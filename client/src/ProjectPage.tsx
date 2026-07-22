import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Layout,
  Descriptions,
  Tag,
  Typography,
  Spin,
  Empty,
  List,
  Space,
  theme,
  Alert,
  Button,
  Input,
  Tooltip,
  Tabs,
  App as AntApp,
} from 'antd';
import {
  ArrowLeftOutlined,
  BranchesOutlined,
  CheckCircleTwoTone,
  ClockCircleTwoTone,
  BorderOutlined,
  EditOutlined,
  PushpinOutlined,
  PushpinFilled,
  InboxOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import type { ProjectDetail, TodoItem } from './types';
import { fetchProjectDetail, patchProject, importTodos } from './api';
import { relativeTime } from './util';
import TaskBoard from './components/TaskBoard';

const { Header, Content } = Layout;
const { Paragraph, Text, Title } = Typography;

function TodoIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'done') return <CheckCircleTwoTone twoToneColor="#52c41a" />;
  if (status === 'doing') return <ClockCircleTwoTone twoToneColor="#faad14" />;
  return <BorderOutlined />;
}

export default function ProjectPage() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { message } = AntApp.useApp();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const reload = useCallback(() => {
    // 刷新失败不要清空已有数据（否则页面突变 Empty），提示即可
    fetchProjectDetail(name)
      .then(setData)
      .catch((e) => message.error(String(e.message ?? e)));
  }, [name, message]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setEditing(false);
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

  const doImport = () => {
    importTodos(name)
      .then((r) => {
        message.success(`导入 ${r.imported} 条，跳过 ${r.skipped} 条（已存在）`);
        reload();
      })
      .catch((e) => message.error(String(e.message ?? e)));
  };

  const grouped: Record<string, TodoItem[]> = {};
  data?.todoItems.forEach((it) => {
    const key = it.section ?? '（无段落）';
    (grouped[key] ??= []).push(it);
  });

  const meta = data && (
    <>
      {!data.missing && (
        <Descriptions column={1} size="small" styles={{ label: { width: 96 } }}>
          <Descriptions.Item label="路径">
            <Text copyable style={{ fontSize: 12 }}>
              {data.path}
            </Text>
          </Descriptions.Item>
          {data.git.isRepo && (
            <Descriptions.Item label="分支">
              <Tag icon={<BranchesOutlined />} color={data.git.nested ? 'purple' : 'default'}>
                {data.git.branch}
              </Tag>
              {data.git.dirtyCount > 0 && <Tag color="orange">{data.git.dirtyCount} 改动</Tag>}
              {data.git.nested && <Text type="secondary">（git 在子目录）</Text>}
            </Descriptions.Item>
          )}
          {data.git.remote && (
            <Descriptions.Item label="remote">
              <Text style={{ fontSize: 12 }}>{data.git.remote}</Text>
            </Descriptions.Item>
          )}
          <Descriptions.Item label="最近活跃">
            {relativeTime(data.lastActive)}
            {data.git.lastCommit && <Text type="secondary"> · {data.git.lastCommit.slice(0, 10)}</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="文档">
            <Space>
              {(['directory', 'schema', 'api'] as const).map((k) => (
                <Tag key={k} color={data.docs[k] ? 'blue' : undefined} style={{ opacity: data.docs[k] ? 1 : 0.45 }}>
                  {k.toUpperCase()}.md
                </Tag>
              ))}
            </Space>
          </Descriptions.Item>
        </Descriptions>
      )}
      {data.techStack.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {data.techStack.map((t) => (
            <Tag key={t} style={{ marginBottom: 4 }}>
              {t}
            </Tag>
          ))}
        </div>
      )}
      {data.description && (
        <Paragraph style={{ marginTop: 12, color: token.colorTextSecondary }}>{data.description}</Paragraph>
      )}
    </>
  );

  const todoTab = data && (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          只读 · 来自 tasks/todo.md（{data.todos.open} 未完成 / {data.todos.total} 总）。文件原始清单，非看板受管任务。
        </Text>
        {data.todoItems.some((t) => t.status !== 'done') && (
          <Button size="small" icon={<ImportOutlined />} onClick={doImport}>
            导入未完成项为任务
          </Button>
        )}
      </Space>
      {data.todoItems.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无 tasks/todo.md" />
      ) : (
        Object.entries(grouped).map(([section, items]) => (
          <div key={section} style={{ marginBottom: 16 }}>
            <Title level={5} style={{ marginBottom: 8 }}>
              {section}
            </Title>
            <List
              size="small"
              dataSource={items}
              renderItem={(it) => (
                <List.Item>
                  <Space align="start">
                    <TodoIcon status={it.status} />
                    <Text delete={it.status === 'done'} type={it.status === 'done' ? 'secondary' : undefined}>
                      {it.text}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          </div>
        ))
      )}
    </>
  );

  return (
    <Layout style={{ minHeight: '100vh', background: token.colorBgLayout }}>
      <Header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          paddingInline: 16,
        }}
      >
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
          返回
        </Button>
        <Title level={4} style={{ margin: 0, flex: 1, minWidth: 0 }} ellipsis>
          {data?.displayName ?? name}
        </Title>
        {data && (
          <Space>
            <Tooltip title={data.pinned ? '取消置顶' : '置顶'}>
              <Button
                icon={data.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                onClick={() =>
                  patchProject(name, { pinned: !data.pinned }).then(reload).catch((e) => message.error(String(e.message ?? e)))
                }
              />
            </Tooltip>
            <Tooltip title={data.archived ? '取消归档' : '归档'}>
              <Button
                icon={<InboxOutlined />}
                type={data.archived ? 'primary' : 'default'}
                onClick={() =>
                  patchProject(name, { archived: !data.archived }).then(reload).catch((e) => message.error(String(e.message ?? e)))
                }
              />
            </Tooltip>
            <Tooltip title="编辑名称/简介">
              <Button icon={<EditOutlined />} onClick={startEdit} />
            </Tooltip>
          </Space>
        )}
      </Header>

      <Content style={{ padding: 24 }}>
        {/* 全宽铺满（与首页看板一致）：六列看板需要横向空间，不再限宽居中 */}
        <div>
          <Spin spinning={loading}>
            {!data && !loading ? (
              <Empty description="项目不存在或加载失败" />
            ) : data ? (
              <>
                {data.missing && (
                  <Alert
                    type="warning"
                    showIcon
                    message="该项目目录已不在扫描范围（移动/删除）"
                    description="下方受管任务仍保留，可在原目录恢复后自动重新关联。"
                    style={{ marginBottom: 16 }}
                  />
                )}
                {data.error && <Alert type="error" message={data.error} style={{ marginBottom: 16 }} />}
                {editing && (
                  <div
                    style={{
                      marginBottom: 16,
                      padding: 12,
                      background: token.colorFillQuaternary,
                      borderRadius: token.borderRadius,
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
                    <Space>
                      <Button type="primary" size="small" onClick={saveEdit}>
                        保存
                      </Button>
                      <Button size="small" onClick={() => setEditing(false)}>
                        取消
                      </Button>
                    </Space>
                  </div>
                )}

                <Tabs
                  defaultActiveKey="tasks"
                  items={[
                    {
                      key: 'tasks',
                      label: (() => {
                        // 徽标＝活跃受管任务数（待开发+进行中+待验收），不含已收集/待规划/已完成
                        const active = data.managed.todo + data.managed.doing + data.managed.review;
                        return `任务${active > 0 ? ` ${active}` : ''}`;
                      })(),
                      children: (
                        <TaskBoard
                          projectName={name}
                          tasks={data.tasks}
                          onChange={reload}
                        />
                      ),
                    },
                    {
                      key: 'todomd',
                      label: `todo.md${data.todos.open > 0 ? ` ${data.todos.open}` : ''}`,
                      children: todoTab,
                    },
                    { key: 'meta', label: '资料', children: meta },
                  ]}
                />
              </>
            ) : null}
          </Spin>
        </div>
      </Content>
    </Layout>
  );
}
