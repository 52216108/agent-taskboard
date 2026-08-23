type EventStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const MAX_PROCESSED_EVENTS = 200;
let lastProcessedAt = 0;
export interface ProcessedEventStore {
  has: (key: string) => Promise<boolean>;
  mark: (key: string) => Promise<void>;
}
const unavailableProcessedEvents: ProcessedEventStore = {
  has: async () => false,
  mark: async () => undefined,
};
export type OwnershipCheck = () => boolean | Promise<boolean>;
export type WithEventLock = (
  name: string,
  claim: (stillOwner: OwnershipCheck) => boolean | Promise<boolean>,
) => Promise<boolean>;

function readRecentEventIds(storage: EventStorage, key: string): string[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return [];
  }
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string');
    }
  } catch {
    // 兼容旧版本直接保存的单个事件 ID。
  }
  return [raw];
}

function pruneProcessedEvents(storage: EventStorage, key: string, limit: number): void {
  try {
    const prefix = `${key}:`;
    const entries: Array<{ key: string; timestamp: number }> = [];
    for (let index = 0; index < storage.length; index += 1) {
      const storedKey = storage.key(index);
      if (!storedKey?.startsWith(prefix)) continue;
      const timestamp = Number(storage.getItem(storedKey));
      entries.push({ key: storedKey, timestamp: Number.isFinite(timestamp) ? timestamp : 0 });
    }
    entries.sort((a, b) => b.timestamp - a.timestamp);
    for (const entry of entries.slice(limit)) storage.removeItem(entry.key);
  } catch {
    // 存储被浏览器禁用时无法维护去重记录，但不能影响已经完成的通知展示。
  }
}

async function wasProcessed(
  storage: EventStorage,
  processedKey: string,
  sharedStore: ProcessedEventStore,
): Promise<boolean> {
  try {
    if (storage.getItem(processedKey) !== null) return true;
  } catch {
    // 继续查询 IndexedDB 后备记录。
  }
  try {
    return await sharedStore.has(processedKey);
  } catch {
    return false;
  }
}

async function markProcessed(
  storage: EventStorage,
  baseKey: string,
  processedKey: string,
  sharedStore: ProcessedEventStore,
): Promise<void> {
  lastProcessedAt = Math.max(Date.now(), lastProcessedAt + 1);
  try {
    storage.setItem(processedKey, String(lastProcessedAt));
  } catch {
    // 配额不足时先腾出一批旧记录再重试；服务端最多只回放最近 50 条。
    pruneProcessedEvents(storage, baseKey, 150);
    try {
      storage.setItem(processedKey, String(lastProcessedAt));
    } catch {
      try {
        await sharedStore.mark(processedKey);
      } catch {
        // 两种同源持久化都被禁用时只能依赖当前锁周期，不能让已展示通知抛错重试。
      }
      return;
    }
  }
  pruneProcessedEvents(storage, baseKey, MAX_PROCESSED_EVENTS);
}

/**
 * 原子尝试展示事件，并只在 deliver 成功后记录为已处理。
 * 返回 true 表示本标签页完成了展示；已被其他标签页处理或当前无法展示时返回 false。
 */
export async function deliverRecentEventOnce(
  storage: EventStorage,
  key: string,
  eventId: string,
  withLock: WithEventLock,
  deliver: (stillOwner: OwnershipCheck) => boolean | Promise<boolean>,
  sharedStore: ProcessedEventStore = unavailableProcessedEvents,
): Promise<boolean> {
  const processedKey = `${key}:${eventId}`;
  const claim = async (stillOwner: OwnershipCheck) => {
    if (await wasProcessed(storage, processedKey, sharedStore)) return false;
    const recentIds = readRecentEventIds(storage, key);
    if (recentIds.includes(eventId)) return false;
    if (!(await stillOwner())) return false;
    if (!(await deliver(stillOwner))) return false;
    if (!(await stillOwner())) return false;

    // 每个事件单独落键，不让并行认领互相覆盖；落标失败也不能把已展示通知当成可重试。
    await markProcessed(storage, key, processedKey, sharedStore);
    return true;
  };

  return withLock(`taskboard:${key}:${eventId}`, claim);
}
