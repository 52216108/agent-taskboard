import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, createReadStream } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { CONFIG, buildAllowedHosts, checkSecureBinding, hostnameOf } from './config';
import { scanProjects, buildDetail } from './scanner';
import { getDb } from './db';
import {
  enrich,
  reconcilePaths,
  readScanCache,
  writeScanCache,
  patchProject,
  listTasks,
  listAllTasks,
  createTask,
  updateTask,
  rejectTask,
  acceptTask,
  importTodos,
  addTaskImage,
  removeTaskImage,
  type ProjectPatch,
  type NewTask,
  type TaskPatch,
} from './repo';
import type { ProjectInfo, TaskStatus, TaskPriority, TaskType } from './types';
import {
  saveImage,
  deleteImage,
  taskImagePath,
  isValidName,
  extForMime,
  contentTypeForName,
} from './task-images';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STATUSES: TaskStatus[] = ['collected', 'backlog', 'todo', 'doing', 'review', 'done', 'archived'];
const PRIORITIES: TaskPriority[] = ['p0', 'p1', 'p2', 'p3'];
const TASK_TYPES: TaskType[] = ['feature', 'bug', 'optimize'];

// 仅缓存昂贵的原始扫描结果（git/fs）；DB 覆盖/任务计数在每次请求时 enrich（廉价）。
let rawCache: { at: number; data: ProjectInfo[] } | null = null;
let inflight: Promise<ProjectInfo[]> | null = null;

async function runScan(): Promise<ProjectInfo[]> {
  const data = await scanProjects(CONFIG.roots, CONFIG.extraProjects);
  reconcilePaths(data); // 改名迁移（写）只在新鲜扫描时做
  const at = Date.now();
  rawCache = { at, data };
  writeScanCache(data, new Date(at).toISOString());
  return data;
}

/** 获取原始扫描：新鲜缓存直返；陈旧→返陈旧并后台刷新；无缓存→等待。 */
async function getRaw(force = false): Promise<ProjectInfo[]> {
  if (force) return runScan();
  if (rawCache && Date.now() - rawCache.at < CONFIG.scanTtlMs) return rawCache.data;
  if (rawCache) {
    if (!inflight) inflight = runScan().finally(() => (inflight = null));
    return rawCache.data; // 陈旧但即时
  }
  if (!inflight) inflight = runScan().finally(() => (inflight = null));
  return inflight;
}

function listResponse() {
  const raw = rawCache?.data ?? [];
  const projects = enrich(raw);
  return { scannedAt: rawCache?.at ?? null, count: projects.length, roots: CONFIG.roots, projects };
}

/** 从当前（enriched）列表按名字解析单个项目，供详情/任务/覆盖路由复用。 */
async function resolve(name: string): Promise<ProjectInfo | undefined> {
  await getRaw();
  return enrich(rawCache?.data ?? []).find((p) => p.name === name);
}

// 模块作用域构建 app 并注册路由；导出供集成测试 app.inject 复用（listen 只在下方入口守护里做）。
// 测试下关掉 access log：几十个用例会刷出几百行 JSON，把真正的失败信息淹掉。
export const app = Fastify({
  logger: process.env.VITEST ? false : {
    level: 'info',
    serializers: {
      // 读路径的 token 只能走 ?token=（<img> 无法设 header）；从 access log 里脱敏，避免 token 落盘。
      req(req: import('fastify').FastifyRequest) {
        return {
          method: req.method,
          url: req.url.replace(/([?&]token=)[^&]*/g, '$1__redacted__'),
          host: req.host,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        };
      },
    },
  },
});

// 任务附图：把图片 mime 收成原始 Buffer（不引 multipart）；只注册这几种，默认 JSON parser 不受影响。
// bodyLimit 在此显式设置——否则哪天路由级 bodyLimit 被改掉，parse 阶段会静默回退到 Fastify 默认 1MB。
const IMG_BODY_LIMIT = 10 * 1024 * 1024; // 10MB
app.addContentTypeParser(
  ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  { parseAs: 'buffer', bodyLimit: IMG_BODY_LIMIT },
  (_req, body, done) => done(null, body),
);

// 反 DNS rebinding + 反 CSRF。这道防线与 token 无关，**默认配置（无 token、绑 loopback）下尤其关键**：
// 浏览器可以向 127.0.0.1 发跨站请求，且 text/plain 的 POST 属于 CORS simple request 不触发预检，
// 因此任意网页都能命中写接口（改任务状态、删图片等）。
//   · Host 白名单挡 DNS rebinding（rebind 后请求变同源，但 Host 头仍是攻击者域名）
//   · Sec-Fetch-Site 挡浏览器发起的跨站请求；same-origin/none(地址栏直达) 放行
// 不带 Sec-Fetch-Site 的客户端（curl、CLI、老浏览器）放行：CSRF 的攻击载体是浏览器，
// 能在本机跑 curl 的攻击者已经拿到了远比这更大的权限，拦它没有收益却会打断 CLI。
/** 常量时间比较凭证；长度不等直接判否（长度本身不是秘密）。 */
function tokenEquals(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ALLOWED_HOSTS = buildAllowedHosts(CONFIG.allowedHosts);
app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/')) return;
  if (!ALLOWED_HOSTS.has(hostnameOf(req.headers.host ?? ''))) {
    // 带上补救办法：经反代/隧道访问时这是最常见的第一个坑，只回 "bad host" 无从下手
    return reply.code(403).send({
      error: 'bad host',
      hint: `Host "${req.headers.host ?? ''}" 不在白名单内。经反代/隧道访问请设 BOARD_ALLOWED_HOSTS=<你的域名>`,
    });
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    return reply.code(403).send({ error: 'cross-site request rejected' });
  }
});

// 鉴权：设置了 BOARD_TOKEN 才生效。静态资源(非 /api)一律放行——否则远程连登录页都打不开、无从填 token。
// 写操作坚持 header-only（Bearer），保留 CSRF 防护；读操作(GET/HEAD)额外允许 ?token= 查询参数，
// 因为 <img src> 无法设自定义 header，只能靠查询参数带 token。
app.addHook('preHandler', async (req, reply) => {
  if (!CONFIG.token) return;
  if (req.method === 'OPTIONS') return;
  // 用原始 url 前缀判 /api/ 与 find-my-way 路由匹配只在"默认不做 slash 归一化"下一致；
  // 若日后开 ignoreTrailingSlash/ignoreDuplicateSlashes，需重审此鉴权边界避免绕过。
  if (!req.url.startsWith('/api/')) return;
  // 常量时间比较：`===` 的短路行为会随首个不同字节的位置泄漏时长，理论上可被逐字节爆破
  const headerOk = tokenEquals(req.headers.authorization, `Bearer ${CONFIG.token}`);
  const isRead = req.method === 'GET' || req.method === 'HEAD';
  const queryOk =
    isRead && tokenEquals((req.query as { token?: string } | undefined)?.token, CONFIG.token);
  if (!headerOk && !queryOk) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
});

// ── 项目 ──────────────────────────────────────────────────────
app.get('/api/projects', async () => {
  await getRaw();
  return listResponse();
});

app.post('/api/projects/scan', async () => {
  await getRaw(true);
  return listResponse();
});

app.get<{ Params: { name: string } }>('/api/projects/:name', async (req, reply) => {
  const p = await resolve(req.params.name);
  if (!p) return reply.code(404).send({ error: `project not found: ${req.params.name}` });
  // 目录已消失的项目不去读其文件系统，直接给空 todo/readme，仍带回受管任务
  if (p.missing) return { ...p, todoItems: [], readmeExcerpt: null, tasks: listTasks(p.key) };
  return { ...buildDetail(p), tasks: listTasks(p.key) };
});

// 项目覆盖：置顶/归档/改展示名/改简介
app.patch<{ Params: { name: string }; Body: ProjectPatch }>(
  '/api/projects/:name',
  async (req, reply) => {
    const p = await resolve(req.params.name);
    if (!p) return reply.code(404).send({ error: 'project not found' });
    patchProject(p.key, p.path, req.body ?? {});
    return enrich(rawCache?.data ?? []).find((x) => x.key === p.key) ?? p;
  },
);

// ── 受管任务 ──────────────────────────────────────────────────
app.get<{ Params: { name: string }; Querystring: { includeArchived?: string } }>(
  '/api/projects/:name/tasks',
  async (req, reply) => {
    const p = await resolve(req.params.name);
    if (!p) return reply.code(404).send({ error: 'project not found' });
    return { tasks: listTasks(p.key, req.query.includeArchived === '1') };
  },
);

// 跨项目全局任务（附 projectName/key/path），用于工作台视图
app.get<{ Querystring: { includeArchived?: string } }>('/api/tasks', async (req) => {
  await getRaw();
  const byKey = new Map(enrich(rawCache?.data ?? []).map((p) => [p.key, p]));
  const tasks = listAllTasks(req.query.includeArchived === '1').map(({ task, projectKey, projectPath }) => {
    const p = byKey.get(projectKey);
    const dir = projectPath.split('/').filter(Boolean).pop() ?? projectKey;
    return {
      ...task,
      projectKey,
      projectPath,
      projectName: p?.displayName ?? dir, // 展示名
      projectDir: p?.name ?? dir, // 路由用的目录名（= detail 路由的 :name）
    };
  });
  return { tasks };
});

app.post<{ Params: { name: string }; Body: NewTask }>(
  '/api/projects/:name/tasks',
  async (req, reply) => {
    const p = await resolve(req.params.name);
    if (!p) return reply.code(404).send({ error: 'project not found' });
    const body = req.body ?? ({} as NewTask);
    if (!body.title || !body.title.trim()) return reply.code(400).send({ error: 'title required' });
    if (body.priority !== undefined && !PRIORITIES.includes(body.priority))
      return reply.code(400).send({ error: 'bad priority' });
    if (body.taskType !== undefined && !TASK_TYPES.includes(body.taskType))
      return reply.code(400).send({ error: 'bad taskType' });
    if (body.status !== undefined && !STATUSES.includes(body.status))
      return reply.code(400).send({ error: 'bad status' });
    if (body.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate))
      return reply.code(400).send({ error: 'bad dueDate (need YYYY-MM-DD)' });
    if (body.assignee !== undefined && body.assignee !== null) {
      if (typeof body.assignee !== 'string') return reply.code(400).send({ error: 'bad assignee' });
      body.assignee = body.assignee.trim();
      if (body.assignee.length < 1 || body.assignee.length > 32)
        return reply.code(400).send({ error: 'bad assignee (need 1-32 chars)' });
    }
    return createTask(p.key, p.path, body);
  },
);

app.patch<{ Params: { id: string }; Body: TaskPatch }>('/api/tasks/:id', async (req, reply) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return reply.code(400).send({ error: 'bad id' });
  const body = req.body ?? {};
  if (body.status !== undefined && !STATUSES.includes(body.status))
    return reply.code(400).send({ error: 'bad status' });
  // done 只能经验收端点写入（人工验收 = 显式动作 + 记 accepted_at/by）。PATCH 拒绝，防 agent 的常规
  // 状态流转误置完成；这是防误操作 + 可审计，不是防绕过（人机同 token，同一进程能改也能调 accept）。
  if (body.status === 'done')
    return reply
      .code(400)
      .send({ error: 'cannot set done via PATCH; use POST /api/tasks/:id/accept (human acceptance)' });
  if (body.priority !== undefined && !PRIORITIES.includes(body.priority))
    return reply.code(400).send({ error: 'bad priority' });
  if (body.taskType !== undefined && !TASK_TYPES.includes(body.taskType))
    return reply.code(400).send({ error: 'bad taskType' });
  if (body.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate))
    return reply.code(400).send({ error: 'bad dueDate (need YYYY-MM-DD)' });
  if (body.assignee !== undefined && body.assignee !== null) {
    if (typeof body.assignee !== 'string') return reply.code(400).send({ error: 'bad assignee' });
    body.assignee = body.assignee.trim();
    if (body.assignee.length < 1 || body.assignee.length > 32)
      return reply.code(400).send({ error: 'bad assignee (need 1-32 chars)' });
  }
  const updated = updateTask(id, body);
  if (!updated) return reply.code(404).send({ error: 'task not found' });
  return updated;
});

// 验收打回：待验收(review) → 待开发(todo)，记录原因供 agent 下轮领取时消化
app.post<{ Params: { id: string }; Body: { reason?: unknown } }>(
  '/api/tasks/:id/reject',
  async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'bad id' });
    const raw = (req.body ?? {}).reason;
    if (typeof raw !== 'string') return reply.code(400).send({ error: 'reason required' });
    const reason = raw.trim();
    if (reason.length < 1 || reason.length > 500)
      return reply.code(400).send({ error: 'bad reason (need 1-500 chars)' });
    const r = rejectTask(id, reason);
    if (r.error === 'not_found') return reply.code(404).send({ error: 'task not found' });
    if (r.error === 'not_review')
      return reply.code(400).send({ error: 'only review task can be rejected' });
    return r.task;
  },
);

// 验收通过：置任务 done（唯一入口，PATCH 拒绝 done）。body.by=验收人署名，可空（单用户模型下自报、仅供审计）。
// 与 reject 对称，宽松语义：任意状态皆可验收通过。
app.post<{ Params: { id: string }; Body: { by?: unknown } }>(
  '/api/tasks/:id/accept',
  async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'bad id' });
    let by: string | null = null;
    const raw = (req.body ?? {}).by;
    if (raw !== undefined && raw !== null) {
      if (typeof raw !== 'string') return reply.code(400).send({ error: 'bad by' });
      by = raw.trim();
      if (by.length < 1 || by.length > 32)
        return reply.code(400).send({ error: 'bad by (need 1-32 chars)' });
    }
    const r = acceptTask(id, by);
    if (r.error === 'not_found') return reply.code(404).send({ error: 'task not found' });
    return r.task;
  },
);

// ── 任务图片附件（IMG_BODY_LIMIT 见上方 content-type parser 处）──
app.post<{ Params: { id: string } }>(
  '/api/tasks/:id/images',
  { bodyLimit: IMG_BODY_LIMIT },
  async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'bad id' });
    const mime = String(req.headers['content-type'] ?? '')
      .split(';')[0]
      .trim();
    if (!extForMime(mime))
      return reply.code(400).send({ error: `unsupported image type: ${mime || '(none)'}` });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0)
      return reply.code(400).send({ error: 'empty image body' });
    const { name } = saveImage(id, req.body, mime);
    const task = addTaskImage(id, { name, addedAt: new Date().toISOString() });
    if (!task) {
      deleteImage(id, name); // 任务不存在 → 回滚刚落盘的文件
      return reply.code(404).send({ error: 'task not found' });
    }
    return { name, url: `/api/tasks/${id}/images/${name}` };
  },
);

app.get<{ Params: { id: string; name: string } }>(
  '/api/tasks/:id/images/:name',
  async (req, reply) => {
    const id = Number(req.params.id);
    const name = req.params.name;
    if (!Number.isInteger(id) || id <= 0 || !isValidName(name))
      return reply.code(400).send({ error: 'bad request' });
    const path = taskImagePath(id, name);
    if (!existsSync(path)) return reply.code(404).send({ error: 'image not found' });
    return reply.type(contentTypeForName(name)).send(createReadStream(path));
  },
);

app.delete<{ Params: { id: string; name: string } }>(
  '/api/tasks/:id/images/:name',
  async (req, reply) => {
    const id = Number(req.params.id);
    const name = req.params.name;
    if (!Number.isInteger(id) || id <= 0 || !isValidName(name))
      return reply.code(400).send({ error: 'bad request' });
    // 先改 DB（含任务存在性校验），确认存在再删文件——与 POST 回滚逻辑对称，避免任务不存在时静默删掉孤儿文件
    const task = removeTaskImage(id, name);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    deleteImage(id, name);
    return { ok: true };
  },
);

// 从 todo.md 导入为受管任务（去重）
app.post<{ Params: { name: string } }>('/api/projects/:name/import', async (req, reply) => {
  const p = await resolve(req.params.name);
  if (!p) return reply.code(404).send({ error: 'project not found' });
  if (p.missing) return { imported: 0, skipped: 0 }; // 目录已消失，无文件可导
  // 只导入未完成项：已完成的 todo 无需再变成需要管理的受管任务
  const items = buildDetail(p).todoItems.filter((t) => t.status !== 'done');
  if (items.length === 0) return { imported: 0, skipped: 0 };
  return importTodos(p.key, p.path, items);
});

async function main() {
  const insecure = checkSecureBinding();
  if (insecure) {
    console.error(insecure);
    process.exit(1);
  }

  getDb(); // 初始化 DB + 建表
  const cached = readScanCache();
  if (cached) {
    rawCache = { at: new Date(cached.scannedAt).getTime(), data: cached.payload };
    app.log.info(`primed from scan_cache: ${cached.payload.length} projects @ ${cached.scannedAt}`);
  }

  const clientDist = join(__dirname, '../../client/dist');
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ port: CONFIG.port, host: CONFIG.host });
  app.log.info(
    `agent-taskboard → http://${CONFIG.host}:${CONFIG.port}  (roots: ${CONFIG.roots.join(', ')}; extra: ${CONFIG.extraProjects.join(', ') || 'none'})`,
  );
}

// 被 vitest import 时不自动 listen（VITEST 由 vitest 注入，测试只需 app.inject）；生产/直接运行照常启动。
if (!process.env.VITEST) {
  main().catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
}
