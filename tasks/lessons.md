# 教训

会话中被纠正过的点，写在这里防止再犯。保持精简。

## README 截图必须用演示数据，不能拍真实看板

`docs/screenshots/` 是**公开仓库**里的文件。拿本机真实看板截图会把私有项目名
（客户项目、内部系统、个人仓库）直接推到 GitHub 上。`DIRECTORY.md` 里已经写明
「演示数据，非真实项目」，照做。

正确做法：起一个独立实例，用临时 root + 临时 DB，不碰 `~/.project-board`：

```bash
BOARD_PORT=7799 \
BOARD_ROOTS=/tmp/demo-root \
BOARD_DB=/tmp/demo-board/board.db \
BOARD_TASK_IMAGES_DIR=/tmp/demo-board/task-images \
npm start --prefix server
```

演示项目一律叫 `acme-*`。灌演示任务时「已完成」不能直接建——先建成
`review` 再调 `POST /api/tasks/:id/accept`，跟真实流程一致。

顺带：`.playwright-mcp/` 的截图输出目录被限制在仓库内，拍完记得别把临时图
`git add` 进来（之前误加过 `overview-light.png`）。
