# agent-taskboard 协作规则

给在本仓库工作的 coding agent（Codex / Claude Code 等）的约定。

## 运行与数据

- 看板地址：`http://127.0.0.1:7788`（`BOARD_PORT` 可改）。
- 服务未启动时：`cd server && npm run start`。前端产物由后端托管，不需要单独启动 Vite。
- 数据库默认是 `~/.project-board/board.db`（`BOARD_DB` 可改）。
- **创建或更新任务必须走本地 HTTP API 或 `bin/board` CLI，禁止直接写 SQLite**——绕过业务逻辑会跳过状态校验、打回原因清空、todo.md 指纹去重等约束。

## 任务流转

状态六列：`collected(已收集) → backlog(待规划) → todo(待开发) → doing(进行中) → review(待验收) → done(已完成)`，另有 `archived`。

- agent **只领「待开发」(`todo`) 的活**；「已收集」是未分诊的收件箱，「待规划」是已选中但未排期，两者都不要碰。
- 开工：`bin/board here doing <id> --as <你的名字>`（`--as` 必须写在 id 之后；缺省读 `BOARD_ACTOR`）。
- 每个任务一次 commit，提交信息带 `#<id>`。
- 做完置「待验收」(`review`) 交回用户验收，**不要直接置「已完成」**。
- 被打回的任务会带 `⤺ 打回:` 原因回灌到 `bin/board here` 输出，重做前先消化原因。

## 本仓库约定

- 注释、提交信息、文档一律中文。
- 改了接口/表结构/新增文件，同步更新 `DIRECTORY.md` / `SCHEMA.md` / `API.md` 三层索引。
- 数据库表和列必须带注释（写法见 `server/src/schema.sql`）。
