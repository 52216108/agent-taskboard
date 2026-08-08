import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select, Spin } from 'antd';
import { useBoard } from './BoardContext';
import { activeManaged } from './util';
import ProjectCard from './components/ProjectCard';

type SortKey = 'active' | 'priority' | 'todos' | 'name';
const PRIORITY_RANK: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'active', label: '按最近活跃' },
  { value: 'priority', label: '按优先级' },
  { value: 'todos', label: '按待办数' },
  { value: 'name', label: '按名称' },
];

/** 项目概览：所有项目的卡片网格。任务在项目页看板 / 全局任务页看。 */
export default function ProjectsPage() {
  const { projects, loading, search, reload } = useBoard();
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortKey>('active');
  const [showArchived, setShowArchived] = useState(false);

  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = projects;
    if (!showArchived) list = list.filter((p) => !p.archived);
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.displayName.toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q) ||
          p.techStack.some((t) => t.toLowerCase().includes(q)),
      );
    }
    // 活跃工作量＝文件待办 + 受管的(待开发+进行中+待验收)；待规划是点子堆、已完成不计
    const actionable = (p: (typeof list)[number]) => p.todos.open + activeManaged(p.managed);
    const rank = (p: (typeof list)[number]) => (p.topPriority ? PRIORITY_RANK[p.topPriority] : 9);
    const byKey =
      sort === 'active'
        ? (a: (typeof list)[number], b: (typeof list)[number]) =>
            (b.lastActive ?? '').localeCompare(a.lastActive ?? '')
        : sort === 'priority'
          ? (a: (typeof list)[number], b: (typeof list)[number]) =>
              rank(a) - rank(b) || (b.lastActive ?? '').localeCompare(a.lastActive ?? '')
          : sort === 'todos'
            ? (a: (typeof list)[number], b: (typeof list)[number]) => actionable(b) - actionable(a)
            : (a: (typeof list)[number], b: (typeof list)[number]) => a.name.localeCompare(b.name);
    // 置顶恒前，其次按所选维度
    return [...list].sort((a, b) => (a.pinned === b.pinned ? byKey(a, b) : a.pinned ? -1 : 1));
  }, [projects, search, sort, showArchived]);

  const archivedCount = projects.filter((p) => p.archived).length;

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
              onClick={() => navigate(`/p/${encodeURIComponent(p.name)}`)}
              onChange={reload}
            />
          ))}
        </div>
      )}
    </>
  );
}
