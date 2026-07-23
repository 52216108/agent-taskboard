import { createHash } from 'node:crypto';
import { getDb } from './db';
import type { ProjectInfo, Task, TaskImage, TaskStatus, TaskPriority, TaskType, TodoItem } from './types';

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

/** 扫描完成后调用：key 匹配但目录已改名 → 更新 path（在一个事务里批量）。 */
export function reconcilePaths(scanned: ProjectInfo[]): void {
  const db = getDb();
  const upd = db.prepare(
    'UPDATE project SET path = ?, updated_at = ? WHERE project_key = ? AND path <> ?',
  );
  const tx = db.transaction((items: ProjectInfo[]) => {
    for (const p of items) upd.run(p.path, now(), p.key, p.path);
  });
  tx(scanned);
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

function missingProject(row: ProjectRow, managed: ManagedCounts): ProjectInfo {
  return {
    key: row.project_key,
    path: row.path,
    name: row.path.split('/').filter(Boolean).pop() ?? row.path,
    displayName: row.display_name || (row.path.split('/').filter(Boolean).pop() ?? row.path),
    description: row.description,
    techStack: [],
    git: { isRepo: false, branch: null, dirtyCount: 0, lastCommit: null, remote: null, nested: false },
    todos: { open: 0, doing: 0, done: 0, total: 0 },
    hasTasksFile: false,
    docs: { directory: false, schema: false, api: false },
    lastActive: null,
    error: null,
    dbId: row.id,
    pinned: !!row.pinned,
    archived: !!row.archived,
    missing: true,
    managed,
    topPriority: null,
    overdue: 0,
  };
}

/**
 * 用 DB 状态丰富扫描结果（只读）：应用覆盖、受管任务计数；并追加"DB 有行但已不在扫描结果"的项目。
 * 路径迁移不在这里做（只读），由 reconcilePaths 在扫描后单独执行。
 */
export function enrich(scanned: ProjectInfo[]): ProjectInfo[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM project').all() as ProjectRow[];
  const byKey = new Map(rows.map((r) => [r.project_key, r]));
  const byPath = new Map(rows.map((r) => [r.path, r]));
  const counts = managedCounts();
  const sig = taskSignals();
  const scannedKeys = new Set(scanned.map((p) => p.key));
  const scannedPaths = new Set(scanned.map((p) => p.path));

  const enriched = scanned.map((p): ProjectInfo => {
    // 先按稳定身份键匹配；身份键漂移（如多仓外壳内层仓增减致 remote 变化）时按路径兜底，
    // 保证目录仍在的项目不丢 DB 覆盖/任务计数。
    // 兜底选"只读"而非在 reconcilePaths 里把漂移键写回，有两个已知边界（均属罕见、非本次 bug，勿当新缺陷重查）：
    //  M1 路径复用错关联：删掉某路径的仓 A、把不同的仓 B 克隆进同一路径 → B 的键不在库、按 path 命中 A 的 stale 行，
    //     会静默继承 A 的历史任务/覆盖。只读兜底每次重扫有自愈机会；写回则会一锤定音劫持，故不写回。
    //  M2 漂移后写入分裂行：enrich 只填 dbId 不改 p.key，真·漂移后一旦经 API 写任务，ensureProject(新键) 会新插一行，
    //     原行连同历史被 scannedPaths 从 missing 循环抑制而"隐身"。治它需在 reconcilePaths 里带 UNIQUE/消失判定，不塞本次。
    const row = byKey.get(p.key) ?? byPath.get(p.path);
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
      managed: m,
      topPriority: s.topPriority,
      overdue: s.overdue,
    };
  });

  for (const row of rows) {
    // 身份键或路径任一命中扫描结果，即说明目录还在，不判"目录已消失"。
    if (scannedKeys.has(row.project_key) || scannedPaths.has(row.path)) continue;
    const mp = missingProject(row, counts.get(row.id) ?? emptyManaged());
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
    return { payload: JSON.parse(row.payload) as ProjectInfo[], scannedAt: row.scanned_at };
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
