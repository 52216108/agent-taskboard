-- agent-taskboard SQLite 架构。SQLite 无原生列注释，故以本文件 + SCHEMA.md 作为注释事实源。
-- 全部 IF NOT EXISTS，可重复执行（幂等）。

-- project：项目注册/覆盖表。懒创建——扫描到的项目无此行也能显示，仅在置顶/归档/改名/有受管任务时建行。
CREATE TABLE IF NOT EXISTS project (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,  -- 内部自增主键，task.project_id 指向它
  project_key   TEXT    NOT NULL UNIQUE,            -- 稳定身份键：归一化 git remote（无则 realpath），改名不变 → 任务不断链
  path          TEXT    NOT NULL,                   -- 当前绝对路径，可随目录改名被 reconcilePaths 更新
  display_name  TEXT,                               -- 用户覆盖的展示名；NULL=用扫描值
  description   TEXT,                               -- 用户覆盖的简介；NULL=用扫描值
  pinned        INTEGER NOT NULL DEFAULT 0,         -- 是否置顶：0=否 1=是
  archived      INTEGER NOT NULL DEFAULT 0,         -- 是否归档：0=否 1=是（归档后默认不在看板主视图显示）
  sort_order    INTEGER NOT NULL DEFAULT 0,         -- 手动排序权重（暂留，越小越靠前）
  created_at    TEXT    NOT NULL,                   -- 建行时间 ISO8601
  updated_at    TEXT    NOT NULL                    -- 最后更新 ISO8601
);

-- task：受管任务（看板卡片）。区别于只读的 tasks/todo.md——这些是可增删改、可流转的结构化任务。
CREATE TABLE IF NOT EXISTS task (
  id               INTEGER PRIMARY KEY AUTOINCREMENT, -- 任务主键
  project_id       INTEGER NOT NULL,                  -- 所属项目 → project.id（外键）
  title            TEXT    NOT NULL,                  -- 任务标题
  description      TEXT,                              -- 任务详情，可空
  status           TEXT    NOT NULL DEFAULT 'collected',-- 看板列：collected(已收集,需求收件箱,新建/导入默认)/backlog(待规划,确定要做)/todo(待开发,可被agent领取)/doing(进行中)/review(待验收)/done(已完成)/archived(归档软删)
  priority         TEXT    NOT NULL DEFAULT 'p2',     -- p0(最高/故障级)/p1/p2/p3(最低)
  task_type        TEXT    NOT NULL DEFAULT 'feature',-- 任务类型：feature(需求)/bug(缺陷)/optimize(优化重构)；新建默认 feature
  due_date         TEXT,                              -- 截止日期 ISO8601，可空
  assignee         TEXT,                              -- 认领人/执行者（claude/codex/人名等自由文本），NULL=未认领
  reject_reason    TEXT,                              -- 最近一次验收打回原因（review→todo 时写入，重新置 review/done 自动清空），NULL=无打回在身
  tags             TEXT,                              -- 标签，JSON 字符串数组，可空
  images           TEXT,                              -- 任务附图，JSON 数组 [{name,addedAt}]：name=磁盘文件名(<uuid>.<ext>)，addedAt=ISO8601；绝对路径=~/.project-board/task-images/<task.id>/<name>；NULL=无图
  source           TEXT    NOT NULL DEFAULT 'manual', -- manual(手动新建)/todo_md(从 todo.md 导入快照)
  todo_fingerprint TEXT,                              -- 导入去重指纹=sha1(project_key+段+文本)；仅 source=todo_md 有值
  sort_order       INTEGER NOT NULL DEFAULT 0,        -- 列内排序权重，越小越靠前
  created_at       TEXT    NOT NULL,                  -- 创建时间 ISO8601
  updated_at       TEXT    NOT NULL,                  -- 更新时间 ISO8601
  completed_at     TEXT,                              -- 完成时间 ISO8601；status 变 done 时写入
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_project ON task(project_id);
-- 同一项目内 todo.md 导入指纹唯一 → INSERT OR IGNORE 实现去重（partial index，仅约束非空指纹）
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_fingerprint
  ON task(project_id, todo_fingerprint) WHERE todo_fingerprint IS NOT NULL;

-- scan_cache：整表单行（id 固定 1）缓存最近一次扫描的原始结果，供首屏秒开 + 后台刷新。
CREATE TABLE IF NOT EXISTS scan_cache (
  id          INTEGER PRIMARY KEY CHECK (id = 1),  -- 固定为 1，全表仅一行
  payload     TEXT    NOT NULL,                    -- 扫描结果 JSON（原始 ProjectInfo[]，未含 DB 覆盖/计数）
  scanned_at  TEXT    NOT NULL                     -- 该次扫描完成时间 ISO8601
);
