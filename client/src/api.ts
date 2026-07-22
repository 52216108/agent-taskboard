import type {
  ProjectsResponse,
  ProjectDetail,
  ProjectInfo,
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  GlobalTask,
} from './types';

// 访问 token（远程访问时用；本机默认无）。存 localStorage，填一次即可。
function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('board-token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// <img src> 无法设 header，只能把 token 拼进查询参数。无 token 时返回空串（行为不变）。
function tokenQuery(): string {
  const t = localStorage.getItem('board-token');
  return t ? `?token=${encodeURIComponent(t)}` : '';
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function post<T>(url: string, body?: unknown): Promise<T> {
  // 无 body 时不要设 content-type:application/json，否则 Fastify 对空 body 直接 400
  const headers: Record<string, string> = { ...authHeaders() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(url, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => json<T>(r));
}

function patch<T>(url: string, body: unknown): Promise<T> {
  return fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  }).then((r) => json<T>(r));
}

export const fetchProjects = (): Promise<ProjectsResponse> =>
  fetch('/api/projects', { headers: authHeaders() }).then((r) => json<ProjectsResponse>(r));

export const rescanProjects = (): Promise<ProjectsResponse> =>
  post<ProjectsResponse>('/api/projects/scan');

export const fetchProjectDetail = (name: string): Promise<ProjectDetail> =>
  fetch(`/api/projects/${encodeURIComponent(name)}`, { headers: authHeaders() }).then((r) =>
    json<ProjectDetail>(r),
  );

export const fetchAllTasks = (includeArchived = false): Promise<{ tasks: GlobalTask[] }> =>
  fetch(`/api/tasks${includeArchived ? '?includeArchived=1' : ''}`, { headers: authHeaders() }).then(
    (r) => json(r),
  );

export interface ProjectPatch {
  displayName?: string | null;
  description?: string | null;
  pinned?: boolean;
  archived?: boolean;
}
export const patchProject = (name: string, body: ProjectPatch): Promise<ProjectInfo> =>
  patch<ProjectInfo>(`/api/projects/${encodeURIComponent(name)}`, body);

export interface NewTask {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  taskType?: TaskType;
  dueDate?: string | null;
  assignee?: string | null;
}
export const createTask = (name: string, body: NewTask): Promise<Task> =>
  post<Task>(`/api/projects/${encodeURIComponent(name)}/tasks`, body);

export interface TaskPatch {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  taskType?: TaskType;
  dueDate?: string | null;
  assignee?: string | null;
}
export const updateTask = (id: number, body: TaskPatch): Promise<Task> =>
  patch<Task>(`/api/tasks/${id}`, body);
/** 验收打回：待验收 → 待开发并记录原因（仅 review 态任务可打回）。 */
export const rejectTask = (id: number, reason: string): Promise<Task> =>
  post<Task>(`/api/tasks/${id}/reject`, { reason });

export const importTodos = (name: string): Promise<{ imported: number; skipped: number }> =>
  post(`/api/projects/${encodeURIComponent(name)}/import`);

// ── 任务图片附件 ──────────────────────────────────────────────
export const uploadTaskImage = (
  taskId: number,
  blob: Blob,
  mime: string,
): Promise<{ name: string; url: string }> =>
  fetch(`/api/tasks/${taskId}/images`, {
    method: 'POST',
    headers: { 'content-type': mime, ...authHeaders() },
    body: blob,
  }).then((r) => json(r));

export const deleteTaskImage = (taskId: number, name: string): Promise<{ ok: boolean }> =>
  fetch(`/api/tasks/${taskId}/images/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }).then((r) => json(r));

export const taskImageUrl = (taskId: number, name: string): string =>
  `/api/tasks/${taskId}/images/${encodeURIComponent(name)}${tokenQuery()}`;
