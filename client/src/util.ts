import type { TaskStatus, TaskType } from './types';

/**
 * 任务类型展示文案。三处任务视图共用，避免重复。
 * 颜色不在这里——见 theme.ts 的 `--ty-<type>` CSS 变量（明暗两套，样式层统一取）。
 */
export const TASK_TYPE_META: Record<TaskType, { label: string }> = {
  feature: { label: '需求' },
  bug: { label: 'Bug' },
  optimize: { label: '优化' },
};

/** 看板列顺序（不含归档），即状态流转顺序。看板/编辑弹窗共用一处事实源。 */
export const BOARD_STATUSES: Array<Exclude<TaskStatus, 'archived'>> = [
  'collected',
  'backlog',
  'todo',
  'doing',
  'review',
  'done',
];

/**
 * 任务状态展示文案（列标题 / 标签）。看板、弹窗、全局列表共用。
 * 颜色见 theme.ts 的 `--st-<status>-fg` / `-bg` CSS 变量，图标见 StatusIcon。
 */
export const TASK_STATUS_META: Record<Exclude<TaskStatus, 'archived'>, { label: string }> = {
  collected: { label: '已收集' },
  backlog: { label: '待规划' },
  todo: { label: '待开发' },
  doing: { label: '进行中' },
  review: { label: '待验收' },
  done: { label: '已完成' },
};

/**
 * 活跃受管任务数＝待开发+进行中+待验收。
 * 「已收集/待规划」是点子堆、「已完成」不算工作量——侧边栏徽标、项目卡片、排序共用这一处定义。
 */
export function activeManaged(m: {
  todo: number;
  doing: number;
  review: number;
}): number {
  return m.todo + m.doing + m.review;
}

/** 新建表单/选择器的类型选项（顺序固定：需求 → Bug → 优化）。 */
export const TASK_TYPE_OPTIONS: Array<{ value: TaskType; label: string }> = (
  ['feature', 'bug', 'optimize'] as TaskType[]
).map((v) => ({ value: v, label: TASK_TYPE_META[v].label }));

/** ISO 时间 → 相对时间（中文）。 */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  if (sec < 60) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  if (hr < 24) return `${hr} 小时前`;
  if (day < 30) return `${day} 天前`;
  const mon = Math.round(day / 30);
  if (mon < 12) return `${mon} 个月前`;
  return `${Math.round(mon / 12)} 年前`;
}

/** 活跃度等级：7 天内 fresh、30 天内 recent、更久 stale。由组件映射到 token 颜色。 */
export function activityLevel(iso: string | null): 'fresh' | 'recent' | 'stale' {
  if (!iso) return 'stale';
  const day = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (day <= 7) return 'fresh';
  if (day <= 30) return 'recent';
  return 'stale';
}
