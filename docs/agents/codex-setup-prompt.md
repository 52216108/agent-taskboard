# Codex 接入提示词

> 这是 [agent-taskboard](https://github.com/52216108/agent-taskboard) 的 Codex 接入文档。
> Claude Code 用户见 [claude-setup-prompt.md](claude-setup-prompt.md)。

Codex 每次会话只自动加载两处规则文件：全局 `~/.codex/AGENTS.md` 和**当前工作目录**所在仓库的
`AGENTS.md`。看板仓库根的那份 `AGENTS.md` 只在看板仓库本身里干活时生效——你在自己的项目里
开 Codex，它根本读不到，也就不知道看板的存在。

所以接入方式是：**把看板协作约定写进全局 `~/.codex/AGENTS.md`**，一次生效所有项目。
把下面这段整体复制粘给 Codex，它会自己完成验证和写入：

````text
请帮我把本机的 agent-taskboard 看板（https://github.com/52216108/agent-taskboard）接入你的工作流，
让你以后在我的任何项目里都能从看板领活。

【第一步：验证环境】任何一项不通过就停下来告诉我缺什么，不要继续：
1. 运行 `board ls`，退出码应为 0（说明 board CLI 已在 PATH、看板服务在 http://127.0.0.1:7788 正常运行）
2. 进入我的任意一个项目目录运行 `board here`，能认出该项目并列出任务

【第二步：写入全局规则】把下面「====」之间的内容写入 `~/.codex/AGENTS.md`：
- 文件不存在就创建
- 文件里已有「agent-taskboard 看板协作」这一节的话，整节替换为下面的最新版，不要重复追加
- 文件里的其他内容一律保持原样

====
## agent-taskboard 看板协作

本机运行着 agent-taskboard 任务看板（服务 http://127.0.0.1:7788，CLI 命令为 `board`），
是各项目任务的唯一事实源。用户说「处理看板任务」「做看板上待开发的活」时按以下约定执行；
**不要主动认领任务，一切由用户发起**。

- 状态六列：collected（已收集）→ backlog（待规划）→ todo（待开发）→ doing（进行中）→
  review（待验收）→ done（已完成）。
- **只领 todo（待开发）列的活**。collected 是未分诊的收件箱，backlog 是已选中未排期，都不要碰；
  用户点名要做还没晋级的任务，先 `board here todo <id>` 晋级再动手。
- 在项目目录里跑 `board here` 查看该项目的任务；退出码非零 = 项目未纳管或服务未启动，
  如实告知用户，不要硬来。
- 开工：`board here doing <id> --as codex`（`--as` 必须写在 id 之后）。
- 任务行下方黄字 `⤺ 打回: ...` 是上一轮验收的打回原因，领到这种任务优先按打回原因修复，再看描述。
- 一个任务一次 commit，提交信息带 `#<id>`（如 `fix: 修复空输入崩溃 (board #12)`）；
  只 commit 不 push，除非用户明确要求。
- 做完置待验收：`board here review <id>`，**不要直接置 done**——验收是用户的人工动作。
- 干活途中发现的新问题/遗留项：`board here add "标题"` 登记（默认落 collected 收件箱等用户分诊），
  不要写 tasks/todo.md。
- 创建/更新任务只走 `board` CLI 或它的 HTTP API，禁止直接写 ~/.project-board/board.db。
- 项目有自己独立的任务系统时，用那个系统，不要往本看板记。

命令速查：
```
board ls                            所有项目概览
board here                          当前项目的任务
board <项目名>                      查看指定项目
board here add "标题"               登记新任务（落收件箱）
board here todo <id>                晋级到待开发
board here doing <id> --as codex    领活并署名
board here review <id>              做完交回验收
board here done <id>                验收通过——由用户点，你不要用
```
====

【第三步：自检】
1. 重新读取 ~/.codex/AGENTS.md，确认这一节已写入且没有破坏文件里原有的内容
2. 用一句话向我复述工作流：你只领哪一列的活、开工和交活各跑什么命令、为什么做完不置 done
````

写入之后，在任何项目里对 Codex 说一句「处理看板上待开发的任务」即可——它会自己跑
`board here` 看活、领活、干完置「待验收」交回给你。
