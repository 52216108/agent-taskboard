import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { App as AntApp, Input, Modal, Tooltip, Typography } from 'antd';
import {
  AppstoreFilled,
  AppstoreOutlined,
  KeyOutlined,
  MenuOutlined,
  MoonOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SunOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useBoard } from '../BoardContext';
import { activeManaged, activityLevel, relativeTime } from '../util';
import TaskCreateModal from './TaskCreateModal';

/**
 * 当前路由的项目名。
 * AppShell 渲染在 <Routes> 外面（它包着路由），拿不到 useParams，只能自己解 /p/:name。
 */
function useRouteProject(): string | undefined {
  const { pathname } = useLocation();
  const m = /^\/p\/([^/]+)/.exec(pathname);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    // 畸形转义（手输 /p/foo%bar）会让 decodeURIComponent 抛 URIError。
    // 这里在 AppShell 顶层每次渲染都跑，外面没有 error boundary——抛出去就是整站白屏。
    return m[1];
  }
}

/** 面包屑：从路由推导，不需要各页面自己上报。 */
function Crumbs() {
  const { pathname } = useLocation();
  const name = useRouteProject();
  const { projects } = useBoard();

  let current = '项目概览';
  if (pathname === '/tasks') current = '全局任务';
  else if (name) current = projects.find((p) => p.name === name)?.displayName ?? name;

  return (
    <div className="crumbs">
      <Link to="/">看板</Link>
      <span className="crumbs-sep">›</span>
      <span className="crumbs-cur">{current}</span>
    </div>
  );
}

function NavItem({
  to,
  end,
  icon,
  label,
  badge,
  badgeTitle,
  onNavigate,
}: {
  to: string;
  end?: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  badgeTitle?: string;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) => `sb-item${isActive ? ' is-active' : ''}`}
    >
      <span className="sb-item-icon">{icon}</span>
      <span className="sb-item-label">{label}</span>
      {badge != null && badge > 0 && (
        <span className="sb-item-badge" title={badgeTitle}>
          {badge}
        </span>
      )}
    </NavLink>
  );
}

/**
 * 应用外壳：左侧常驻导航 + 右侧「面包屑顶栏 + 页面内容」。
 * 所有路由页都渲染在这层里面，页面自己只负责工具条和主体。
 */
export default function AppShell({
  dark,
  onToggleTheme,
  children,
}: {
  dark: boolean;
  onToggleTheme: () => void;
  children: React.ReactNode;
}) {
  const { projects, scannedAt, scanning, rescan, reload, search, setSearch } = useBoard();
  const { message } = AntApp.useApp();
  const { pathname } = useLocation();
  const routeProject = useRouteProject();
  const [createOpen, setCreateOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenVal, setTokenVal] = useState(localStorage.getItem('board-token') ?? '');
  const [navOpen, setNavOpen] = useState(false); // 仅窄屏用：侧边栏变抽屉后的开合

  const saveToken = () => {
    const v = tokenVal.trim();
    if (v) localStorage.setItem('board-token', v);
    else localStorage.removeItem('board-token');
    setTokenOpen(false);
    message.success(v ? '已保存访问令牌' : '已清除访问令牌');
  };

  // 在全局任务页，搜索词是在搜任务标题，拿它过滤项目导航只会把侧边栏清空成「无匹配项目」，
  // 看起来像项目都没了。那一页就不过滤导航。
  const q = pathname === '/tasks' ? '' : search.trim().toLowerCase();
  // 侧边栏项目列表：归档的不进导航（要看去「项目概览」开「含归档」），置顶恒前，其余按最近活跃
  const navProjects = projects
    .filter((p) => !p.archived)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q))
    .sort((a, b) =>
      a.pinned === b.pinned
        ? (b.lastActive ?? '').localeCompare(a.lastActive ?? '')
        : a.pinned
          ? -1
          : 1,
    );

  const live = projects.filter((p) => !p.archived);
  // 「全局任务」徽标跟该页默认筛选（未完成）同口径，否则侧边栏写 12 点进去 34 条，看着像数错了
  const openTasks = live.reduce(
    (n, p) => n + p.managed.collected + p.managed.backlog + activeManaged(p.managed),
    0,
  );

  return (
    <div className="shell">
      {/* 窄屏下侧边栏变抽屉，遮罩点掉即关；宽屏 CSS 里不渲染它的效果 */}
      {navOpen && <div className="sb-scrim" onClick={() => setNavOpen(false)} />}
      <aside className={`sb${navOpen ? ' is-open' : ''}`}>
        <div className="sb-head">
          <div className="sb-brand">
            <span className="sb-mark">
              <AppstoreFilled />
            </span>
            <span>Agent任务看板</span>
          </div>
          <Tooltip title={dark ? '切换浅色' : '切换深色'} placement="right">
            <button className="btn btn-ghost btn-icon" onClick={onToggleTheme} aria-label="切换主题">
              {dark ? <SunOutlined /> : <MoonOutlined />}
            </button>
          </Tooltip>
        </div>

        <div className="sb-body">
          <label className="sb-search">
            <SearchOutlined />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索项目 / 任务"
              aria-label="搜索"
            />
          </label>

          <button
            className="btn btn-solid btn-block"
            onClick={() => {
              setNavOpen(false);
              setCreateOpen(true);
            }}
          >
            <PlusOutlined />
            新建任务
          </button>

          <div style={{ height: 10 }} />

          <NavItem
            to="/"
            end
            icon={<AppstoreOutlined />}
            label="项目概览"
            badge={live.length}
            badgeTitle="未归档项目数"
            onNavigate={() => setNavOpen(false)}
          />
          <NavItem
            to="/tasks"
            icon={<UnorderedListOutlined />}
            label="全局任务"
            badge={openTasks}
            badgeTitle="未完成任务数（与该页默认筛选一致）"
            onNavigate={() => setNavOpen(false)}
          />

          <div className="sb-group">项目</div>
          {navProjects.length === 0 ? (
            <div className="sb-item is-dim" style={{ cursor: 'default' }}>
              <span className="sb-item-label">{q ? '无匹配项目' : '未发现项目'}</span>
            </div>
          ) : (
            navProjects.map((p) => {
              const active = activeManaged(p.managed);
              return (
                <NavLink
                  key={p.key}
                  to={`/p/${encodeURIComponent(p.name)}`}
                  className={`sb-item${p.name === routeProject ? ' is-active' : ''}${p.missing ? ' is-dim' : ''}`}
                  title={p.missing ? '目录已消失（任务仍保留）' : p.path}
                  onClick={() => setNavOpen(false)}
                >
                  <span className="sb-item-icon">
                    <span className="dot" data-level={activityLevel(p.lastActive)} aria-hidden />
                  </span>
                  <span className="sb-item-label">{p.displayName}</span>
                  {active > 0 && (
                    <span className="sb-item-badge" title="活跃任务（待开发+进行中+待验收）">
                      {active}
                    </span>
                  )}
                </NavLink>
              );
            })
          )}
        </div>

        <div className="sb-foot">
          <Tooltip title="重新扫描磁盘">
            <button
              className="btn btn-ghost btn-icon"
              onClick={rescan}
              disabled={scanning}
              aria-label="重新扫描"
            >
              <ReloadOutlined spin={scanning} />
            </button>
          </Tooltip>
          <Tooltip title="访问令牌（远程写操作需要）">
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setTokenOpen(true)}
              aria-label="访问令牌"
            >
              <KeyOutlined />
            </button>
          </Tooltip>
          <span className="sb-scan">
            {scannedAt ? `扫描于 ${relativeTime(new Date(scannedAt).toISOString())}` : '未扫描'}
          </span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="btn btn-ghost btn-icon sb-toggle"
            onClick={() => setNavOpen(true)}
            aria-label="打开导航"
            aria-expanded={navOpen}
          >
            <MenuOutlined />
          </button>
          <Crumbs />
        </header>
        <div className="page">{children}</div>
      </main>

      {/* 侧边栏的「新建任务」不带项目上下文，弹窗内自己选项目；在项目页则预选当前项目 */}
      <TaskCreateModal
        projectName={routeProject}
        projects={projects}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
      />

      <Modal
        title="访问令牌"
        open={tokenOpen}
        onOk={saveToken}
        onCancel={() => setTokenOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          远程访问（Tailscale）且服务端设置了 <code>BOARD_TOKEN</code> 时，写操作（建任务/置顶/改状态等）需要此令牌。
          本机本地使用通常无需设置。令牌仅存于本浏览器 localStorage。
        </Typography.Paragraph>
        <Input.Password
          placeholder="粘贴 BOARD_TOKEN"
          value={tokenVal}
          onChange={(e) => setTokenVal(e.target.value)}
          onPressEnter={saveToken}
        />
      </Modal>
    </div>
  );
}
