// agent-taskboard CLI —— 终端查看项目、登记与流转受管任务。
// 运行：bin/board <cmd>（内部用 node --import tsx）。
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TaskType, TaskImage } from '../server/src/types'; // 类型复用，type-only 不引入运行时依赖
import { taskImagePath } from '../server/src/task-images';

// 管道（如 | head）提前关闭时安静退出，不抛 EPIPE
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
});

const BASE = process.env.BOARD_URL ?? 'http://127.0.0.1:7788';

function token(): string | null {
  if (process.env.BOARD_TOKEN) return process.env.BOARD_TOKEN;
  const f = join(homedir(), '.project-board', 'token');
  try {
    return readFileSync(f, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function headers(write = false): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (write) {
    const t = token();
    if (t) h.authorization = `Bearer ${t}`;
  }
  return h;
}

async function api<T>(path: string, init?: RequestInit & { write?: boolean }): Promise<T> {
  const res = await fetch(BASE + path, { ...init, headers: { ...headers(init?.write), ...init?.headers } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

// 任务状态（看板列）—— 与 server/src/types.ts 的 TaskStatus 同源（不含 archived 的可见五态）
const STATUS_CMDS = ['collected', 'backlog', 'todo', 'doing', 'review', 'done', 'archived'];
const STATUS_LABEL: Record<string, string> = {
  collected: '已收集',
  backlog: '待规划',
  todo: '待开发',
  doing: '进行中',
  review: '待验收',
  done: '已完成',
  archived: '归档',
};
const STATUS_MARK: Record<string, string> = {
  collected: C.dim('◦'),
  backlog: C.dim('·'),
  todo: '○',
  doing: C.yellow('▸'),
  review: C.yellow('⊙'),
  done: C.green('✓'),
};

interface P {
  name: string;
  displayName: string;
  git: { isRepo: boolean; branch: string | null; dirtyCount: number };
  todos: { open: number };
  managed: { collected: number; backlog: number; todo: number; doing: number; review: number; done: number };
  pinned: boolean;
  archived: boolean;
}

async function listProjects() {
  try {
    const r = await api<{ projects: P[] }>('/api/projects');
    const rows = r.projects.filter((p) => !p.archived);
    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length));
    console.log(C.bold(pad('项目', 24) + pad('分支', 22) + pad('改动', 6) + pad('文件待办', 9) + '受管'));
    for (const p of rows) {
      const pin = p.pinned ? '📌 ' : '   ';
      const br = p.git.isRepo ? (p.git.branch ?? '-') : '(no git)';
      const brShow = br.length > 20 ? br.slice(0, 19) + '…' : br;
      console.log(
        pin +
          pad(p.name, 21) +
          pad(brShow, 22) +
          pad(p.git.dirtyCount ? String(p.git.dirtyCount) : '-', 6) +
          pad(String(p.todos.open || '-'), 9) +
          String(p.managed.todo + p.managed.doing + p.managed.review || '-'),
      );
    }
  } catch (e) {
    // 只读 fallback：API 没起时直接扫描
    console.error(C.yellow(`(API 未响应，改为本地直扫：${(e as Error).message})`));
    const { scanProjects } = await import('../server/src/scanner');
    const { CONFIG } = await import('../server/src/config');
    const ps = await scanProjects(CONFIG.roots, CONFIG.extraProjects);
    for (const p of ps) console.log(`${p.name}\t${p.git.branch ?? '(no git)'}\t待办 ${p.todos.open}`);
  }
}

interface Detail extends P {
  path: string;
  tasks: Array<{
    id: number;
    title: string;
    status: string;
    priority: string;
    taskType: TaskType;
    description: string | null;
    assignee?: string | null;
    rejectReason?: string | null;
    images?: TaskImage[]; // 旧服务（未含 images 列）可能不返回此字段，故 optional + 调用处兜底
  }>;
}

async function showProject(name: string, json = false) {
  const d = await api<Detail>(`/api/projects/${encodeURIComponent(name)}`);
  if (json) {
    console.log(JSON.stringify(d));
    return;
  }
  console.log(C.bold(`${d.displayName}  `) + C.dim(d.path));
  console.log(C.dim(`分支 ${d.git.branch ?? '-'} · 改动 ${d.git.dirtyCount} · 文件待办 ${d.todos.open}`));
  console.log(C.bold('\n受管任务:'));
  console.log(C.dim('  （agent 只领「待开发」的活；「已收集」是收件箱未分诊，需人工晋级到「待规划」再排期）'));
  if (d.tasks.length === 0) console.log(C.dim('  (无)'));
  for (const t of d.tasks) {
    const mark = STATUS_MARK[t.status] ?? '○';
    // 列名直接标出，免得 agent 靠 glyph 猜状态
    const stat = C.dim(`[${STATUS_LABEL[t.status] ?? t.status}]`);
    // feature(需求)是默认类型，终端列表里不加标签降噪，只标 bug/优化 这类"非默认"项
    const ty =
      t.taskType === 'bug' ? C.red('[Bug] ') : t.taskType === 'optimize' ? C.yellow('[优化] ') : '';
    const cam = t.images?.length ? C.dim(` 📷${t.images.length}`) : '';
    const who = t.assignee ? C.dim(` @${t.assignee}`) : '';
    console.log(`  ${mark} ${stat} [${t.priority.toUpperCase()}] ${ty}#${t.id} ${t.title}${cam}${who}`);
    if (t.rejectReason && t.rejectReason.trim()) {
      // 上轮验收打回原因——agent 领任务时优先消化这里
      for (const line of t.rejectReason.split('\n')) console.log(C.yellow(`      ⤺ 打回: ${line}`));
    }
    if (t.description && t.description.trim()) {
      for (const line of t.description.split('\n')) console.log(C.dim(`      ${line}`));
    }
    for (const img of t.images ?? []) {
      console.log(C.dim(`      🖼  ${taskImagePath(t.id, img.name)}`));
    }
  }
}

// TYPE_LABEL 的 key 须与 server/src/types.ts 的 TaskType 同步（共三值）
const TYPE_LABEL: Record<TaskType, string> = { feature: '需求', bug: 'Bug', optimize: '优化' };

/** 从标题词组里抽出类型标志（--bug / --optimize|--opt / --feature / --type <t>），返回剩余标题。 */
function extractType(words: string[]): { title: string; taskType?: TaskType } {
  let taskType: TaskType | undefined;
  const rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '--bug') taskType = 'bug';
    else if (w === '--optimize' || w === '--opt') taskType = 'optimize';
    else if (w === '--feature') taskType = 'feature';
    else if (w === '--type') {
      const v = words[++i];
      if (v === undefined || v.startsWith('--'))
        throw new Error('--type 后需跟类型：feature|bug|optimize');
      if (v !== 'bug' && v !== 'optimize' && v !== 'feature')
        throw new Error(`--type 取值须为 feature|bug|optimize，收到：${v}`);
      taskType = v;
    } else rest.push(w);
  }
  return { title: rest.join(' '), taskType };
}

async function addTask(name: string, words: string[]) {
  const { title, taskType } = extractType(words);
  if (!title.trim()) throw new Error('用法：board add <项目> <标题> [--bug|--optimize|--type <t>]');
  const body: { title: string; taskType?: TaskType } = { title };
  if (taskType) body.taskType = taskType;
  const t = await api<{ id: number }>(`/api/projects/${encodeURIComponent(name)}/tasks`, {
    method: 'POST',
    write: true,
    body: JSON.stringify(body),
  });
  const tag = taskType && taskType !== 'feature' ? `[${TYPE_LABEL[taskType]}] ` : '';
  console.log(C.green(`✓ 已新建任务 #${t.id}：${tag}${title}`));
}

function parseFlags(args: string[]): { name?: string; flags: Record<string, string | boolean> } {
  const flags: Record<string, string | boolean> = {};
  let name: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else if (!name) name = a;
  }
  return { name, flags };
}

function safeReal(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** 根据当前工作目录解析所属看板项目名（取路径最长匹配）。 */
async function resolveHere(): Promise<string> {
  // bin/board 会 cd 到 server，故用 BOARD_CWD（用户原始目录）而非 process.cwd()
  const cwd = safeReal(process.env.BOARD_CWD ?? process.cwd());
  const r = await api<{ projects: Array<{ name: string; path: string; missing?: boolean }> }>(
    '/api/projects',
  );
  let best: { name: string; path: string } | null = null;
  let bestLen = -1;
  for (const p of r.projects) {
    if (p.missing) continue; // 目录已失效的历史项目不参与 cwd 匹配
    const pp = safeReal(p.path);
    if (cwd === pp || cwd.startsWith(pp + '/')) {
      if (pp.length > bestLen) {
        best = p;
        bestLen = pp.length;
      }
    }
  }
  if (!best) throw new Error(`当前目录不在任何看板项目内：${cwd}`);
  return best.name;
}

/** 从 `--as <名字>` 或 BOARD_ACTOR 取执行者署名（doing 认领人 / done 验收人共用）。 */
function actorFromArgs(args: string[]): string | undefined {
  const i = args.indexOf('--as');
  if (i >= 0) {
    const actor = args[i + 1];
    if (!actor || actor.startsWith('--')) throw new Error('--as 后需跟名字');
    return actor;
  }
  return process.env.BOARD_ACTOR?.trim() || undefined;
}

async function setStatus(id: number, status: string, args: string[] = []) {
  if (!Number.isInteger(id))
    throw new Error('用法：board here collected|backlog|todo|doing|review|done <任务id>');
  // done 只能经验收端点写入（PATCH 拒绝 done）——置完成是显式的人工验收动作，记录验收人/时间
  if (status === 'done') return acceptCmd(id, args);
  const actor = status === 'doing' ? actorFromArgs(args) : undefined;
  const body = actor ? { status, assignee: actor } : { status };
  await api(`/api/tasks/${id}`, { method: 'PATCH', write: true, body: JSON.stringify(body) });
  console.log(C.green(`✓ #${id} → ${STATUS_LABEL[status] ?? status}`));
}

/** 验收通过：任意态 → 已完成，经 accept 端点写 accepted_at/by（`--as`/BOARD_ACTOR 作验收人署名）。 */
async function acceptCmd(id: number, args: string[] = []) {
  const by = actorFromArgs(args);
  const body = by ? { by } : {};
  await api(`/api/tasks/${id}/accept`, { method: 'POST', write: true, body: JSON.stringify(body) });
  console.log(C.green(`✓ #${id} → ${STATUS_LABEL.done}（验收通过${by ? ` @${by}` : ''}）`));
}

/** 验收打回：待验收 → 待开发并记录原因（原因在任务下次置 review/done 时自动清空）。 */
async function rejectCmd(args: string[]) {
  const id = Number(args[0]);
  const reason = args.slice(1).join(' ').trim();
  if (!Number.isInteger(id) || !reason) throw new Error('用法：board [here] reject <任务id> "打回原因"');
  await api(`/api/tasks/${id}/reject`, { method: 'POST', write: true, body: JSON.stringify({ reason }) });
  console.log(C.yellow(`⤺ #${id} 已打回 → 待开发`));
}

/** `board here ...`：自动认出当前目录所属项目，再执行子命令（供 agent 在项目里直接调用）。 */
async function here(rest: string[]) {
  const name = await resolveHere();
  const [sub, ...args] = rest;
  if (!sub) return showProject(name);
  if (sub === '--json') return showProject(name, true);
  if (sub === 'add') return addTask(name, args);
  if (sub === 'reject') return rejectCmd(args);
  if (STATUS_CMDS.includes(sub)) return setStatus(Number(args[0]), sub, args.slice(1));
  throw new Error(`未知子命令：board here ${sub}`);
}

const BACKUP_KEEP = 14; // 轮转：保留最近 N 份（每日 1 份 ≈ 两周）

async function backup() {
  // 经 server/src/db 调用，以便从 server/node_modules 解析 better-sqlite3
  const { backupTo } = await import('../server/src/db');
  const { mkdirSync, readdirSync, unlinkSync } = await import('node:fs');
  const dir = join(homedir(), '.project-board', 'backups');
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(dir, `board-${ts}.db`);
  await backupTo(dest); // 在线一致快照（WAL 收缩由 server 连接自动 checkpoint 负责）
  console.log(C.green(`✓ 已备份 → ${dest}`));
  // 轮转：备份文件名内嵌 ISO 时间戳，字典序 == 时间序，删最旧、只留最近 BACKUP_KEEP 份。
  // 只匹配 board-*.db（不碰 -shm/-wal 等衍生文件），且删的都是本命令自己产的备份。
  const snaps = readdirSync(dir)
    .filter((f) => /^board-.*\.db$/.test(f))
    .sort();
  for (const f of snaps.slice(0, Math.max(0, snaps.length - BACKUP_KEEP))) {
    unlinkSync(join(dir, f));
    console.log(C.dim(`  · 清理旧备份 ${f}`));
  }
}

function help() {
  console.log(`agent-taskboard CLI

  board                       列出项目
  board <项目> [--json]       查看某项目的受管任务；--json 输出 API 详情原文
  board add <项目> <标题>     新建受管任务（默认进「已收集」，类型=需求）
       --bug | --optimize     标记为 Bug / 优化（亦可 --type feature|bug|optimize）
  board here [--json]         看"当前目录所属项目"的任务（agent 在项目里用）；--json 输出 API 详情原文
  board here add <标题>       给当前项目登记任务（同样支持 --bug|--optimize）
  board here <状态> <id>      改当前会话任务状态
  board <状态> <id>           改任意任务状态
       --as <名字>            doing 认领任务 / done 署验收人（置于 id 之后）；缺省读取 BOARD_ACTOR
  board [here] reject <id> "原因"  验收打回：待验收 → 待开发，原因回灌给 agent
       状态流转：collected 已收集 → backlog 待规划 → todo 待开发 → doing 进行中 → review 待验收 → done 已完成
       （已收集=收件箱，人工分诊采纳后晋级到待规划；agent 干完置 review 待验收，由人验收后 done）
  board backup                备份看板数据库到 ~/.project-board/backups/
  board open                  打印看板地址
  board help                  本帮助

  环境：BOARD_URL（默认 http://127.0.0.1:7788）、BOARD_TOKEN（或 ~/.project-board/token）
        BOARD_ACTOR（认领署名默认值）`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (!cmd || cmd === 'ls') return await listProjects();
    if (cmd === 'help' || cmd === '--help' || cmd === '-h') return help();
    if (cmd === 'open') return console.log(BASE);
    if (cmd === 'backup') return await backup();
    if (cmd === 'add') return await addTask(rest[0], rest.slice(1));
    if (cmd === 'here') return await here(rest);
    if (cmd === 'reject') return await rejectCmd(rest);
    // 状态命令须后接整数 id（board done 5）才生效；否则把 cmd 当项目名，避免与"项目恰好叫 done/review"冲突
    if (STATUS_CMDS.includes(cmd) && /^\d+$/.test(rest[0] ?? ''))
      return await setStatus(Number(rest[0]), cmd, rest.slice(1));
    // 否则把 cmd 当项目名
    return await showProject(cmd, rest[0] === '--json');
  } catch (e) {
    console.error(C.red(`错误：${(e as Error).message}`));
    process.exit(1);
  }
}

main();
