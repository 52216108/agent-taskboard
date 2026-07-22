#!/usr/bin/env bash
# 安装看板为 macOS 开机自启服务（launchd），并打印 Tailscale 远程访问步骤。
# 用法：bash deploy/setup.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SERVER_DIR="$ROOT/server"
CLIENT_DIR="$ROOT/client"
DATA_DIR="$HOME/.project-board"
LOG_DIR="$DATA_DIR/logs"
NODE="$(command -v node)"
NODE_DIR="$(dirname "$NODE")"
PLIST_SRC="$HERE/com.projectboard.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.projectboard.plist"

# 读回已安装 plist 里的某个环境变量值（不存在则空）。
# 重跑 setup.sh 时用它兜底：不给环境变量就沿用旧值，避免把上次配好的项目/域名静默清空。
plist_env() {
  [ -f "$PLIST_DST" ] || return 0
  /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$1" "$PLIST_DST" 2>/dev/null || true
}

# 扫描根之外额外纳入的项目路径（逗号分隔），个人配置不进代码默认值
EXTRA_PROJECTS="${BOARD_PROJECTS:-$(plist_env BOARD_PROJECTS)}"
# 经反代/隧道访问时必须放行对外域名，否则被反 DNS rebinding 防线拦成 403
ALLOWED_HOSTS="${BOARD_ALLOWED_HOSTS:-$(plist_env BOARD_ALLOWED_HOSTS)}"
LAUNCH_PATH="$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin"
BACKUP_SRC="$HERE/com.projectboard.backup.plist"
BACKUP_DST="$HOME/Library/LaunchAgents/com.projectboard.backup.plist"

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

echo "▶ 安装依赖 + 构建前端…"
( cd "$SERVER_DIR" && npm install --silent )
( cd "$CLIENT_DIR" && npm install --silent && npm run build )

# 生成/复用写操作令牌
TOKEN_FILE="$DATA_DIR/token"
if [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(cat "$TOKEN_FILE")"
else
  TOKEN="$(openssl rand -hex 24)"
  printf '%s' "$TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi

# 渲染 plist
sed -e "s|@@NODE@@|$NODE|g" \
    -e "s|@@SERVER_DIR@@|$SERVER_DIR|g" \
    -e "s|@@LOG_DIR@@|$LOG_DIR|g" \
    -e "s|@@TOKEN@@|$TOKEN|g" \
    -e "s|@@EXTRA_PROJECTS@@|$EXTRA_PROJECTS|g" \
    -e "s|@@ALLOWED_HOSTS@@|$ALLOWED_HOSTS|g" \
    -e "s|@@PATH@@|$LAUNCH_PATH|g" \
    "$PLIST_SRC" > "$PLIST_DST"
chmod 600 "$PLIST_DST"   # plist 含明文 token，限本人可读
plutil -lint "$PLIST_DST"

# 渲染每日备份 plist（无 token：backup 直连 DB 文件，不经 HTTP）
sed -e "s|@@NODE@@|$NODE|g" \
    -e "s|@@ROOT@@|$ROOT|g" \
    -e "s|@@SERVER_DIR@@|$SERVER_DIR|g" \
    -e "s|@@LOG_DIR@@|$LOG_DIR|g" \
    -e "s|@@PATH@@|$LAUNCH_PATH|g" \
    "$BACKUP_SRC" > "$BACKUP_DST"
plutil -lint "$BACKUP_DST"

# 重新加载服务 + 备份定时任务
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"
launchctl unload "$BACKUP_DST" 2>/dev/null || true
launchctl load "$BACKUP_DST"
sleep 1

echo
echo "✓ 看板已作为开机自启服务运行：http://127.0.0.1:7788"
echo "  日志：${LOG_DIR}/board.{out,err}.log"
if [ -n "$EXTRA_PROJECTS" ]; then
  echo "  额外纳入项目：${EXTRA_PROJECTS}"
else
  echo "  额外纳入项目：（无）要纳入扫描根之外的项目，重跑："
  echo "      BOARD_PROJECTS=~/some-project bash deploy/setup.sh"
fi
echo "  访问令牌（已存 ${TOKEN_FILE}，远程写操作需要）："
echo "      ${TOKEN}"
echo
echo "▶ 远程访问（Tailscale，需你本人执行）："
echo "  1. 安装并登录 Tailscale： https://tailscale.com/download"
echo "       Mac 与手机/外出电脑登录同一账号。"
echo "  2. 把看板暴露到你的 tailnet（服务仍只绑 127.0.0.1，Tailscale 做加密隧道）："
echo "       tailscale serve --bg 7788"
echo "  3. 放行该域名（否则 API 被反 DNS rebinding 防线拦成 403 bad host）："
echo "       BOARD_ALLOWED_HOSTS=<你的Mac的MagicDNS名>.ts.net bash deploy/setup.sh"
echo "  4. 在已登 Tailscale 的设备浏览器打开： https://<你的Mac的MagicDNS名>.ts.net/"
echo "       右上角「访问令牌」填入上面的 token。"
echo "  5. 防 Mac 睡眠导致不可达（电源常接时）： sudo pmset -c sleep 0"
echo
echo "  卸载服务： launchctl unload \"$PLIST_DST\" && rm \"$PLIST_DST\""
