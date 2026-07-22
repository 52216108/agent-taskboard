# 文件索引 DIRECTORY.md

> agent-taskboard（本地多项目看板）— 文件职责速查
>
> 单体应用：后端扫描+API（Fastify/tsx，无构建步骤）、前端看板（React18+AntD5+Vite）、终端 CLI。
> 最后更新：2026-07-22

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

| 文件 | 职责 | 关键符号 |
|------|------|---------|
| `src/main.tsx` | React 根挂载，包 `BrowserRouter` | — |
| `src/App.tsx` | 根组件：AntD 明暗主题 + 路由 + 看板首页（搜索/排序/归档过滤/项目↔任务视图切换） | `Board`, `App`；路由 `/` `/p/:name` |
| `src/ProjectPage.tsx` | 单项目详情页：元数据/内联改名简介/import todos + Tabs 整合看板与资料 | `ProjectPage` |
| `src/api.ts` | 后端 API 客户端封装（fetch + token header），含 NewTask/TaskPatch（带 taskType）、任务图片上传/删除/取 URL | `createTask`, `updateTask`, `fetchAllTasks`, `uploadTaskImage`, `deleteTaskImage`, `taskImageUrl` … |
| `src/types.ts` | 前端类型，与后端对齐（含 `TaskType = feature\|bug\|optimize`、`TaskImage`） | `Task`, `TaskType`, `TaskImage`, `ProjectInfo` … |
| `src/util.ts` | 工具：相对时间 / 活跃度等级 / **任务类型展示元数据** + **任务状态元数据**（列标题/标签+颜色，看板/弹窗/全局列表共用，单一事实源） | `relativeTime`, `activityLevel`, `TASK_TYPE_META`, `TASK_TYPE_OPTIONS`, `BOARD_STATUSES`, `TASK_STATUS_META` |
| `src/components/ProjectCard.tsx` | 项目卡片：活跃度/git/todo 计数/优先级/逾期标签 + 置顶按钮 | `ProjectCard` |
| `src/components/TaskBoard.tsx` | 六列看板（已收集/待规划/待开发/进行中/待验收/已完成，列数/定义源自 util 的 `BOARD_STATUSES`，grid 列数按其长度派生）+ 拖拽 + 新建任务表单（**类型/优先级选择器**，默认进已收集）+ 卡片**类型标签** | `TaskBoard` |
| `src/components/TaskEditModal.tsx` | 任务编辑弹窗（标题/描述/**类型**/优先级/状态/截止/归档/**图片粘贴上传**），看板与全局视图共用 | `TaskEditModal` |
| `src/components/GlobalTaskView.tsx` | 跨项目全局任务列表 + 筛选（未完成/高优/今天/逾期/全部）+ **类型标签** | `GlobalTaskView` |

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
| `agents/board-tasks-skill.md` | Claude Code skill（装到 `~/.claude/skills/board-tasks/SKILL.md`）；Codex 侧对应根目录 `AGENTS.md` |
| `screenshots/` | README 用产品截图（演示数据，非真实项目） |

---

## 根目录文档

| 文件 | 职责 |
|------|------|
| `README.md` / `README.zh-CN.md` | 项目说明（英文主 / 中文），含安全说明与 agent 接入 |
| `AGENTS.md` | 在本仓库工作的 coding agent 规则（Codex 自动读取） |
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
