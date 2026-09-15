import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG } from './config';
import { getDb, isInMemoryDb, backupTo } from './db';
import type { ProjectInfo, Task, TaskImage, SubTask, TaskStatus, TaskPriority, TaskType, TodoItem } from './types';

const now = () => new Date().toISOString();

// ── 行类型（snake_case，与表对应）──────────────────────────────
interface ProjectRow {
  id: number;
  project_key: string;
  path: string;
  display_name: string | null;
  description: string | null;
  pinned: number;
  archived: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
interface TaskRow {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  task_type: TaskType;
  due_date: string | null;
  assignee: string | null;
  reject_reason: string | null;
  tags: string | null;
  images: string | null;
  subtasks: string | null;
  source: 'manual' | 'todo_md';
  todo_fingerprint: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
}

function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    taskType: r.task_type,
    dueDate: r.due_date,
    assignee: r.assignee,
    rejectReason: r.reject_reason,
    tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    images: r.images ? (JSON.parse(r.images) as TaskImage[]) : [],
    subtasks: r.subtasks ? (JSON.parse(r.subtasks) as SubTask[]) : [],
    source: r.source,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    acceptedAt: r.accepted_at,
    acceptedBy: r.accepted_by,
  };
}

// ── 项目：懒创建 / 覆盖 / 路径迁移 ────────────────────────────
/** 懒创建项目行，返回 id（已存在则顺带迁移 path）。 */
export function ensureProject(key: string, path: string): number {
  const db = getDb();
  const row = db.prepare('SELECT id, path FROM project WHERE project_key = ?').get(key) as
    | { id: number; path: string }
    | undefined;
  if (row) {
    if (row.path !== path) {
      db.prepare('UPDATE project SET path = ?, updated_at = ? WHERE id = ?').run(path, now(), row.id);
    }
    return row.id;
  }
  const t = now();
  const r = db
    .prepare('INSERT INTO project (project_key, path, created_at, updated_at) VALUES (?,?,?,?)')
    .run(key, path, t, t);
  return Number(r.lastInsertRowid);
}

export interface ProjectPatch {
  displayName?: string | null;
  description?: string | null;
  pinned?: boolean;
  archived?: boolean;
}

/** 更新项目覆盖字段（不存在则懒创建）。 */
export function patchProject(key: string, path: string, patch: ProjectPatch): void {
  const db = getDb();
  ensureProject(key, path);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('displayName' in patch) {
    sets.push('display_name = ?');
    vals.push(patch.displayName ?? null);
  }
  if ('description' in patch) {
    sets.push('description = ?');
    vals.push(patch.description ?? null);
  }
  if ('pinned' in patch) {
    sets.push('pinned = ?');
    vals.push(patch.pinned ? 1 : 0);
  }
  if ('archived' in patch) {
    sets.push('archived = ?');
    vals.push(patch.archived ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(now(), key);
  db.prepare(`UPDATE project SET ${sets.join(', ')} WHERE project_key = ?`).run(...vals);
}

/**
 * 扫描完成后调用：key 匹配但目录已改名 → 更新 path（在一个事务里批量）。
 * 路径落在某个扫描到的工作区（外壳）上的行一律不动：那是旧版外壳借子仓 remote 当键留下的行，
 * 按路径规则归工作区（见 reconcileWorkspaces）。若归并那一步失败（备份写不进去等）而这里仍按键把它
 * 搬到子仓路径，归并所依据的"路径=外壳"证据就没了，整批外壳历史任务会静默落到子仓、下轮也无法再试。
 */
export function reconcilePaths(scanned: ProjectInfo[]): void {
  const db = getDb();
  const wsPaths = new Set(scanned.filter((p) => p.kind === 'workspace').map((p) => p.path));
  const upd = db.prepare(
    'UPDATE project SET path = ?, updated_at = ? WHERE project_key = ? AND path <> ?',
  );
  const sel = db.prepare('SELECT path FROM project WHERE project_key = ?');
  const tx = db.transaction((items: ProjectInfo[]) => {
    for (const p of items) {
      const row = sel.get(p.key) as { path: string } | undefined;
      if (!row || row.path === p.path || wsPaths.has(row.path)) continue;
      upd.run(p.path, now(), p.key, p.path);
    }
  });
  tx(scanned);
}

// ── 项目行合并（工作区旧行自动归并 / 手动 merge）────────────────

/**
 * 合并前先做一次在线备份到 `<db 目录>/backups/pre-merge-<时间>.db`。
 * 合并会移动任务归属并删除被并入的 project 行，是本项目唯一会"减少行数"的写操作——
 * 备份失败就抛出，调用方据此放弃合并（宁可旧行继续以 stale 形式显示，也不做无备份的合并）。
 * 测试用内存库没有磁盘文件可备，直接跳过。
 */
async function backupBeforeMerge(): Promise<string | null> {
  if (isInMemoryDb()) return null;
  const dir = join(dirname(CONFIG.dbPath), 'backups');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `pre-merge-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await backupTo(dest);
  return dest;
}

/**
 * 把若干 project 行并入目标行（同一事务）：任务整体改挂到目标行；展示名/简介目标行为空时继承来源；
 * 置顶取并集；只有全部都归档时目标才保持归档；最后删除来源行。
 * 任务的 todo_fingerprint 含来源行的 project_key，不同来源行的指纹必不相同，故迁移不会撞
 * `(project_id, todo_fingerprint)` 唯一索引。
 * 已知边界：目标行日后若换了 project_key（工作区归并会重打键），旧指纹与新键算出的指纹不再相等，
 * 同一 todo.md 条目再次「导入」会多出一份——只影响用过 todo.md 导入的工作区，且导入是显式动作。
 */
function mergeRowsTx(intoId: number, fromIds: number[]): void {
  const db = getDb();
  const get = db.prepare('SELECT * FROM project WHERE id = ?');
  const moveTasks = db.prepare('UPDATE task SET project_id = ?, updated_at = ? WHERE project_id = ?');
  const del = db.prepare('DELETE FROM project WHERE id = ?');
  const setMeta = db.prepare(
    'UPDATE project SET display_name = ?, description = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ?',
  );
  db.transaction(() => {
    const into = get.get(intoId) as ProjectRow | undefined;
    if (!into) throw new Error(`project row ${intoId} not found`);
    let displayName = into.display_name;
    let description = into.description;
    let pinned = !!into.pinned;
    let archived = !!into.archived;
    for (const fid of fromIds) {
      if (fid === intoId) continue;
      const from = get.get(fid) as ProjectRow | undefined;
      if (!from) throw new Error(`project row ${fid} not found`);
      moveTasks.run(intoId, now(), fid);
      displayName ??= from.display_name;
      description ??= from.description;
      pinned = pinned || !!from.pinned;
      archived = archived && !!from.archived;
      del.run(fid);
    }
    setMeta.run(displayName, description, pinned ? 1 : 0, archived ? 1 : 0, now(), intoId);
  })();
}

/**
 * 手动合并：把 from 行并入 into 行（任务整体迁移，from 行删除），合并前自动备份。
 * 用途：remote 迁移（gitee → 自建 git）留下的旧行、外壳身份漂移留下的 stale 行，并回现役项目。
 * 返回备份文件路径（内存库为 null）。
 */
export async function mergeProjects(fromId: number, intoId: number): Promise<string | null> {
  if (fromId === intoId) throw new Error('cannot merge a project into itself');
  const backup = await backupBeforeMerge();
  mergeRowsTx(intoId, [fromId]);
  return backup;
}

/**
 * 扫描后调用：把工作区（多仓外壳）的历史项目行归并成一行，并把身份键统一为外壳 realpath。
 *
 * 背景：旧版把外壳的身份键"借"自某个子仓的 remote，子仓一增删改名，借的对象就变，
 * 下一次写任务便新插一行，旧行既不显示也不算失效（路径还在）——同一个外壳在库里散成多行、任务隐身。
 * 归并规则：路径等于外壳路径的所有行（不论旧键是什么）都属于这个外壳——路径是"这行当初作为外壳建的"证据；
 * 而路径指向子仓自身的行（子仓曾是顶层项目、后来挪进外壳）按键归子仓，不在此处理。
 * 目标行优先取已是 realpath 键者，否则任务最多者（并列取最早建的）；随后重打键与路径。
 * 幂等：归并完成后每个外壳恰有一行且键=realpath，再次调用不会再动。首次真正归并前做一次备份。
 * 返回归并的外壳数。
 */
export async function reconcileWorkspaces(scanned: ProjectInfo[]): Promise<number> {
  const db = getDb();
  const sel = db.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM task t WHERE t.project_id = p.id) AS task_count
     FROM project p WHERE p.path = ? OR p.project_key = ? ORDER BY p.id`,
  );
  const rekey = db.prepare('UPDATE project SET project_key = ?, path = ?, updated_at = ? WHERE id = ?');
  let merged = 0;
  let backedUp = false;
  for (const ws of scanned) {
    if (ws.kind !== 'workspace') continue;
    const rows = sel.all(ws.path, ws.key) as Array<ProjectRow & { task_count: number }>;
    if (rows.length === 0) continue;
    if (rows.length === 1 && rows[0].project_key === ws.key && rows[0].path === ws.path) continue;
    if (!backedUp) {
      await backupBeforeMerge(); // 失败即抛出，整轮放弃（下次扫描再试）
      backedUp = true;
    }
    const target =
      rows.find((r) => r.project_key === ws.key) ??
      [...rows].sort((a, b) => b.task_count - a.task_count || a.id - b.id)[0];
    db.transaction(() => {
      mergeRowsTx(
        target.id,
        rows.filter((r) => r.id !== target.id).map((r) => r.id),
      );
      rekey.run(ws.key, ws.path, now(), target.id);
    })();
    merged++;
  }
  return merged;
}

/** 把任务改挂到另一个项目（项目行不存在则懒创建）。任务不存在返回 null。 */
export function moveTask(id: number, projectKey: string, path: string): Task | null {
  const db = getDb();
  if (!getTask(id)) return null;
  const projectId = ensureProject(projectKey, path);
  db.prepare('UPDATE task SET project_id = ?, updated_at = ? WHERE id = ?').run(projectId, now(), id);
  return getTask(id);
}

/** 各项目按状态的受管任务计数（排除 archived），六状态分桶。 */
type ManagedCounts = { collected: number; backlog: number; todo: number; doing: number; review: number; done: number };
const emptyManaged = (): ManagedCounts => ({ collected: 0, backlog: 0, todo: 0, doing: 0, review: 0, done: 0 });

function managedCounts(): Map<number, ManagedCounts> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT project_id, status, COUNT(*) AS c FROM task WHERE status <> 'archived' GROUP BY project_id, status`,
    )
    .all() as Array<{ project_id: number; status: TaskStatus; c: number }>;
  const map = new Map<number, ManagedCounts>();
  for (const r of rows) {
    const m = map.get(r.project_id) ?? emptyManaged();
    // archived 已被 WHERE 排除；其余六状态各自落桶
    if (r.status !== 'archived') m[r.status] = r.c;
    map.set(r.project_id, m);
  }
  return map;
}

/** 每项目：未完成任务的最高优先级 + 逾期数。 */
function taskSignals(): Map<number, { topPriority: TaskPriority | null; overdue: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = getDb()
    .prepare(
      // MIN(priority) 取最高优先级：依赖优先级码 'p0'<'p1'<'p2'<'p3' 的字典序恰好等于优先级降序，
      // 故 MIN 得到最高优先级(p0)。若日后改优先级码值，这里需同步改。
      `SELECT project_id,
              MIN(priority) AS top,
              SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue
       FROM task WHERE status IN ('todo','doing','review') GROUP BY project_id`,
    )
    .all(today) as Array<{ project_id: number; top: TaskPriority | null; overdue: number }>;
  return new Map(rows.map((r) => [r.project_id, { topPriority: r.top, overdue: r.overdue }]));
}

/**
 * 仅存在于 DB 的行（目录已消失 / 身份键已对不上）转成列表项。
 * name 用 `#<dbId>`：这类行的目录名常与现役项目撞名（huaji 旧行 vs 挪进外壳后的 xxx/huaji），
 * 按目录名解析会永远命中现役项目，旧行就没法被打开、也没法被 merge 指到。
 */
function dbOnlyProject(row: ProjectRow, managed: ManagedCounts, stale: boolean): ProjectInfo {
  const dirName = row.path.split('/').filter(Boolean).pop() ?? row.path;
  return {
    key: row.project_key,
    path: row.path,
    name: `#${row.id}`,
    kind: 'repo',
    parent: null,
    displayName: row.display_name || dirName,
    description: row.description,
    techStack: [],
    git: { isRepo: false, branch: null, dirtyCount: 0, lastCommit: null, remote: null },
    todos: { open: 0, doing: 0, done: 0, total: 0 },
    hasTasksFile: false,
    docs: { directory: false, schema: false, api: false },
    lastActive: null,
    error: null,
    dbId: row.id,
    pinned: !!row.pinned,
    archived: !!row.archived,
    missing: true,
    stale,
    managed,
    topPriority: null,
    overdue: 0,
  };
}

/**
 * 用 DB 状态丰富扫描结果（只读）：应用覆盖、受管任务计数；并追加"只存在于 DB"的行——
 * 目录已消失的标 missing，目录还在但身份键对不上的标 stale（missing 同时为 true）。
 * 路径迁移不在这里做（只读），由 reconcilePaths / reconcileWorkspaces 在扫描后单独执行。
 */
export function enrich(scanned: ProjectInfo[]): ProjectInfo[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM project').all() as ProjectRow[];
  const byKey = new Map(rows.map((r) => [r.project_key, r]));
  const byPath = new Map(rows.map((r) => [r.path, r]));
  const counts = managedCounts();
  const sig = taskSignals();
  const scannedPaths = new Set(scanned.map((p) => p.path));
  const claimed = new Set<number>(); // 被某个扫描项目认领的行 id

  const enriched = scanned.map((p): ProjectInfo => {
    // 先按稳定身份键匹配；键对不上时按路径兜底（remote 刚迁移、还没来得及 merge 的过渡期），
    // 保证目录仍在的项目不丢 DB 覆盖/任务计数。兜底只读、不写回：
    // 路径复用（删掉仓 A、把不同的仓 B 克隆进同一路径）会按 path 命中 A 的旧行，只读兜底每次重扫都有自愈机会，
    // 写回则会一锤定音劫持。真要归并由用户显式 merge（工作区例外：路径即身份，reconcileWorkspaces 自动归并）。
    const row = byKey.get(p.key) ?? byPath.get(p.path);
    if (row) claimed.add(row.id);
    const m = (row && counts.get(row.id)) || emptyManaged();
    const s = (row && sig.get(row.id)) || { topPriority: null, overdue: 0 };
    return {
      ...p,
      displayName: row?.display_name || p.displayName,
      description: row?.description ?? p.description,
      dbId: row?.id ?? null,
      pinned: row ? !!row.pinned : false,
      archived: row ? !!row.archived : false,
      missing: false,
      stale: false,
      managed: m,
      topPriority: s.topPriority,
      overdue: s.overdue,
    };
  });

  for (const row of rows) {
    if (claimed.has(row.id)) continue;
    // 没被任何扫描项目认领的行：路径还被扫到 → 身份键漂移留下的旧行（stale）；否则目录真的没了（missing）
    const mp = dbOnlyProject(row, counts.get(row.id) ?? emptyManaged(), scannedPaths.has(row.path));
    const s = sig.get(row.id);
    if (s) {
      mp.topPriority = s.topPriority;
      mp.overdue = s.overdue;
    }
    enriched.push(mp);
  }
  return enriched;
}

// ── scan_cache：缓存原始扫描结果 ──────────────────────────────
export function readScanCache(): { payload: ProjectInfo[]; scannedAt: string } | null {
  const db = getDb();
  const row = db.prepare('SELECT payload, scanned_at FROM scan_cache WHERE id = 1').get() as
    | { payload: string; scanned_at: string }
    | undefined;
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload) as ProjectInfo[];
    // 旧版进程写的快照没有 kind/parent 等字段（升级前的缓存）：当作没有缓存，启动后立刻真扫一次，
    // 否则首屏会用缺字段的旧快照渲染出一批"形态未知"的项目。
    if (!payload.every((p) => typeof p.kind === 'string')) return null;
    return { payload, scannedAt: row.scanned_at };
  } catch {
    return null;
  }
}

export function writeScanCache(payload: ProjectInfo[], scannedAt: string): void {
  getDb()
    .prepare(
      `INSERT INTO scan_cache (id, payload, scanned_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, scanned_at = excluded.scanned_at`,
    )
    .run(JSON.stringify(payload), scannedAt);
}

// ── 任务 CRUD ────────────────────────────────────────────────
export function listTasks(projectKey: string, includeArchived = false): Task[] {
  const db = getDb();
  const proj = db.prepare('SELECT id FROM project WHERE project_key = ?').get(projectKey) as
    | { id: number }
    | undefined;
  if (!proj) return [];
  const clause = includeArchived ? '' : "AND status <> 'archived'";
  const rows = db
    .prepare(
      `SELECT * FROM task WHERE project_id = ? ${clause}
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(proj.id) as TaskRow[];
  return rows.map(rowToTask);
}

/** 跨项目全局任务列表（按优先级→截止→创建排序），附所属项目 key/path。 */
export function listAllTasks(includeArchived = false): Array<{
  task: Task;
  projectKey: string;
  projectPath: string;
}> {
  const clause = includeArchived ? '' : "WHERE t.status <> 'archived'";
  const rows = getDb()
    .prepare(
      `SELECT t.*, p.project_key AS pkey, p.path AS ppath
       FROM task t JOIN project p ON t.project_id = p.id ${clause}
       ORDER BY t.priority ASC, (t.due_date IS NULL) ASC, t.due_date ASC, t.created_at ASC`,
    )
    .all() as Array<TaskRow & { pkey: string; ppath: string }>;
  return rows.map((r) => ({ task: rowToTask(r), projectKey: r.pkey, projectPath: r.ppath }));
}

export interface NewTask {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  taskType?: TaskType;
  dueDate?: string | null;
  assignee?: string | null;
  tags?: string[];
  status?: TaskStatus;
}

export function createTask(projectKey: string, path: string, data: NewTask): Task {
  const db = getDb();
  const projectId = ensureProject(projectKey, path);
  const t = now();
  const r = db
    .prepare(
      `INSERT INTO task (project_id, title, description, status, priority, task_type, due_date, assignee, tags, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'manual', ?, ?)`,
    )
    .run(
      projectId,
      data.title,
      data.description ?? null,
      data.status ?? 'collected', // 新建默认进「已收集」收件箱，由人工分诊后晋级到「待规划」再到「待开发」
      data.priority ?? 'p2',
      data.taskType ?? 'feature',
      data.dueDate ?? null,
      data.assignee ?? null,
      data.tags ? JSON.stringify(data.tags) : null,
      t,
      t,
    );
  return getTask(Number(r.lastInsertRowid))!;
}

export function getTask(id: number): Task | null {
  const row = getDb().prepare('SELECT * FROM task WHERE id = ?').get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

/** 给任务追加一张图（读-改-写 images JSON）。任务不存在返回 null。 */
export function addTaskImage(taskId: number, img: TaskImage): Task | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM task WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!row) return null;
  const images = row.images ? (JSON.parse(row.images) as TaskImage[]) : [];
  images.push(img);
  const json = JSON.stringify(images);
  db.prepare('UPDATE task SET images = ?, updated_at = ? WHERE id = ?').run(json, now(), taskId);
  return rowToTask({ ...row, images: json });
}

/** 从任务移除一张图（按文件名）。任务不存在返回 null；图不存在则无操作。 */
export function removeTaskImage(taskId: number, name: string): Task | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM task WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!row) return null;
  const images = (row.images ? (JSON.parse(row.images) as TaskImage[]) : []).filter(
    (i) => i.name !== name,
  );
  const json = JSON.stringify(images);
  db.prepare('UPDATE task SET images = ?, updated_at = ? WHERE id = ?').run(json, now(), taskId);
  return rowToTask({ ...row, images: json });
}

export interface TaskPatch {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  taskType?: TaskType;
  dueDate?: string | null;
  assignee?: string | null;
  tags?: string[];
  subtasks?: SubTask[];
  sortOrder?: number;
}

export function updateTask(id: number, patch: TaskPatch): Task | null {
  const db = getDb();
  const existing = getTask(id);
  if (!existing) return null;
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (patch.title !== undefined) push('title', patch.title);
  if (patch.description !== undefined) push('description', patch.description);
  if (patch.priority !== undefined) push('priority', patch.priority);
  if (patch.taskType !== undefined) push('task_type', patch.taskType);
  if (patch.dueDate !== undefined) push('due_date', patch.dueDate);
  if (patch.assignee !== undefined) push('assignee', patch.assignee);
  if (patch.tags !== undefined) push('tags', JSON.stringify(patch.tags));
  if (patch.subtasks !== undefined) push('subtasks', JSON.stringify(patch.subtasks));
  if (patch.sortOrder !== undefined) push('sort_order', patch.sortOrder);
  if (patch.status !== undefined) {
    push('status', patch.status);
    // 进入 done 记完成时间；离开 done 清空
    push('completed_at', patch.status === 'done' ? (existing.completedAt ?? now()) : null);
    // 重新交付(review)或验收通过(done)时，上一轮打回原因视为已消化，自动清空
    if (patch.status === 'review' || patch.status === 'done') push('reject_reason', null);
    // 离开 done：验收记录一并作废（与 completed_at 对称，避免 done→其它列后残留 accepted_*）。
    // 注意：done 本身经 accept 端点写入 accepted_*，不走本函数，故这里只处理"离开"。
    if (patch.status !== 'done') {
      push('accepted_at', null);
      push('accepted_by', null);
    }
  }
  if (sets.length === 0) return existing;
  push('updated_at', now());
  vals.push(id);
  db.prepare(`UPDATE task SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getTask(id);
}

/** 验收打回：仅「待验收(review)」任务可打回 → 置回 todo 并记录原因；原因在任务下次置 review/done 时自动清空。 */
export function rejectTask(
  id: number,
  reason: string,
): { task?: Task; error?: 'not_found' | 'not_review' } {
  const db = getDb();
  const existing = getTask(id);
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'review') return { error: 'not_review' };
  db.prepare(`UPDATE task SET status = 'todo', reject_reason = ?, updated_at = ? WHERE id = ?`).run(
    reason,
    now(),
    id,
  );
  return { task: getTask(id)! };
}

/**
 * 二次编辑打回内容：仅对**已携带打回原因**（reject_reason 非空）的任务更新原因，不改状态。
 * 与 rejectTask 分工——rejectTask 负责 review→todo 的首次打回，本函数负责已打回任务的原因修订；
 * 二者都是写 reject_reason 的专用入口，PATCH 仍不能写（白名单锁不动）。
 */
export function updateRejectReason(
  id: number,
  reason: string,
): { task?: Task; error?: 'not_found' | 'no_reject' } {
  const db = getDb();
  const existing = getTask(id);
  if (!existing) return { error: 'not_found' };
  if (!existing.rejectReason) return { error: 'no_reject' }; // 没有打回在身，无内容可编辑
  db.prepare(`UPDATE task SET reject_reason = ?, updated_at = ? WHERE id = ?`).run(reason, now(), id);
  return { task: getTask(id)! };
}

/**
 * 验收通过：置任务为 done，写完成/验收时间与验收人（by 可空）。这是**唯一**能把任务置 done 的入口
 * （PATCH 拒绝 status=done）——目的是让"置完成"成为一个显式的人工动作，达成防误操作 + 可审计。
 * 单用户模型下人机共用一个 token，技术上无法真正鉴别谁是人，故这不是防绕过的权限锁。
 * 采「宽松」语义：任意状态皆可验收通过（保留前端从任意列直接完成的便捷）；已 done 再次验收只重打验收时间。
 */
export function acceptTask(id: number, by: string | null): { task?: Task; error?: 'not_found' } {
  const db = getDb();
  const existing = getTask(id);
  if (!existing) return { error: 'not_found' };
  const t = now();
  db.prepare(
    `UPDATE task SET status = 'done', completed_at = ?, accepted_at = ?, accepted_by = ?, reject_reason = NULL, updated_at = ? WHERE id = ?`,
  ).run(existing.completedAt ?? t, t, by, t, id);
  return { task: getTask(id)! };
}

// ── todo.md 导入（去重）──────────────────────────────────────
function fingerprint(projectKey: string, item: TodoItem): string {
  const norm = `${projectKey}\n${item.section ?? ''}\n${item.text.trim()}`;
  return createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

const TODO_TO_TASK: Record<TodoItem['status'], TaskStatus> = {
  open: 'collected', // todo.md 的未开始项＝尚未分诊 → 进「已收集」，与手动新建默认一致
  doing: 'doing',
  done: 'done',
};

/** 把 todo.md 条目导入为受管任务，按指纹去重（已存在则跳过）。 */
export function importTodos(
  projectKey: string,
  path: string,
  items: TodoItem[],
): { imported: number; skipped: number } {
  const db = getDb();
  const projectId = ensureProject(projectKey, path);
  // 显式声明 task_type='feature'（不靠列默认值），与 createTask 风格一致，避免日后改 schema 漏列
  const insert = db.prepare(
    `INSERT OR IGNORE INTO task
       (project_id, title, status, priority, task_type, source, todo_fingerprint, created_at, updated_at, completed_at)
     VALUES (?,?,?, 'p2', 'feature', 'todo_md', ?,?,?,?)`,
  );
  let imported = 0;
  const tx = db.transaction((list: TodoItem[]) => {
    for (const it of list) {
      const status = TODO_TO_TASK[it.status];
      const t = now();
      const r = insert.run(
        projectId,
        it.text.trim(),
        status,
        fingerprint(projectKey, it),
        t,
        t,
        status === 'done' ? t : null,
      );
      if (r.changes > 0) imported++;
    }
  });
  tx(items);
  return { imported, skipped: items.length - imported };
}
