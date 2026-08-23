import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntApp } from 'antd';
import type { ProjectInfo } from './types';
import { fetchProjects, rescanProjects, subscribeTaskEvents, type TaskReviewEvent } from './api';
import {
  deliverRecentEventOnce,
  type OwnershipCheck,
  type WithEventLock,
} from './recent-events';
import {
  hasIndexedDbProcessedEvent,
  markIndexedDbProcessedEvent,
  withIndexedDbLock,
} from './indexeddb-lock';

export type SystemNotificationState = 'unsupported' | 'off' | 'on' | 'blocked';

const NOTIFICATIONS_KEY = 'board-system-notifications';
const TOKEN_KEY = 'board-token';
// 沿用旧键名，由 recent-events 兼容其中原先保存的单个 ID。
const RECENT_EVENTS_KEY = 'board-last-review-event';
const indexedDbProcessedEvents = {
  has: hasIndexedDbProcessedEvent,
  mark: markIndexedDbProcessedEvent,
};

function readNotificationState(): SystemNotificationState {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && localStorage.getItem(NOTIFICATIONS_KEY) === '1'
    ? 'on'
    : 'off';
}

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
  /** 任何写操作后调它：重拉项目列表 + 递增 revision 通知当前页刷新。 */
  reload: () => void;
  /** 触发后端重新扫描磁盘。 */
  rescan: () => void;
  /** token 改变后重建 SSE 连接。 */
  reconnectEvents: () => void;
  systemNotificationState: SystemNotificationState;
  toggleSystemNotifications: () => Promise<void>;
  /**
   * 数据版本号，每次 reload/rescan 自增。
   *
   * 页面把它放进自己 fetch 的 useEffect 依赖里，就能收到「别处发生了写操作」的广播——
   * 否则侧边栏建的任务落了库，项目页/全局任务页却因为各拉各的而看不见（要手动刷新才出现）。
   */
  revision: number;
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
  const { message, notification } = AntApp.useApp();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [eventConnectionRevision, setEventConnectionRevision] = useState(0);
  const [systemNotificationState, setSystemNotificationState] =
    useState<SystemNotificationState>(readNotificationState);
  const projectsRef = useRef(projects);
  const pendingReviewEventsRef = useRef(new Map<string, TaskReviewEvent>());

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const reload = useCallback(() => {
    setLoading(true);
    fetchProjects()
      .then((r) => {
        setProjects(r.projects);
        setScannedAt(r.scannedAt);
        setRevision((n) => n + 1);
      })
      .catch((e) => message.error(`加载失败：${e.message}`))
      .finally(() => setLoading(false));
  }, [message]);

  useEffect(reload, [reload]);

  const reconnectEvents = useCallback(() => setEventConnectionRevision((n) => n + 1), []);

  const toggleSystemNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      message.warning('当前浏览器不支持系统通知');
      return;
    }
    if (systemNotificationState === 'on') {
      localStorage.removeItem(NOTIFICATIONS_KEY);
      setSystemNotificationState('off');
      message.success('已关闭系统通知，站内提醒仍会保留');
      return;
    }
    if (Notification.permission === 'denied') {
      setSystemNotificationState('blocked');
      message.warning('系统通知已被浏览器阻止，请在站点权限中重新开启');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        localStorage.setItem(NOTIFICATIONS_KEY, '1');
        setSystemNotificationState('on');
        message.success('系统通知已开启');
      } else {
        localStorage.removeItem(NOTIFICATIONS_KEY);
        setSystemNotificationState(permission === 'denied' ? 'blocked' : 'off');
      }
    } catch {
      message.error('无法申请系统通知权限');
    }
  }, [message, systemNotificationState]);

  // 浏览器设置可能在页面外或其他标签页被修改，立即同步真实权限和用户开关。
  useEffect(() => {
    const syncPermission = () => setSystemNotificationState(readNotificationState());
    const syncStoredSetting = (event: StorageEvent) => {
      if (event.key === null || event.key === NOTIFICATIONS_KEY) syncPermission();
      if (event.key === null || event.key === TOKEN_KEY) reconnectEvents();
    };
    window.addEventListener('focus', syncPermission);
    window.addEventListener('storage', syncStoredSetting);
    return () => {
      window.removeEventListener('focus', syncPermission);
      window.removeEventListener('storage', syncStoredSetting);
    };
  }, [reconnectEvents]);

  useEffect(() => {
    const deliver = async (event: TaskReviewEvent) => {
      const supportsLongRunningLock = Boolean(navigator.locks);
      // 系统通知关闭时，后台标签页先排队，避免它抢先认领后把站内提醒显示在不可见页面。
      if (
        (!supportsLongRunningLock || readNotificationState() !== 'on') &&
        document.visibilityState !== 'visible'
      ) {
        pendingReviewEventsRef.current.set(event.id, event);
        return;
      }

      const project = projectsRef.current.find((item) => item.dbId === event.task.projectId);
      const description = `${project?.displayName ?? '未知项目'} · #${event.task.id} ${event.task.title}${
        event.task.assignee ? ` · @${event.task.assignee}` : ''
      }`;

      let deferred = false;
      let deliveryAttempted = false;
      const showNotification = async (stillOwner: OwnershipCheck) => {
        if (!(await stillOwner())) return false;

        // 事件可能在等待跨标签页锁时排队，必须在实际展示前读取最新开关。
        const liveNotificationState = readNotificationState();
        // Web Locks 不可用时只做同步站内提醒，避免浏览器冻结跨过 IndexedDB 租约后重复系统通知。
        if (
          supportsLongRunningLock &&
          liveNotificationState === 'on' &&
          Notification.permission === 'granted'
        ) {
          try {
            deliveryAttempted = true;
            const systemNotification = new Notification('任务已交付，等待验收', {
              body: description,
              tag: `task-review-${event.task.id}-${event.task.updatedAt}`,
            });
            systemNotification.onclick = () => {
              window.focus();
              window.location.assign(project ? `/p/${encodeURIComponent(project.name)}` : '/tasks');
              systemNotification.close();
            };
            const shown = await new Promise<boolean>((resolve) => {
              let settled = false;
              const finish = (result: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(result);
              };
              const timeout = window.setTimeout(() => {
                systemNotification.close();
                finish(false);
              }, 5_000);
              systemNotification.onshow = () => finish(true);
              systemNotification.onerror = () => finish(false);
            });
            // 标签页冻结期间租约可能已被接管；旧持有者不得继续提交或展示站内兜底。
            if (!(await stillOwner())) return false;
            if (shown) return true;
          } catch {
            // 后台标签页不能承载站内兜底，返回 false 让可见标签页继续认领。
          }
        }
        if (!(await stillOwner())) return false;
        if (document.visibilityState !== 'visible') {
          deferred = true;
          pendingReviewEventsRef.current.set(event.id, event);
          return false;
        }
        deliveryAttempted = true;
        notification.success({
          message: '任务已交付，等待验收',
          description,
          placement: 'bottomRight',
        });
        return true;
      };

      const withLock: WithEventLock = navigator.locks
        ? async (name, claim): Promise<boolean> =>
            await navigator.locks.request(name, async () => await claim(async () => true))
        : withIndexedDbLock;
      try {
        const delivered = await deliverRecentEventOnce(
          localStorage,
          RECENT_EVENTS_KEY,
          event.id,
          withLock,
          showNotification,
          indexedDbProcessedEvents,
        );
        if (delivered || !deferred) pendingReviewEventsRef.current.delete(event.id);
      } catch {
        // 展示开始后的异常（例如 localStorage 配额）不能再次执行通知副作用。
        if (deliveryAttempted) {
          pendingReviewEventsRef.current.delete(event.id);
          return;
        }
        // 极端隐私模式下 IndexedDB 也可能不可用；只让唯一获得焦点的标签页降级展示。
        if (!document.hasFocus()) {
          pendingReviewEventsRef.current.set(event.id, event);
          return;
        }
        const delivered = await deliverRecentEventOnce(
          localStorage,
          RECENT_EVENTS_KEY,
          event.id,
          async (_name, claim) => claim(async () => document.hasFocus()),
          showNotification,
          indexedDbProcessedEvents,
        );
        if (delivered || !deferred) pendingReviewEventsRef.current.delete(event.id);
      }
    };

    let reloadTimer: number | null = null;
    const scheduleReload = () => {
      if (reloadTimer !== null) return;
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        reload();
      }, 50);
    };
    const unsubscribe = subscribeTaskEvents((event) => {
      scheduleReload();
      void deliver(event);
    });

    const deliverPendingWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      for (const event of pendingReviewEventsRef.current.values()) {
        void deliver(event);
      }
    };
    document.addEventListener('visibilitychange', deliverPendingWhenVisible);
    window.addEventListener('focus', deliverPendingWhenVisible);
    return () => {
      unsubscribe();
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      document.removeEventListener('visibilitychange', deliverPendingWhenVisible);
      window.removeEventListener('focus', deliverPendingWhenVisible);
    };
  }, [eventConnectionRevision, notification, reload]);

  const rescan = useCallback(() => {
    setScanning(true);
    rescanProjects()
      .then((r) => {
        setProjects(r.projects);
        setScannedAt(r.scannedAt);
        setRevision((n) => n + 1);
        message.success(`已重新扫描，共 ${r.count} 个项目`);
      })
      .catch((e) => message.error(`扫描失败：${e.message}`))
      .finally(() => setScanning(false));
  }, [message]);

  const value = useMemo<BoardState>(
    () => ({
      projects,
      loading,
      scanning,
      scannedAt,
      reload,
      rescan,
      reconnectEvents,
      systemNotificationState,
      toggleSystemNotifications,
      revision,
      search,
      setSearch,
    }),
    [
      projects,
      loading,
      scanning,
      scannedAt,
      reload,
      rescan,
      reconnectEvents,
      systemNotificationState,
      toggleSystemNotifications,
      revision,
      search,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
