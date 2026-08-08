import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as AntApp, Checkbox, Spin, Tooltip } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import type { GlobalTask } from '../types';
import { fetchAllTasks, setTaskStatus } from '../api';
import { TASK_STATUS_META, TASK_TYPE_META } from '../util';
import { useBoard } from '../BoardContext';
import { PriorityIcon, StatusIcon } from './StatusIcon';
import TaskEditModal from './TaskEditModal';

type Filter = 'open' | 'all' | 'today' | 'overdue' | 'high';
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'open', label: '未完成' },
  { value: 'high', label: '高优先' },
  { value: 'today', label: '今天到期' },
  { value: 'overdue', label: '逾期' },
  { value: 'all', label: '全部' },
];

const today = () => new Date().toISOString().slice(0, 10);

/** 全局任务：跨项目一条条平铺，左侧状态环表达进度，右侧标出所属项目。 */
export default function GlobalTaskView() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const { search, reload: reloadProjects, revision } = useBoard();
  const [tasks, setTasks] = useState<GlobalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('open');
  const [editing, setEditing] = useState<GlobalTask | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchAllTasks(filter === 'all')
      .then((r) => setTasks(r.tasks))
      .catch((e) => message.error(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [filter, message]);
  // revision 变化＝别处（侧边栏新建、项目页编辑）发生了写操作，跟着重拉
  useEffect(load, [load, revision]);

  // 只发广播，让上面的 effect 去拉——直接 load() 会和 revision 触发的那次重复请求
  const reload = () => reloadProjects();

  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    const td = today();
    return tasks.filter((t) => {
      if (q && !t.title.toLowerCase().includes(q) && !t.projectName.toLowerCase().includes(q)) return false;
      // 未完成＝除"已完成/归档"外的所有列（已收集/待规划/待开发/进行中/待验收）
      const open = t.status !== 'done' && t.status !== 'archived';
      if (filter === 'open') return open;
      if (filter === 'high') return open && (t.priority === 'p0' || t.priority === 'p1');
      if (filter === 'today') return open && t.dueDate?.slice(0, 10) === td;
      if (filter === 'overdue') return open && !!t.dueDate && t.dueDate.slice(0, 10) < td;
      return true; // all
    });
  }, [tasks, search, filter]);

  const toggleDone = (t: GlobalTask, checked: boolean) => {
    // 勾=已完成（走 accept 端点，记 accepted_at/by）；取消勾只会发生在已完成任务上（框 checked 当且仅当 done），
    // 退回「进行中」是"未完成"最直觉的补集——不退到 todo/backlog（会丢掉已做进度的语义）
    setTaskStatus(t.id, checked ? 'done' : 'doing')
      .then(reload)
      .catch((e) => message.error(String(e.message ?? e)));
  };

  return (
    <>
      <div className="toolbar">
        <div className="seg">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              className={filter === f.value ? 'is-active' : undefined}
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="toolbar-spacer" />
        <span className="toolbar-count">{view.length} 条</span>
      </div>

      {loading && tasks.length === 0 ? (
        <div className="empty">
          <Spin />
        </div>
      ) : view.length === 0 ? (
        <div className="empty">{search ? '无匹配任务' : '该筛选下暂无任务'}</div>
      ) : (
        <div className="stack">
          {view.map((t) => {
            const done = t.status === 'done';
            const overdue = !!t.dueDate && t.dueDate.slice(0, 10) < today() && !done;
            // 归档是软删、不在六列里：借「已收集」的空心环画个形，但压暗并另打「已归档」标，
            // 免得看起来像一条待分诊的新任务
            const archived = t.status === 'archived';
            // 直接写三元而不是用 archived——TS 只在这种写法下把 t.status 收窄成 BoardStatus
            const status = t.status === 'archived' ? 'collected' : t.status;
            return (
              <div
                key={t.id}
                className={`trow${done ? ' is-done' : ''}`}
                onClick={() => {
                  setEditing(t);
                  setEditOpen(true);
                }}
              >
                {/* 归档任务不给勾：勾了会打到 accept 端点，而它只收「待验收 → 已完成」，必然报错 */}
                <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex' }}>
                  <Checkbox
                    checked={done}
                    disabled={archived}
                    onChange={(e) => toggleDone(t, e.target.checked)}
                  />
                </span>
                {/* StatusIcon 是 aria-hidden 的纯图形，状态得由这层的 aria-label 说出来，
                    否则读屏用户听不到任务处在哪一列（AntD Tooltip 不产生 aria 文本） */}
                <Tooltip title={archived ? '已归档' : TASK_STATUS_META[status].label}>
                  <span
                    role="img"
                    aria-label={`状态：${archived ? '已归档' : TASK_STATUS_META[status].label}`}
                    style={{ display: 'flex', opacity: archived ? 0.4 : 1 }}
                  >
                    <StatusIcon status={status} />
                  </span>
                </Tooltip>
                <span className="tcard-id">#{t.id}</span>
                <span
                  className="chip chip-pri"
                  role="img"
                  aria-label={`优先级 ${t.priority.toUpperCase()}`}
                  title={`优先级 ${t.priority.toUpperCase()}`}
                  style={{ ['--chip-c' as string]: `var(--pri-${t.priority})` }}
                >
                  <PriorityIcon priority={t.priority} />
                </span>
                <span
                  className="chip chip-type"
                  style={{ ['--chip-c' as string]: `var(--ty-${t.taskType})` }}
                >
                  {TASK_TYPE_META[t.taskType].label}
                </span>
                {archived && <span className="chip">已归档</span>}
                {t.rejectReason && <span className="chip chip-warn">已打回</span>}

                <span className="trow-title">{t.title}</span>

                {t.assignee && <span className="chip">@{t.assignee}</span>}
                {t.dueDate && (
                  <span className={`tcard-meta${overdue ? ' is-overdue' : ''}`}>
                    <CalendarOutlined />
                    {t.dueDate.slice(5, 10)}
                  </span>
                )}
                <Tooltip title="打开该项目">
                  <span
                    className="trow-proj"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/p/${encodeURIComponent(t.projectDir)}`);
                    }}
                  >
                    {t.projectName}
                  </span>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}

      <TaskEditModal task={editing} open={editOpen} onClose={() => setEditOpen(false)} onSaved={reload} />
    </>
  );
}
