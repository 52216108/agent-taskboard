import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { App as AntApp } from 'antd';
import type { ProjectInfo } from './types';
import { fetchProjects, rescanProjects } from './api';

/**
 * 全壳共享状态：项目列表 + 搜索词。
 *
 * 侧边栏（项目导航）、概览页（项目网格）、全局任务页都要读同一份项目数据和同一个搜索框，
 * 逐层传 props 会把 AppShell 变成中转站，所以放 context。只放"跨页面共享"的，页面私有状态仍留在页面里。
 */
interface BoardState {
  projects: ProjectInfo[];
  loading: boolean;
  scanning: boolean;
  scannedAt: number | null;
  /** 重新拉取项目列表（不触发磁盘扫描）。任何写操作后调它刷新侧边栏计数。 */
  reload: () => void;
  /** 触发后端重新扫描磁盘。 */
  rescan: () => void;
  search: string;
  setSearch: (v: string) => void;
}

const Ctx = createContext<BoardState | null>(null);

export function useBoard(): BoardState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBoard 必须在 <BoardProvider> 内使用');
  return v;
}

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const { message } = AntApp.useApp();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    fetchProjects()
      .then((r) => {
        setProjects(r.projects);
        setScannedAt(r.scannedAt);
      })
      .catch((e) => message.error(`加载失败：${e.message}`))
      .finally(() => setLoading(false));
  }, [message]);

  useEffect(reload, [reload]);

  const rescan = useCallback(() => {
    setScanning(true);
    rescanProjects()
      .then((r) => {
        setProjects(r.projects);
        setScannedAt(r.scannedAt);
        message.success(`已重新扫描，共 ${r.count} 个项目`);
      })
      .catch((e) => message.error(`扫描失败：${e.message}`))
      .finally(() => setScanning(false));
  }, [message]);

  const value = useMemo<BoardState>(
    () => ({ projects, loading, scanning, scannedAt, reload, rescan, search, setSearch }),
    [projects, loading, scanning, scannedAt, reload, rescan, search],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
