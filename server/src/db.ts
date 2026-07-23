import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONFIG } from './config';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

/** 获取（首次调用时初始化）SQLite 连接，并幂等建表。 */
export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(dirname(CONFIG.dbPath), { recursive: true });
  const db = new Database(CONFIG.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // 第二连接（备份/CLI/checkpoint）抢锁时不立即抛 SQLITE_BUSY，最多等 5s 重试。
  db.pragma('busy_timeout = 5000');
  db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
  migrate(db);
  _db = db;
  return db;
}

/**
 * 轻量迁移。两类策略并存：
 * 1) 补列：SQLite 无 ADD COLUMN IF NOT EXISTS，用 try/catch 吞"列已存在"实现幂等。
 * 2) 数据迁移：用 PRAGMA user_version 守护，保证一次性（不会每次启动重跑）。
 * 导出供单测直接驱动（in-memory DB 不经 getDb，故不会自动迁移）。
 */
export function migrate(db: Database.Database): void {
  const adds = [
    // 老库补任务类型列；NOT NULL + DEFAULT 让既有行回填为 feature(需求)
    "ALTER TABLE task ADD COLUMN task_type TEXT NOT NULL DEFAULT 'feature'",
    // 老库补认领人列；NULL=未认领
    'ALTER TABLE task ADD COLUMN assignee TEXT',
    // 老库补验收打回原因列；NULL=无打回在身
    'ALTER TABLE task ADD COLUMN reject_reason TEXT',
    // 老库补任务附图列；JSON 数组字符串，NULL=无图
    'ALTER TABLE task ADD COLUMN images TEXT',
    // 老库补验收审计列：accepted_at=人工验收(→done)时间、accepted_by=验收人署名（自报），均 NULL=未经 accept 端点
    'ALTER TABLE task ADD COLUMN accepted_at TEXT',
    'ALTER TABLE task ADD COLUMN accepted_by TEXT',
    // 老库补子任务清单列；JSON 数组 [{id,title,done}]，NULL=无子任务
    'ALTER TABLE task ADD COLUMN subtasks TEXT',
  ];
  for (const sql of adds) {
    try {
      db.exec(sql);
    } catch (e) {
      // 只吞"列已存在"，其余迁移错误要暴露
      if (!(e instanceof Error) || !e.message.includes('duplicate column name')) throw e;
    }
  }

  // user_version 守护的一次性数据迁移。version 只读一次：v0 新库会顺序跑完 v1+v2
  // （旧 todo → backlog → collected），既有库各自从当前版本续跑；每个 UPDATE 与版本标记同事务，
  // 避免"数据已迁但版本没标"的崩溃窗口（better-sqlite3 中 PRAGMA user_version 随事务回滚一起撤销）。
  const version = db.pragma('user_version', { simple: true }) as number;

  // v1：状态体系 3 列→5 列升级。旧 todo(待办) 实为"未分诊的点子堆"，语义上属于新「待规划」，
  // 故把存量 todo 行整体迁到 backlog；此后 todo 码改表示「待开发」，由用户从待规划手动晋级。
  if (version < 1) {
    db.transaction(() => {
      db.prepare("UPDATE task SET status = 'backlog', updated_at = ? WHERE status = 'todo'").run(
        new Date().toISOString(),
      );
      db.pragma('user_version = 1');
    })();
  }

  // v2：在「待规划」前新增「已收集」收件箱。旧「待规划」兼任收件箱（未分诊的点子堆），
  // 语义上属于新「已收集」，故把存量 backlog 整体迁到 collected；此后 backlog 专表"确定要做"，
  // 由用户从已收集手动晋级。守护确保只迁一次——否则会把新晋级到 backlog 的行错误打回 collected。
  if (version < 2) {
    db.transaction(() => {
      db.prepare("UPDATE task SET status = 'collected', updated_at = ? WHERE status = 'backlog'").run(
        new Date().toISOString(),
      );
      db.pragma('user_version = 2');
    })();
  }
}

/** 在线备份到指定路径：只读连接 + SQLite Online Backup API，并发写入下也得到一致快照。 */
export async function backupTo(dest: string): Promise<void> {
  const db = new Database(CONFIG.dbPath, { readonly: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
}

/** 测试用：用内存库替换连接（先关闭旧连接，避免 fd 泄漏）。 */
export function useInMemoryDb(): Database.Database {
  if (_db) _db.close();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
  _db = db;
  return db;
}
