import { useCallback, useEffect, useMemo, useState } from 'react';
import { Segmented, Tag, Typography, Space, theme, Empty, Spin, Checkbox, Tooltip, App as AntApp } from 'antd';
import { ClockCircleTwoTone } from '@ant-design/icons';
import type { GlobalTask, TaskPriority, TaskStatus } from '../types';
import { fetchAllTasks, setTaskStatus } from '../api';
import { TASK_STATUS_META, TASK_TYPE_META } from '../util';
import TaskEditModal from './TaskEditModal';

const { Text } = Typography;

const PRIORITY_COLOR: Record<TaskPriority, string> = { p0: 'red', p1: 'volcano', p2: 'blue', p3: 'default' };
type Filter = 'open' | 'all' | 'today' | 'overdue' | 'high';
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'open', label: '未完成' },
  { value: 'high', label: '高优先' },
  { value: 'today', label: '今天到期' },
  { value: 'overdue', label: '逾期' },
  { value: 'all', label: '全部' },
];

const today = () => new Date().toISOString().slice(0, 10);

export default function GlobalTaskView({
  search,
  onProjectClick,
  onChanged,
}: {
  search: string;
  onProjectClick: (name: string) => void;
  onChanged: () => void;
}) {
  const { token } = theme.useToken();
  const { message } = AntApp.useApp();
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
  useEffect(load, [load]);

  const reload = () => {
    load();
    onChanged();
  };

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
      <Segmented
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        options={FILTERS}
        style={{ marginBottom: 16 }}
      />
      <Spin spinning={loading}>
        {view.length === 0 && !loading ? (
          <Empty description={search ? '无匹配任务' : '该筛选下暂无任务'} />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            {view.map((t) => {
              const overdue = !!t.dueDate && t.dueDate.slice(0, 10) < today() && t.status !== 'done';
              return (
                <div
                  key={t.id}
                  onClick={() => {
                    setEditing(t);
                    setEditOpen(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadius,
                    cursor: 'pointer',
                    background: token.colorBgContainer,
                  }}
                >
                  <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex' }}>
                    <Checkbox
                      checked={t.status === 'done'}
                      onChange={(e) => toggleDone(t, e.target.checked)}
                    />
                  </span>
                  <Tag color={TASK_TYPE_META[t.taskType].color} style={{ marginInlineEnd: 0 }}>
                    {TASK_TYPE_META[t.taskType].label}
                  </Tag>
                  <Tag color={PRIORITY_COLOR[t.priority]} style={{ marginInlineEnd: 0 }}>
                    {t.priority.toUpperCase()}
                  </Tag>
                  {t.assignee && (
                    <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                      @{t.assignee}
                    </Tag>
                  )}
                  {t.rejectReason && (
                    <Tag color="volcano" style={{ marginInlineEnd: 0 }}>
                      已打回
                    </Tag>
                  )}
                  {/* 非"待开发/已完成"的中间态打状态标签（已收集/待规划/进行中/待验收）；已完成靠删除线表达 */}
                  {(['collected', 'backlog', 'doing', 'review'] as TaskStatus[]).includes(t.status) && (
                    <Tag
                      color={TASK_STATUS_META[t.status as 'collected' | 'backlog' | 'doing' | 'review'].color}
                      style={{ marginInlineEnd: 0 }}
                    >
                      {TASK_STATUS_META[t.status as 'collected' | 'backlog' | 'doing' | 'review'].label}
                    </Tag>
                  )}
                  <Text
                    delete={t.status === 'done'}
                    type={t.status === 'done' ? 'secondary' : undefined}
                    style={{ flex: 1, minWidth: 0 }}
                    ellipsis
                  >
                    {t.title}
                  </Text>
                  {t.dueDate && (
                    <Text
                      style={{ fontSize: 12, color: overdue ? token.colorError : token.colorTextTertiary }}
                    >
                      <ClockCircleTwoTone twoToneColor={overdue ? '#cf1322' : token.colorTextDisabled} />{' '}
                      {t.dueDate.slice(5, 10)}
                    </Text>
                  )}
                  <Tooltip title="打开该项目">
                    <Tag
                      onClick={(e) => {
                        e.stopPropagation();
                        onProjectClick(t.projectDir);
                      }}
                      style={{ marginInlineEnd: 0, cursor: 'pointer', maxWidth: 160 }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.projectName}
                      </span>
                    </Tag>
                  </Tooltip>
                </div>
              );
            })}
          </Space>
        )}
      </Spin>

      <TaskEditModal task={editing} open={editOpen} onClose={() => setEditOpen(false)} onSaved={reload} />
    </>
  );
}
