import { describe, it, expect, beforeEach } from 'vitest';
import { useInMemoryDb, migrate } from '../src/db';
import {
  ensureProject,
  patchProject,
  reconcilePaths,
  enrich,
  createTask,
  updateTask,
  rejectTask,
  listTasks,
  importTodos,
  addTaskImage,
  removeTaskImage,
} from '../src/repo';
import type { ProjectInfo, TodoItem } from '../src/types';

function fakeProject(key: string, path: string, name = path.split('/').pop()!): ProjectInfo {
  return {
    key,
    path,
    name,
    displayName: name,
    description: null,
    techStack: [],
    git: { isRepo: true, branch: 'main', dirtyCount: 0, lastCommit: null, remote: key, nested: false },
    todos: { open: 0, doing: 0, done: 0, total: 0 },
    hasTasksFile: false,
    docs: { directory: false, schema: false, api: false },
    lastActive: null,
    error: null,
    dbId: null,
    pinned: false,
    archived: false,
    missing: false,
    managed: { collected: 0, backlog: 0, todo: 0, doing: 0, review: 0, done: 0 },
    topPriority: null,
    overdue: 0,
  };
}

beforeEach(() => {
  useInMemoryDb();
});

describe('项目身份与懒创建', () => {
  it('ensureProject 幂等返回同一 id', () => {
    const a = ensureProject('github.com/g/x', '/p/x');
    const b = ensureProject('github.com/g/x', '/p/x');
    expect(a).toBe(b);
  });

  it('改名（同 key 不同 path）→ reconcilePaths 更新 path，任务不断链', () => {
    const id = ensureProject('github.com/g/x', '/p/x');
    createTask('github.com/g/x', '/p/x', { title: '任务1' });
    // 目录改名为 /p/x-new
    reconcilePaths([fakeProject('github.com/g/x', '/p/x-new')]);
    // 同 key 仍解析到同一行（id 不变），任务还在
    expect(ensureProject('github.com/g/x', '/p/x-new')).toBe(id);
    expect(listTasks('github.com/g/x')).toHaveLength(1);
  });
});

describe('任务 CRUD', () => {
  it('createTask 默认 collected(已收集)/p2/feature，listTasks 可见', () => {
    const t = createTask('k', '/p', { title: 'A' });
    expect(t.status).toBe('collected');
    expect(t.priority).toBe('p2');
    expect(t.taskType).toBe('feature');
    expect(listTasks('k')).toHaveLength(1);
  });

  it('taskType 可指定为 bug 并持久化，updateTask 可改为 optimize', () => {
    const t = createTask('k', '/p', { title: '崩溃修复', taskType: 'bug' });
    expect(t.taskType).toBe('bug');
    expect(listTasks('k')[0].taskType).toBe('bug');
    const upd = updateTask(t.id, { taskType: 'optimize' })!;
    expect(upd.taskType).toBe('optimize');
  });

  it('assignee 可在创建时持久化', () => {
    const t = createTask('k', '/p', { title: '认领任务', assignee: 'claude' });
    expect(t.assignee).toBe('claude');
    expect(listTasks('k')[0].assignee).toBe('claude');
  });

  it('updateTask 可修改 assignee', () => {
    const t = createTask('k', '/p', { title: '认领任务', assignee: 'claude' });
    const updated = updateTask(t.id, { assignee: 'codex' })!;
    expect(updated.assignee).toBe('codex');
  });

  it('updateTask 可将 assignee 清空为 null', () => {
    const t = createTask('k', '/p', { title: '认领任务', assignee: 'claude' });
    const updated = updateTask(t.id, { assignee: null })!;
    expect(updated.assignee).toBeNull();
  });

  it('rejectTask 仅可打回待验收任务：review → todo 并记录原因', () => {
    const t = createTask('k', '/p', { title: 'A' });
    expect(rejectTask(t.id, '不行').error).toBe('not_review'); // 默认 collected 不可打回
    updateTask(t.id, { status: 'review' });
    const r = rejectTask(t.id, '缺测试，补上再交');
    expect(r.error).toBeUndefined();
    expect(r.task!.status).toBe('todo');
    expect(r.task!.rejectReason).toBe('缺测试，补上再交');
  });

  it('rejectTask 不存在的任务返回 not_found', () => {
    expect(rejectTask(999999, 'x').error).toBe('not_found');
  });

  it('重新置 review 或 done 自动清空打回原因', () => {
    const t = createTask('k', '/p', { title: 'A', status: 'review' });
    rejectTask(t.id, '第一轮打回');
    const backToReview = updateTask(t.id, { status: 'review' })!;
    expect(backToReview.rejectReason).toBeNull(); // 重新交付即视为已消化
    rejectTask(t.id, '第二轮打回');
    const accepted = updateTask(t.id, { status: 'done' })!;
    expect(accepted.rejectReason).toBeNull(); // 验收通过也清空
  });

  it('状态改 done 写 completedAt，改回清空', () => {
    const t = createTask('k', '/p', { title: 'A' });
    const done = updateTask(t.id, { status: 'done' })!;
    expect(done.completedAt).toBeTruthy();
    const back = updateTask(t.id, { status: 'todo' })!;
    expect(back.completedAt).toBeNull();
  });

  it('archived 任务不出现在 listTasks', () => {
    const t = createTask('k', '/p', { title: 'A' });
    updateTask(t.id, { status: 'archived' });
    expect(listTasks('k')).toHaveLength(0);
  });
});

describe('todo.md 导入去重', () => {
  const items: TodoItem[] = [
    { text: '做 A', status: 'open', section: '阶段1' },
    { text: '做 B', status: 'doing', section: '阶段1' },
  ];

  it('首次导入全进，再次导入全跳过（指纹去重）', () => {
    const r1 = importTodos('k', '/p', items);
    expect(r1.imported).toBe(2);
    const r2 = importTodos('k', '/p', items);
    expect(r2.imported).toBe(0);
    expect(r2.skipped).toBe(2);
    expect(listTasks('k')).toHaveLength(2);
    // open(未开始) → collected(已收集)，doing 原样保留
    const byTitle = Object.fromEntries(listTasks('k').map((x) => [x.title, x.status]));
    expect(byTitle['做 A']).toBe('collected');
    expect(byTitle['做 B']).toBe('doing');
  });
});

describe('任务图片附件', () => {
  it('新建任务 images 默认空数组', () => {
    const t = createTask('k', '/p', { title: 'x' });
    expect(t.images).toEqual([]);
  });
  it('addTaskImage 追加、removeTaskImage 删除', () => {
    const t = createTask('k', '/p', { title: 'x' });
    const a = addTaskImage(t.id, { name: 'a.png', addedAt: '2026-01-01T00:00:00Z' });
    expect(a?.images.map((i) => i.name)).toEqual(['a.png']);
    const b = addTaskImage(t.id, { name: 'b.png', addedAt: '2026-01-02T00:00:00Z' });
    expect(b?.images.map((i) => i.name)).toEqual(['a.png', 'b.png']);
    const c = removeTaskImage(t.id, 'a.png');
    expect(c?.images.map((i) => i.name)).toEqual(['b.png']);
  });
  it('对不存在的任务返回 null', () => {
    expect(addTaskImage(9999, { name: 'a.png', addedAt: 'x' })).toBeNull();
    expect(removeTaskImage(9999, 'a.png')).toBeNull();
  });
});

describe('enrich 合并 DB 状态', () => {
  it('应用覆盖 + 受管计数', () => {
    patchProject('k', '/p', { displayName: '我的名字', pinned: true });
    createTask('k', '/p', { title: 'A', status: 'todo' });
    createTask('k', '/p', { title: 'B', status: 'doing' });
    createTask('k', '/p', { title: 'C', status: 'review' });
    createTask('k', '/p', { title: 'D' }); // 默认 collected
    const [p] = enrich([fakeProject('k', '/p')]);
    expect(p.displayName).toBe('我的名字');
    expect(p.pinned).toBe(true);
    expect(p.managed).toEqual({ collected: 1, backlog: 0, todo: 1, doing: 1, review: 1, done: 0 });
    expect(p.dbId).not.toBeNull();
  });

  it('DB 有行但未扫描到 → 追加为 missing，受管任务仍可见', () => {
    createTask('gone', '/p/gone', { title: '遗留任务' }); // 默认 collected
    const result = enrich([fakeProject('k', '/p')]); // 扫描结果里没有 gone
    const missing = result.find((p) => p.key === 'gone');
    expect(missing?.missing).toBe(true);
    expect(missing?.managed.collected).toBe(1);
  });

  it('身份键漂移但目录仍在 → 按 path 兜底，不误判 missing、任务不断链', () => {
    // 模拟外壳型项目：DB 行以旧身份键登记且挂着任务
    createTask('gitee.com/x/old-key', '/p/multi', { title: '遗留任务' });
    // 本轮扫描同一目录但身份键变了（多仓外壳内层仓增减致 remote 变化）
    const result = enrich([fakeProject('/p/multi', '/p/multi')]);
    // 只有一条（不该既出一条新项目又出一条 missing）
    expect(result).toHaveLength(1);
    expect(result[0].missing).toBe(false);
    expect(result[0].dbId).not.toBeNull();
    expect(result[0].managed.collected).toBe(1); // 旧行的任务被认领
  });
});

describe('migrate: 状态体系数据迁移', () => {
  const t = '2026-01-01T00:00:00Z';
  const seedProject = (db: ReturnType<typeof useInMemoryDb>) =>
    db.prepare("INSERT INTO project (project_key, path, created_at, updated_at) VALUES ('k','/p',?,?)").run(t, t);
  const insTask = (db: ReturnType<typeof useInMemoryDb>) =>
    db.prepare(
      "INSERT INTO task (project_id, title, status, priority, task_type, source, created_at, updated_at) VALUES (1,?,?, 'p2','feature','manual',?,?)",
    );

  it('v0 全量库：旧 todo →(v1)→ backlog →(v2)→ collected，doing 不动，user_version=2，幂等', () => {
    const db = useInMemoryDb(); // 全新内存库 user_version=0，会顺序跑完 v1+v2
    seedProject(db);
    const ins = insTask(db);
    ins.run('旧待办', 'todo', t, t);
    ins.run('进行中的', 'doing', t, t);

    migrate(db);

    const after = db.prepare('SELECT title, status FROM task ORDER BY id').all() as Array<{
      title: string;
      status: string;
    }>;
    // 旧 todo 链式迁到 collected（途径 backlog）——这正是 v0 直升到最新版的正确终态
    expect(after.find((r) => r.title === '旧待办')!.status).toBe('collected');
    expect(after.find((r) => r.title === '进行中的')!.status).toBe('doing'); // 其余不动
    expect(db.pragma('user_version', { simple: true })).toBe(2);

    // 迁移后新建的 todo/backlog 行不应被二次迁移打回——守护确保只迁一次
    ins.run('新待开发', 'todo', t, t);
    ins.run('新待规划', 'backlog', t, t);
    migrate(db);
    expect(db.prepare("SELECT status FROM task WHERE title='新待开发'").get()).toEqual({ status: 'todo' });
    expect(db.prepare("SELECT status FROM task WHERE title='新待规划'").get()).toEqual({ status: 'backlog' });
  });

  it('v2：模拟既有 v1 库（user_version=1），存量 backlog → collected，todo 不动', () => {
    const db = useInMemoryDb();
    seedProject(db);
    const ins = insTask(db);
    ins.run('旧待规划', 'backlog', t, t);
    ins.run('待开发的', 'todo', t, t);
    db.pragma('user_version = 1'); // 标记为"已跑过 v1"，本次只应跑 v2

    migrate(db);

    expect(db.prepare("SELECT status FROM task WHERE title='旧待规划'").get()).toEqual({ status: 'collected' });
    expect(db.prepare("SELECT status FROM task WHERE title='待开发的'").get()).toEqual({ status: 'todo' }); // v1 不应再跑
    expect(db.pragma('user_version', { simple: true })).toBe(2);
  });
});
