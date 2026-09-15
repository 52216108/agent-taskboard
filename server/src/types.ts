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
  /** origin remote URL（原文，未归一）。工作区聚合时为 null。 */
  remote: string | null;
}

/**
 * 项目形态：
 * - repo：单个 git 仓（或无 git 的普通目录），身份键 = 归一化 remote（无则 realpath）。
 * - workspace：多仓外壳——自身无 .git、直接子目录里有 ≥1 个 git 仓（如 acme/ 下放 acme-app + acme-server）。
 *   身份键 = 外壳目录 realpath（不借子仓 remote，子仓增删改名不会让外壳身份漂移）；
 *   每个子仓各自成一个 repo 项目，name 为 `外壳名/子仓名`、parent 指向外壳。
 */
export type ProjectKind = 'repo' | 'workspace';

/** 看板列表项：一个项目的概要信息。 */
export interface ProjectInfo {
  /** 稳定身份键：有 remote 取归一化 remote，否则取 realpath（工作区恒为 realpath）。用于跨重命名追踪（P2 起入库）。 */
  key: string;
  /** 当前绝对路径。 */
  path: string;
  /**
   * 路由/CLI 用的项目名：顶层项目＝目录名；工作区子项目＝`外壳名/子仓名`；
   * 仅存在于 DB 的旧行（missing/stale）＝`#<dbId>`（目录名会与现役项目撞名，无法据以定位）。
   */
  name: string;
  /** 项目形态，见 ProjectKind。 */
  kind: ProjectKind;
  /** 所属工作区的 name（工作区子项目才有）；顶层项目为 null。 */
  parent: string | null;
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
  /**
   * DB 旧行：目录仍在（路径被某个现役项目扫到）但身份键已对不上——remote 迁移、外壳身份漂移都会留下这种行。
   * 与 missing 一样只存在于 DB、任务仍可见；区别是目录没丢，应当用 merge 并入现役项目。stale 时 missing 也为 true。
   */
  stale: boolean;
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

/** 子任务（父任务里的轻量检查项，非独立 task 行）。 */
export interface SubTask {
  id: number;      // 父任务内唯一（客户端取 max(现有 id)+1 分配），供勾选/删除/React key 定位
  title: string;   // 子任务标题
  done: boolean;   // 是否完成
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
  subtasks: SubTask[]; // 子任务清单（轻量检查项）；空数组=无子任务
  source: 'manual' | 'todo_md';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** 人工验收(→done)通过时间；仅经 accept 端点写入，离开 done 清空。NULL=未经验收端点。 */
  acceptedAt: string | null;
  /** 验收人署名（自报，如 CLI --as）；单用户模型下仅供审计。NULL=未提供。 */
  acceptedBy: string | null;
}

/** 详情接口的额外字段。 */
export interface ProjectDetail extends ProjectInfo {
  todoItems: TodoItem[];
  readmeExcerpt: string | null;
}

/** 工作区详情里挂的"亲属"项目及其受管任务（外壳看全部子仓、子仓看外壳的跨仓任务）。 */
export interface ProjectTasksRef {
  name: string;
  displayName: string;
  path: string;
  tasks: Task[];
}

/** 全局任务视图条目：受管任务 + 所属项目信息。 */
export interface GlobalTask extends Task {
  projectName: string;
  projectKey: string;
  projectPath: string;
}
