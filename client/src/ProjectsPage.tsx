import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select, Spin } from 'antd';
import { useBoard } from './BoardContext';
import { activeManaged, projectHref } from './util';
import type { ProjectInfo } from './types';
import ProjectCard from './components/ProjectCard';

type SortKey = 'active' | 'priority' | 'todos' | 'name';
const PRIORITY_RANK: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'active', label: '按最近活跃' },
  { value: 'priority', label: '按优先级' },
  { value: 'todos', label: '按待办数' },
  { value: 'name', label: '按名称' },
];

/** 项目概览：顶层项目的卡片网格（工作区一张卡，子仓以芯片挂在卡上）。任务在项目页看板 / 全局任务页看。 */
export default function ProjectsPage() {
  const { projects, loading, search, reload } = useBoard();
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortKey>('active');
  const [showArchived, setShowArchived] = useState(false);

  const childrenOf = useMemo(() => {
    const map = new Map<string, ProjectInfo[]>();
    for (const p of projects) {
      if (!p.parent) continue;
      const list = map.get(p.parent) ?? [];
      list.push(p);
      map.set(p.parent, list);
    }
    return (name: string) => map.get(name) ?? [];
  }, [projects]);

  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hit = (p: ProjectInfo) =>
      p.name.toLowerCase().includes(q) ||
      p.displayName.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q) ||
      p.techStack.some((t) => t.toLowerCase().includes(q));
    let list = projects.filter((p) => !p.parent); // 子仓不单独出卡，挂在工作区卡上
    if (!showArchived) list = list.filter((p) => !p.archived);
    if (q) list = list.filter((p) => hit(p) || childrenOf(p.name).some(hit)); // 搜到子仓也显示其工作区
    // 活跃工作量＝文件待办 + 受管的(待开发+进行中+待验收)；待规划是点子堆、已完成不计。工作区把子仓的也算上
    const actionable = (p: ProjectInfo) =>
      p.todos.open + activeManaged(p.managed) + childrenOf(p.name).reduce((n, c) => n + activeManaged(c.managed), 0);
    const rank = (p: ProjectInfo) => (p.topPriority ? PRIORITY_RANK[p.topPriority] : 9);
    const byKey =
      sort === 'active'
        ? (a: ProjectInfo, b: ProjectInfo) => (b.lastActive ?? '').localeCompare(a.lastActive ?? '')
        : sort === 'priority'
          ? (a: ProjectInfo, b: ProjectInfo) =>
              rank(a) - rank(b) || (b.lastActive ?? '').localeCompare(a.lastActive ?? '')
          : sort === 'todos'
            ? (a: ProjectInfo, b: ProjectInfo) => actionable(b) - actionable(a)
            : (a: ProjectInfo, b: ProjectInfo) => a.name.localeCompare(b.name);
    // 置顶恒前，其次按所选维度
    return [...list].sort((a, b) => (a.pinned === b.pinned ? byKey(a, b) : a.pinned ? -1 : 1));
  }, [projects, search, sort, showArchived, childrenOf]);

  const archivedCount = projects.filter((p) => p.archived && !p.parent).length;

  return (
    <>
      <div className="toolbar">
        <Select<SortKey>
          value={sort}
          onChange={setSort}
          size="small"
          style={{ width: 130 }}
          options={SORTS}
        />
        <button
          className={`btn${showArchived ? ' btn-solid' : ''}`}
          onClick={() => setShowArchived((v) => !v)}
          disabled={archivedCount === 0 && !showArchived}
        >
          含归档{archivedCount > 0 ? ` ${archivedCount}` : ''}
        </button>
        <span className="toolbar-spacer" />
        <span className="toolbar-count">{view.length} 个项目</span>
      </div>

      {loading && projects.length === 0 ? (
        <div className="empty">
          <Spin />
        </div>
      ) : view.length === 0 ? (
        <div className="empty">{search ? '无匹配项目' : '未发现项目'}</div>
      ) : (
        <div className="pgrid">
          {view.map((p) => (
            <ProjectCard
              key={p.key}
              project={p}
              children={childrenOf(p.name)}
              onClick={() => navigate(projectHref(p.name))}
              onOpen={(name) => navigate(projectHref(name))}
              onChange={reload}
            />
          ))}
        </div>
      )}
    </>
  );
}
