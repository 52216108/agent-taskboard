import { Card, Tag, Typography, Space, theme, Tooltip, Button, App as AntApp } from 'antd';
import {
  BranchesOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  FileTextOutlined,
  ProfileOutlined,
  FileExclamationOutlined,
  PushpinOutlined,
  PushpinFilled,
} from '@ant-design/icons';
import type { ProjectInfo } from '../types';
import { relativeTime, activityLevel } from '../util';
import { patchProject } from '../api';

const { Text, Paragraph } = Typography;

export default function ProjectCard({
  project,
  onClick,
  onChange,
}: {
  project: ProjectInfo;
  onClick: () => void;
  onChange: () => void;
}) {
  const { token } = theme.useToken();
  const { message } = AntApp.useApp();
  const g = project.git;
  const t = project.todos;
  // 活跃受管任务＝待开发+进行中+待验收（待规划是点子堆、已完成不计）
  const managedActive = project.managed.todo + project.managed.doing + project.managed.review;
  const dotColor = {
    fresh: token.colorSuccess,
    recent: token.colorInfo,
    stale: token.colorTextQuaternary,
  }[activityLevel(project.lastActive)];

  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    patchProject(project.name, { pinned: !project.pinned })
      .then(onChange)
      .catch((err) => message.error(String(err.message ?? err)));
  };

  return (
    <Card
      hoverable
      onClick={onClick}
      styles={{ body: { padding: 16 } }}
      style={{
        height: '100%',
        opacity: project.archived ? 0.6 : 1,
        borderColor: project.pinned ? token.colorPrimaryBorder : undefined,
      }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <Space align="center" style={{ marginBottom: 4 }} wrap>
          <Text strong style={{ fontSize: 16 }}>
            {project.displayName}
          </Text>
          {project.displayName !== project.name && (
            <Text style={{ color: token.colorTextTertiary, fontSize: 12 }}>{project.name}/</Text>
          )}
          {project.missing && (
            <Tag color="warning" bordered={false}>
              目录已消失
            </Tag>
          )}
          {project.archived && (
            <Tag bordered={false}>已归档</Tag>
          )}
          {(project.topPriority === 'p0' || project.topPriority === 'p1') && (
            <Tag color={project.topPriority === 'p0' ? 'red' : 'volcano'} style={{ marginInlineEnd: 0 }}>
              {project.topPriority.toUpperCase()}
            </Tag>
          )}
          {project.overdue > 0 && (
            <Tag color="red" style={{ marginInlineEnd: 0 }}>
              逾期 {project.overdue}
            </Tag>
          )}
          {project.error && (
            <Tooltip title={project.error}>
              <FileExclamationOutlined style={{ color: token.colorError }} />
            </Tooltip>
          )}
        </Space>
        <Tooltip title={project.pinned ? '取消置顶' : '置顶'}>
          <Button
            type="text"
            size="small"
            icon={
              project.pinned ? (
                <PushpinFilled style={{ color: token.colorPrimary }} />
              ) : (
                <PushpinOutlined style={{ color: token.colorTextTertiary }} />
              )
            }
            onClick={togglePin}
          />
        </Tooltip>
      </div>

      {/* 简介 */}
      <Paragraph
        type="secondary"
        ellipsis={{ rows: 2 }}
        style={{ marginBottom: 10, minHeight: 40, fontSize: 13 }}
      >
        {project.description || '暂无简介'}
      </Paragraph>

      {/* 技术栈 */}
      {project.techStack.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {project.techStack.slice(0, 5).map((tag) => (
            <Tag key={tag} style={{ marginBottom: 4 }}>
              {tag}
            </Tag>
          ))}
        </div>
      )}

      {/* git 行 */}
      {!project.missing && (
        <Space size={[8, 4]} wrap style={{ marginBottom: 8 }}>
          {g.isRepo ? (
            <Tooltip title={g.nested ? 'git 仓库在子目录' : undefined}>
              <Tag icon={<BranchesOutlined />} color={g.nested ? 'purple' : 'default'}>
                {g.branch ?? 'detached'}
              </Tag>
            </Tooltip>
          ) : (
            <Tag>无 git</Tag>
          )}
          {g.dirtyCount > 0 && (
            <Tag icon={<WarningOutlined />} color="orange">
              {g.dirtyCount} 改动
            </Tag>
          )}
        </Space>
      )}

      {/* 底部：待办（file + managed）+ 活跃时间 */}
      <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
        <Space size={10}>
          <Tooltip title="tasks/todo.md 文件里的未完成项（只读来源）">
            <Space size={3}>
              <FileTextOutlined style={{ color: token.colorTextTertiary, fontSize: 12 }} />
              <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>
                todo.md {t.total > 0 ? t.open : '—'}
              </Text>
            </Space>
          </Tooltip>
          <Tooltip title="看板活跃受管任务（待开发+进行中+待验收）">
            <Space size={3}>
              <ProfileOutlined style={{ color: token.colorTextTertiary, fontSize: 12 }} />
              <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>
                任务 {managedActive > 0 ? managedActive : '—'}
              </Text>
            </Space>
          </Tooltip>
        </Space>

        {!project.missing && (
          <Tooltip title={g.lastCommit ?? project.lastActive ?? ''}>
            <Space size={4}>
              <ClockCircleOutlined style={{ color: token.colorTextTertiary }} />
              <span
                style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: dotColor }}
              />
              <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>
                {relativeTime(project.lastActive)}
              </Text>
            </Space>
          </Tooltip>
        )}
      </Space>
    </Card>
  );
}
