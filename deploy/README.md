# 部署与远程访问

看板是**本地优先**的：扫描程序必须跑在 Mac 本机（要读本地 git 状态/目录/todo.md）。
远程访问 = 把本机服务安全地暴露出去，用 **Tailscale 私有内网**，不暴露公网。

## 一键安装（开机自启）

```bash
bash deploy/setup.sh
```

它会：安装依赖 + 构建前端 → 生成写操作令牌（存 `~/.project-board/token`）→ 渲染 launchd plist
到 `~/Library/LaunchAgents/com.projectboard.plist` 并加载 → 打印访问令牌与 Tailscale 步骤。

服务以 launchd 常驻：开机自启、崩溃自拉起，日志在 `~/.project-board/logs/board.{out,err}.log`。

> 卸载：`launchctl unload ~/Library/LaunchAgents/com.projectboard.plist && rm ~/Library/LaunchAgents/com.projectboard.plist`

## 远程访问（Tailscale，需你本人操作）

服务只绑 `127.0.0.1`；不要把端口绑到 `0.0.0.0` 暴露公网。用 Tailscale 做隧道：

1. **安装登录** Tailscale（<https://tailscale.com/download>），Mac 与手机/外出电脑用**同一账号**。
2. **暴露看板到 tailnet**（服务仍只在 loopback，Tailscale 自带 HTTPS）：
   ```bash
   tailscale serve --bg 7788
   ```
3. **把 MagicDNS 域名加进 Host 白名单**——否则所有 `/api/` 请求会被反 DNS rebinding 防线拦成
   `403 bad host`（服务只认 `127.0.0.1`/`localhost`，隧道进来的 Host 是你的 `.ts.net` 域名）：
   ```bash
   BOARD_ALLOWED_HOSTS=<你的Mac的MagicDNS名>.ts.net bash deploy/setup.sh
   ```
4. 在已登 Tailscale 的设备浏览器打开 `https://<你的Mac的MagicDNS名>.ts.net/`，
   在右上角「访问令牌」填入 `~/.project-board/token` 里的值。
5. **防睡眠**（电源常接时，否则 Mac 睡了远程不可达）：
   ```bash
   sudo pmset -c sleep 0      # 永久；或临时前台： caffeinate -s
   ```

## 鉴权说明

- 设置了 `BOARD_TOKEN`（setup.sh 自动设）后，**所有 `/api/` 请求都需要令牌**，读写皆然。
  写操作只认 `Authorization: Bearer <token>`（header-only，保 CSRF 防护）；读操作额外接受
  `?token=` 查询参数（`<img>` 无法设自定义头）。
- **不设 token 也有一层防线**：所有 `/api/` 请求都会校验 `Host` 白名单（反 DNS rebinding）并拒绝
  浏览器发起的跨站请求（反 CSRF）。经反代/隧道访问时，把对外域名加进 `BOARD_ALLOWED_HOSTS`，
  否则会被 `403 bad host` 拦掉。
- 本机本地使用（localhost）通常无需在前端填 token——除非你也给本机设了 `BOARD_TOKEN`。
- 能力边界：远程访问仅在 **Mac 在线**时可用。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `BOARD_HOST` | `127.0.0.1` | 绑定地址；保持 loopback，用 `tailscale serve` 暴露 |
| `BOARD_PORT` | `7788` | 端口 |
| `BOARD_TOKEN` | 无 | 访问令牌；setup.sh 自动生成 |
| `BOARD_ALLOWED_HOSTS` | 无 | 额外允许的 Host（逗号分隔）；经反代/隧道访问时**必须**填对外域名 |
| `BOARD_PROJECTS` | 无 | 扫描根之外额外纳入的项目路径（逗号分隔）；`BOARD_PROJECTS=~/foo bash deploy/setup.sh` 写进 plist |
| `BOARD_ROOTS` | `~/projects` | 扫描根目录 |
| `BOARD_DB` | `~/.project-board/board.db` | SQLite 路径 |
