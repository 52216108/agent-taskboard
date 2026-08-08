import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { App as AntApp, Input, Modal, Tooltip, Typography } from 'antd';
import {
  AppstoreFilled,
  AppstoreOutlined,
  KeyOutlined,
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
  return m ? decodeURIComponent(m[1]) : undefined;
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
}: {
  to: string;
  end?: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `sb-item${isActive ? ' is-active' : ''}`}>
      <span className="sb-item-icon">{icon}</span>
      <span className="sb-item-label">{label}</span>
      {badge != null && badge > 0 && <span className="sb-item-badge">{badge}</span>}
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
  const routeProject = useRouteProject();
  const [createOpen, setCreateOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenVal, setTokenVal] = useState(localStorage.getItem('board-token') ?? '');

  const saveToken = () => {
    const v = tokenVal.trim();
    if (v) localStorage.setItem('board-token', v);
    else localStorage.removeItem('board-token');
    setTokenOpen(false);
    message.success(v ? '已保存访问令牌' : '已清除访问令牌');
  };

  // 侧边栏项目列表：归档的不进导航（要看去「项目概览」开「含归档」），置顶恒前，其余按最近活跃
  const q = search.trim().toLowerCase();
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

  const totalActive = projects
    .filter((p) => !p.archived)
    .reduce((n, p) => n + activeManaged(p.managed), 0);

  return (
    <div className="shell">
      <aside className="sb">
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

          <button className="btn btn-solid btn-block" onClick={() => setCreateOpen(true)}>
            <PlusOutlined />
            新建任务
          </button>

          <div style={{ height: 10 }} />

          <NavItem to="/" end icon={<AppstoreOutlined />} label="项目概览" badge={projects.length} />
          <NavItem
            to="/tasks"
            icon={<UnorderedListOutlined />}
            label="全局任务"
            badge={totalActive}
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
                >
                  <span className="sb-item-icon">
                    <span className="dot" data-level={activityLevel(p.lastActive)} />
                  </span>
                  <span className="sb-item-label">{p.displayName}</span>
                  {active > 0 && <span className="sb-item-badge">{active}</span>}
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
