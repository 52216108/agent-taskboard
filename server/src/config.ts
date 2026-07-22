import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 把开头的 ~ 展开为用户主目录。 */
function expandTilde(p: string): string {
  const t = p.trim();
  if (t === '~') return homedir();
  if (t.startsWith('~/')) return join(homedir(), t.slice(2));
  return t;
}

/** 解析 BOARD_ROOTS（扫描根，其子目录视为项目）；为空时回退到 ~/projects。 */
function parseRoots(env: string | undefined): string[] {
  const parsed = env?.split(',').map(expandTilde).filter(Boolean);
  return parsed && parsed.length > 0 ? parsed : [join(homedir(), 'projects')];
}

/**
 * 解析 BOARD_PROJECTS（散落在扫描根之外、需单独纳入的项目路径，逗号分隔）。
 * 未设置时为空——扫描根之外的项目因人而异，不预设任何路径。
 */
function parseExtraProjects(env: string | undefined): string[] {
  return env ? env.split(',').map(expandTilde).filter(Boolean) : [];
}

/** 全局运行配置，可被环境变量覆盖（见 README）。 */
export const CONFIG = {
  /** 扫描根目录列表，默认 ~/projects；BOARD_ROOTS 逗号分隔可指定多个（空值回退默认）。 */
  roots: parseRoots(process.env.BOARD_ROOTS),
  /** 额外单独纳入的项目路径（扫描根之外），默认空；BOARD_PROJECTS 逗号分隔指定。 */
  extraProjects: parseExtraProjects(process.env.BOARD_PROJECTS),
  /** 后端监听端口。 */
  port: Number(process.env.BOARD_PORT ?? 7788),
  /** 绑定地址。P1 只在本机用，默认 loopback；P3 远程时再放开。 */
  host: process.env.BOARD_HOST ?? '127.0.0.1',
  /** 扫描结果内存缓存有效期（毫秒）。 */
  scanTtlMs: Number(process.env.BOARD_SCAN_TTL ?? 60_000),
  /** 单仓库 git 操作超时（毫秒），防止坏/慢仓库拖垮整体扫描。 */
  gitTimeoutMs: Number(process.env.BOARD_GIT_TIMEOUT ?? 5_000),
  /** 扫描并发上限，避免一次性 spawn 几十个 git 进程。 */
  concurrency: Number(process.env.BOARD_CONCURRENCY ?? 6),
  /** SQLite 数据库路径（受管任务/项目覆盖/扫描缓存），默认 ~/.project-board/board.db。 */
  dbPath: process.env.BOARD_DB ?? join(homedir(), '.project-board', 'board.db'),
  /** Bearer token：设置后所有写接口需带 `Authorization: Bearer <token>`；未设则本机放行（远程时必设）。 */
  token: process.env.BOARD_TOKEN || null,
  /** 额外允许的 Host 头（逗号分隔），供反代/隧道场景放行，如 `mymac.tailnet.ts.net`。 */
  allowedHosts: process.env.BOARD_ALLOWED_HOSTS,

  /** 任务附图存储根目录，默认 ~/.project-board/task-images（与 CLI 共用，override 时两边须一致）。 */
  taskImagesDir: process.env.BOARD_TASK_IMAGES_DIR ?? join(homedir(), '.project-board', 'task-images'),
};

/**
 * 判断绑定地址是否只有本机可达。
 * 通配地址（0.0.0.0 / ::）不算 loopback——它包含所有网络接口。
 * 主机名一律按"网络可达"处理：`127.0.0.1.evil.com` 这类前缀伪装能被 DNS 解析到任意地址，
 * 所以只认真正的 IP 字面量（用 node:net 判定，不靠正则前缀匹配）。
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost') return true;
  const version = isIP(h);
  if (version === 4) return h.startsWith('127.');
  if (version === 6) return h === '::1' || /^::ffff:127\./.test(h);
  return false;
}

/**
 * 从 Host 头取出 hostname（剥掉端口）。IPv6 在 Host 头里必须写成 `[::1]:7788`。
 */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/**
 * 构造允许的 Host 白名单（只比 hostname，不比端口），用于反 DNS rebinding。
 *
 * 攻击手法：诱导用户访问恶意页面，把该域名 rebind 到 127.0.0.1。此后浏览器认为请求同源，
 * CORS 与 Sec-Fetch-Site 全部失效，但 **Host 头仍是攻击者的域名**——校验它即可挡住。
 * 端口不参与判定：攻击者 rebind 的是域名，端口由被访问的 URL 决定，拦端口既无收益
 * 又会误伤反代（经 443 转发时 Host 不带端口）。
 *
 * 远程访问（如 `tailscale serve` 带 `<机器名>.ts.net`）用 BOARD_ALLOWED_HOSTS 放行。
 */
export function buildAllowedHosts(extra: string | undefined): Set<string> {
  const hosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  for (const h of extra?.split(',').map((s) => hostnameOf(s)).filter(Boolean) ?? []) {
    hosts.add(h);
  }
  return hosts;
}

/**
 * 绑定到网络可达地址时强制要求 BOARD_TOKEN，返回错误信息（null = 配置安全）。
 *
 * 看板存的任务会成为 coding agent 据以行动的指令，无鉴权地暴露到网络上
 * 等同于把「指挥别人 agent」的权限开放给同网段——这里 fail-fast 而不是只打警告。
 */
export function checkSecureBinding(cfg: Pick<typeof CONFIG, 'host' | 'token'> = CONFIG): string | null {
  if (cfg.token || isLoopbackHost(cfg.host)) return null;
  return [
    `拒绝启动：BOARD_HOST=${cfg.host} 可从网络访问，但未设置 BOARD_TOKEN。`,
    '看板里的任务会被 coding agent 当指令执行，无鉴权暴露等于把 agent 的操作权交出去。',
    '',
    '二选一：',
    '  1) 设置访问令牌：BOARD_TOKEN=$(openssl rand -hex 32)',
    '  2) 只绑本机（默认）：不设 BOARD_HOST，改用 Tailscale/SSH 隧道做远程访问',
  ].join('\n');
}
