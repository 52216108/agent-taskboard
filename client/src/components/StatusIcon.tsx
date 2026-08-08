import type { TaskPriority, TaskStatus } from '../types';

type BoardStatus = Exclude<TaskStatus, 'archived'>;

/**
 * 状态进度环：六个状态画成 0 → 1 的填充度，一眼看出任务走到哪一步。
 * 已收集=虚线圈（还没分诊）、待规划=空心圈、待开发/进行中/待验收=1/4·1/2·3/4 扇形、已完成=实心打勾。
 */
const FILL: Record<BoardStatus, number> = {
  collected: 0,
  backlog: 0,
  todo: 0.25,
  doing: 0.5,
  review: 0.75,
  done: 1,
};

const R = 1.75; // 内扇形半径的一半——用 strokeWidth=2R 的描边把 0..2R 整片填满（经典甜甜圈画扇形法）
const C = 2 * Math.PI * R;

export function StatusIcon({ status, size = 14 }: { status: BoardStatus; size?: number }) {
  const fill = FILL[status];
  const color = `var(--st-${status}-fg)`;

  if (status === 'done') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden focusable="false">
        <circle cx="7" cy="7" r="6" fill={color} />
        <path
          d="M4.3 7.15 6.15 9 9.8 5.2"
          fill="none"
          stroke="var(--bg-surface)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden focusable="false" color={color}>
      <circle
        cx="7"
        cy="7"
        r="5.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={status === 'collected' ? '2.2 2.2' : undefined}
      />
      {fill > 0 && (
        <circle
          cx="7"
          cy="7"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={R * 2}
          strokeDasharray={`${C * fill} ${C}`}
          transform="rotate(-90 7 7)"
        />
      )}
    </svg>
  );
}

/**
 * 优先级图标：p0 是实心感叹号方块（唯一"停下来看我"的形状），p1/p2/p3 是 3/2/1 格信号条。
 * 形状本身就分级，不依赖颜色——色盲/灰度打印也读得出来。
 */
export function PriorityIcon({ priority, size = 12 }: { priority: TaskPriority; size?: number }) {
  const color = `var(--pri-${priority})`;

  if (priority === 'p0') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden focusable="false">
        <rect x="1" y="1" width="12" height="12" rx="3" fill={color} />
        <rect x="6.3" y="3.4" width="1.4" height="4.6" rx="0.7" fill="var(--bg-surface)" />
        <rect x="6.3" y="9.2" width="1.4" height="1.5" rx="0.7" fill="var(--bg-surface)" />
      </svg>
    );
  }

  const lit = { p1: 3, p2: 2, p3: 1 }[priority];
  const bars = [
    { x: 1, y: 8.5, h: 4.5 },
    { x: 5.3, y: 5.5, h: 7.5 },
    { x: 9.6, y: 2.5, h: 10.5 },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden focusable="false">
      {bars.map((b, i) => (
        <rect
          key={b.x}
          x={b.x}
          y={b.y}
          width="3.4"
          height={b.h}
          rx="1"
          fill={color}
          opacity={i < lit ? 1 : 0.28}
        />
      ))}
    </svg>
  );
}
