const DB_NAME = 'agent-taskboard-browser-locks';
const STORE_NAME = 'locks';
const LEASE_MS = 10_000;
const PROCESSED_PREFIX = 'processed:';
const MAX_PROCESSED_EVENTS = 200;

interface LockLease {
  owner: string;
  expiresAt: number;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开浏览器互斥数据库'));
    request.onblocked = () => reject(new Error('浏览器互斥数据库升级被阻止'));
  });
  return databasePromise;
}

function acquireLease(database: IDBDatabase, name: string, owner: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(name);
    let acquired = false;

    request.onsuccess = () => {
      const lease = request.result as LockLease | undefined;
      if (!lease || lease.expiresAt <= Date.now()) {
        store.put({ owner, expiresAt: Date.now() + LEASE_MS } satisfies LockLease, name);
        acquired = true;
      }
    };
    transaction.oncomplete = () => resolve(acquired);
    transaction.onerror = () => reject(transaction.error ?? new Error('浏览器互斥失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器互斥中止'));
  });
}

function releaseLease(database: IDBDatabase, name: string, owner: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(name);
    request.onsuccess = () => {
      const lease = request.result as LockLease | undefined;
      if (lease?.owner === owner) store.delete(name);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('浏览器互斥释放失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器互斥释放中止'));
  });
}

const waitForLease = () => new Promise<void>((resolve) => setTimeout(resolve, 25 + Math.random() * 25));

function ownsLease(database: IDBDatabase, name: string, owner: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(name);
    request.onsuccess = () => {
      const lease = request.result as LockLease | undefined;
      resolve(lease?.owner === owner && lease.expiresAt > Date.now());
    };
    request.onerror = () => reject(request.error ?? new Error('浏览器互斥所有权检查失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器互斥所有权检查中止'));
  });
}

function renewLease(database: IDBDatabase, name: string, owner: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(name);
    let renewed = false;
    request.onsuccess = () => {
      const lease = request.result as LockLease | undefined;
      if (lease?.owner === owner) {
        store.put({ owner, expiresAt: Date.now() + LEASE_MS } satisfies LockLease, name);
        renewed = true;
      }
    };
    transaction.oncomplete = () => resolve(renewed);
    transaction.onerror = () => reject(transaction.error ?? new Error('浏览器互斥续租失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器互斥续租中止'));
  });
}

/** Web Locks 不可用时，以 IndexedDB 原子抢占短租约，并用所有权复核阻止过期持有者提交。 */
export async function withIndexedDbLock(
  name: string,
  claim: (stillOwner: () => Promise<boolean>) => boolean | Promise<boolean>,
): Promise<boolean> {
  const database = await openDatabase();
  const owner = `${Date.now()}-${Math.random()}`;
  while (!(await acquireLease(database, name, owner))) await waitForLease();
  let leaseLost = false;
  let renewing = false;
  const renewalTimer = window.setInterval(() => {
    if (renewing || leaseLost) return;
    renewing = true;
    void renewLease(database, name, owner)
      .then((renewed) => {
        if (!renewed) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      })
      .finally(() => {
        renewing = false;
      });
  }, LEASE_MS / 3);

  try {
    return await claim(async () => !leaseLost && (await ownsLease(database, name, owner)));
  } finally {
    window.clearInterval(renewalTimer);
    await releaseLease(database, name, owner).catch(() => undefined);
  }
}

/** localStorage 不可写时，仍用同源 IndexedDB 在标签页间共享已处理状态。 */
export async function hasIndexedDbProcessedEvent(key: string): Promise<boolean> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(`${PROCESSED_PREFIX}${key}`);
    request.onsuccess = () => resolve(request.result !== undefined);
    request.onerror = () => reject(request.error ?? new Error('浏览器通知去重读取失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器通知去重读取中止'));
  });
}

export async function markIndexedDbProcessedEvent(key: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(Date.now(), `${PROCESSED_PREFIX}${key}`);
    const keysRequest = store.getAllKeys();
    const valuesRequest = store.getAll();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('浏览器通知去重写入失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器通知去重写入中止'));
    valuesRequest.onsuccess = () => {
      if (keysRequest.readyState !== 'done') return;
      const entries = keysRequest.result
        .map((storedKey, index) => ({
          key: storedKey,
          timestamp: valuesRequest.result[index],
        }))
        .filter(
          (entry): entry is { key: string; timestamp: number } =>
            typeof entry.key === 'string' &&
            entry.key.startsWith(PROCESSED_PREFIX) &&
            typeof entry.timestamp === 'number',
        )
        .sort((a, b) => b.timestamp - a.timestamp);
      for (const entry of entries.slice(MAX_PROCESSED_EVENTS)) store.delete(entry.key);
    };
  });
}
