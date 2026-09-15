// agent-taskboard CLI —— 终端查看项目、登记与流转受管任务。
// 运行：bin/board <cmd>（内部用 node --import tsx）。
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TaskType, TaskImage, SubTask, ProjectKind } from '../server/src/types'; // 类型复用，type-only 不引入运行时依赖
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

/** 项目名进 URL：子仓名形如 `外壳/子仓`，斜杠逐段转义（服务端按 %2F 还原成同一个 name）。 */
const enc = (name: string) => name.split('/').map(encodeURIComponent).join('%2F');

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
  path: string;
  kind: ProjectKind;
  parent: string | null;
  git: { isRepo: boolean; branch: string | null; dirtyCount: number };
  todos: { open: number };
  managed: { collected: number; backlog: number; todo: number; doing: number; review: number; done: number };
  pinned: boolean;
  archived: boolean;
  missing?: boolean;
  stale?: boolean;
  dbId?: number | null;
}

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length));
const clip = (s: string, n: number) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);

async function listProjects() {
  try {
    const r = await api<{ projects: P[] }>('/api/projects');
    const rows = r.projects.filter((p) => !p.archived);
    const live = rows.filter((p) => !p.missing);
    const old = rows.filter((p) => p.missing);
    const activeOf = (p: P) => String(p.managed.todo + p.managed.doing + p.managed.review || '-');
    console.log(C.bold(pad('项目', 40) + pad('分支', 22) + pad('改动', 6) + pad('文件待办', 9) + '受管'));
    const line = (p: P, indent: string) => {
      const pin = p.pinned ? '📌 ' : '   ';
      const kids = live.filter((c) => c.parent === p.name).length;
      const br =
        p.kind === 'workspace' ? `工作区 · ${kids} 子仓` : p.git.isRepo ? (p.git.branch ?? '-') : '(no git)';
      console.log(
        pin +
          pad(indent + clip(p.name, 37 - [...indent].length), 37) +
          pad(clip(br, 20), 22) +
          pad(p.git.dirtyCount ? String(p.git.dirtyCount) : '-', 6) +
          pad(String(p.todos.open || '-'), 9) +
          activeOf(p),
      );
    };
    // 服务端已把子仓紧排在工作区后面；这里只管缩进
    for (const p of live) line(p, p.parent ? '└ ' : '');
    if (old.length > 0) {
      console.log(C.dim("\n仅存在于看板的旧行（目录已消失 / 身份键已变更），用 board merge <旧行id> <现役项目> 并入（id 写成 13 或 '#13'，裸 #13 在 bash 里是注释）："));
      for (const p of old) {
        const why = p.stale ? '身份已变更' : '目录已消失';
        console.log(`   ${pad(p.name, 8)} ${pad(clip(p.displayName, 20), 22)} ${C.dim(why)}  受管 ${activeOf(p)}  ${C.dim(p.path)}`);
      }
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

interface TaskRow {
  id: number;
  title: string;
  status: string;
  priority: string;
  taskType: TaskType;
  description: string | null;
  assignee?: string | null;
  rejectReason?: string | null;
  tags?: string[]; // 跨仓任务的「涉及仓」（子仓目录名）；旧服务可能不返回
  images?: TaskImage[]; // 旧服务（未含 images 列）可能不返回此字段，故 optional + 调用处兜底
  subtasks?: SubTask[]; // 同上，旧服务可能不返回
}

interface TasksRef {
  name: string;
  displayName: string;
  path: string;
  tasks: TaskRow[];
}

interface Detail extends P {
  tasks: TaskRow[];
  /** 工作区详情：各子仓及其任务 */
  children?: TasksRef[];
  /** 子仓详情：所属工作区及其跨仓任务 */
  workspace?: TasksRef;
}

function printTasks(tasks: TaskRow[]) {
  if (tasks.length === 0) console.log(C.dim('  (无)'));
  for (const t of tasks) {
    const mark = STATUS_MARK[t.status] ?? '○';
    // 列名直接标出，免得 agent 靠 glyph 猜状态
    const stat = C.dim(`[${STATUS_LABEL[t.status] ?? t.status}]`);
    // feature(需求)是默认类型，终端列表里不加标签降噪，只标 bug/优化 这类"非默认"项
    const ty =
      t.taskType === 'bug' ? C.red('[Bug] ') : t.taskType === 'optimize' ? C.yellow('[优化] ') : '';
    const cam = t.images?.length ? C.dim(` 📷${t.images.length}`) : '';
    const who = t.assignee ? C.dim(` @${t.assignee}`) : '';
    const subs = t.subtasks ?? [];
    const subCount = subs.length ? C.dim(` (${subs.filter((s) => s.done).length}/${subs.length})`) : '';
    // 涉及仓标签：跨仓任务标出碰哪几个子仓（值=子仓目录名）
    const tg = t.tags?.length ? C.dim(` ⟨${t.tags.join(', ')}⟩`) : '';
    console.log(`  ${mark} ${stat} [${t.priority.toUpperCase()}] ${ty}#${t.id} ${t.title}${tg}${cam}${who}${subCount}`);
    if (t.rejectReason && t.rejectReason.trim()) {
      // 上轮验收打回原因——agent 领任务时优先消化这里
      for (const line of t.rejectReason.split('\n')) console.log(C.yellow(`      ⤺ 打回: ${line}`));
    }
    if (t.description && t.description.trim()) {
      for (const line of t.description.split('\n')) console.log(C.dim(`      ${line}`));
    }
    // 子任务清单缩进列出（☑ 已完成 / ☐ 未完成）
    for (const s of subs) {
      console.log(C.dim(`      ${s.done ? '☑' : '☐'} ${s.title}`));
    }
    for (const img of t.images ?? []) {
      console.log(C.dim(`      🖼  ${taskImagePath(t.id, img.name)}`));
    }
  }
}

/**
 * 项目任务视图。工作区：先列工作区自己的（跨仓）任务，再逐个子仓分组；
 * 子仓：先列本仓任务，再附上工作区的跨仓任务——挂在工作区上的活在任何子仓里都能看到。
 * 分组标题顶格输出（不带前导空格），任务行固定"两空格+符号"开头，说明行缩进更深；
 * 会话 hook 靠这个版式过滤已完成任务，改版式需同步。
 */
async function showProject(name: string, json = false) {
  const d = await api<Detail>(`/api/projects/${enc(name)}`);
  if (json) {
    console.log(JSON.stringify(d));
    return;
  }
  const kids = d.children ?? [];
  console.log(C.bold(`${d.displayName}  `) + C.dim(d.path));
  if (d.kind === 'workspace') {
    console.log(C.dim(`工作区 · ${kids.length} 个子仓 · 改动 ${d.git.dirtyCount} · 文件待办 ${d.todos.open}`));
  } else if (d.parent) {
    console.log(C.dim(`子仓 · 属于工作区 ${d.parent} · 分支 ${d.git.branch ?? '-'} · 改动 ${d.git.dirtyCount} · 文件待办 ${d.todos.open}`));
  } else {
    console.log(C.dim(`分支 ${d.git.branch ?? '-'} · 改动 ${d.git.dirtyCount} · 文件待办 ${d.todos.open}`));
  }
  if (d.stale) console.log(C.yellow(`身份键已变更的旧行（目录仍在）：用 board merge ${d.name.slice(1)} <现役项目> 并入`));
  else if (d.missing) console.log(C.yellow('目录已消失，任务仍保留；可用 board merge 并入别的项目'));
  console.log(C.bold('\n受管任务:'));
  console.log(C.dim('  （agent 只领「待开发」的活；「已收集」是收件箱未分诊，需人工晋级到「待规划」再排期）'));
  if (d.kind === 'workspace') {
    console.log(C.dim(`  工作区级任务（跨仓，⟨…⟩ 为涉及仓）；登记到某个子仓用 board here add "标题" --repo <子仓>，涉及多个仓写多个 --repo`));
  }
  printTasks(d.tasks);
  for (const c of kids) {
    console.log(C.bold(`\n── 子仓 ${c.displayName}（${c.name}）──`));
    printTasks(c.tasks);
  }
  if (d.workspace) {
    console.log(C.bold(`\n── 工作区 ${d.workspace.displayName}（${d.workspace.name}）的跨仓任务（涉及本仓或未标仓）──`));
    printTasks(d.workspace.tasks);
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

/**
 * 从词组里抽出 `--repo <子仓>`（只在 here add 里用），可重复、可逗号分隔（--repo a --repo b / --repo a,b），
 * 返回去重后的子仓名列表与剩余词。
 */
function extractRepos(words: string[]): { repos: string[]; rest: string[] } {
  const repos: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== '--repo') {
      rest.push(words[i]);
      continue;
    }
    const v = words[++i];
    if (!v || v.startsWith('--')) throw new Error('--repo 后需跟子仓目录名');
    for (const r of v.split(',').map((x) => x.trim()).filter(Boolean)) if (!repos.includes(r)) repos.push(r);
  }
  return { repos, rest };
}

async function addTask(name: string, words: string[], tags?: string[]) {
  const { title, taskType } = extractType(words);
  if (!title.trim()) throw new Error('用法：board add <项目> <标题> [--bug|--optimize|--type <t>]');
  const body: { title: string; taskType?: TaskType; tags?: string[] } = { title };
  if (taskType) body.taskType = taskType;
  if (tags?.length) body.tags = tags;
  const t = await api<{ id: number }>(`/api/projects/${enc(name)}/tasks`, {
    method: 'POST',
    write: true,
    body: JSON.stringify(body),
  });
  const tag = taskType && taskType !== 'feature' ? `[${TYPE_LABEL[taskType]}] ` : '';
  const tg = tags?.length ? ` ⟨${tags.join(', ')}⟩` : '';
  console.log(C.green(`✓ 已新建任务 #${t.id}：${tag}${title}`) + C.dim(`  → ${name}${tg}`));
}

/**
 * 设置任务的涉及仓标签：`board tags <id> a b`；不带仓名 = 清空。
 * 仓名与 `--repo` 同款校验（必须是该任务所在工作区的子仓）：写错的仓名不匹配任何子仓，
 * 任务会从每个子仓的 `board here` 里消失，只剩工作区层可见，很难察觉。
 */
async function tagsCmd(args: string[]) {
  const id = Number(args[0]);
  if (!Number.isInteger(id)) throw new Error('用法：board tags <任务id> [子仓名...]（不带仓名=清空）');
  const tags = [...new Set(args.slice(1).flatMap((a) => a.split(',').map((x) => x.trim()).filter(Boolean)))];
  if (tags.length > 0) {
    const all = await api<{ tasks: Array<{ id: number; projectDir: string; projectParent: string | null }> }>('/api/tasks?includeArchived=1');
    const t = all.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`任务 #${id} 不存在`);
    const r = await api<{ projects: P[] }>('/api/projects');
    const owner = r.projects.find((x) => x.name === t.projectDir);
    const ws = t.projectParent ?? (owner?.kind === 'workspace' ? owner.name : null);
    if (!ws) throw new Error(`任务 #${id} 不在工作区（多仓外壳）上，涉及仓标签没有意义`);
    const subs = r.projects.filter((x) => x.parent === ws && !x.missing).map((x) => x.name.slice(ws.length + 1));
    const unknown = tags.filter((x) => !subs.includes(x));
    if (unknown.length) throw new Error(`工作区 ${ws} 下没有子仓 ${unknown.join(', ')}；可选：${subs.join(', ') || '(无)'}`);
  }
  await api(`/api/tasks/${id}`, { method: 'PATCH', write: true, body: JSON.stringify({ tags }) });
  console.log(C.green(`✓ #${id} 涉及仓 → ${tags.length ? tags.join(', ') : '(清空)'}`));
}

function safeReal(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** 根据当前工作目录解析所属看板项目（取路径最长匹配：在子仓里命中子仓，在外壳里命中工作区）。 */
async function resolveHere(): Promise<P> {
  // bin/board 会 cd 到 server，故用 BOARD_CWD（用户原始目录）而非 process.cwd()
  const cwd = safeReal(process.env.BOARD_CWD ?? process.cwd());
  const r = await api<{ projects: P[] }>('/api/projects');
  let best: P | null = null;
  let bestLen = -1;
  for (const p of r.projects) {
    if (p.missing) continue; // 目录已失效 / 身份已变更的旧行不参与 cwd 匹配
    const pp = safeReal(p.path);
    if (cwd === pp || cwd.startsWith(pp + '/')) {
      if (pp.length > bestLen) {
        best = p;
        bestLen = pp.length;
      }
    }
  }
  if (!best) throw new Error(`当前目录不在任何看板项目内：${cwd}`);
  return best;
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

/**
 * 合并项目行：from（通常是 `#<id>` 旧行）的任务整体并入 into，from 行删除；服务端合并前自动备份。
 * 纯数字参数视为 `#<id>`：裸 `#13` 在 bash / 非交互 zsh 里是注释，会被 shell 吞掉，agent 从 Bash 工具里调用时尤其容易踩。
 */
async function mergeCmd(args: string[]) {
  const asName = (a: string | undefined) => (a && /^\d+$/.test(a) ? `#${a}` : a);
  const from = asName(args[0]);
  const into = asName(args[1]);
  if (!from || !into) throw new Error("用法：board merge <旧行 id，如 13 或 '#13'> <现役项目名>");
  const r = await api<{ project: P; backup: string | null }>('/api/projects/merge', {
    method: 'POST',
    write: true,
    body: JSON.stringify({ from, into }),
  });
  console.log(C.green(`✓ 已把 ${from} 并入 ${r.project.name}`) + (r.backup ? C.dim(`  备份：${r.backup}`) : ''));
}

/** 任务改挂到另一个项目（如从工作区下放到具体子仓）。 */
async function moveCmd(args: string[]) {
  const id = Number(args[0]);
  const project = args[1];
  if (!Number.isInteger(id) || !project) throw new Error('用法：board move <任务id> <项目名，子仓写成 外壳/子仓>');
  await api(`/api/tasks/${id}/move`, { method: 'POST', write: true, body: JSON.stringify({ project }) });
  console.log(C.green(`✓ #${id} → ${project}`));
}

/**
 * `board here ...`：自动认出当前目录所属项目，再执行子命令（供 agent 在项目里直接调用）。
 * `here add` 支持 `--repo <子仓>`：在工作区（或其某个子仓）里把任务登记到指定子仓。
 */
async function here(rest: string[]) {
  const p = await resolveHere();
  const [sub, ...args] = rest;
  if (!sub) return showProject(p.name);
  if (sub === '--json') return showProject(p.name, true);
  if (sub === 'add') {
    const { repos, rest: words } = extractRepos(args);
    if (repos.length === 0) return addTask(p.name, words);
    const ws = p.kind === 'workspace' ? p.name : p.parent;
    if (!ws) throw new Error('--repo 只在工作区（多仓外壳）或其子仓目录里可用');
    const r = await api<{ projects: P[] }>('/api/projects');
    const subs = r.projects.filter((x) => x.parent === ws && !x.missing).map((x) => x.name.slice(ws.length + 1));
    const unknown = repos.filter((x) => !subs.includes(x));
    if (unknown.length) throw new Error(`工作区 ${ws} 下没有子仓 ${unknown.join(', ')}；可选：${subs.join(', ') || '(无)'}`);
    // 只涉及一个仓 → 归属该子仓；涉及多个 → 跨仓任务，归属工作区并标注涉及仓
    if (repos.length === 1) return addTask(`${ws}/${repos[0]}`, words);
    return addTask(ws, words, repos);
  }
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
  // 只匹配 board-*.db（不碰 -shm/-wal 等衍生文件，也不碰服务端合并前自动落的 pre-merge-*.db），
  // 且删的都是本命令自己产的备份。
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

  board                       列出项目（多仓外壳显示为工作区，子仓缩进在其下，名字形如 外壳/子仓）
  board <项目> [--json]       查看某项目的受管任务；--json 输出 API 详情原文
  board add <项目> <标题>     新建受管任务（默认进「已收集」，类型=需求）
       --bug | --optimize     标记为 Bug / 优化（亦可 --type feature|bug|optimize）
  board here [--json]         看"当前目录所属项目"的任务（agent 在项目里用）；--json 输出 API 详情原文
                              在外壳目录里看到工作区任务 + 各子仓任务；在子仓里看到本仓任务 + 工作区的跨仓任务
  board here add <标题>       给当前项目登记任务（同样支持 --bug|--optimize）
       --repo <子仓>          在工作区里把任务登记到指定子仓；写多个（--repo a --repo b 或 --repo a,b）
                              = 跨仓任务：落工作区并标注涉及仓；不写 = 落工作区、不标仓
  board here <状态> <id>      改当前会话任务状态
  board <状态> <id>           改任意任务状态
       --as <名字>            doing 认领任务 / done 署验收人（置于 id 之后）；缺省读取 BOARD_ACTOR
  board [here] reject <id> "原因"  验收打回：待验收 → 待开发，原因回灌给 agent
       状态流转：collected 已收集 → backlog 待规划 → todo 待开发 → doing 进行中 → review 待验收 → done 已完成
       （已收集=收件箱，人工分诊采纳后晋级到待规划；agent 干完置 review 待验收，由人验收后 done）
  board move <id> <项目>      把任务改挂到另一个项目（如从工作区下放到 外壳/子仓）
  board tags <id> [子仓...]   设置任务的涉及仓标签（跨仓任务标出碰哪几个子仓；不带参数=清空）
  board merge <旧行id> <项目> 把旧项目行（列表里形如 #13：目录已消失/身份已变更）的任务并入现役项目，合并前自动备份
                              id 写 13 或 '#13'（裸 #13 会被 shell 当注释）
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
    if (cmd === 'merge') return await mergeCmd(rest);
    if (cmd === 'move') return await moveCmd(rest);
    if (cmd === 'tags') return await tagsCmd(rest);
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
