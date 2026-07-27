# Claude Code 接入提示词

> 这是 [agent-taskboard](https://github.com/52216108/agent-taskboard) 的 Claude Code 接入文档。
> Codex 用户见 [codex-setup-prompt.md](codex-setup-prompt.md)。

Claude Code 的接入方式是把 [board-tasks-skill.md](board-tasks-skill.md) 装成 skill
（放到 `~/.claude/skills/board-tasks/SKILL.md`）。你可以手动复制,也可以把下面这段
整体粘给 Claude Code,让它自己完成验证和安装:

````text
请帮我把本机的 agent-taskboard 看板（https://github.com/52216108/agent-taskboard）接入你的工作流，
让你以后在我的任何项目里都能从看板领活。

【第一步：验证环境】任何一项不通过就停下来告诉我缺什么，不要继续：
1. 运行 `board ls`，退出码应为 0（说明 board CLI 已在 PATH、看板服务在 http://127.0.0.1:7788 正常运行）
2. 进入我的任意一个项目目录运行 `board here`，能认出该项目并列出任务

【第二步：安装 skill】把看板的 board-tasks skill 装到 ~/.claude/skills/board-tasks/SKILL.md：
1. 定位看板仓库：`board` 命令通常是软链，用 `readlink -f "$(command -v board)"` 解析出真实路径，
   它指向仓库里的 bin/board——它上面两级目录就是仓库根
2. 把仓库根下的 docs/agents/board-tasks-skill.md 复制为 ~/.claude/skills/board-tasks/SKILL.md
   （目录不存在就创建；文件已存在就覆盖为这份最新版）
3. 如果第 1 步定位不到本地仓库（比如 board 不是软链），改从 GitHub 获取同一文件：
   https://raw.githubusercontent.com/52216108/agent-taskboard/main/docs/agents/board-tasks-skill.md

【第三步：自检】
1. 确认 ~/.claude/skills/board-tasks/SKILL.md 存在，且文件开头 frontmatter 里的 name 是 board-tasks
2. 读一遍 skill 内容，用一句话向我复述工作流：你只领哪一列的活、开工和交活各跑什么命令、
   为什么做完不置 done
3. 如果 ~/.claude/skills/ 这个目录是本次才第一次创建的，提醒我需要新开一个 Claude Code 会话
   才能加载到它；目录本来就存在的话，skill 在当前会话就会生效
````

装好后,在任何项目里对 Claude Code 说一句「处理看板上待开发的任务」即可——
它会自己跑 `board here` 看活、领活、干完置「待验收」交回给你。
