import { readFileSync } from 'node:fs';
import type { TodoItem, TodoSummary } from './types';

/** 复选框行：- [ ] / - [x] / - [~]（兼容 * 列表与大小写 X；允许嵌套缩进的子待办）。 */
const CHECKBOX = /^\s*[-*]\s*\[([ xX~])\]\s+(.*\S)\s*$/;
/** 段落标题：## 或 ### 开头。 */
const HEADING = /^\s{0,3}(#{2,6})\s+(.*\S)\s*$/;
/** 围栏代码块边界：``` 或 ~~~，块内的复选框/标题不计入。 */
const FENCE = /^\s*(```|~~~)/;

function emptySummary(): TodoSummary {
  return { open: 0, doing: 0, done: 0, total: 0, items: [] };
}

function statusOf(mark: string): TodoItem['status'] {
  if (mark === '~') return 'doing';
  if (mark === ' ') return 'open';
  return 'done'; // x / X
}

/** 解析一段 markdown 文本中的待办条目。 */
export function parseTodoText(text: string): TodoSummary {
  const items: TodoItem[] = [];
  let section: string | null = null;
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = line.match(HEADING);
    if (h) {
      section = h[2];
      continue;
    }
    const m = line.match(CHECKBOX);
    if (m) items.push({ text: m[2], status: statusOf(m[1]), section });
  }
  let open = 0;
  let doing = 0;
  let done = 0;
  for (const it of items) {
    if (it.status === 'open') open++;
    else if (it.status === 'doing') doing++;
    else done++;
  }
  return { open, doing, done, total: items.length, items };
}

/** 读取并解析 tasks/todo.md；文件不存在或读取失败返回空结果。 */
export function parseTodoFile(path: string): TodoSummary {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return emptySummary();
  }
  return parseTodoText(text);
}
