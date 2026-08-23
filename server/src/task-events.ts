import { randomUUID } from 'node:crypto';
import type { Task } from './types';

export interface TaskReviewEvent {
  id: string;
  type: 'task.review';
  occurredAt: string;
  task: Pick<Task, 'id' | 'projectId' | 'title' | 'assignee' | 'updatedAt'>;
}

export interface TaskStreamCursorEvent {
  id: string;
  type: 'stream.ready';
  occurredAt: string;
}

type TaskStreamEvent = TaskReviewEvent | TaskStreamCursorEvent;
interface SequencedReviewEvent {
  sequence: number;
  event: TaskReviewEvent;
}

type Listener = (event: TaskReviewEvent) => void;

/**
 * 进程内任务事件总线。
 *
 * 看板是单进程本地服务，状态写入和 SSE 连接都在同一进程内，无需额外消息中间件。
 * 保留少量历史只为 EventSource 短线重连补发；服务重启后的离线事件不承诺补发。
 */
export class TaskEventBroker {
  private readonly listeners = new Set<Listener>();
  private readonly history: SequencedReviewEvent[] = [];
  private readonly cursors = new Map<string, number>();
  private sequence = 0;

  constructor(private readonly historyLimit = 50) {}

  private remember(event: TaskReviewEvent): void {
    this.sequence += 1;
    this.history.push({ sequence: this.sequence, event });
    if (this.history.length > this.historyLimit) this.history.shift();
  }

  /** 初次连接先发送此游标；即使尚无任务事件，后续重连也有 Last-Event-ID 可用于回放。 */
  createCursor(): TaskStreamCursorEvent {
    const event: TaskStreamCursorEvent = {
      id: randomUUID(),
      type: 'stream.ready',
      occurredAt: new Date().toISOString(),
    };
    this.cursors.set(event.id, this.sequence);
    // 游标不占任务事件额度；仅限制游标映射自身，淘汰后按未知游标回放当前历史即可恢复。
    if (this.cursors.size > 200) this.cursors.delete(this.cursors.keys().next().value!);
    return event;
  }

  publishReview(task: Task): TaskReviewEvent {
    const event: TaskReviewEvent = {
      id: randomUUID(),
      type: 'task.review',
      occurredAt: new Date().toISOString(),
      task: {
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        assignee: task.assignee,
        updatedAt: task.updatedAt,
      },
    };
    this.remember(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 单个已断开的客户端不能影响状态写接口，也不能阻断其他订阅者。
      }
    }
    return event;
  }

  /** 创建接口允许任务直接落到 review；该状态同样属于首次进入待验收。 */
  publishCreatedReview(task: Task): TaskReviewEvent | null {
    return task.status === 'review' ? this.publishReview(task) : null;
  }

  subscribe(listener: Listener, lastEventId?: string, replayAllIfUnknown = false): () => void {
    if (lastEventId) {
      const reviewBoundary = this.history.find((item) => item.event.id === lastEventId)?.sequence;
      const cursorBoundary = this.cursors.get(lastEventId);
      const boundary = reviewBoundary ?? cursorBoundary;
      const replay =
        boundary !== undefined
          ? this.history.filter((item) => item.sequence > boundary)
          : replayAllIfUnknown
            ? this.history
            : [];
      for (const item of replay) listener(item.event);
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function formatSseEvent(event: TaskStreamEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const taskEvents = new TaskEventBroker();
