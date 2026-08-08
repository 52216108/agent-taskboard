import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, App as AntApp, Button, Input, Spin, Tooltip } from 'antd';
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
import { activeManaged, relativeTime } from './util';
import { useBoard } from './BoardContext';
import TaskBoard from './components/TaskBoard';
import TaskCreateModal from './components/TaskCreateModal';

type Tab = 'tasks' | 'todomd' | 'meta';
type BoardStatus = Exclude<TaskStatus, 'archived'>;

const TODO_MARK: Record<TodoItem['status'], string> = { open: '○', doing: '◐', done: '●' };

export default function ProjectPage() {
  const { name = '' } = useParams();
  const { message } = AntApp.useApp();
  const { reload: reloadProjects } = useBoard();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('tasks');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  // null=关闭；undefined=开着但不指定列（工具条按钮）；具体状态=从该列的「＋」开的
  const [createIn, setCreateIn] = useState<BoardStatus | null | undefined>(null);

  const reload = useCallback(() => {
    // 刷新失败不要清空已有数据（否则页面突变 Empty），提示即可
    fetchProjectDetail(name)
      .then(setData)
      .catch((e) => message.error(String(e.message ?? e)));
    reloadProjects(); // 侧边栏的活跃任务计数跟着动
  }, [name, message, reloadProjects]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setEditing(false);
    setTab('tasks');
    fetchProjectDetail(name)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [name]);

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

  const active = activeManaged(data.managed);
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

  return (
    <>
      <div className="toolbar">
        <div className="seg">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'is-active' : undefined}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.badge != null && t.badge > 0 ? ` ${t.badge}` : ''}
            </button>
          ))}
        </div>

        <span className="toolbar-spacer" />

        <span className="toolbar-count">{data.tasks.length} 任务</span>
        <Tooltip title={data.pinned ? '取消置顶' : '置顶'}>
          <button
            className={`btn btn-ghost btn-icon${data.pinned ? ' is-on' : ''}`}
            style={data.pinned ? { color: 'var(--accent)' } : undefined}
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

      {(data.missing || data.error || editing) && (
        <div className="section" style={{ paddingBottom: 0 }}>
          {data.missing && (
            <Alert
              type="warning"
              showIcon
              message="该项目目录已不在扫描范围（移动/删除）"
              description="下方受管任务仍保留，可在原目录恢复后自动重新关联。"
              style={{ marginBottom: 12 }}
            />
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

      {tab === 'tasks' && <TaskBoard tasks={data.tasks} onChange={reload} onCreate={setCreateIn} />}

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
                <dd style={{ fontFamily: 'var(--mono)' }}>{data.path}</dd>
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
                  {data.git.nested && <span className="hint"> git 在子目录</span>}
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

      <TaskCreateModal
        projectName={name}
        targetStatus={createIn ?? undefined}
        open={createIn !== null}
        onClose={() => setCreateIn(null)}
        onCreated={reload}
      />
    </>
  );
}
