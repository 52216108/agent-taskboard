import { describe, expect, it } from 'vitest';
import { TaskEventBroker, formatSseEvent } from '../src/task-events';
import type { Task } from '../src/types';

function fakeTask(id: number, title = `任务${id}`): Task {
  return {
    id,
    projectId: 7,
    title,
    description: null,
    status: 'review',
    priority: 'p2',
    taskType: 'feature',
    dueDate: null,
    assignee: 'codex',
    rejectReason: null,
    tags: [],
    images: [],
    subtasks: [],
    source: 'manual',
    sortOrder: 0,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: `2026-08-23T00:00:0${id}.000Z`,
    completedAt: null,
    acceptedAt: null,
    acceptedBy: null,
  };
}

describe('TaskEventBroker', () => {
  it('向在线订阅者广播最小任务信息，取消订阅后停止接收', () => {
    const broker = new TaskEventBroker();
    const received: number[] = [];
    const unsubscribe = broker.subscribe((event) => received.push(event.task.id));

    const event = broker.publishReview(fakeTask(1, '交付通知'));
    unsubscribe();
    broker.publishReview(fakeTask(2));

    expect(received).toEqual([1]);
    expect(event).toMatchObject({
      type: 'task.review',
      task: { id: 1, projectId: 7, title: '交付通知', assignee: 'codex' },
    });
    expect(event.task).not.toHaveProperty('description');
  });

  it('按 Last-Event-ID 补发短线期间事件，未知 id 不回放历史', () => {
    const broker = new TaskEventBroker(2);
    const first = broker.publishReview(fakeTask(1));
    const second = broker.publishReview(fakeTask(2));
    const third = broker.publishReview(fakeTask(3));

    const replayed: number[] = [];
    broker.subscribe((event) => replayed.push(event.task.id), second.id)();
    expect(replayed).toEqual([3]);

    const expired: number[] = [];
    broker.subscribe((event) => expired.push(event.task.id), first.id)();
    expect(expired).toEqual([]);
    expect(third.id).not.toBe(second.id);
  });

  it('重启或淘汰后的未知游标可选择回放当前进程仍保留的事件', () => {
    const broker = new TaskEventBroker(2);
    broker.publishReview(fakeTask(1));
    broker.publishReview(fakeTask(2));

    const replayed: number[] = [];
    broker.subscribe((event) => replayed.push(event.task.id), 'expired-cursor', true)();

    expect(replayed).toEqual([1, 2]);
  });

  it('空历史也能建立初始游标，并从该游标回放断线期间的首个事件', () => {
    const broker = new TaskEventBroker();
    const cursor = broker.createCursor();
    broker.publishReview(fakeTask(1));

    const replayed: number[] = [];
    broker.subscribe((event) => replayed.push(event.task.id), cursor.id)();

    expect(cursor.type).toBe('stream.ready');
    expect(replayed).toEqual([1]);
    expect(formatSseEvent(cursor)).toContain('event: stream.ready\n');
  });

  it('频繁创建连接游标不会挤占任务事件的回放额度', () => {
    const broker = new TaskEventBroker(2);
    const first = broker.publishReview(fakeTask(1));
    broker.publishReview(fakeTask(2));
    for (let i = 0; i < 100; i += 1) broker.createCursor();

    const replayed: number[] = [];
    broker.subscribe((event) => replayed.push(event.task.id), first.id)();

    expect(replayed).toEqual([2]);
  });

  it('任务直接创建在 review 时发布事件，其他初始状态不发布', () => {
    const broker = new TaskEventBroker();
    const received: number[] = [];
    broker.subscribe((event) => received.push(event.task.id));

    expect(broker.publishCreatedReview(fakeTask(1))).toMatchObject({ type: 'task.review' });
    expect(broker.publishCreatedReview({ ...fakeTask(2), status: 'doing' })).toBeNull();
    expect(received).toEqual([1]);
  });

  it('序列化为带 id、事件名和 JSON data 的 SSE 帧', () => {
    const event = new TaskEventBroker().publishReview(fakeTask(1));
    const frame = formatSseEvent(event);

    expect(frame).toContain(`id: ${event.id}\n`);
    expect(frame).toContain('event: task.review\n');
    expect(frame.endsWith('\n\n')).toBe(true);
    const data = frame
      .split('\n')
      .find((line) => line.startsWith('data: '))!
      .slice('data: '.length);
    expect(JSON.parse(data)).toEqual(event);
  });
});
