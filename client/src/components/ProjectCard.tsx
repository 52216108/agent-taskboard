import { App as AntApp, Tooltip } from 'antd';
import {
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
  return (
    <div className="pbar">
      {cols.map((s) => (
        <Tooltip key={s} title={`${TASK_STATUS_META[s].label} ${managed[s]}`}>
          <span
            style={{ flex: managed[s], background: `var(--st-${s}-fg)` }}
            aria-label={`${TASK_STATUS_META[s].label} ${managed[s]}`}
          />
        </Tooltip>
      ))}
    </div>
  );
}

export default function ProjectCard({
  project,
  onClick,
  onChange,
}: {
  project: ProjectInfo;
  onClick: () => void;
  onChange: () => void;
}) {
  const { message } = AntApp.useApp();
  const g = project.git;
  const t = project.todos;
  const active = activeManaged(project.managed);

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
        {project.missing && <span className="chip chip-warn">目录已消失</span>}
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

      {project.techStack.length > 0 && (
        <div className="pcard-tags">
          {project.techStack.slice(0, 5).map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
      )}

      <StatusBar managed={project.managed} />

      <div className="pcard-foot">
        {!project.missing &&
          (g.isRepo ? (
            <Tooltip title={g.nested ? 'git 仓库在子目录' : 'git 分支'}>
              <span className="tcard-meta" style={g.nested ? { color: 'var(--st-review-fg)' } : undefined}>
                <BranchesOutlined />
                {g.branch ?? 'detached'}
              </span>
            </Tooltip>
          ) : (
            <span className="tcard-meta">无 git</span>
          ))}
        {g.dirtyCount > 0 && (
          <Tooltip title="未提交改动">
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
        <Tooltip title="看板活跃受管任务（待开发+进行中+待验收）">
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
