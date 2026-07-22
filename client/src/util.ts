import type { TaskStatus, TaskType } from './types';

/** 任务类型展示元数据：标签文案 + antd Tag 颜色。三处任务视图共用，避免重复。 */
export const TASK_TYPE_META: Record<TaskType, { label: string; color: string }> = {
  feature: { label: '需求', color: 'blue' },
  bug: { label: 'Bug', color: 'red' },
  optimize: { label: '优化', color: 'gold' },
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

/** 任务状态展示元数据：列标题 / 标签文案 + antd Tag 颜色。看板、弹窗、全局列表共用。 */
export const TASK_STATUS_META: Record<
  Exclude<TaskStatus, 'archived'>,
  { label: string; color: string }
> = {
  collected: { label: '已收集', color: 'default' },
  backlog: { label: '待规划', color: 'cyan' },
  todo: { label: '待开发', color: 'blue' },
  doing: { label: '进行中', color: 'processing' },
  review: { label: '待验收', color: 'gold' },
  done: { label: '已完成', color: 'green' },
};

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
