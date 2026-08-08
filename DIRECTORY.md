# 文件索引 DIRECTORY.md

> agent-taskboard（本地多项目看板）— 文件职责速查
>
> 单体应用：后端扫描+API（Fastify/tsx，无构建步骤）、前端看板（React18+AntD5+Vite）、终端 CLI。
> 最后更新：2026-08-08

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
| `src/index.ts` | Fastify 入口：注册所有 API 路由、鉴权 hook、扫描缓存、静态托管。见 [API.md](./API.md) | `app`, `main()` |
| `src/config.ts` | 全局运行配置，环境变量覆盖（端口/根目录/DB路径/token/Host 白名单）；绑定安全校验（非 loopback 必须带 token，否则拒绝启动） | `CONFIG`, `isLoopbackHost`, `checkSecureBinding`, `buildAllowedHosts`, `hostnameOf` |
| `src/scanner.ts` | 递归扫描根目录、识别"真项目"、聚合 git/todo/技术栈 → ProjectInfo/Detail | `scanProjects`, `buildDetail` |
| `src/git.ts` | 异步读单个 git 仓库概要：分支/脏文件数/最近提交/remote；remote 归一化 | `getGitInfo`, `normalizeRemote` |
| `src/tech-stack.ts` | 据 package.json 依赖 + 标记文件推断技术栈标签 | `detectTechStack` |
| `src/todo-parser.ts` | 解析 Markdown 复选框（`- [ ]`/`- [x]`/`- [~]`）→ 待办统计 + 条目 | `parseTodoText`, `parseTodoFile` |
| `src/db.ts` | SQLite 连接（better-sqlite3）+ 幂等建表 + 轻量迁移（ALTER 补列 + `PRAGMA user_version` 守护的一次性数据迁移：v1 旧 `todo`→`backlog`；v2 旧 `backlog`→`collected`）+ 在线备份 | `getDb`, `migrate`, `backupTo`, `useInMemoryDb` |
| `src/schema.sql` | DDL 事实源（project/task/scan_cache），内联列注释。见 [SCHEMA.md](./SCHEMA.md) | — |
| `src/repo.ts` | 任务/项目 CRUD、懒创建、路径迁移、enrich（合并 DB 状态到扫描结果）、todo.md 导入去重、任务附图增删 | `createTask`, `updateTask`, `listTasks`, `listAllTasks`, `enrich`, `importTodos`, `patchProject`, `addTaskImage`, `removeTaskImage`, `NewTask`, `TaskPatch` |
| `src/task-images.ts` | 任务附图磁盘存取与文件名校验（路径单一事实源，CLI 共用）。落盘 `~/.project-board/task-images/<taskId>/` | `saveImage`, `deleteImage`, `taskImagePath`, `isValidName`, `extForMime`, `contentTypeForName` |
| `src/types.ts` | 后端类型事实源：ProjectInfo/Task + 枚举（TaskStatus/TaskPriority/**TaskType**）+ **TaskImage** | `Task`, `TaskType`, `TaskImage`, `ProjectInfo` … |
| `test/` | vitest 单测：`repo.test.ts`（任务/项目/类型）、`api.test.ts`（集成）、`config.test.ts`（绑定安全/Host 白名单）、`scanner.test.ts`、`task-images.test.ts`、`todo-parser.test.ts` | — |

---

## client/ — 前端

界面是「左侧常驻侧边栏 + 右侧面包屑顶栏 + 页面工具条」的工作区外壳。
样式分两层：外壳/看板/卡片/列表**手写 CSS**（`theme.css` + `theme.ts` 的令牌），
弹窗/表单/日期选择仍用 AntD（`ConfigProvider` 吃同一套令牌，两层不跑色）。

| 文件 | 职责 | 关键符号 |
|------|------|---------|
| `src/main.tsx` | React 根挂载，包 `BrowserRouter`；**挂载前先 `applyPalette()`**，首帧就是正确主题 | — |
| `src/App.tsx` | 根组件：明暗状态 + AntD ConfigProvider（令牌来自 `theme.ts`）+ 路由，页面统一包进 `AppShell` | `App`；路由 `/`（项目概览）`/tasks`（全局任务）`/p/:name`（项目页） |
| `src/theme.ts` | **设计令牌单一事实源**：明暗两套调色板 + 状态/优先级/类型色，同时导出成 CSS 变量与 AntD token | `LIGHT`, `DARK`, `applyPalette`, `antdTokens`, `initialDark` |
| `src/theme.css` | 手写样式层（外壳/看板/卡片/列表/按钮），颜色一律 `var(--xxx)`，末尾少量 AntD 收边 | — |
| `src/BoardContext.tsx` | 跨页共享状态：项目列表 + 搜索词（侧边栏、概览页、全局任务页同源） | `BoardProvider`, `useBoard` |
| `src/ProjectsPage.tsx` | 项目概览页：卡片网格 + 排序 / 含归档过滤 | `ProjectsPage` |
| `src/ProjectPage.tsx` | 单项目页：工具条（任务/todo.md/资料 切换 + 置顶/归档/编辑 + 新建任务）+ 看板 / 只读 todo 清单 / 资料表，并持有新建弹窗 | `ProjectPage` |
| `src/api.ts` | 后端 API 客户端封装（fetch + token header），含 NewTask（**带 status，供列头「＋」直接建进该列**）/TaskPatch、任务图片上传/删除/取 URL | `createTask`, `updateTask`, `fetchAllTasks`, `uploadTaskImage`, `deleteTaskImage`, `taskImageUrl` … |
| `src/types.ts` | 前端类型，与后端对齐（含 `TaskType = feature\|bug\|optimize`、`TaskImage`） | `Task`, `TaskType`, `TaskImage`, `ProjectInfo` … |
| `src/util.ts` | 工具：相对时间 / 活跃度等级 / 活跃受管任务数 / **任务类型与状态的展示文案**（看板/弹窗/全局列表共用，单一事实源；颜色在 `theme.ts`） | `relativeTime`, `activityLevel`, `activeManaged`, `TASK_TYPE_META`, `TASK_TYPE_OPTIONS`, `BOARD_STATUSES`, `TASK_STATUS_META` |
| `src/components/AppShell.tsx` | 应用外壳：侧边栏（搜索 / 新建任务 / 概览·全局任务导航 / 项目列表 / 重扫·令牌·主题）+ 面包屑顶栏；全局新建与令牌弹窗归它持有 | `AppShell` |
| `src/components/StatusIcon.tsx` | 状态进度环（六状态画成 0→1 填充，已完成实心打勾）+ 优先级信号条（p0 感叹号方块），**形状即分级，不依赖颜色** | `StatusIcon`, `PriorityIcon` |
| `src/components/ProjectCard.tsx` | 项目卡片：简介/技术栈/**任务状态分布条**/git/待办计数/活跃度 + 置顶按钮 | `ProjectCard`, `StatusBar` |
| `src/components/TaskBoard.tsx` | 六列看板（列数/定义源自 util 的 `BOARD_STATUSES`）：**列带状态底色 + 列头图标·计数·「＋」**、拖拽流转、卡片**三段式（编号行/标题/描述摘要/页脚）**。「已完成」列不给「＋」——置 done 只能走人工验收 | `TaskBoard`, `TaskCard` |
| `src/components/TaskCreateModal.tsx` | 新建任务弹窗（标题/描述/类型/优先级/认领人/截止/**图片内存缓冲、创建后上传**）；**无项目上下文时弹窗内选项目**，`targetStatus` 决定落哪列（默认已收集）；「取消」不落库 | `TaskCreateModal` |
| `src/components/TaskEditModal.tsx` | 任务编辑弹窗（标题/描述/**类型**/优先级/状态/认领人/截止/归档/打回/**图片粘贴上传**/**子任务清单**），看板与全局视图共用 | `TaskEditModal` |
| `src/components/GlobalTaskView.tsx` | 跨项目全局任务列表（`/tasks`）+ 筛选（未完成/高优/今天/逾期/全部）+ 状态环/优先级/类型标记 | `GlobalTaskView` |

---

## cli/ + bin/ — 终端 CLI

| 文件 | 职责 |
|------|------|
| `bin/board` | Bash 包装器：解析软链定位项目根，传 `BOARD_CWD`（用户原始 cwd），用 server 的 tsx 跑 `cli/task.ts` |
| `cli/task.ts` | CLI 主体：调 HTTP API 列项目/任务、`add`（支持 `--bug`/`--optimize`/`--type`）、`here`（按 cwd 认项目）、`backup`、状态流转 |

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
```

- **项目信息**：实时只读扫描（磁盘/git/README/todo.md），带内存缓存 + scan_cache 首屏秒开。
- **受管任务**：持久化在 SQLite（`~/.project-board/board.db`）。
- **项目身份**：稳定键 = 归一化 git remote（无则 realpath），改名/移动不断链。
