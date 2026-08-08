// 设计令牌单一事实源。
//
// 同一份调色板喂两个消费方：
//   ① CSS 自定义属性（手写的外壳/看板/卡片用 var(--xxx)）
//   ② AntD ConfigProvider 的 token（弹窗/表单/日期选择器仍是 AntD 的）
// 只在这里改颜色，两边同时生效——避免「CSS 改了 AntD 没改」的半旧半新。

import type { TaskPriority, TaskStatus } from './types';

/** 一套主题的全部令牌。键名即 CSS 变量名（`bg-app` → `--bg-app`）。 */
export type Palette = Record<string, string>;

/** 状态色：每个看板列一个色相，列底色是同色相的极淡铺底。 */
type StatusHue = { fg: string; bg: string; bgHover: string };

const LIGHT_STATUS: Record<Exclude<TaskStatus, 'archived'>, StatusHue> = {
  // 灰 → 青 → 蓝 → 琥珀 → 紫 → 绿，从"没分诊"走到"已验收"，冷色起步暖色推进、绿色收尾
  collected: { fg: '#8a8f98', bg: 'rgba(138,143,152,0.07)', bgHover: 'rgba(138,143,152,0.13)' },
  backlog: { fg: '#3fa2c0', bg: 'rgba(63,162,192,0.07)', bgHover: 'rgba(63,162,192,0.14)' },
  todo: { fg: '#4a86f0', bg: 'rgba(74,134,240,0.07)', bgHover: 'rgba(74,134,240,0.14)' },
  doing: { fg: '#d8912a', bg: 'rgba(216,145,42,0.09)', bgHover: 'rgba(216,145,42,0.16)' },
  review: { fg: '#8878e2', bg: 'rgba(136,120,226,0.08)', bgHover: 'rgba(136,120,226,0.15)' },
  done: { fg: '#33a06c', bg: 'rgba(51,160,108,0.07)', bgHover: 'rgba(51,160,108,0.14)' },
};

const DARK_STATUS: Record<Exclude<TaskStatus, 'archived'>, StatusHue> = {
  // 深色下前景提亮、铺底加浓——同样的 7% 白底看得见，黑底就没了
  collected: { fg: '#9aa0aa', bg: 'rgba(154,160,170,0.07)', bgHover: 'rgba(154,160,170,0.13)' },
  backlog: { fg: '#5cbfda', bg: 'rgba(92,191,218,0.08)', bgHover: 'rgba(92,191,218,0.15)' },
  todo: { fg: '#6d9df5', bg: 'rgba(109,157,245,0.09)', bgHover: 'rgba(109,157,245,0.16)' },
  doing: { fg: '#e8ab4d', bg: 'rgba(232,171,77,0.10)', bgHover: 'rgba(232,171,77,0.17)' },
  review: { fg: '#a294ee', bg: 'rgba(162,148,238,0.10)', bgHover: 'rgba(162,148,238,0.17)' },
  done: { fg: '#4bbc85', bg: 'rgba(75,188,133,0.09)', bgHover: 'rgba(75,188,133,0.16)' },
};

/** 优先级色：p0 报警红 → p3 隐去。 */
const LIGHT_PRIORITY: Record<TaskPriority, string> = {
  p0: '#dc4a4a',
  p1: '#dd8b28',
  p2: '#7c828d',
  p3: '#a8adb6',
};
const DARK_PRIORITY: Record<TaskPriority, string> = {
  p0: '#f06a6a',
  p1: '#e8a44a',
  p2: '#8d939e',
  p3: '#6b707a',
};

/** 任务类型色（需求/Bug/优化）。 */
const LIGHT_TYPE = { feature: '#4a86f0', bug: '#dc4a4a', optimize: '#d8912a' };
const DARK_TYPE = { feature: '#6d9df5', bug: '#f06a6a', optimize: '#e8ab4d' };

const SHARED: Palette = {
  'radius-sm': '5px',
  radius: '8px',
  'radius-lg': '11px',
  'sidebar-w': '232px',
  'topbar-h': '44px',
  // 看板列的最小宽。240 是权衡出来的：1920 宽的显示器上六列正好铺满不横滚（还能各自撑到 ~268），
  // 1440 的笔记本上横滚露出半列——比六列硬挤成 187px 让标题疯狂折行强。
  'col-w': '240px',
  font: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Roboto, sans-serif`,
  mono: `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`,
};

export const LIGHT: Palette = {
  ...SHARED,
  'bg-app': '#f7f7f8', // 侧边栏 / 页面外底
  'bg-canvas': '#ffffff', // 主内容区
  'bg-surface': '#ffffff', // 卡片
  'bg-sunken': '#f1f1f3', // 内嵌槽（搜索框、空态）
  'bg-hover': 'rgba(17,17,20,0.045)',
  'bg-active': 'rgba(17,17,20,0.075)',
  border: '#e7e7ea',
  'border-strong': '#d5d5da',
  text: '#17171a',
  'text-2': '#63636d',
  'text-3': '#95959f',
  accent: '#5b5bd6',
  'accent-fg': '#ffffff',
  'accent-soft': 'rgba(91,91,214,0.10)',
  solid: '#1c1c20', // 主按钮（Multica 的「+ New Issue」是近黑实心）
  'solid-fg': '#ffffff',
  'solid-hover': '#33333a',
  danger: '#dc4a4a',
  warn: '#d8912a',
  ok: '#33a06c',
  'shadow-1': '0 1px 2px rgba(18,18,23,0.06)',
  'shadow-2': '0 6px 20px rgba(18,18,23,0.10)',
};

export const DARK: Palette = {
  ...SHARED,
  'bg-app': '#0e0e11',
  'bg-canvas': '#141417',
  'bg-surface': '#1a1a1f',
  'bg-sunken': '#0b0b0d',
  'bg-hover': 'rgba(255,255,255,0.055)',
  'bg-active': 'rgba(255,255,255,0.09)',
  border: '#26262c',
  'border-strong': '#35353d',
  text: '#eaeaee',
  'text-2': '#9b9ba6',
  'text-3': '#6d6d78',
  accent: '#7f7ff0',
  'accent-fg': '#ffffff',
  'accent-soft': 'rgba(127,127,240,0.16)',
  solid: '#eaeaee',
  'solid-fg': '#141417',
  'solid-hover': '#ffffff',
  danger: '#f06a6a',
  warn: '#e8ab4d',
  ok: '#4bbc85',
  'shadow-1': '0 1px 2px rgba(0,0,0,0.4)',
  'shadow-2': '0 6px 20px rgba(0,0,0,0.5)',
};

/** 展开状态/优先级/类型色为扁平 CSS 变量（`--st-todo-fg` / `--pri-p0` / `--ty-bug`）。 */
function expand(dark: boolean): Palette {
  const out: Palette = {};
  const status = dark ? DARK_STATUS : LIGHT_STATUS;
  for (const [k, v] of Object.entries(status)) {
    out[`st-${k}-fg`] = v.fg;
    out[`st-${k}-bg`] = v.bg;
    out[`st-${k}-bg-hover`] = v.bgHover;
  }
  for (const [k, v] of Object.entries(dark ? DARK_PRIORITY : LIGHT_PRIORITY)) out[`pri-${k}`] = v;
  for (const [k, v] of Object.entries(dark ? DARK_TYPE : LIGHT_TYPE)) out[`ty-${k}`] = v;
  return out;
}

/**
 * 初始明暗：用户存过就听用户的，没存过跟随系统。
 * main.tsx（首帧上色）和 App 的 useDark（状态初值）必须用同一个判断，否则会闪一下错主题。
 */
export function initialDark(): boolean {
  const saved = localStorage.getItem('board-dark');
  if (saved != null) return saved === '1';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** 把整套令牌写到 <html> 的 style 上，并设 data-theme / color-scheme（原生控件跟随明暗）。 */
export function applyPalette(dark: boolean): void {
  const root = document.documentElement;
  const vars = { ...(dark ? DARK : LIGHT), ...expand(dark) };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
}

/** AntD ConfigProvider 的 token 覆盖，与上面同一套值——弹窗表单不至于是另一个设计系统。 */
export function antdTokens(dark: boolean) {
  const p = dark ? DARK : LIGHT;
  return {
    colorPrimary: p.accent,
    colorError: p.danger,
    colorWarning: p.warn,
    colorSuccess: p.ok,
    colorBgBase: p['bg-canvas'],
    colorBgContainer: p['bg-surface'],
    colorBgElevated: p['bg-surface'],
    colorBgLayout: p['bg-app'],
    colorBorder: p['border-strong'],
    colorBorderSecondary: p.border,
    colorText: p.text,
    colorTextSecondary: p['text-2'],
    colorTextTertiary: p['text-3'],
    borderRadius: 8,
    borderRadiusLG: 11,
    borderRadiusSM: 5,
    fontSize: 13,
    fontFamily: p.font,
    controlHeight: 30,
    boxShadowSecondary: p['shadow-2'],
  };
}
