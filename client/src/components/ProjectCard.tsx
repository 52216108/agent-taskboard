import { App as AntApp, Tooltip } from 'antd';
import {
  ApartmentOutlined,
  BranchesOutlined,
  ClockCircleOutlined,
  FileExclamationOutlined,
  FileTextOutlined,
  ProfileOutlined,
  PushpinFilled,
  PushpinOutlined,
} from '@ant-design/icons';
import type { ProjectInfo } from '../types';
import { activeManaged, activityLevel, relativeTime, BOARD_STATUSES, TASK_STATUS_META } from '../util';
import { patchProject } from '../api';
import { PriorityIcon } from './StatusIcon';

/** 六列任务数的横向占比条：不看数字也能看出这个项目是"堆着没做"还是"做完了"。无受管任务则不画。 */
function StatusBar({ managed }: { managed: ProjectInfo['managed'] }) {
  const cols = BOARD_STATUSES.filter((s) => managed[s] > 0);
  if (cols.length === 0) return null;
  // aria 放容器上（role=img + 整句摘要）：分段是纯装饰，给每个裸 span 挂 aria-label 读屏多半会忽略
  return (
    <div
      className="pbar"
      role="img"
      aria-label={`任务分布：${cols.map((s) => `${TASK_STATUS_META[s].label} ${managed[s]}`).join('，')}`}
    >
      {cols.map((s) => (
        <Tooltip key={s} title={`${TASK_STATUS_META[s].label} ${managed[s]}`}>
          <span aria-hidden style={{ flex: managed[s], background: `var(--st-${s}-fg)` }} />
        </Tooltip>
      ))}
    </div>
  );
}

/** 工作区卡片上的任务分布：外壳自己的 + 各子仓的合在一起看，否则外壳那条常常是空的、看不出整体进度。 */
function sumManaged(items: ProjectInfo[]): ProjectInfo['managed'] {
  const sum = { collected: 0, backlog: 0, todo: 0, doing: 0, review: 0, done: 0 };
  for (const p of items) for (const s of BOARD_STATUSES) sum[s] += p.managed[s];
  return sum;
}

export default function ProjectCard({
  project,
  children = [],
  onClick,
  onOpen,
  onChange,
}: {
  project: ProjectInfo;
  /** 工作区的子仓（顶层 repo 项目为空） */
  children?: ProjectInfo[];
  onClick: () => void;
  /** 点子仓芯片：打开该子仓的项目页 */
  onOpen?: (name: string) => void;
  onChange: () => void;
}) {
  const { message } = AntApp.useApp();
  const g = project.git;
  const t = project.todos;
  const isWorkspace = project.kind === 'workspace';
  const managed = isWorkspace ? sumManaged([project, ...children]) : project.managed;
  const active = activeManaged(managed);

  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    patchProject(project.name, { pinned: !project.pinned })
      .then(onChange)
      .catch((err) => message.error(String(err.message ?? err)));
  };

  return (
    <article
      className={`pcard${project.pinned ? ' is-pinned' : ''}${project.archived ? ' is-archived' : ''}`}
      onClick={onClick}
    >
      <div className="pcard-top">
        <span className="pcard-name">{project.displayName}</span>
        {project.displayName !== project.name && <span className="pcard-dir">{project.name}/</span>}
        {isWorkspace && (
          <Tooltip title="多仓外壳：自身无 git，下面的子仓各自是一个项目">
            <span className="chip chip-repo">工作区</span>
          </Tooltip>
        )}
        {project.stale ? (
          <Tooltip title="目录还在，但这行的身份键已对不上（remote 迁移/外壳身份变更留下的旧行）。任务仍保留，用 CLI「board merge <本行 id> <现役项目名>」并入现役项目">
            <span className="chip chip-warn">旧身份行</span>
          </Tooltip>
        ) : (
          project.missing && <span className="chip chip-warn">目录已消失</span>
        )}
        {project.archived && <span className="chip">已归档</span>}
        {(project.topPriority === 'p0' || project.topPriority === 'p1') && (
          <Tooltip title="项目内最高任务优先级">
            <span
              className="chip chip-pri"
              style={{ ['--chip-c' as string]: `var(--pri-${project.topPriority})` }}
            >
              <PriorityIcon priority={project.topPriority} />
              {project.topPriority.toUpperCase()}
            </span>
          </Tooltip>
        )}
        {project.error && (
          <Tooltip title={project.error}>
            <FileExclamationOutlined style={{ color: 'var(--danger)' }} />
          </Tooltip>
        )}
        <Tooltip title={project.pinned ? '取消置顶' : '置顶'}>
          <button
            className={`pcard-pin${project.pinned ? ' is-on' : ''}`}
            onClick={togglePin}
            aria-label={project.pinned ? '取消置顶' : '置顶'}
          >
            {project.pinned ? <PushpinFilled /> : <PushpinOutlined />}
          </button>
        </Tooltip>
      </div>

      <div className="pcard-desc">{project.description || '暂无简介'}</div>

      {children.length > 0 && (
        <div className="pcard-subs">
          {children.map((c) => {
            const n = activeManaged(c.managed);
            return (
              <Tooltip key={c.key} title={`${c.path}${n > 0 ? ` · 活跃任务 ${n}` : ''}`}>
                <button
                  type="button"
                  className="chip chip-repo"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen?.(c.name);
                  }}
                >
                  {c.displayName}
                  {n > 0 && <span style={{ opacity: 0.7 }}>{n}</span>}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}

      {project.techStack.length > 0 && (
        <div className="pcard-tags">
          {project.techStack.slice(0, 5).map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
      )}

      <StatusBar managed={managed} />

      <div className="pcard-foot">
        {!project.missing &&
          (isWorkspace ? (
            <Tooltip title="工作区里的 git 子仓数">
              <span className="tcard-meta">
                <ApartmentOutlined />
                {children.length} 个子仓
              </span>
            </Tooltip>
          ) : g.isRepo ? (
            <Tooltip title="git 分支">
              <span className="tcard-meta">
                <BranchesOutlined />
                {g.branch ?? 'detached'}
              </span>
            </Tooltip>
          ) : (
            <span className="tcard-meta">无 git</span>
          ))}
        {g.dirtyCount > 0 && (
          <Tooltip title={isWorkspace ? '各子仓未提交改动合计' : '未提交改动'}>
            <span className="tcard-meta" style={{ color: 'var(--warn)' }}>
              {g.dirtyCount} 改动
            </span>
          </Tooltip>
        )}

        <span className="toolbar-spacer" />

        <Tooltip title="tasks/todo.md 文件里的未完成项（只读来源）">
          <span className="tcard-meta">
            <FileTextOutlined />
            {t.total > 0 ? t.open : '—'}
          </span>
        </Tooltip>
        <Tooltip title={`看板活跃受管任务（待开发+进行中+待验收）${isWorkspace ? '，含各子仓' : ''}`}>
          <span className="tcard-meta" style={active > 0 ? { color: 'var(--text-2)' } : undefined}>
            <ProfileOutlined />
            {active > 0 ? active : '—'}
          </span>
        </Tooltip>
        {project.overdue > 0 && (
          <Tooltip title="已逾期任务">
            <span className="tcard-meta is-overdue">逾期 {project.overdue}</span>
          </Tooltip>
        )}
        {!project.missing && (
          <Tooltip title={g.lastCommit ?? project.lastActive ?? ''}>
            <span className="tcard-meta">
              <ClockCircleOutlined />
              <span className="dot" data-level={activityLevel(project.lastActive)} />
              {relativeTime(project.lastActive)}
            </span>
          </Tooltip>
        )}
      </div>
    </article>
  );
}
