import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, App as AntApp, Button, Input, Spin, Tooltip, Typography } from 'antd';
import {
  EditOutlined,
  ImportOutlined,
  InboxOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
} from '@ant-design/icons';
import type { ProjectDetail, TaskStatus, TodoItem } from './types';
import { fetchProjectDetail, patchProject, importTodos } from './api';
import { activeManaged, projectHref, relativeTime } from './util';
import { useBoard } from './BoardContext';
import TaskBoard, { type BoardTask } from './components/TaskBoard';
import TaskCreateModal from './components/TaskCreateModal';

type Tab = 'tasks' | 'todomd' | 'meta';
/** 可作为新建目标的列：排除归档（软删）和已完成（只能人工验收进入） */
type BoardStatus = Exclude<TaskStatus, 'archived' | 'done'>;
/** 工作区看板的仓筛选：全部 / 只看工作区自己的（跨仓）任务 / 某个子仓（存其 name） */
type RepoFilter = 'all' | 'self' | string;

const TODO_MARK: Record<TodoItem['status'], string> = { open: '○', doing: '◐', done: '●' };

export default function ProjectPage() {
  // 路由是 /p/*（子仓名带斜杠），通配段在 params['*']
  const { '*': name = '' } = useParams();
  const { message } = AntApp.useApp();
  const { projects, reload: reloadProjects, revision } = useBoard();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('tasks');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [repoFilter, setRepoFilter] = useState<RepoFilter>('all');
  // null=关闭；undefined=开着但不指定列（工具条按钮）；具体状态=从该列的「＋」开的
  const [createIn, setCreateIn] = useState<BoardStatus | null | undefined>(null);

  // 写操作后只发广播：BoardContext 重拉项目列表并把 revision +1，下面的 effect 收到后重拉详情。
  // 不在这里直接 fetch 详情，否则一次编辑会打两遍 detail 接口。
  const reload = useCallback(() => reloadProjects(), [reloadProjects]);

  // 切项目时先清空，避免旧项目的看板残留一帧
  useEffect(() => {
    setLoading(true);
    setData(null);
    setEditing(false);
    setTab('tasks');
    setRepoFilter('all');
  }, [name]);

  // 切项目 或 任何写操作（含侧边栏「新建任务」建到本项目）都重拉详情。
  // 刷新失败不清空已有数据（否则页面突变 Empty），提示即可。
  useEffect(() => {
    let alive = true;
    fetchProjectDetail(name)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) message.error(String(e.message ?? e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [name, revision, message]);

  const isWorkspace = data?.kind === 'workspace';
  const children = useMemo(() => data?.children ?? [], [data]);

  // 工作区看板：外壳自己的（跨仓）任务 + 各子仓任务合在一块，卡片带仓标签；可按仓筛选。
  // 子仓/顶层仓：就是自己的任务。
  const boardTasks = useMemo<BoardTask[]>(() => {
    if (!data) return [];
    if (!isWorkspace) return data.tasks;
    const own: Array<BoardTask & { of: string }> = data.tasks.map((t) => ({ ...t, projectLabel: '工作区', of: 'self' }));
    const kids = children.flatMap((c) => c.tasks.map((t) => ({ ...t, projectLabel: c.displayName, of: c.name })));
    const all = [...own, ...kids];
    return repoFilter === 'all' ? all : all.filter((t) => t.of === repoFilter);
  }, [data, isWorkspace, children, repoFilter]);

  // 工作区页的新建弹窗：让用户选落到工作区还是某个子仓；正筛着某个子仓时默认就是它
  const family = useMemo(() => {
    if (!data || !isWorkspace) return undefined;
    const names = new Set([data.name, ...children.map((c) => c.name)]);
    return projects.filter((p) => names.has(p.name));
  }, [data, isWorkspace, children, projects]);
  const createTarget = isWorkspace && repoFilter !== 'all' && repoFilter !== 'self' ? repoFilter : name;

  const startEdit = () => {
    if (!data) return;
    setEditName(data.displayName);
    setEditDesc(data.description ?? '');
    setEditing(true);
  };
  const saveEdit = () => {
    patchProject(name, { displayName: editName.trim() || null, description: editDesc.trim() || null })
      .then(() => {
        reload();
        setEditing(false);
      })
      .catch((e) => message.error(String(e.message ?? e)));
  };

  const toggle = (patch: { pinned?: boolean; archived?: boolean }) =>
    patchProject(name, patch)
      .then(reload)
      .catch((e) => message.error(String(e.message ?? e)));

  const doImport = () => {
    importTodos(name)
      .then((r) => {
        message.success(`导入 ${r.imported} 条，跳过 ${r.skipped} 条（已存在）`);
        reload();
      })
      .catch((e) => message.error(String(e.message ?? e)));
  };

  if (!data) {
    return loading ? (
      <div className="empty">
        <Spin />
      </div>
    ) : (
      <div className="empty">项目不存在或加载失败</div>
    );
  }

  const active = isWorkspace
    ? activeManaged(data.managed) + children.reduce((n, c) => n + activeManaged(countBy(c.tasks)), 0)
    : activeManaged(data.managed);
  const grouped: Record<string, TodoItem[]> = {};
  data.todoItems.forEach((it) => {
    const key = it.section ?? '（无段落）';
    (grouped[key] ??= []).push(it);
  });

  const TABS: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: 'tasks', label: '任务', badge: active },
    { key: 'todomd', label: 'todo.md', badge: data.todos.open },
    { key: 'meta', label: '资料' },
  ];

  const totalTasks = isWorkspace ? data.tasks.length + children.reduce((n, c) => n + c.tasks.length, 0) : data.tasks.length;

  return (
    <>
      <div className="toolbar">
        <div className="seg">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'is-active' : undefined}
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.badge != null && t.badge > 0 ? ` ${t.badge}` : ''}
            </button>
          ))}
        </div>

        <span className="toolbar-spacer" />

        <span className="toolbar-count">{totalTasks} 任务</span>
        <Tooltip title={data.pinned ? '取消置顶' : '置顶'}>
          <button
            className="btn btn-ghost btn-icon"
            style={data.pinned ? { color: 'var(--accent)' } : undefined}
            aria-pressed={data.pinned}
            onClick={() => toggle({ pinned: !data.pinned })}
            aria-label="置顶"
          >
            {data.pinned ? <PushpinFilled /> : <PushpinOutlined />}
          </button>
        </Tooltip>
        <Tooltip title={data.archived ? '取消归档' : '归档'}>
          <button
            className="btn btn-ghost btn-icon"
            style={data.archived ? { color: 'var(--warn)' } : undefined}
            aria-pressed={data.archived}
            onClick={() => toggle({ archived: !data.archived })}
            aria-label="归档"
          >
            <InboxOutlined />
          </button>
        </Tooltip>
        <Tooltip title="编辑名称 / 简介">
          <button className="btn btn-ghost btn-icon" onClick={startEdit} aria-label="编辑">
            <EditOutlined />
          </button>
        </Tooltip>
        <button className="btn btn-solid" onClick={() => setCreateIn(undefined)}>
          <PlusOutlined />
          新建任务
        </button>
      </div>

      {/* 工作区看板的仓筛选：全部 / 工作区自己的跨仓任务 / 各子仓 */}
      {isWorkspace && tab === 'tasks' && (
        <div className="toolbar">
          <div className="seg">
            {(
              [
                { key: 'all', label: '全部' },
                { key: 'self', label: '工作区（跨仓）', n: data.tasks.length },
                ...children.map((c) => ({ key: c.name, label: c.displayName, n: c.tasks.length })),
              ] as Array<{ key: RepoFilter; label: string; n?: number }>
            ).map((f) => (
              <button
                key={f.key}
                className={repoFilter === f.key ? 'is-active' : undefined}
                aria-pressed={repoFilter === f.key}
                onClick={() => setRepoFilter(f.key)}
              >
                {f.label}
                {f.n != null && f.n > 0 ? ` ${f.n}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {(data.missing || data.error || editing) && (
        <div className="section" style={{ paddingBottom: 0 }}>
          {data.stale ? (
            <Alert
              type="warning"
              showIcon
              message="这是一条身份键已变更的旧项目行（目录还在）"
              description={`remote 迁移或多仓外壳的身份变更会留下这种行。下方任务仍保留；在终端用「board merge ${data.name.slice(1)} <现役项目名>」把它们并入现役项目（合并前自动备份）。`}
              style={{ marginBottom: 12 }}
            />
          ) : (
            data.missing && (
              <Alert
                type="warning"
                showIcon
                message="该项目目录已不在扫描范围（移动/删除）"
                description="下方受管任务仍保留，可在原目录恢复后自动重新关联；也可用「board merge」并入别的项目。"
                style={{ marginBottom: 12 }}
              />
            )
          )}
          {data.error && <Alert type="error" message={data.error} style={{ marginBottom: 12 }} />}
          {editing && (
            <div
              style={{
                padding: 12,
                background: 'var(--bg-sunken)',
                borderRadius: 'var(--radius)',
              }}
            >
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="展示名（留空=用扫描值）"
                style={{ marginBottom: 8 }}
              />
              <Input.TextArea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="简介（留空=用扫描值）"
                rows={2}
                style={{ marginBottom: 8 }}
              />
              <Button type="primary" size="small" onClick={saveEdit} style={{ marginRight: 8 }}>
                保存
              </Button>
              <Button size="small" onClick={() => setEditing(false)}>
                取消
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === 'tasks' && <TaskBoard tasks={boardTasks} onChange={reload} onCreate={setCreateIn} />}

      {tab === 'todomd' && (
        <div className="section">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <span className="hint">
              只读 · 来自 tasks/todo.md（{data.todos.open} 未完成 / {data.todos.total} 总）。文件原始清单，非看板受管任务。
            </span>
            {data.todoItems.some((t) => t.status !== 'done') && (
              <button className="btn" onClick={doImport}>
                <ImportOutlined />
                导入未完成项为任务
              </button>
            )}
          </div>
          {data.todoItems.length === 0 ? (
            <div className="empty">无 tasks/todo.md</div>
          ) : (
            Object.entries(grouped).map(([section, items]) => (
              <div key={section} style={{ marginBottom: 18 }}>
                <h3 className="section-title">{section}</h3>
                {items.map((it, i) => (
                  <div key={`${section}-${i}`} className="todo-row">
                    <span className="todo-mark" data-status={it.status}>
                      {TODO_MARK[it.status]}
                    </span>
                    <span className={it.status === 'done' ? 'todo-done' : undefined}>{it.text}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'meta' && (
        <div className="section">
          <dl className="meta">
            {!data.missing && (
              <>
                <dt>路径</dt>
                <dd>
                  {/* 保留可复制：拿去 cd 过去是这行最常见的用途 */}
                  <Typography.Text copyable style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                    {data.path}
                  </Typography.Text>
                </dd>
              </>
            )}
            {isWorkspace && (
              <>
                <dt>子仓</dt>
                <dd className="pcard-subs" style={{ marginTop: 0 }}>
                  {children.length === 0 && <span className="hint">无</span>}
                  {children.map((c) => (
                    <Link key={c.name} to={projectHref(c.name)} className="chip chip-repo">
                      {c.displayName}
                    </Link>
                  ))}
                </dd>
              </>
            )}
            {data.parent && (
              <>
                <dt>工作区</dt>
                <dd>
                  <Link to={projectHref(data.parent)} className="chip chip-repo">
                    {data.workspace?.displayName ?? data.parent}
                  </Link>
                </dd>
              </>
            )}
            {data.git.isRepo && (
              <>
                <dt>分支</dt>
                <dd>
                  <span className="chip">{data.git.branch ?? 'detached'}</span>
                  {data.git.dirtyCount > 0 && (
                    <span className="chip chip-warn" style={{ marginLeft: 6 }}>
                      {data.git.dirtyCount} 改动
                    </span>
                  )}
                </dd>
              </>
            )}
            {data.git.remote && (
              <>
                <dt>remote</dt>
                <dd style={{ fontFamily: 'var(--mono)' }}>{data.git.remote}</dd>
              </>
            )}
            <dt>最近活跃</dt>
            <dd>
              {relativeTime(data.lastActive)}
              {data.git.lastCommit && <span className="hint"> · {data.git.lastCommit.slice(0, 10)}</span>}
            </dd>
            <dt>文档</dt>
            <dd style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['directory', 'schema', 'api'] as const).map((k) => (
                <span key={k} className="chip" style={{ opacity: data.docs[k] ? 1 : 0.4 }}>
                  {k.toUpperCase()}.md
                </span>
              ))}
            </dd>
            {data.techStack.length > 0 && (
              <>
                <dt>技术栈</dt>
                <dd style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {data.techStack.map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                </dd>
              </>
            )}
            {data.description && (
              <>
                <dt>简介</dt>
                <dd>{data.description}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {/* 工作区页传 family：弹窗里可选落到工作区（跨仓任务）还是某个子仓 */}
      <TaskCreateModal
        projectName={createTarget}
        projects={family}
        targetStatus={createIn ?? undefined}
        open={createIn !== null}
        onClose={() => setCreateIn(null)}
        onCreated={reload}
      />
    </>
  );
}

/** 从任务列表现算六列计数（子仓详情只带任务、不带 managed 汇总）。 */
function countBy(tasks: Array<{ status: TaskStatus }>): { todo: number; doing: number; review: number } {
  const c = { todo: 0, doing: 0, review: 0 };
  for (const t of tasks) if (t.status === 'todo' || t.status === 'doing' || t.status === 'review') c[t.status]++;
  return c;
}
