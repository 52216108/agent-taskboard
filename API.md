# API 接口索引

> agent-taskboard（本地多项目看板）— 接口速查表
>
> 后端：Node22 + Fastify + TypeScript（事实源 `server/src/index.ts`）。默认监听 `127.0.0.1:7788`。
> 最后更新：2026-07-22

---

## 模块 × 接口速查

| 模块 | 接口前缀 | 接口数 | 说明 |
|------|----------|--------|------|
| 项目 | `/api/projects` | 4 | 项目列表/扫描/详情/覆盖 |
| 受管任务 | `/api/projects/:name/tasks`、`/api/tasks` | 9 | 看板卡片 CRUD + 全局视图 + todo.md 导入 + 图片附件 |

---

## 权限说明

分两层：**始终生效的运行期防线**，和**可选的令牌鉴权**。

### 运行期防线（与 token 无关，始终生效）

对所有 `/api/` 请求：

- **Host 白名单**：`Host` 头的 hostname 必须是 `127.0.0.1`/`localhost`/`[::1]` 或 `BOARD_ALLOWED_HOSTS`
  列出的值，否则 `403 bad host`。防 DNS rebinding——攻击者把域名 rebind 到 127.0.0.1 后请求变同源，
  但 Host 头仍是其域名。端口不参与判定。
- **跨站拒绝**：`Sec-Fetch-Site` 为 `cross-site`/`same-site` 时返回 `403`；`same-origin` 与 `none`
  （地址栏直达）放行；不带该头的客户端（CLI/curl）放行。防 CSRF——`text/plain` 的 POST 属于
  CORS simple request 不触发预检，仅靠 CORS 挡不住。
- 静态资源（非 `/api/`）不受此限制，否则反代场景下前端打不开。

### 令牌鉴权（设置 `BOARD_TOKEN` 后生效）

- **鉴权开关**：仅当设置了环境变量 `BOARD_TOKEN` 才生效（本机默认不设 → 不校验令牌）。
- **拦截范围**：**所有** `/api/` 请求都需要令牌，读写皆然（含图片）。
- **凭证方式**：写请求只认 `Authorization: Bearer <token>`（header-only，保 CSRF 防护）；
  读请求（`GET`/`HEAD`）额外接受 `?token=` 查询参数——因为 `<img src>` 无法设自定义头。

下表「鉴权」列：`写` = 写操作，需 Bearer 头；`免` = 未设 `BOARD_TOKEN` 时无需令牌
（设了则同样需要，读操作可用 `?token=`）。

---

## 项目 — `/api/projects`

> Controller: `server/src/index.ts`

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/projects` | 免 | 列出所有项目（扫描结果 + DB 覆盖/受管计数 enrich） |
| POST | `/api/projects/scan` | 写 | 强制重新扫描磁盘（绕过缓存）后返回列表 |
| GET | `/api/projects/:name` | 免 | 项目详情（含 todo 条目、README 摘要、受管任务列表） |
| PATCH | `/api/projects/:name` | 写 | 覆盖项目：`displayName`/`description`/`pinned`/`archived`（懒创建 DB 行） |

---

## 受管任务 — `/api/projects/:name/tasks`、`/api/tasks`

> Controller: `server/src/index.ts`；落库逻辑 `server/src/repo.ts`

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/projects/:name/tasks` | 免 | 某项目的受管任务；`?includeArchived=1` 含归档 |
| GET | `/api/tasks` | 免 | 跨项目全局任务（附 projectName/key/path/dir），工作台视图用；`?includeArchived=1` |
| POST | `/api/projects/:name/tasks` | 写 | 新建受管任务（`source=manual`） |
| PATCH | `/api/tasks/:id` | 写 | 改任务字段 / 状态流转；**拒绝 `status=done`（→400，指向 accept 端点）**；置 review 自动清空 reject_reason；离开 done 清空 completed_at/accepted_at/accepted_by |
| POST | `/api/tasks/:id/reject` | 写 | 验收打回：仅 review 态可打回 → todo 并记录原因；body `{reason}`（trim 后 1..500 字符），非 review → 400 |
| POST | `/api/tasks/:id/accept` | 写 | 验收通过 → done（**唯一置 done 入口**）：写 completed_at/accepted_at、清 reject_reason；body `{by?}`=验收人署名（可空，trim 后 1..32 字符；单用户模型下自报、仅审计）。宽松语义：任意状态皆可验收通过；任务不存在 → 404 |
| POST | `/api/projects/:name/import` | 写 | 从 `tasks/todo.md` 导入未完成项为受管任务（指纹去重） |
| POST | `/api/tasks/:id/images` | 写 | 上传任务附图（body=原始图片字节，content-type=image/png\|jpeg\|webp\|gif，≤10MB）；返回 `{name,url}` |
| GET | `/api/tasks/:id/images/:name` | 免 | 取任务附图（流式） |
| DELETE | `/api/tasks/:id/images/:name` | 写 | 删任务附图 |

**POST 新建 body（NewTask）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 是 | 标题（空串 → 400） |
| description | string \| null | 否 | 详情 |
| priority | `p0`\|`p1`\|`p2`\|`p3` | 否 | 默认 `p2`；非法 → 400 |
| taskType | `feature`\|`bug`\|`optimize` | 否 | 任务类型：需求/缺陷/优化；默认 `feature`；非法 → 400 |
| dueDate | string \| null | 否 | `YYYY-MM-DD`；格式错 → 400 |
| assignee | string \| null | 否 | 认领人/执行者；字符串 trim 后须为 1..32 字符，`null` 表示未认领 |
| tags | string[] | 否 | 标签 |
| status | `collected`\|`backlog`\|`todo`\|`doing`\|`review`\|`done`\|`archived` | 否 | 看板列；默认 `collected`(已收集)；非法 → 400 |

**PATCH 改任务 body（TaskPatch）：** 上述字段均可选，外加 `sortOrder` 与 `subtasks`；同样校验 `priority`/`taskType`/`status`/`dueDate`/`assignee`，其中 `assignee: null` 清空认领人。`status=done` 不可经 PATCH——只能由 accept 接口写（→400）。`rejectReason` 不可经 PATCH 写入——只能由打回接口写、由置 review(PATCH) 或 accept 时清空。`subtasks`=子任务清单（客户端整组提交）：数组 ≤50，每项 `{id:整数, title:trim 后 1..200, done:布尔}`，不合法 → 400。

---

## 静态资源 / 兜底

- 存在 `client/dist` 时挂载为静态站点；非 `/api/` 的未命中路由回退 `index.html`（SPA 前端路由）。
- `/api/` 下未命中 → 404 `{ error: 'not found' }`。
