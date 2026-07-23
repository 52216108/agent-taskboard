import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../src/index';
import { useInMemoryDb } from '../src/db';
import { CONFIG } from '../src/config';
import { createTask, updateTask } from '../src/repo';

// 用 app.inject 打真实路由，不 listen——只覆盖"防线 + 鉴权门 + 请求校验"这些在 handler 早期
// 就短路返回的分支（enrich 合并另有 repo.test.ts 单测）。
// 刻意避开会触发磁盘扫描的路由（/api/projects/* 会 spawn 一堆 git 去扫 BOARD_ROOTS）：
// 鉴权用例改打图片路由，它只做参数校验 + existsSync 就 404，与被测的门无关且不碰文件系统。

beforeEach(() => {
  useInMemoryDb(); // 每例干净内存库（schema 已建），handler 走它
  CONFIG.token = null; // 默认不开鉴权
});

describe('反 DNS rebinding / 反 CSRF（与 token 无关的运行期防线）', () => {
  it('陌生 Host → 403（DNS rebinding 后 Host 仍是攻击者域名）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { host: 'evil.example.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'bad host' });
  });

  it('浏览器发起的跨站写请求 → 403（text/plain 不触发预检，只能靠这道拦）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/__nonexistent__/tasks',
      headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' },
    });
    expect(res.statusCode).toBe(403);
    // 断言具体错误，避免与 Host 白名单的 403 混淆（inject 默认 Host 是 localhost，在白名单内）
    expect(res.json()).toMatchObject({ error: 'cross-site request rejected' });
  });

  it('same-origin 与 none（地址栏直达）放行', async () => {
    for (const site of ['same-origin', 'none']) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/tasks/999999/images/00000000-0000-4000-8000-000000000000.png',
        headers: { 'sec-fetch-site': site },
      });
      expect(res.statusCode, site).not.toBe(403);
    }
  });

  it('不带 Sec-Fetch-Site 的客户端（CLI/curl）放行', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks/999999/images/00000000-0000-4000-8000-000000000000.png' });
    expect(res.statusCode).not.toBe(403);
  });

  it('静态资源不受 Host 白名单限制（否则反代下前端打不开）', async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: { host: 'evil.example.com' } });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('请求校验（不依赖扫描的快速分支）', () => {
  it('PATCH /api/tasks/:id 非整数 id → 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/tasks/abc', payload: { status: 'todo' } });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /api/tasks/:id 非法 status → 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/tasks/1', payload: { status: 'nope' } });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /api/tasks/:id 非法 dueDate → 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/tasks/1', payload: { dueDate: '2026/01/01' } });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /api/tasks/:id 不存在的任务 → 404', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/tasks/999999', payload: { status: 'todo' } });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/tasks/:id assignee 超过 32 字符 → 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/tasks/1', payload: { assignee: 'a'.repeat(33) } });
    expect(res.statusCode).toBe(400);
  });

  it.each(['', '   '])('PATCH /api/tasks/:id assignee 空串或纯空白 %j → 400', async (assignee) => {
    const res = await app.inject({ method: 'PATCH', url: '/api/tasks/1', payload: { assignee } });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /api/tasks/:id 正常 assignee → 200 并 trim 后入库', async () => {
    const task = createTask('k', '/p', { title: '认领任务' });
    const res = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { assignee: ' codex ' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().assignee).toBe('codex');
  });

  it('PATCH /api/tasks/:id assignee=null → 200 并清空', async () => {
    const task = createTask('k', '/p', { title: '认领任务', assignee: 'codex' });
    const res = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { assignee: null } });
    expect(res.statusCode).toBe(200);
    expect(res.json().assignee).toBeNull();
  });

  it('POST /api/tasks/:id/reject 缺 reason → 400', async () => {
    const task = createTask('k', '/p', { title: '待打回', status: 'review' });
    const res = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/reject`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/tasks/:id/reject 非待验收任务 → 400', async () => {
    const task = createTask('k', '/p', { title: '还没交付' }); // 默认 collected
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/reject`,
      payload: { reason: '不行' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/tasks/:id/reject 不存在 → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tasks/999999/reject', payload: { reason: '不行' } });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/tasks/:id/reject reason 超 500 字符 → 400', async () => {
    const task = createTask('k', '/p', { title: '待打回', status: 'review' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/reject`,
      payload: { reason: 'a'.repeat(501) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/tasks/:id/reject 纯空白 reason → 400', async () => {
    const task = createTask('k', '/p', { title: '待打回', status: 'review' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/reject`,
      payload: { reason: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH 无法写入 rejectReason（白名单回归锁：只能由打回接口写）', async () => {
    const task = createTask('k', '/p', { title: 'A' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { rejectReason: '注入尝试' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rejectReason).toBeNull();
  });

  it('POST /api/tasks/:id/reject 正常 → 200，todo + 原因，重新置 review 后清空', async () => {
    const task = createTask('k', '/p', { title: '待打回', status: 'review' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/reject`,
      payload: { reason: ' 缺测试 ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('todo');
    expect(res.json().rejectReason).toBe('缺测试'); // trim 后入库
    expect(updateTask(task.id, { status: 'review' })!.rejectReason).toBeNull();
  });

  // ── 验收通过 accept + done 门禁（board #355）──
  it('PATCH /api/tasks/:id status=done → 400（done 只能经 accept 端点）', async () => {
    const task = createTask('k', '/p', { title: '待验收', status: 'review' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(400);
    expect(updateTask(task.id, {})!.status).toBe('review'); // 未被写成 done
  });

  it('POST /api/tasks/:id/accept 不存在 → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tasks/999999/accept', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/tasks/:id/accept review → done，写 completedAt/acceptedAt，清空打回原因', async () => {
    const task = createTask('k', '/p', { title: '待验收', status: 'review' });
    const res = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/accept`, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('done');
    expect(body.completedAt).toBeTruthy();
    expect(body.acceptedAt).toBeTruthy();
    expect(body.acceptedBy).toBeNull();
  });

  it('POST /api/tasks/:id/accept 任意态(doing)也可验收通过（宽松语义）', async () => {
    const task = createTask('k', '/p', { title: '进行中', status: 'doing' });
    const res = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/accept`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('done');
  });

  it('POST /api/tasks/:id/accept by → 记录验收人（trim 后入库）', async () => {
    const task = createTask('k', '/p', { title: '待验收', status: 'review' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/accept`,
      payload: { by: ' gavin ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().acceptedBy).toBe('gavin');
  });

  it('POST /api/tasks/:id/accept by 超 32 字符 → 400', async () => {
    const task = createTask('k', '/p', { title: '待验收', status: 'review' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/accept`,
      payload: { by: 'a'.repeat(33) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('离开 done 时验收记录一并清空（accept 后退回 doing）', async () => {
    const task = createTask('k', '/p', { title: '待验收', status: 'review' });
    await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/accept`, payload: { by: 'gavin' } });
    const back = updateTask(task.id, { status: 'doing' })!;
    expect(back.completedAt).toBeNull();
    expect(back.acceptedAt).toBeNull();
    expect(back.acceptedBy).toBeNull();
  });

  it('POST /api/tasks/:id/accept by 非字符串 → 400', async () => {
    const task = createTask('k', '/p', { title: '待验收', status: 'review' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/accept`,
      payload: { by: 123 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/tasks/:id/accept 非整数 id → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tasks/abc/accept', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('re-accept 保留原 completedAt、只刷新 acceptedAt（宽松语义下重复验收）', async () => {
    const task = createTask('k', '/p', { title: '待验收', status: 'review' });
    const first = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/accept`, payload: {} });
    const completedAt = first.json().completedAt;
    const second = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/accept`, payload: {} });
    expect(second.json().completedAt).toBe(completedAt); // 完成时间不变
    expect(second.json().status).toBe('done');
  });

  // ── 子任务清单（board #354）──
  it('新建任务 subtasks 默认空数组', () => {
    const task = createTask('k', '/p', { title: '父任务' });
    expect(task.subtasks).toEqual([]);
  });

  it('PATCH /api/tasks/:id subtasks 正常 → 200，落库可取回（trim 标题）', async () => {
    const task = createTask('k', '/p', { title: '父任务' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: {
        subtasks: [
          { id: 1, title: ' 写迁移 ', done: true },
          { id: 2, title: '改 API', done: false },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().subtasks).toEqual([
      { id: 1, title: '写迁移', done: true }, // trim 后入库
      { id: 2, title: '改 API', done: false },
    ]);
  });

  it('PATCH subtasks 非数组 → 400', async () => {
    const task = createTask('k', '/p', { title: '父' });
    const res = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { subtasks: 'nope' } });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH subtasks 空标题 → 400', async () => {
    const task = createTask('k', '/p', { title: '父' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { subtasks: [{ id: 1, title: '   ', done: false }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH subtasks 缺 done 字段 → 400', async () => {
    const task = createTask('k', '/p', { title: '父' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { subtasks: [{ id: 1, title: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH subtasks 超 50 条 → 400', async () => {
    const task = createTask('k', '/p', { title: '父' });
    const many = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, title: `s${i}`, done: false }));
    const res = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { subtasks: many } });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH subtasks 重复 id → 400（防前端 key 撞车）', async () => {
    const task = createTask('k', '/p', { title: '父' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { subtasks: [{ id: 1, title: 'a', done: false }, { id: 1, title: 'b', done: false }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH subtasks id 非正整数 → 400', async () => {
    const task = createTask('k', '/p', { title: '父' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { subtasks: [{ id: 0, title: 'a', done: false }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('鉴权门（设 BOARD_TOKEN 时）', () => {
  const TOKEN = 'test-secret';
  beforeEach(() => {
    CONFIG.token = TOKEN;
  });
  afterEach(() => {
    CONFIG.token = null;
  });

  it('无 token 的读接口 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks/999999/images/00000000-0000-4000-8000-000000000000.png' });
    expect(res.statusCode).toBe(401);
  });

  it('header 带正确 token 的读 → 过门（命中业务 404）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks/999999/images/00000000-0000-4000-8000-000000000000.png',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('读接口可用 ?token= 放行（<img>/SSE 无法设 header）', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/tasks/999999/images/00000000-0000-4000-8000-000000000000.png?token=${TOKEN}` });
    expect(res.statusCode).toBe(404);
  });

  it('静态资源(非 /api)即使开了 token 也放行（否则远程连登录页都打不开）', async () => {
    // 测试环境未挂静态 handler，故命中 404；关键是"不为 401"——证明鉴权门放行了非 /api 路径
    const res = await app.inject({ method: 'GET', url: '/some-spa-route' });
    expect(res.statusCode).not.toBe(401);
  });

  it('错 token → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks/999999/images/00000000-0000-4000-8000-000000000000.png',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('写操作不接受 ?token= 查询参数（仍 401，防 CSRF/日志泄露）', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/999999?token=${TOKEN}`,
      payload: { status: 'todo' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('写操作 header 带正确 token → 过门（非 401）', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/tasks/999999',
      payload: { status: 'todo' },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).not.toBe(401);
  });
});
