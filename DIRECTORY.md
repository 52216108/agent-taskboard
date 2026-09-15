# 文件索引 DIRECTORY.md

> agent-taskboard（本地多项目看板）— 文件职责速查
>
> 单体应用：后端扫描+API（Fastify/tsx，无构建步骤）、前端看板（React18+AntD5+Vite）、终端 CLI。
> 最后更新：2026-09-15

> 配套索引：数据库见 [SCHEMA.md](./SCHEMA.md)，接口见 [API.md](./API.md)。

---

## 顶层结构

| 目录 | 角色 | 运行方式 |
|------|------|---------|
| `server/` | 后端：磁盘扫描 + HTTP API + SQLite | `npm run start`（tsx，:7788） |
| `client/` | 前端：项目看板 / 任务工作台 | `npm run build` → `client/dist`（由 server 托管） |
| `cli/` + `bin/` | 终端 CLI：看项目/任务、登记任务、流转状态 | `bin/board`（包装 `node --import tsx`） |
| `deploy/` | 开机自启 + 远程访问（launchd + Tailscale） | `deploy/setup.sh` |
| `docs/` | agent 集成说明（`agents/`）、README 截图（`screenshots/`） | — |
| `.github/` | CI（typecheck+test+build）、飞书推送通知、Issue 模板 | GitHub Actions |

---

## server/ — 后端

| 文件 | 职责 | 关键导出 |
|------|------|---------|
| `src/index.ts` | Fastify 入口：注册所有 API 路由（含任务事件 SSE）、鉴权 hook、扫描缓存、静态托管。见 [API.md](./API.md) | `app`, `main()` |
| `src/task-events.ts` | 进程内任务事件总线：广播首次进入待验收状态的事件，独立维护任务历史额度与连接回放游标 | `TaskEventBroker`, `formatSseEvent`, `taskEvents` |
| `src/config.ts` | 全局运行配置，环境变量覆盖（端口/根目录/DB路径/token/Host 白名单）；绑定安全校验（非 loopback 必须带 token，否则拒绝启动） | `CONFIG`, `isLoopbackHost`, `checkSecureBinding`, `buildAllowedHosts`, `hostnameOf` |
| `src/scanner.ts` | 扫描根目录（depth=1）、识别"真项目"、聚合 git/todo/技术栈 → ProjectInfo/Detail。**多仓外壳**（无 .git、直接子目录有 git 仓）产出一个 `workspace` 项目（身份键=外壳 realpath）+ 每个子仓一个 `repo` 子项目（name=`外壳/子仓`、parent=外壳），子项目紧排在工作区后 | `scanProjects`, `gitSubdirs`, `buildDetail` |
| `src/git.ts` | 异步读单个 git 仓库概要：分支/脏文件数/最近提交/remote；remote 归一化 | `getGitInfo`, `normalizeRemote`, `NO_GIT` |
| `src/tech-stack.ts` | 据 package.json 依赖 + 标记文件推断技术栈标签 | `detectTechStack` |
| `src/todo-parser.ts` | 解析 Markdown 复选框（`- [ ]`/`- [x]`/`- [~]`）→ 待办统计 + 条目 | `parseTodoText`, `parseTodoFile` |
| `src/db.ts` | SQLite 连接（better-sqlite3）+ 幂等建表 + 轻量迁移（ALTER 补列 + `PRAGMA user_version` 守护的一次性数据迁移：v1 旧 `todo`→`backlog`；v2 旧 `backlog`→`collected`）+ 在线备份 + 内存库标记 | `getDb`, `migrate`, `backupTo`, `useInMemoryDb`, `isInMemoryDb` |
| `src/schema.sql` | DDL 事实源（project/task/scan_cache），内联列注释。见 [SCHEMA.md](./SCHEMA.md) | — |
| `src/repo.ts` | 任务/项目 CRUD、懒创建、路径迁移、enrich（合并 DB 状态到扫描结果；未被认领的旧行以 `#<dbId>` 追加，目录仍在的标 `stale`）、**工作区旧行自动归并**（同外壳路径多行并一、键改 realpath，合并前备份）、手动 merge / 任务 move、todo.md 导入去重、任务附图增删 | `createTask`, `updateTask`, `moveTask`, `listTasks`, `listAllTasks`, `enrich`, `reconcilePaths`, `reconcileWorkspaces`, `mergeProjects`, `importTodos`, `patchProject`, `addTaskImage`, `removeTaskImage`, `NewTask`, `TaskPatch` |
| `src/task-images.ts` | 任务附图磁盘存取与文件名校验（路径单一事实源，CLI 共用）。落盘 `~/.project-board/task-images/<taskId>/` | `saveImage`, `deleteImage`, `taskImagePath`, `isValidName`, `extForMime`, `contentTypeForName` |
| `src/types.ts` | 后端类型事实源：ProjectInfo（含 `kind`/`parent`/`stale`）/Task + 枚举（TaskStatus/TaskPriority/**TaskType**/**ProjectKind**）+ **TaskImage** + 详情亲属 `ProjectTasksRef` | `Task`, `TaskType`, `TaskImage`, `ProjectInfo`, `ProjectKind`, `ProjectTasksRef` … |
| `test/` | vitest 单测：`repo.test.ts`（任务/项目/类型）、`api.test.ts`（集成：防线/鉴权/校验，不触发扫描）、`api-workspace.test.ts`（集成：临时目录真扫，工作区/子仓路由、详情亲属任务、旧行归并、merge/move）、`task-events.test.ts`（通知广播/重连/SSE 帧）、`client-recent-events.test.ts`（浏览器通知去重）、`config.test.ts`、`scanner.test.ts`（临时目录 + git init 真扫：单仓/工作区+子仓/普通目录/非项目分类）、`task-images.test.ts`、`todo-parser.test.ts` | — |

---

## client/ — 前端

界面是「左侧常驻侧边栏 + 右侧面包屑顶栏 + 页面工具条」的工作区外壳。
样式分两层：外壳/看板/卡片/列表**手写 CSS**（`theme.css` + `theme.ts` 的令牌），
弹窗/表单/日期选择仍用 AntD（`ConfigProvider` 吃同一套令牌，两层不跑色）。

| 文件 | 职责 | 关键符号 |
|------|------|---------|
| `src/main.tsx` | React 根挂载，包 `BrowserRouter`；**挂载前先 `applyPalette()`**，首帧就是正确主题 | — |
| `src/App.tsx` | 根组件：明暗状态 + AntD ConfigProvider（令牌来自 `theme.ts`）+ 路由，页面统一包进 `AppShell` | `App`；路由 `/`（项目概览）`/tasks`（全局任务）`/p/*`（项目页，子仓名带斜杠） |
| `src/theme.ts` | **设计令牌单一事实源**：明暗两套调色板 + 状态/优先级/类型色，同时导出成 CSS 变量与 AntD token | `LIGHT`, `DARK`, `applyPalette`, `antdTokens`, `initialDark` |
| `src/theme.css` | 手写样式层（外壳/看板/卡片/列表/按钮），颜色一律 `var(--xxx)`，末尾少量 AntD 收边 | — |
| `src/BoardContext.tsx` | 跨页共享状态：项目列表 + 搜索词 + SSE 订阅；任务交付时刷新数据并触发站内/系统通知 | `BoardProvider`, `useBoard` |
| `src/ProjectsPage.tsx` | 项目概览页：顶层项目卡片网格（子仓不单独出卡，挂在工作区卡上；搜到子仓也显示其工作区）+ 排序 / 含归档过滤 | `ProjectsPage` |
| `src/ProjectPage.tsx` | 单项目页：工具条（任务/todo.md/资料 切换 + 置顶/归档/编辑 + 新建任务）+ 看板 / 只读 todo 清单 / 资料表，并持有新建弹窗。**工作区页**把外壳自己的（跨仓）任务与各子仓任务合成一块看板（卡片带仓标签、可按仓筛选），新建时可选落到工作区还是某个子仓 | `ProjectPage` |
| `src/api.ts` | 后端 API 客户端封装（fetch + token header），含带鉴权头及自动重连的流式 SSE、NewTask/TaskPatch、任务图片上传/删除/取 URL | `subscribeTaskEvents`, `createTask`, `updateTask`, `fetchAllTasks`, `uploadTaskImage` … |
| `src/recent-events.ts` | 浏览器通知事件去重：每个事件独立加锁，保留最近 200 个处理标记，并兼容旧版单值格式 | `deliverRecentEventOnce` |
| `src/indexeddb-lock.ts` | Web Locks 不可用时提供续租互斥，并在 localStorage 不可写时保存跨标签已处理状态 | `withIndexedDbLock`, `hasIndexedDbProcessedEvent`, `markIndexedDbProcessedEvent` |
| `src/types.ts` | 前端类型，与后端对齐（含 `TaskType = feature\|bug\|optimize`、`TaskImage`） | `Task`, `TaskType`, `TaskImage`, `ProjectInfo` … |
| `src/util.ts` | 工具：相对时间 / 活跃度等级 / 活跃受管任务数 / 项目页链接（子仓名逐段转义）/ **任务类型与状态的展示文案**（看板/弹窗/全局列表共用，单一事实源；颜色在 `theme.ts`） | `relativeTime`, `activityLevel`, `activeManaged`, `projectHref`, `TASK_TYPE_META`, `TASK_TYPE_OPTIONS`, `BOARD_STATUSES`, `TASK_STATUS_META` |
| `src/components/AppShell.tsx` | 应用外壳：侧边栏（搜索 / 新建任务 / 导航 / 项目——子仓缩进挂在工作区下 / 通知·重扫·令牌·主题）+ 面包屑顶栏；持有系统通知权限入口 | `AppShell` |
| `src/components/StatusIcon.tsx` | 状态进度环（六状态画成 0→1 填充，已完成实心打勾）+ 优先级信号条（p0 感叹号方块），**形状即分级，不依赖颜色** | `StatusIcon`, `PriorityIcon` |
| `src/components/ProjectCard.tsx` | 项目卡片：简介/技术栈/**任务状态分布条**/git/待办计数/活跃度 + 置顶按钮；工作区卡显示子仓芯片（可点进）、分布与活跃数含各子仓；旧行标「旧身份行/目录已消失」 | `ProjectCard`, `StatusBar` |
| `src/components/TaskBoard.tsx` | 六列看板（列数/定义源自 util 的 `BOARD_STATUSES`）：**列带状态底色 + 列头图标·计数·「＋」**、拖拽流转、卡片**三段式（编号行/标题/描述摘要/页脚）**，卡片可带所属仓标签（工作区合并视图用）。「已完成」列不给「＋」——置 done 只能走人工验收 | `TaskBoard`, `TaskCard`, `BoardTask` |
| `src/components/TaskCreateModal.tsx` | 新建任务弹窗（标题/描述/类型/优先级/认领人/截止/**图片内存缓冲、创建后上传**）；**无项目上下文时弹窗内选项目**，`targetStatus` 决定落哪列（默认已收集）；「取消」不落库 | `TaskCreateModal` |
| `src/components/TaskEditModal.tsx` | 任务编辑弹窗（标题/描述/**类型**/优先级/状态/认领人/截止/归档/打回/**图片粘贴上传**/**子任务清单**），看板与全局视图共用 | `TaskEditModal` |
| `src/components/GlobalTaskView.tsx` | 跨项目全局任务列表（`/tasks`）+ 筛选（未完成/高优/今天/逾期/全部）+ 状态环/优先级/类型标记 | `GlobalTaskView` |

---

## cli/ + bin/ — 终端 CLI

| 文件 | 职责 |
|------|------|
| `bin/board` | Bash 包装器：解析软链定位项目根，传 `BOARD_CWD`（用户原始 cwd），用 server 的 tsx 跑 `cli/task.ts` |
| `cli/task.ts` | CLI 主体：调 HTTP API 列项目/任务（工作区下缩进子仓、旧行单列）、`add`（支持 `--bug`/`--optimize`/`--type`）、`here`（按 cwd 认项目，路径最长匹配：子仓里命中子仓、外壳里命中工作区；外壳里看到工作区+各子仓任务、子仓里附带工作区的跨仓任务；`here add --repo <子仓>` 登记到指定子仓）、`move`（任务改挂项目）、`merge`（旧行并入现役项目）、`backup`、状态流转 |

---

## deploy/ — 部署

| 文件 | 职责 |
|------|------|
| `setup.sh` | 一键安装：装依赖 + 构建前端 + 生成 token + 渲染并加载 launchd plist（开机自启） |
| `com.projectboard.plist` | launchd 服务定义模板（占位符由 setup.sh 渲染），macOS 常驻守护 |
| `com.projectboard.backup.plist` | 每日 04:00 备份数据库的 launchd 定时任务模板 |
| `README.md` | 部署 + 远程访问说明（Tailscale 私有内网方案） |

---

## docs/ — 文档

| 路径 | 职责 |
|------|------|
| `agents/board-tasks-skill.md` | Claude Code skill（装到 `~/.claude/skills/board-tasks/SKILL.md`） |
| `agents/claude-setup-prompt.md` | Claude Code 接入提示词（粘给 Claude Code，自动把 board-tasks-skill.md 装成 skill） |
| `agents/codex-setup-prompt.md` | Codex 接入提示词（粘给 Codex，把约定写入全局 `~/.codex/AGENTS.md`；根目录 `AGENTS.md` 仅本仓库内生效） |
| `screenshots/` | README 用产品截图（演示数据，非真实项目） |

---

## 根目录文档

| 文件 | 职责 |
|------|------|
| `README.md` / `README.zh-CN.md` | 项目说明（英文主 / 中文），含安全说明与 agent 接入 |
| `AGENTS.md` | 在本仓库工作的 coding agent 通用规则（Codex 自动读取） |
| `CLAUDE.md` | Claude Code 专属补充：PR 流程、提交前检查、索引同步清单、红线 |
| `CONTRIBUTING.md` | 贡献指南：环境、提交前检查、安全敏感区域 |
| `SECURITY.md` | 漏洞报告方式 + 威胁模型（防什么 / 不防什么） |
| `LICENSE` | MIT |

---

## 数据流概览

```
扫描：磁盘(~/projects/*) ──scanner+git+tech-stack+todo-parser──▶ ProjectInfo[]
                                                                    │
                              SQLite(project/task) ──repo.enrich──▶ 合并覆盖+受管计数+信号
                                                                    │
前端/CLI ◀── Fastify(index.ts) API ◀────────────────────────────────┘

通知：任务首次进入 review ──task-events/SSE──▶ BoardContext ──▶ 数据刷新 + 站内/系统通知
```

- **项目信息**：实时只读扫描（磁盘/git/README/todo.md），带内存缓存 + scan_cache 首屏秒开。
- **受管任务**：持久化在 SQLite（`~/.project-board/board.db`）。
- **项目身份**：稳定键 = 归一化 git remote（无则 realpath），改名/移动不断链。**多仓外壳**（工作区）的键恒为外壳 realpath，子仓各自按 remote 成项目；外壳旧行在扫描后自动归并（合并前备份），其余身份漂移的旧行以 `#<dbId>` 显示、由用户 `board merge` 并入。
