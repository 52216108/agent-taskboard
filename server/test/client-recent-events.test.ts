import { describe, expect, it } from 'vitest';
import { deliverRecentEventOnce } from '../../client/src/recent-events';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class SerialLock {
  private readonly tails = new Map<string, Promise<void>>();

  request(
    name: string,
    claim: (stillOwner: () => Promise<boolean>) => boolean | Promise<boolean>,
  ): Promise<boolean> {
    const result = (this.tails.get(name) ?? Promise.resolve()).then(() =>
      claim(async () => true),
    );
    this.tails.set(
      name,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
}

describe('浏览器通知事件去重', () => {
  it('多个标签页交错处理连续事件时不会让旧事件覆盖新事件并重复提醒', async () => {
    const storage = new MemoryStorage();
    const key = 'events';

    const lock = new SerialLock();
    const withLock = lock.request.bind(lock);
    await expect(deliverRecentEventOnce(storage, key, 'A', withLock, () => true)).resolves.toBe(true);
    await expect(deliverRecentEventOnce(storage, key, 'B', withLock, () => true)).resolves.toBe(true);
    await expect(deliverRecentEventOnce(storage, key, 'A', withLock, () => true)).resolves.toBe(false);
    await expect(deliverRecentEventOnce(storage, key, 'B', withLock, () => true)).resolves.toBe(false);
  });

  it('兼容旧版本直接保存的单个事件 ID', async () => {
    const storage = new MemoryStorage();
    storage.setItem('events', 'legacy-event');

    const lock = new SerialLock();
    const withLock = lock.request.bind(lock);
    await expect(
      deliverRecentEventOnce(storage, 'events', 'legacy-event', withLock, () => true),
    ).resolves.toBe(false);
    await expect(
      deliverRecentEventOnce(storage, 'events', 'new-event', withLock, () => true),
    ).resolves.toBe(true);
  });

  it('通过跨标签页锁把同一事件的并发认领收敛为一次', async () => {
    const storage = new MemoryStorage();
    const lock = new SerialLock();
    const withLock = lock.request.bind(lock);
    let confirmShown!: (shown: boolean) => void;
    let secondStarted = false;
    let confirmFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => (confirmFirstStarted = resolve));

    const first = deliverRecentEventOnce(
      storage,
      'events',
      'same-event',
      withLock,
      () => {
        confirmFirstStarted();
        return new Promise<boolean>((resolve) => (confirmShown = resolve));
      },
    );
    const second = deliverRecentEventOnce(storage, 'events', 'same-event', withLock, () => {
      secondStarted = true;
      return true;
    });
    await firstStarted;
    expect(secondStarted).toBe(false);
    confirmShown(true);

    await expect(Promise.all([first, second])).resolves.toEqual([true, false]);
    expect(secondStarted).toBe(false);
  });

  it('不同事件使用独立锁，不会被前一个系统通知的等待时间阻塞', async () => {
    const storage = new MemoryStorage();
    const lock = new SerialLock();
    const withLock = lock.request.bind(lock);
    let finishFirst!: (shown: boolean) => void;

    const first = deliverRecentEventOnce(
      storage,
      'events',
      'slow-event',
      withLock,
      () => new Promise<boolean>((resolve) => (finishFirst = resolve)),
    );
    const second = deliverRecentEventOnce(storage, 'events', 'fast-event', withLock, () => true);

    await expect(second).resolves.toBe(true);
    finishFirst(true);
    await expect(first).resolves.toBe(true);
  });

  it('租约失效后不提交已处理标记，允许新持有者重新认领', async () => {
    const storage = new MemoryStorage();
    let ownershipChecks = 0;
    const expiringLock = async (
      _name: string,
      claim: (stillOwner: () => Promise<boolean>) => boolean | Promise<boolean>,
    ) => claim(async () => ++ownershipChecks === 1);

    await expect(
      deliverRecentEventOnce(storage, 'events', 'expired-event', expiringLock, () => true),
    ).resolves.toBe(false);

    const lock = new SerialLock();
    await expect(
      deliverRecentEventOnce(storage, 'events', 'expired-event', lock.request.bind(lock), () => true),
    ).resolves.toBe(true);
  });

  it('展示失败时不记录事件，允许其他可见标签页接手', async () => {
    const storage = new MemoryStorage();
    const lock = new SerialLock();
    const withLock = lock.request.bind(lock);

    await expect(
      deliverRecentEventOnce(storage, 'events', 'deferred', withLock, () => false),
    ).resolves.toBe(false);
    await expect(
      deliverRecentEventOnce(storage, 'events', 'deferred', withLock, () => true),
    ).resolves.toBe(true);
  });

  it('多标签页积压超过服务端回放批次时仍不会因截断记录而重复提醒', async () => {
    const storage = new MemoryStorage();
    const lock = new SerialLock();
    const withLock = lock.request.bind(lock);
    const ids = Array.from({ length: 60 }, (_, index) => `event-${index}`);

    for (const id of ids) {
      await expect(deliverRecentEventOnce(storage, 'events', id, withLock, () => true)).resolves.toBe(true);
    }
    for (const id of ids) {
      await expect(deliverRecentEventOnce(storage, 'events', id, withLock, () => true)).resolves.toBe(false);
    }
  });

  it('已处理标记保持有界，超过上限时只清理最早记录', async () => {
    const storage = new MemoryStorage();
    const lock = new SerialLock();
    const withLock = lock.request.bind(lock);

    for (let index = 0; index < 220; index += 1) {
      await deliverRecentEventOnce(storage, 'events', `bounded-${index}`, withLock, () => true);
    }

    expect(storage.length).toBe(200);
    await expect(
      deliverRecentEventOnce(storage, 'events', 'bounded-219', withLock, () => true),
    ).resolves.toBe(false);
  });

  it('通知展示后即使持久化标记失败也不抛错触发二次展示', async () => {
    class QuotaStorage extends MemoryStorage {
      override setItem(): void {
        throw new DOMException('quota', 'QuotaExceededError');
      }
    }
    const storage = new QuotaStorage();
    const lock = new SerialLock();
    const sharedIds = new Set<string>();
    const sharedStore = {
      has: async (key: string) => sharedIds.has(key),
      mark: async (key: string) => {
        sharedIds.add(key);
      },
    };
    let deliveries = 0;

    const deliver = () =>
      deliverRecentEventOnce(storage, 'events', 'quota-event', lock.request.bind(lock), () => {
        deliveries += 1;
        return true;
      }, sharedStore);

    await expect(deliver()).resolves.toBe(true);
    await expect(deliver()).resolves.toBe(false);
    expect(deliveries).toBe(1);
  });
});
