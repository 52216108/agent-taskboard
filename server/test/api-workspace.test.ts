import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { app } from '../src/index';
import { useInMemoryDb } from '../src/db';
import { CONFIG } from '../src/config';
import { createTask, ensureProject, patchProject } from '../src/repo';

// 与 api.test.ts 不同，这组用例**需要**真扫描：工作区/子仓的路由解析（name 带斜杠）、详情的亲属任务、
// merge / move 都建立在扫描结果之上。扫描根指向一个临时目录，只含两个小 git 仓，不会碰用户的 BOARD_ROOTS。
function gitInit(dir: string, remote: string) {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
}

let root: string;
const origRoots = CONFIG.roots;
const origExtra = CONFIG.extraProjects;

beforeAll(() => {
  // realpath：macOS 的 tmpdir 是 /var → /private/var 的软链，扫描器按 realpath 取工作区身份键，测试路径须与之一致
  root = realpathSync(mkdtempSync(join(tmpdir(), 'board-api-ws-')));
  mkdirSync(join(root, 'acme'));
  writeFileSync(join(root, 'acme', 'README.md'), '# Acme\n');
  gitInit(join(root, 'acme', 'acme-app'), 'git@github.com:acme/acme-app.git');
  gitInit(join(root, 'acme', 'server'), 'git@github.com:acme/server.git');
  gitInit(join(root, 'solo'), 'git@github.com:acme/solo.git');
  CONFIG.roots = [root];
  CONFIG.extraProjects = [];
});

afterAll(() => {
  CONFIG.roots = origRoots;
  CONFIG.extraProjects = origExtra;
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  useInMemoryDb();
  CONFIG.token = null;
  await app.inject({ method: 'POST', url: '/api/projects/scan' }); // 每例重扫，rawCache 与干净内存库对齐
});

const wsPath = () => join(root, 'acme');

describe('工作区 / 子仓的路由与详情', () => {
  it('列表：外壳是 workspace，子仓 name=外壳/子仓、parent=外壳', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    const { projects } = res.json() as { projects: Array<{ name: string; kind: string; parent: string | null; key: string }> };
    const ws = projects.find((p) => p.name === 'acme')!;
    expect(ws.kind).toBe('workspace');
    expect(ws.key).toBe(wsPath());
    const child = projects.find((p) => p.name === 'acme/acme-app')!;
    expect(child.kind).toBe('repo');
    expect(child.parent).toBe('acme');
    expect(projects.find((p) => p.name === 'solo')?.parent).toBeNull();
  });

  it('子仓名带斜杠：按 %2F 转义能命中详情与建任务路由', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects/acme%2Facme-app/tasks',
      payload: { title: '子仓任务', status: 'todo' },
    });
    expect(created.statusCode).toBe(200);
    const detail = await app.inject({ method: 'GET', url: '/api/projects/acme%2Facme-app' });
    expect(detail.statusCode).toBe(200);
    const d = detail.json() as { name: string; tasks: Array<{ title: string }>; workspace?: { name: string; tasks: unknown[] } };
    expect(d.name).toBe('acme/acme-app');
    expect(d.tasks.map((t) => t.title)).toEqual(['子仓任务']);
    // 子仓详情附带所属工作区（及其跨仓任务）
    expect(d.workspace?.name).toBe('acme');
    expect(d.workspace?.tasks).toEqual([]);
  });

  it('工作区详情附带每个子仓的任务；工作区自己的任务单列', async () => {
    createTask(wsPath(), wsPath(), { title: '跨仓任务', status: 'todo' });
    createTask('github.com/acme/server', join(root, 'acme', 'server'), { title: '服务端任务' });
    const res = await app.inject({ method: 'GET', url: '/api/projects/acme' });
    expect(res.statusCode).toBe(200);
    const d = res.json() as {
      kind: string;
      tasks: Array<{ title: string }>;
      children: Array<{ name: string; tasks: Array<{ title: string }> }>;
    };
    expect(d.kind).toBe('workspace');
    expect(d.tasks.map((t) => t.title)).toEqual(['跨仓任务']);
    expect(d.children.map((c) => c.name).sort()).toEqual(['acme/acme-app', 'acme/server']);
    expect(d.children.find((c) => c.name === 'acme/server')?.tasks.map((t) => t.title)).toEqual(['服务端任务']);
  });

  it('扫描时把外壳的旧行（借子仓键、路径=外壳）归并成一行，任务全部可见', async () => {
    // 旧版留下的两行：都以外壳路径登记，键分别借自两个子仓
    createTask('github.com/acme/acme-app', wsPath(), { title: '老任务 A', status: 'todo' });
    createTask('github.com/acme/server', wsPath(), { title: '老任务 B', status: 'doing' });
    patchProject('github.com/acme/server', wsPath(), { displayName: '七合一' });
    await app.inject({ method: 'POST', url: '/api/projects/scan' });

    const res = await app.inject({ method: 'GET', url: '/api/projects/acme' });
    const d = res.json() as { displayName: string; managed: Record<string, number>; tasks: Array<{ title: string }>; children: Array<{ tasks: unknown[] }> };
    expect(d.displayName).toBe('七合一');
    expect(d.tasks.map((t) => t.title).sort()).toEqual(['老任务 A', '老任务 B']);
    expect(d.managed).toMatchObject({ todo: 1, doing: 1 });
    // 子仓不继承外壳的旧行（路径证明那些行当初是作为外壳建的）
    expect(d.children.every((c) => c.tasks.length === 0)).toBe(true);
    // 列表里没有 stale/missing 残留
    const list = (await app.inject({ method: 'GET', url: '/api/projects' })).json() as { projects: Array<{ missing: boolean }> };
    expect(list.projects.some((p) => p.missing)).toBe(false);
  });
});

describe('跨仓任务的「涉及仓」标签（tags）', () => {
  it('校验：非数组/非字符串/空串/超长 → 400；合法则 trim + 去重落库', async () => {
    const post = (tags: unknown) =>
      app.inject({ method: 'POST', url: '/api/projects/acme/tasks', payload: { title: 't', tags } });
    expect((await post('acme-app')).statusCode).toBe(400);
    expect((await post([1])).statusCode).toBe(400);
    expect((await post([''])).statusCode).toBe(400);
    expect((await post(['x'.repeat(41)])).statusCode).toBe(400);
    expect((await post(Array.from({ length: 21 }, (_, i) => `t${i}`))).statusCode).toBe(400);
    const ok = await post([' acme-app ', 'server', 'acme-app']);
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { tags: string[] }).tags).toEqual(['acme-app', 'server']);
    // PATCH 同样校验与归一
    const id = (ok.json() as { id: number }).id;
    expect((await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, payload: { tags: 'x' } })).statusCode).toBe(400);
    const patched = await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, payload: { tags: ['server '] } });
    expect((patched.json() as { tags: string[] }).tags).toEqual(['server']);
  });

  it('子仓详情只带涉及本仓（或未标仓）的工作区任务；工作区详情不过滤', async () => {
    createTask(wsPath(), wsPath(), { title: '没标仓', status: 'todo' });
    createTask(wsPath(), wsPath(), { title: '只涉及 server', status: 'todo', tags: ['server'] });
    createTask(wsPath(), wsPath(), { title: '两个都涉及', status: 'todo', tags: ['acme-app', 'server'] });
    const app1 = (await app.inject({ method: 'GET', url: '/api/projects/acme%2Facme-app' })).json() as {
      workspace: { tasks: Array<{ title: string }> };
    };
    expect(app1.workspace.tasks.map((t) => t.title).sort()).toEqual(['两个都涉及', '没标仓']);
    const srv = (await app.inject({ method: 'GET', url: '/api/projects/acme%2Fserver' })).json() as {
      workspace: { tasks: Array<{ title: string }> };
    };
    expect(srv.workspace.tasks.map((t) => t.title).sort()).toEqual(['两个都涉及', '只涉及 server', '没标仓']);
    const ws = (await app.inject({ method: 'GET', url: '/api/projects/acme' })).json() as { tasks: unknown[] };
    expect(ws.tasks).toHaveLength(3);
  });
});

describe('merge / move', () => {
  it('stale 旧行以 #id 出现在列表，merge 后并入现役项目并消失', async () => {
    createTask('gitee.com/acme/solo', join(root, 'solo'), { title: '迁移前的任务', status: 'todo' });
    createTask('github.com/acme/solo', join(root, 'solo'), { title: '迁移后的任务' });
    await app.inject({ method: 'POST', url: '/api/projects/scan' });
    const list = (await app.inject({ method: 'GET', url: '/api/projects' })).json() as {
      projects: Array<{ name: string; stale: boolean; missing: boolean; dbId: number }>;
    };
    const old = list.projects.find((p) => p.stale)!;
    expect(old).toBeDefined();
    expect(old.name).toBe(`#${old.dbId}`);
    expect(old.missing).toBe(true);

    const res = await app.inject({ method: 'POST', url: '/api/projects/merge', payload: { from: old.name, into: 'solo' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { project: { name: string; managed: Record<string, number> }; backup: string | null };
    expect(body.project.name).toBe('solo');
    expect(body.project.managed).toMatchObject({ todo: 1, collected: 1 });
    expect(body.backup).toBeNull(); // 内存库不备份

    const after = (await app.inject({ method: 'GET', url: '/api/projects' })).json() as { projects: Array<{ missing: boolean }> };
    expect(after.projects.some((p) => p.missing)).toBe(false);
  });

  it('merge 校验：缺参数 400、目标不存在 404、来源无看板数据 400、自己并自己 400', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/projects/merge', payload: { from: 'solo' } })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/api/projects/merge', payload: { from: 'solo', into: 'nope' } })).statusCode,
    ).toBe(404);
    // solo 还没登记过任何任务 → 没有 DB 行可并
    expect(
      (await app.inject({ method: 'POST', url: '/api/projects/merge', payload: { from: 'solo', into: 'acme' } })).statusCode,
    ).toBe(400);
    ensureProject('github.com/acme/solo', join(root, 'solo'));
    expect(
      (await app.inject({ method: 'POST', url: '/api/projects/merge', payload: { from: 'solo', into: 'solo' } })).statusCode,
    ).toBe(400);
  });

  it('move：任务从工作区下放到子仓', async () => {
    const t = createTask(wsPath(), wsPath(), { title: '先挂在工作区', status: 'todo' });
    const res = await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/move`, payload: { project: 'acme/server' } });
    expect(res.statusCode).toBe(200);
    const d = (await app.inject({ method: 'GET', url: '/api/projects/acme' })).json() as {
      tasks: unknown[];
      children: Array<{ name: string; tasks: Array<{ id: number }> }>;
    };
    expect(d.tasks).toEqual([]);
    expect(d.children.find((c) => c.name === 'acme/server')?.tasks.map((x) => x.id)).toEqual([t.id]);
    expect((await app.inject({ method: 'POST', url: '/api/tasks/9999/move', payload: { project: 'solo' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/move`, payload: { project: 'nope' } })).statusCode).toBe(404);
  });
});
