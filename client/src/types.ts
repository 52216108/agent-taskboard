// 与后端 server/src/types.ts 对齐的前端类型

export interface TodoItem {
  text: string;
  status: 'open' | 'doing' | 'done';
  section: string | null;
}

export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  dirtyCount: number;
  lastCommit: string | null;
  remote: string | null;
  nested: boolean;
}

export interface ProjectInfo {
  key: string;
  path: string;
  name: string;
  displayName: string;
  description: string | null;
  techStack: string[];
  git: GitInfo;
  todos: { open: number; doing: number; done: number; total: number };
  hasTasksFile: boolean;
  docs: { directory: boolean; schema: boolean; api: boolean };
  lastActive: string | null;
  error: string | null;
  // P2 注册/受管字段
  dbId: number | null;
  pinned: boolean;
  archived: boolean;
  missing: boolean;
  managed: { collected: number; backlog: number; todo: number; doing: number; review: number; done: number };
  topPriority: TaskPriority | null;
  overdue: number;
}

export interface GlobalTask extends Task {
  projectName: string;
  projectDir: string;
  projectKey: string;
  projectPath: string;
}

// 看板列流转：collected(已收集) → backlog(待规划) → todo(待开发) → doing(进行中) → review(待验收) → done(已完成)；archived=归档软删
export type TaskStatus = 'collected' | 'backlog' | 'todo' | 'doing' | 'review' | 'done' | 'archived';
export type TaskPriority = 'p0' | 'p1' | 'p2' | 'p3';
/** 任务类型：需求 / 缺陷 / 优化重构。新建默认 feature。 */
export type TaskType = 'feature' | 'bug' | 'optimize';

export interface TaskImage {
  name: string;
  addedAt: string;
}

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

export interface ProjectDetail extends ProjectInfo {
  todoItems: TodoItem[];
  readmeExcerpt: string | null;
  tasks: Task[];
}

export interface ProjectsResponse {
  scannedAt: number | null;
  count: number;
  roots: string[];
  projects: ProjectInfo[];
}
