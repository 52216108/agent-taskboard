import type {
  ProjectsResponse,
  ProjectDetail,
  ProjectInfo,
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  SubTask,
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

export interface TaskReviewEvent {
  id: string;
  type: 'task.review';
  occurredAt: string;
  task: Pick<Task, 'id' | 'projectId' | 'title' | 'assignee' | 'updatedAt'>;
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

/** 订阅任务首次进入待验收状态的 SSE 事件；以流式 fetch 携带 header token，避免凭证进入 URL。 */
export function subscribeTaskEvents(onReview: (event: TaskReviewEvent) => void): () => void {
  let stopped = false;
  let reconnectTimer: number | null = null;
  let controller: AbortController | null = null;
  let lastEventId = '';
  let retryMs = 3_000;

  const consumeBlock = (block: string) => {
    let eventName = 'message';
    let eventId: string | null = null;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'event') eventName = value;
      else if (field === 'data') data.push(value);
      else if (field === 'id' && !value.includes('\0')) eventId = value;
      else if (field === 'retry' && /^\d+$/.test(value)) retryMs = Number(value);
    }
    if (eventId !== null) lastEventId = eventId;
    if (eventName !== 'task.review' || data.length === 0) return;
    try {
      onReview(JSON.parse(data.join('\n')) as TaskReviewEvent);
    } catch {
      // 单条畸形事件不应关闭连接；后续合法事件仍可继续接收。
    }
  };

  const connect = async () => {
    controller = new AbortController();
    try {
      const headers: Record<string, string> = { Accept: 'text/event-stream', ...authHeaders() };
      if (lastEventId) headers['Last-Event-ID'] = lastEventId;
      const response = await fetch('/api/events', { headers, signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = /\r?\n\r?\n/.exec(buffer);
        while (boundary?.index !== undefined) {
          consumeBlock(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
          boundary = /\r?\n\r?\n/.exec(buffer);
        }
      }
    } catch (error) {
      if (stopped || (error instanceof DOMException && error.name === 'AbortError')) return;
    } finally {
      if (!stopped) reconnectTimer = window.setTimeout(() => void connect(), retryMs);
    }
  };

  void connect();
  return () => {
    stopped = true;
    controller?.abort();
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
  };
}

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
  /** 落到哪一列；省略＝后端默认「已收集」。看板列头的「＋」用它直接建进该列。 */
  status?: TaskStatus;
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
  subtasks?: SubTask[];
}
export const updateTask = (id: number, body: TaskPatch): Promise<Task> =>
  patch<Task>(`/api/tasks/${id}`, body);
/** 验收打回：待验收 → 待开发并记录原因（仅 review 态任务可打回）。 */
export const rejectTask = (id: number, reason: string): Promise<Task> =>
  post<Task>(`/api/tasks/${id}/reject`, { reason });
/** 二次编辑打回内容：修订已打回任务的原因，不改状态（仅对已携带打回原因的任务）。 */
export const updateRejectReason = (id: number, reason: string): Promise<Task> =>
  post<Task>(`/api/tasks/${id}/reject-reason`, { reason });
/** 验收通过：置任务为 done（唯一入口，PATCH 拒绝 done）。by=验收人署名，可空。 */
export const acceptTask = (id: number, by?: string | null): Promise<Task> =>
  post<Task>(`/api/tasks/${id}/accept`, by != null ? { by } : undefined);
/** 置状态统一入口：done 走验收端点（记 accepted_at/by），其余走 PATCH。避免各处漏判 done 门禁。 */
export const setTaskStatus = (id: number, status: TaskStatus): Promise<Task> =>
  status === 'done' ? acceptTask(id) : updateTask(id, { status });

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
