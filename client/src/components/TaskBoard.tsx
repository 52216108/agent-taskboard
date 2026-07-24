import { useRef, useState } from 'react';
import { Button, Tag, Typography, theme, Dropdown, Empty, App as AntApp } from 'antd';
import { PlusOutlined, MoreOutlined, CalendarOutlined } from '@ant-design/icons';
import type { Task, TaskStatus, TaskPriority } from '../types';
import { updateTask, setTaskStatus } from '../api';
import { BOARD_STATUSES, TASK_STATUS_META, TASK_TYPE_META } from '../util';
import TaskEditModal from './TaskEditModal';
import TaskCreateModal from './TaskCreateModal';

const { Text } = Typography;

const COLUMNS = BOARD_STATUSES.map((key) => ({ key, label: TASK_STATUS_META[key].label }));

// 单列超过此数默认收起，避免成熟项目的「已完成」列堆几百张卡片把其余列压成一条缝。
const COLLAPSE_LIMIT = 15;

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  p0: 'red',
  p1: 'volcano',
  p2: 'blue',
  p3: 'default',
};

function TaskCard({
  task,
  onChange,
  onEdit,
}: {
  task: Task;
  onChange: () => void;
  onEdit: (t: Task) => void;
}) {
  const { token } = theme.useToken();
  const { message } = AntApp.useApp();
  const dragging = useRef(false);

  const act = (fn: () => Promise<unknown>) =>
    fn().then(onChange).catch((e) => message.error(String(e.message ?? e)));

  return (
    <div
      draggable
      onDragStart={(e) => {
        dragging.current = true;
        e.dataTransfer.setData('text/task-id', String(task.id));
      }}
      onDragEnd={() => {
        // 兜底：若拖拽后未触发 click，稍后复位，避免后续单击被吞
        setTimeout(() => (dragging.current = false), 50);
      }}
      onClick={() => {
        if (dragging.current) {
          dragging.current = false; // 这次 click 是拖拽的尾巴，不当作打开编辑
          return;
        }
        onEdit(task);
      }}
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        padding: 8,
        marginBottom: 8,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
        {/* 编号与标题分列两个 Text：编号不跟随「已完成」的删除线，它是标识不是内容；
            flexShrink:0 保证长标题换行时编号不被挤压 */}
        <div style={{ display: 'flex', gap: 4, minWidth: 0 }}>
          <Text
            style={{ fontSize: 12, color: token.colorTextTertiary, flexShrink: 0, lineHeight: '20px' }}
          >
            #{task.id}
          </Text>
          <Text
            style={{ fontSize: 13 }}
            delete={task.status === 'done'}
            type={task.status === 'done' ? 'secondary' : undefined}
          >
            {task.title}
          </Text>
        </div>
        {/* ⋮ 阻止冒泡，避免触发卡片点击与拖拽 */}
        <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'edit', label: '编辑' },
                { type: 'divider' },
                // 「移到X」按状态流转顺序生成，当前状态项禁用
                ...BOARD_STATUSES.map((s) => ({
                  key: s,
                  label: `移到${TASK_STATUS_META[s].label}`,
                  disabled: task.status === s,
                })),
                { type: 'divider' },
                { key: 'archive', label: '归档', danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'edit') return onEdit(task);
                if (key === 'archive') return act(() => updateTask(task.id, { status: 'archived' }));
                // done 走验收端点（记 accepted_at/by）；其余状态走 PATCH
                return act(() => setTaskStatus(task.id, key as TaskStatus));
              },
            }}
          >
            <MoreOutlined style={{ color: token.colorTextTertiary, cursor: 'pointer' }} />
          </Dropdown>
        </span>
      </div>
      <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tag color={TASK_TYPE_META[task.taskType].color} style={{ marginInlineEnd: 0 }}>
          {TASK_TYPE_META[task.taskType].label}
        </Tag>
        <Tag color={PRIORITY_COLOR[task.priority]} style={{ marginInlineEnd: 0 }}>
          {task.priority.toUpperCase()}
        </Tag>
        {task.assignee && (
          <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
            @{task.assignee}
          </Tag>
        )}
        {task.rejectReason && (
          <Tag color="volcano" style={{ marginInlineEnd: 0 }}>
            已打回
          </Tag>
        )}
        {task.source === 'todo_md' && (
          <Tag style={{ marginInlineEnd: 0 }} bordered={false}>
            来自 todo.md
          </Tag>
        )}
        {task.subtasks.length > 0 && (
          <Text style={{ fontSize: 11, color: token.colorTextTertiary }}>
            ☑ {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
          </Text>
        )}
        {task.dueDate && (
          <Text style={{ fontSize: 11, color: token.colorTextTertiary }}>
            <CalendarOutlined /> {task.dueDate.slice(0, 10)}
          </Text>
        )}
      </div>
    </div>
  );
}

export default function TaskBoard({
  projectName,
  tasks,
  onChange,
}: {
  projectName: string;
  tasks: Task[];
  onChange: () => void;
}) {
  const { token } = theme.useToken();
  const { message } = AntApp.useApp();
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<TaskStatus>>(new Set());

  const toggleExpand = (key: TaskStatus) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const openEdit = (t: Task) => {
    setEditTask(t);
    setEditOpen(true);
  };

  const drop = (status: TaskStatus) => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData('text/task-id'));
    if (!id) return;
    const task = tasks.find((x) => x.id === id);
    if (!task || task.status === status) return;
    // 拖到「已完成」列＝人工验收，走 accept 端点；其余列走 PATCH
    setTaskStatus(id, status).then(onChange).catch((e2) => message.error(String(e2.message ?? e2)));
  };

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建任务
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(0, 1fr))`, gap: 8 }}>
        {COLUMNS.map((col) => {
          const raw = tasks.filter((t) => t.status === col.key);
          // 「已完成」列按完成时间倒序：最近完成的排在前，收起时优先展示新鲜结果
          const items =
            col.key === 'done'
              ? [...raw].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
              : raw;
          const isExpanded = expanded.has(col.key);
          const overflow = items.length > COLLAPSE_LIMIT;
          const visible = overflow && !isExpanded ? items.slice(0, COLLAPSE_LIMIT) : items;
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={drop(col.key)}
              style={{
                background: over === col.key ? token.colorFillTertiary : token.colorFillQuaternary,
                borderRadius: token.borderRadius,
                padding: 8,
                transition: 'background 0.15s',
              }}
            >
              <Text strong style={{ fontSize: 12, color: token.colorTextSecondary }}>
                {col.label} {items.length > 0 && `· ${items.length}`}
              </Text>
              {/* 整页布局：列随内容自然撑开，用页面滚动（不再限高，那是抽屉时代的约束）*/}
              <div style={{ marginTop: 8, minHeight: 60 }}>
                {items.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} style={{ margin: '8px 0' }} />
                ) : (
                  <>
                    {visible.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onChange={onChange}
                        onEdit={openEdit}
                      />
                    ))}
                    {overflow && (
                      <Button type="link" size="small" block onClick={() => toggleExpand(col.key)}>
                        {isExpanded ? '收起' : `展开全部 ${items.length} 条`}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <TaskCreateModal
        projectName={projectName}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onChange}
      />
      <TaskEditModal task={editTask} open={editOpen} onClose={() => setEditOpen(false)} onSaved={onChange} />
    </>
  );
}
