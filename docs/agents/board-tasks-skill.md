---
name: board-tasks
description: 处理本地多项目看板（agent-taskboard）派给当前项目的任务。当用户说"看板上的任务"、"处理看板任务"、"做一下待开发的任务"、"看板待开发有什么"、"看看看板派给我的活"、"这个项目看板上有什么"时使用。用全局 `board` CLI 拉取当前/指定项目「待开发(todo)」列的受管任务，逐个执行、每任务一次 commit、做完置「待验收(review)」回写状态。
---

# 处理看板任务

> 这是 [agent-taskboard](https://github.com/52216108/agent-taskboard) 的 Claude Code skill。
> 把本文件放到 `~/.claude/skills/board-tasks/SKILL.md` 即可启用。
> 用 Codex 的话不需要它——看板仓库根目录的 `AGENTS.md` 已经承担了同样的角色。

看板是受管项目任务的**唯一事实源**（不是 `tasks/todo.md`）。本 skill 让你拉取并处理派给项目的看板任务。
**只接受用户明确发起，不主动认领。**

## 前置

- `task` CLI 已装（看板仓库的 `bin/board` 软链到 PATH）；它自动读 `~/.project-board/token`。
- 看板服务在 `http://127.0.0.1:7788`（或 `BOARD_URL` 指定的地址）。
- 任务状态六列：`collected` 已收集 → `backlog` 待规划 → `todo` 待开发 → `doing` 进行中 → `review` 待验收 → `done` 已完成；另有 `archived`。优先级 `p0`(最高)~`p3`。
  - **`collected` 已收集 = 需求收件箱**，收下了但不一定采纳，不归你领。
  - **`backlog` 待规划 = 已确定要做、等排期**，也不归你领。
  - **`todo` 待开发 = 已分诊、可直接动手的活**——只有这一列归你。

## 步骤

1. **认项目**：在当前项目目录跑 `board here`。
   - **退出码非零**（项目未纳管 / 服务没起）→ 告诉用户"本项目不在看板"，问是否改用别的流程，**不要硬来**。
   - 列出任务 → 继续。用户指定了别的项目就用 `board <项目名>`。
2. **选任务**：**只从 `todo`（待开发）列取活**。把它们（带 `#id`、优先级）展示给用户确认，优先级高的优先。
   - **不要碰 `collected` 和 `backlog`**。用户想让你做某条，请他先确认晋级，或在确认需求后由你 `board here todo <id>` 晋级再做。
3. **开工标记**：`board here doing <id> --as claude`（`--as` 必须置于 id 之后，署名写入 assignee，卡片显示 @claude）。
   - 任务行下方黄字 `⤺ 打回: ...` 是上轮验收的打回原因——领到带打回原因的任务，**优先按打回原因修复**，再看描述。
4. **执行**：按任务标题/描述实现，遵守该项目自身的规则文件（`CLAUDE.md` / `AGENTS.md`）。完成前必须验证。
5. **每任务一次 commit**：单个任务验证通过后，在目标项目仓库**单独提交这一个任务的改动**（便于逐条 review / 回滚 / 与待验收一一对应）。
   - 提交信息含任务号与标题，例如 `feat: 任务标题 (board #<id>)`；具体规范按项目走。
   - **只 commit，不 push**（除非用户明确要）。目标项目不是 git 仓库 → 跳过提交，提醒用户改动未版本化。
6. **置「待验收」**：commit 后 `board here review <id>`（**不是 done**）。验收是用户的人工动作——你做完置 `review`，把球交回去。
   - 过程中发现新子任务/遗留项 → `board here add "标题"`，默认落 `collected` 收件箱等用户分诊（绝不写 `tasks/todo.md`）。
7. **多任务**：逐条串行重复（doing → 实现 → commit → review）。非琐碎改动在置 review 前起独立 review 子代理。

## 约束

- **事实源是看板**：新任务一律 `board here add`，不要手写或更新 `tasks/todo.md`。
- **不确定就问**：任务描述含糊、要不要做拿不准、涉及破坏性操作（数据库 / 删除 / 对外接口）→ 先停下问用户。
- 项目有自己独立的任务系统时，用那个系统，不要用本 skill。

## 常用命令速查

```
board here                          # 看当前项目的受管任务（按六列标注）
board here add "标题"               # 登记新任务（默认进「已收集」收件箱）
board here todo <id>                # 晋级到待开发（确认要做之后）
board here doing <id> --as claude   # 开工（署名认领）
board here review <id>              # 做完 + commit 后置待验收（交回用户）
board here done <id>                # 一般由用户验收时点；agent 不直接置 done
board <项目名>                      # 看指定项目
board ls                            # 所有项目概览
```
