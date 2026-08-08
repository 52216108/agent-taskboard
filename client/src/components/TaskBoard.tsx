import { useRef, useState } from 'react';
import { Dropdown, App as AntApp } from 'antd';
import { MoreOutlined, PlusOutlined, CalendarOutlined, CheckSquareOutlined } from '@ant-design/icons';
import type { Task, TaskStatus } from '../types';
import { updateTask, setTaskStatus } from '../api';
import { BOARD_STATUSES, TASK_STATUS_META, TASK_TYPE_META } from '../util';
import { PriorityIcon, StatusIcon } from './StatusIcon';
import TaskEditModal from './TaskEditModal';

type BoardStatus = Exclude<TaskStatus, 'archived'>;

// 单列超过此数默认收起，避免成熟项目的「已完成」列堆几百张卡片把其余列压成一条缝。
const COLLAPSE_LIMIT = 15;

/** 任务卡片：编号行 → 标题 → 描述摘要 → 页脚标记，四段自上而下信息密度递减。 */
function TaskCard({
  task,
  onChange,
  onEdit,
}: {
  task: Task;
  onChange: () => void;
  onEdit: (t: Task) => void;
}) {
  const { message } = AntApp.useApp();
  const dragging = useRef(false);
  const [held, setHeld] = useState(false);

  const act = (fn: () => Promise<unknown>) =>
    fn()
      .then(onChange)
      .catch((e) => message.error(String(e.message ?? e)));

  const done = task.status === 'done';
  const doneCount = task.subtasks.filter((s) => s.done).length;
  const overdue = !!task.dueDate && task.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10) && !done;

  return (
    <article
      draggable
      className={`tcard${done ? ' is-done' : ''}${held ? ' is-dragging' : ''}`}
      onDragStart={(e) => {
        dragging.current = true;
        setHeld(true);
        e.dataTransfer.setData('text/task-id', String(task.id));
      }}
      onDragEnd={() => {
        setHeld(false);
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
    >
      <div className="tcard-top">
        <span className="tcard-id">#{task.id}</span>
        <span className="chip chip-type" style={{ ['--chip-c' as string]: `var(--ty-${task.taskType})` }}>
          {TASK_TYPE_META[task.taskType].label}
        </span>
        {task.rejectReason && <span className="chip chip-warn">已打回</span>}
        {/* ⋮ 阻止冒泡，避免触发卡片点击与拖拽 */}
        <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ marginLeft: 'auto', display: 'flex' }}>
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
            <button className="tcard-more" aria-label="任务操作">
              <MoreOutlined />
            </button>
          </Dropdown>
        </span>
      </div>

      <div className="tcard-title">{task.title}</div>

      {task.description && <div className="tcard-desc">{task.description}</div>}

      <div className="tcard-foot">
        <span className="chip chip-pri" style={{ ['--chip-c' as string]: `var(--pri-${task.priority})` }}>
          <PriorityIcon priority={task.priority} />
          {task.priority.toUpperCase()}
        </span>
        {task.assignee && <span className="chip">@{task.assignee}</span>}
        {task.subtasks.length > 0 && (
          <span className="tcard-meta">
            <CheckSquareOutlined />
            {doneCount}/{task.subtasks.length}
          </span>
        )}
        {task.dueDate && (
          <span className={`tcard-meta${overdue ? ' is-overdue' : ''}`}>
            <CalendarOutlined />
            {task.dueDate.slice(5, 10)}
          </span>
        )}
        {task.source === 'todo_md' && <span className="tcard-meta">todo.md</span>}
      </div>
    </article>
  );
}

export default function TaskBoard({
  tasks,
  onChange,
  onCreate,
}: {
  tasks: Task[];
  onChange: () => void;
  /** 列头「＋」回调：由页面弹新建弹窗（弹窗归页面所有，工具条上的「新建任务」共用同一个） */
  onCreate: (status: BoardStatus) => void;
}) {
  const { message } = AntApp.useApp();
  const [over, setOver] = useState<BoardStatus | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<BoardStatus>>(new Set());

  const toggleExpand = (key: BoardStatus) =>
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

  const drop = (status: BoardStatus) => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData('text/task-id'));
    if (!id) return;
    const task = tasks.find((x) => x.id === id);
    if (!task || task.status === status) return;
    // 拖到「已完成」列＝人工验收，走 accept 端点；其余列走 PATCH
    setTaskStatus(id, status)
      .then(onChange)
      .catch((e2) => message.error(String(e2.message ?? e2)));
  };

  return (
    <>
      <div className="board">
        {BOARD_STATUSES.map((key) => {
          const raw = tasks.filter((t) => t.status === key);
          // 「已完成」列按完成时间倒序：最近完成的排在前，收起时优先展示新鲜结果
          const items =
            key === 'done'
              ? [...raw].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
              : raw;
          const isExpanded = expanded.has(key);
          const overflow = items.length > COLLAPSE_LIMIT;
          const visible = overflow && !isExpanded ? items.slice(0, COLLAPSE_LIMIT) : items;
          return (
            <section
              key={key}
              className={`col${over === key ? ' is-over' : ''}`}
              style={{
                ['--col-bg' as string]: `var(--st-${key}-bg)`,
                ['--col-bg-hover' as string]: `var(--st-${key}-bg-hover)`,
                ['--col-fg' as string]: `var(--st-${key}-fg)`,
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(key);
              }}
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={drop(key)}
            >
              <header className="col-head">
                <StatusIcon status={key} />
                <span className="col-name">{TASK_STATUS_META[key].label}</span>
                <span className="col-count">{items.length}</span>
                {/* 「已完成」不给建入口：置 done 只能由人从「待验收」验收，见 SECURITY.md */}
                {key !== 'done' && (
                  <button
                    className="col-add"
                    onClick={() => onCreate(key)}
                    aria-label={`在${TASK_STATUS_META[key].label}新建任务`}
                    title={`在${TASK_STATUS_META[key].label}新建任务`}
                  >
                    <PlusOutlined />
                  </button>
                )}
              </header>

              {/* 列随内容自然撑开，由外层 .page 滚动（不再限高，那是抽屉时代的约束）*/}
              <div className="col-body">
                {items.length === 0 ? (
                  <div className="col-empty">暂无</div>
                ) : (
                  <>
                    {visible.map((t) => (
                      <TaskCard key={t.id} task={t} onChange={onChange} onEdit={openEdit} />
                    ))}
                    {overflow && (
                      <button className="col-more" onClick={() => toggleExpand(key)}>
                        {isExpanded ? '收起' : `展开全部 ${items.length} 条`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <TaskEditModal task={editTask} open={editOpen} onClose={() => setEditOpen(false)} onSaved={onChange} />
    </>
  );
}
