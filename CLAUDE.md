# CLAUDE.md

给 Claude Code 在本仓库工作的补充约定。

任务流转、状态机、数据库注释规范见 [AGENTS.md](AGENTS.md)——那份是所有 coding agent 共用的，
本文件只写 Claude Code 特有的部分，不重复。

## 这是一个公开仓库

https://github.com/52216108/agent-taskboard （MIT）。

你写的每一行代码、注释、commit message 都对外可见。**不要写入本机绝对路径、私有项目名、令牌或任何个人信息**——
仓库里的示例一律用 `acme` / `acme-app` 这类中性名。

## 改动走 PR，不直接推 main

1. 从 main 开分支：`git checkout -b feat/xxx` 或 `fix/xxx`
2. 一个看板任务一个 commit，信息里带 `#<任务 id>`
3. 推分支后 `gh pr create`，PR 描述写清四段：背景 / 改动 / 验证 / 未包含
4. **等 CI 绿再合并**（Node 22 + 24 矩阵），用 squash merge，合并后删分支
5. 回看板 `board here review <id>` 交回人工验收，**不要自己置 done**

## 提交前必须全绿

```bash
cd server && npm run typecheck && npm test
cd client && npm run build
```

CI 跑的就是这三条。本地不过就别推，别让 PR 挂着红叉。

## 改了这些，要同步更新

| 改了什么 | 要更新 |
|---|---|
| 接口 | `API.md` |
| 表结构 | `SCHEMA.md` + `db.ts` 里的迁移（`PRAGMA user_version` 守护，**老库必须能升上来**） |
| 新增/删除文件 | `DIRECTORY.md` |
| 鉴权 hook / Host 白名单 / 绑定检查 | `SECURITY.md` 的威胁模型 |
| 面向用户的功能或配置 | `README.md` **和** `README.zh-CN.md`（双语，别只改一边） |

## 两条红线

- **不要引入依赖某个特定 coding agent 的代码**。看板不启动 agent、不调模型 API，agent 是主动来领活的一方——
  这是它「谁都能用」的根基，加一行 spawn 就毁了。
- **不要改 `~/.project-board` 这个数据目录名**。改了会让所有现有用户的数据库、令牌、任务附图全部失踪。
  它跟项目名不一致是历史原因，不是 bug。

## 一个已知的坑

改 git remote（仓库改名、迁移托管平台）时，**必须同步迁移数据库里的 `project_key`**。
项目身份键 = 归一化后的 git remote，不迁会导致 project 表分裂成两行，历史任务从看板上「消失」。
这个坑真实发生过，37 条任务凭空不见。
