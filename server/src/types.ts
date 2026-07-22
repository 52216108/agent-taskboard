/** 单条待办（来自 tasks/todo.md）。 */
export interface TodoItem {
  text: string;
  status: 'open' | 'doing' | 'done';
  section: string | null;
}

/** todo.md 解析结果：条目 + 各状态计数。 */
export interface TodoSummary {
  open: number;
  doing: number;
  done: number;
  total: number;
  items: TodoItem[];
}

/** git 仓库信息（可能解析自项目根，或嵌套子目录）。 */
export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  /** `git status --porcelain` 的行数，即未提交改动数。 */
  dirtyCount: number;
  /** 最近一次 commit 的 ISO 时间。 */
  lastCommit: string | null;
  /** origin remote URL（原文，未归一）。 */
  remote: string | null;
  /** git 信息是否来自子目录（如 acme/acme-app）。 */
  nested: boolean;
}

/** 看板列表项：一个项目的概要信息。 */
export interface ProjectInfo {
  /** 稳定身份键：有 remote 取归一化 remote，否则取 realpath。用于跨重命名追踪（P2 起入库）。 */
  key: string;
  /** 当前绝对路径。 */
  path: string;
  /** 目录名。 */
  name: string;
  /** 展示名：package.json name 或 README 标题，回退到目录名。 */
  displayName: string;
  /** 一句话用途：package.json description 或 README 首段，可能为空。 */
  description: string | null;
  /** 推断出的技术栈标签。 */
  techStack: string[];
  git: GitInfo;
  /** 待办计数（来自 tasks/todo.md）。 */
  todos: { open: number; doing: number; done: number; total: number };
  hasTasksFile: boolean;
  /** 三层索引文件是否存在。 */
  docs: { directory: boolean; schema: boolean; api: boolean };
  /** 最近活跃时间 = max(最近 commit, 目录 mtime)，用于排序。 */
  lastActive: string | null;
  /** 单项扫描错误（错误隔离：不抛出，标在该项上）。 */
  error: string | null;

  // ── 以下为 P2 注册/受管字段，由 DB merge 层填充（扫描层给默认值）──
  /** DB project 行 id；懒创建后才有（置顶/归档/覆盖/有受管任务时）。 */
  dbId: number | null;
  pinned: boolean;
  archived: boolean;
  /** DB 有行但目录已不在扫描结果中（移出/删除），保住其受管任务可见。 */
  missing: boolean;
  /** 受管任务计数（来自 SQLite task 表，区别于 todo.md 的 todos）。按六状态分桶（不含 archived）。 */
  managed: { collected: number; backlog: number; todo: number; doing: number; review: number; done: number };
  // ── 6A 卡片信号（由 enrich 填，scanner 给默认）──
  /** 未完成受管任务中的最高优先级（p0 最高），无则 null。 */
  topPriority: TaskPriority | null;
  /** 逾期（due_date < 今天且未完成）的受管任务数。 */
  overdue: number;
}

/**
 * 任务状态（看板列）。流转：collected → backlog → todo → doing → review → done。
 * collected(已收集)：需求/点子的收件箱，收下了但还没决定采纳——新建/导入默认落这里。
 * backlog(待规划)：已确定选中要做、等排期，由人工从已收集晋级而来。
 * todo(待开发)：已分诊、可被 agent 直接领取干活。
 * doing(进行中) → review(待验收)：agent 做完并提交，等人工验收。
 * done(已完成)：验收通过。archived(归档)：软删，默认不在看板显示。
 */
export type TaskStatus = 'collected' | 'backlog' | 'todo' | 'doing' | 'review' | 'done' | 'archived';
export type TaskPriority = 'p0' | 'p1' | 'p2' | 'p3';
/** 任务类型：需求 / 缺陷 / 优化重构。新建默认 feature。 */
export type TaskType = 'feature' | 'bug' | 'optimize';

export interface TaskImage {
  name: string;    // 磁盘文件名 <uuid>.<ext>
  addedAt: string; // ISO8601 添加时间
}

/** 受管任务（看板卡片），存 SQLite，区别于只读的 tasks/todo.md。 */
export interface Task {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  taskType: TaskType;
  dueDate: string | null;
  assignee: string | null;
  rejectReason: string | null;
  tags: string[];
  images: TaskImage[];
  source: 'manual' | 'todo_md';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** 详情接口的额外字段。 */
export interface ProjectDetail extends ProjectInfo {
  todoItems: TodoItem[];
  readmeExcerpt: string | null;
}

/** 全局任务视图条目：受管任务 + 所属项目信息。 */
export interface GlobalTask extends Task {
  projectName: string;
  projectKey: string;
  projectPath: string;
}
