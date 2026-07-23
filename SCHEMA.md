# SCHEMA.md — agent-taskboard 数据索引

SQLite 库，默认 `~/.project-board/board.db`（`BOARD_DB` 可覆盖）。DDL 事实源：`server/src/schema.sql`。
P1 无库；P2 起引入。**SQLite 无原生列注释，故本文件与 schema.sql 内联注释共同作为注释事实源。**

## 表速查

| 表 | 用途 | 关键列 |
|---|---|---|
| `project` | 项目注册/覆盖（懒创建） | project_key(唯一身份), path, display_name, pinned, archived |
| `task` | 受管任务=看板卡片（区别于只读 todo.md） | project_id(FK), status, priority, source, todo_fingerprint |
| `scan_cache` | 单行扫描结果快照（首屏秒开） | id=1, payload(JSON), scanned_at |

## project — 项目注册/覆盖表

懒创建：扫描到的项目无此行也能在看板显示；仅在**置顶/归档/改展示名简介/有受管任务**时建行。

| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 内部自增主键，被 task.project_id 引用 |
| project_key | TEXT UNIQUE | 稳定身份键：归一化 git remote（无 remote 则 realpath）。改名/移动不变 → 任务不断链 |
| path | TEXT | 当前绝对路径，可随改名被 `reconcilePaths` 更新 |
| display_name | TEXT NULL | 用户覆盖展示名；NULL=用扫描值 |
| description | TEXT NULL | 用户覆盖简介；NULL=用扫描值 |
| pinned | INTEGER | 置顶：0/1 |
| archived | INTEGER | 归档：0/1（归档后默认不在主视图） |
| sort_order | INTEGER | 手动排序权重（暂留，越小越前） |
| created_at / updated_at | TEXT | ISO8601 时间戳 |

## task — 受管任务（看板卡片）

| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 任务主键 |
| project_id | INTEGER FK→project.id | 所属项目，ON DELETE CASCADE |
| title | TEXT | 标题 |
| description | TEXT NULL | 详情 |
| status | TEXT | 看板列（六态流转 + 归档）：`collected`(已收集,需求收件箱,新建/导入默认)/`backlog`(待规划,确定要做)/`todo`(待开发,可被agent领取)/`doing`(进行中)/`review`(待验收,agent做完提交待人工验收)/`done`(已完成)/`archived`(归档软删)。**升级历史**：原仅 todo/doing/done/archived 三列；db.ts 用 `PRAGMA user_version` 守护两次一次性迁移：v1 把存量 `todo`(旧待办) 迁到 `backlog`（`todo` 改表示"待开发"）；v2 在待规划前加「已收集」收件箱，把存量 `backlog`(旧收件箱) 迁到 `collected`（`backlog` 改表示"确定要做"） |
| priority | TEXT | `p0`(最高/故障级)/`p1`/`p2`/`p3`(最低) |
| task_type | TEXT | 任务类型：`feature`(需求)/`bug`(缺陷)/`optimize`(优化重构)；新建默认 `feature`。老库由 db.ts migrate ALTER 补列并回填 feature |
| due_date | TEXT NULL | 截止 ISO8601 |
| assignee | TEXT NULL | 认领人/执行者（惯用值 `claude`/`codex`/人名，也允许其他自由文本）；NULL=未认领。老库由 db.ts 补列 |
| reject_reason | TEXT NULL | 最近一次验收打回原因（打回接口 review→todo 时写入）；任务重新置 review 或 done 时自动清空；NULL=无打回在身。老库由 db.ts 补列 |
| tags | TEXT NULL | JSON 字符串数组 |
| images | TEXT NULL | 任务附图，JSON 数组 `[{name,addedAt}]`：name=磁盘文件名(`<uuid>.<ext>`)，绝对路径=`~/.project-board/task-images/<task.id>/<name>`；NULL=无图。老库由 db.ts migrate ALTER 补列 |
| source | TEXT | `manual`(手动)/`todo_md`(从 todo.md 导入) |
| todo_fingerprint | TEXT NULL | 导入去重指纹 sha1(project_key+段+文本)[:16]；仅 source=todo_md |
| sort_order | INTEGER | 列内排序 |
| created_at / updated_at | TEXT | ISO8601 |
| completed_at | TEXT NULL | status 变 done 时写入，离开 done 清空 |
| accepted_at | TEXT NULL | 人工验收(→done)通过时间 ISO8601；仅经 `POST /tasks/:id/accept` 写入，离开 done 清空；NULL=未经验收端点（历史 done 或未完成）。老库由 db.ts migrate ALTER 补列 |
| accepted_by | TEXT NULL | 验收人署名（自报，如 CLI `--as`/BOARD_ACTOR）；单用户模型下无法强制鉴别，仅供审计；NULL=未提供。老库由 db.ts migrate ALTER 补列 |

**索引**：`idx_task_project(project_id)`；`idx_task_fingerprint(project_id, todo_fingerprint) WHERE todo_fingerprint IS NOT NULL`（唯一，支撑 INSERT OR IGNORE 去重）。

## scan_cache — 扫描快照

单行（id 固定 1）。`payload` 存原始扫描结果 JSON（ProjectInfo[]，**未含** DB 覆盖/任务计数——这些在每次请求时 enrich）。启动时回灌内存缓存令首屏秒开。

---

## 历史遗留

0.x 版本曾有「派活」功能（看板在隔离 git worktree 里启动 coding agent），随之有一张 `dispatch_run` 表。
该功能已整体移除，建表语句也已从 `schema.sql` 删去——**新库不会再有这张表**。

但**升级上来的老库里它仍然存在**（代码不再引用它，运行期无影响）。留着不管即可；想清理就手动执行：

```sql
DROP TABLE IF EXISTS dispatch_run;
```

之所以不做成自动迁移：删表是不可逆操作，而残留一张空表的代价远小于替用户做这个决定。
唯一已知的将来风险是——若某天要重建 `task` 表（SQLite 改列需走 12 步 ALTER 流程），
这张残留子表的外键会挡住 `DROP TABLE task`，届时先手动删掉它即可。
