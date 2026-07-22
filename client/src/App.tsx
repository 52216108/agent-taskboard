import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ConfigProvider,
  Layout,
  theme,
  Input,
  Select,
  Button,
  Space,
  Typography,
  Empty,
  Spin,
  Tooltip,
  Switch,
  Modal,
  Segmented,
  App as AntApp,
} from 'antd';
import {
  ReloadOutlined,
  SunOutlined,
  MoonOutlined,
  AppstoreOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import type { ProjectInfo } from './types';
import { fetchProjects, rescanProjects } from './api';
import { relativeTime } from './util';
import { Routes, Route, useNavigate } from 'react-router-dom';
import ProjectCard from './components/ProjectCard';
import GlobalTaskView from './components/GlobalTaskView';
import ProjectPage from './ProjectPage';

const { Header, Content } = Layout;
const { Text, Title } = Typography;

type SortKey = 'active' | 'priority' | 'todos' | 'name';
const PRIORITY_RANK: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

function useDark(): [boolean, (v: boolean) => void] {
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('board-dark');
    if (saved != null) return saved === '1';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });
  useEffect(() => {
    localStorage.setItem('board-dark', dark ? '1' : '0');
  }, [dark]);
  return [dark, setDark];
}

function Board({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('active');
  const [showArchived, setShowArchived] = useState(false);
  const [mainView, setMainView] = useState<'projects' | 'tasks'>('projects');
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenVal, setTokenVal] = useState(localStorage.getItem('board-token') ?? '');
  const { message } = AntApp.useApp();

  const saveToken = () => {
    const v = tokenVal.trim();
    if (v) localStorage.setItem('board-token', v);
    else localStorage.removeItem('board-token');
    setTokenOpen(false);
    message.success(v ? '已保存访问令牌' : '已清除访问令牌');
  };

  const load = useCallback(() => {
    setLoading(true);
    fetchProjects()
      .then((r) => {
        setProjects(r.projects);
        setScannedAt(r.scannedAt);
      })
      .catch((e) => message.error(`加载失败：${e.message}`))
      .finally(() => setLoading(false));
  }, [message]);
  useEffect(load, [load]);

  const rescan = () => {
    setScanning(true);
    rescanProjects()
      .then((r) => {
        setProjects(r.projects);
        setScannedAt(r.scannedAt);
        message.success(`已重新扫描，共 ${r.count} 个项目`);
      })
      .catch((e) => message.error(`扫描失败：${e.message}`))
      .finally(() => setScanning(false));
  };

  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = projects;
    if (!showArchived) list = list.filter((p) => !p.archived);
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.displayName.toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q) ||
          p.techStack.some((t) => t.toLowerCase().includes(q)),
      );
    }
    // 活跃工作量＝文件待办 + 受管的(待开发+进行中+待验收)；待规划是点子堆、已完成不计
    const actionable = (p: (typeof list)[number]) =>
      p.todos.open + p.managed.todo + p.managed.doing + p.managed.review;
    const rank = (p: (typeof list)[number]) => (p.topPriority ? PRIORITY_RANK[p.topPriority] : 9);
    const byKey =
      sort === 'active'
        ? (a: (typeof list)[number], b: (typeof list)[number]) =>
            (b.lastActive ?? '').localeCompare(a.lastActive ?? '')
        : sort === 'priority'
          ? (a: (typeof list)[number], b: (typeof list)[number]) =>
              rank(a) - rank(b) || (b.lastActive ?? '').localeCompare(a.lastActive ?? '')
          : sort === 'todos'
            ? (a: (typeof list)[number], b: (typeof list)[number]) => actionable(b) - actionable(a)
            : (a: (typeof list)[number], b: (typeof list)[number]) => a.name.localeCompare(b.name);
    // 置顶恒前，其次按所选维度
    return [...list].sort((a, b) => (a.pinned === b.pinned ? byKey(a, b) : a.pinned ? -1 : 1));
  }, [projects, search, sort, showArchived]);

  const openDetail = (name: string) => navigate(`/p/${encodeURIComponent(name)}`);

  return (
    <Layout style={{ minHeight: '100vh', background: token.colorBgLayout }}>
      <Header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          paddingInline: 24,
        }}
      >
        <Space>
          <AppstoreOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
          <Title level={4} style={{ margin: 0 }}>
            agent-taskboard
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {projects.length} 个项目
            {scannedAt && ` · 扫描于 ${relativeTime(new Date(scannedAt).toISOString())}`}
          </Text>
        </Space>

        <Segmented
          value={mainView}
          onChange={(v) => setMainView(v as 'projects' | 'tasks')}
          options={[
            { value: 'projects', label: '项目' },
            { value: 'tasks', label: '任务' },
          ]}
        />

        <Space style={{ marginLeft: 'auto' }} wrap align="center">
          <Input.Search
            placeholder="搜索名称 / 简介 / 技术栈"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240 }}
          />
          {mainView === 'projects' && (
            <>
              <Select<SortKey>
                value={sort}
                onChange={setSort}
                style={{ width: 130 }}
                options={[
                  { value: 'active', label: '按最近活跃' },
                  { value: 'priority', label: '按优先级' },
                  { value: 'todos', label: '按待办数' },
                  { value: 'name', label: '按名称' },
                ]}
              />
              <Tooltip title="显示已归档项目">
                <Switch
                  checkedChildren="含归档"
                  unCheckedChildren="不含归档"
                  checked={showArchived}
                  onChange={setShowArchived}
                />
              </Tooltip>
            </>
          )}
          <Tooltip title="重新扫描">
            <Button icon={<ReloadOutlined />} loading={scanning} onClick={rescan} />
          </Tooltip>
          <Tooltip title="访问令牌（远程写操作需要）">
            <Button icon={<KeyOutlined />} onClick={() => setTokenOpen(true)} />
          </Tooltip>
          <Tooltip title={dark ? '切换浅色' : '切换深色'}>
            <Button icon={dark ? <SunOutlined /> : <MoonOutlined />} onClick={onToggleTheme} />
          </Tooltip>
        </Space>
      </Header>

      <Content style={{ padding: 24 }}>
        {mainView === 'tasks' ? (
          <GlobalTaskView search={search} onProjectClick={openDetail} onChanged={load} />
        ) : (
          <Spin spinning={loading}>
          {view.length === 0 && !loading ? (
            <Empty description={search ? '无匹配项目' : '未发现项目'} />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 16,
                alignItems: 'stretch',
              }}
            >
              {view.map((p) => (
                <ProjectCard
                  key={p.key}
                  project={p}
                  onClick={() => openDetail(p.name)}
                  onChange={load}
                />
              ))}
            </div>
          )}
          </Spin>
        )}
      </Content>

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
    </Layout>
  );
}

export default function App() {
  const [dark, setDark] = useDark();
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}
    >
      <AntApp>
        <Routes>
          <Route path="/" element={<Board dark={dark} onToggleTheme={() => setDark(!dark)} />} />
          <Route path="/p/:name" element={<ProjectPage />} />
        </Routes>
      </AntApp>
    </ConfigProvider>
  );
}
