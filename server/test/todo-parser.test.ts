import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parseTodoText, parseTodoFile } from '../src/todo-parser';

describe('parseTodoText', () => {
  it('按 [ ]/[x]/[~] 正确分类并计数', () => {
    const text = `
## 阶段 0 · 脚手架（进行中）
- [x] 工程 scaffold
- [~] 关键依赖安装中
- [ ] iOS dev build

## 阶段 2 · 框架（已完成）
- [x] 自定义 TabBar
* [X] 大写 X 也算完成
`;
    const r = parseTodoText(text);
    expect(r.done).toBe(3); // 两个 [x] + 一个 [X]
    expect(r.doing).toBe(1);
    expect(r.open).toBe(1);
    expect(r.total).toBe(5);
  });

  it('记录条目所属段落标题', () => {
    const r = parseTodoText('## A\n- [ ] a1\n## B\n- [ ] b1');
    expect(r.items[0].section).toBe('A');
    expect(r.items[1].section).toBe('B');
  });

  it('忽略非复选框行与空文本', () => {
    expect(parseTodoText('普通文字\n- 不是复选框\n- [ ]   ').total).toBe(0);
  });

  it('跳过围栏代码块内的复选框', () => {
    const text = [
      '- [ ] 真待办',
      '```md',
      '- [ ] 这是代码示例，不算',
      '- [x] 这也不算',
      '```',
      '- [x] 另一个真待办',
    ].join('\n');
    const r = parseTodoText(text);
    expect(r.total).toBe(2);
    expect(r.open).toBe(1);
    expect(r.done).toBe(1);
  });

  it('统计嵌套缩进的子待办', () => {
    const r = parseTodoText('- [ ] 父任务\n    - [x] 子任务1\n    - [ ] 子任务2');
    expect(r.total).toBe(3);
    expect(r.done).toBe(1);
    expect(r.open).toBe(2);
  });

  it('文件不存在返回空结果', () => {
    expect(parseTodoFile('/nonexistent/path/todo.md').total).toBe(0);
  });
});

// 对一份贴近真实排版的样例做整体解析，覆盖多语法混排时的相互影响
describe('真实排版的 todo.md', () => {
  const sample = join(__dirname, 'fixtures/sample-todo.md');

  it('混排语法下计数正确', () => {
    const r = parseTodoFile(sample);
    expect(r).toMatchObject({ open: 3, doing: 1, done: 2, total: 6 });
    expect(r.open + r.doing + r.done).toBe(r.total);
  });

  it('围栏代码块内的复选框不计入', () => {
    const r = parseTodoFile(sample);
    expect(r.items.some((i) => i.text.includes('文档里演示用的复选框'))).toBe(false);
  });

  it('条目归属到最近的段落标题（含缩进子项）', () => {
    const { items } = parseTodoFile(sample);
    expect(items.find((i) => i.text.startsWith('重构扫描器'))?.section).toBe('进行中');
    expect(items.find((i) => i.text.startsWith('子项'))?.section).toBe('已完成');
    expect(items.find((i) => i.text.startsWith('星号列表'))?.section).toBe('备注');
  });
});
