import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Input,
  Select,
  AutoComplete,
  DatePicker,
  Space,
  Button,
  App as AntApp,
  Typography,
  Upload,
  Image,
  theme,
} from 'antd';
import type { UploadProps } from 'antd';
import dayjs from 'dayjs';
import { UploadOutlined, DeleteOutlined } from '@ant-design/icons';
import type { TaskPriority, TaskType } from '../types';
import { createTask, uploadTaskImage } from '../api';
import { TASK_TYPE_OPTIONS } from '../util';

const { Text } = Typography;

// AntD customRequest 的入参类型（与 TaskEditModal 同源，避免 ad-hoc 类型漂移）
type UploadReq = Parameters<NonNullable<UploadProps['customRequest']>>[0];

const PRIORITIES: TaskPriority[] = ['p0', 'p1', 'p2', 'p3'];
const ASSIGNEE_SUGGESTIONS = ['claude', 'codex'];

// 缓冲图片：新任务还没 id，无法立即上传，先在内存持有 File + 预览 URL，创建拿到 id 后再逐张上传。
interface PendingImage {
  key: number;
  file: File;
  url: string;
}

/** 新建任务弹窗：布局与编辑弹窗一致，但图片先内存缓冲、创建后再上传；「取消」什么都不建。 */
export default function TaskCreateModal({
  projectName,
  open,
  onClose,
  onCreated,
}: {
  projectName: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { message } = AntApp.useApp();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('p2');
  const [taskType, setTaskType] = useState<TaskType>('feature');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [saving, setSaving] = useState(false);
  const keyRef = useRef(0);
  const { token } = theme.useToken();

  // 释放所有缓冲图片的预览 URL 并清空——打开重置、取消、创建成功三处主动调用，而非赖着"下次打开"惰性回收
  const resetPending = useCallback(() => {
    setPending((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
  }, []);

  // 每次打开重置为空白
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setPriority('p2');
    setTaskType('feature');
    setAssignee('');
    setDue(null);
    resetPending();
  }, [open, resetPending]);

  // 关闭（取消）：主动释放预览 URL，再交回父组件
  const handleCancel = () => {
    resetPending();
    onClose();
  };

  const bufferImage = (file: File) => {
    const url = URL.createObjectURL(file);
    setPending((prev) => [...prev, { key: keyRef.current++, file, url }]);
  };

  const handleUpload = (opt: UploadReq) => {
    bufferImage(opt.file as File);
    opt.onSuccess?.({}); // 仅缓冲，标记 Upload 组件“成功”即可（真正上传在创建之后）
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith('image/'));
    if (imgs.length === 0) return; // 非图片粘贴放行默认行为
    e.preventDefault();
    for (const it of imgs) {
      const blob = it.getAsFile();
      if (blob) bufferImage(blob);
    }
  };

  const removePending = (key: number) =>
    setPending((prev) => {
      const hit = prev.find((p) => p.key === key);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((p) => p.key !== key);
    });

  const create = () => {
    if (saving) return; // 防重复提交（含标题框回车连按）
    const t = title.trim();
    if (!t) {
      message.warning('标题不能为空');
      return;
    }
    if (assignee.trim().length > 32) {
      message.warning('认领人不能超过 32 字符');
      return;
    }
    setSaving(true);
    createTask(projectName, {
      title: t,
      description: description.trim() || null,
      priority,
      taskType,
      dueDate: due,
      assignee: assignee.trim() || null,
    })
      .then(async (created) => {
        // 拿到 id 后逐张上传缓冲图片；单张失败不阻断其余（任务已建成，只提示）
        for (const p of pending) {
          try {
            await uploadTaskImage(created.id, p.file, p.file.type);
          } catch (e) {
            message.error(`图片「${p.file.name}」上传失败：${String((e as Error).message ?? e)}`);
          }
        }
        resetPending();
        onCreated();
        onClose();
      })
      .catch((e) => message.error(String(e.message ?? e)))
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      title="新建任务"
      open={open}
      onCancel={handleCancel}
      okText="创建"
      cancelText="取消"
      confirmLoading={saving}
      onOk={create}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12} onPaste={handlePaste}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            标题
          </Text>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onPressEnter={create}
            disabled={saving}
            autoFocus
          />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            描述（agent 看任务时的上下文）
          </Text>
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            disabled={saving}
            placeholder="可写清楚验收标准、相关文件、注意事项…"
          />
        </div>
        <Space size={12} wrap>
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              类型
            </Text>
            <Select<TaskType>
              value={taskType}
              onChange={setTaskType}
              disabled={saving}
              style={{ width: 100 }}
              options={TASK_TYPE_OPTIONS}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              优先级
            </Text>
            <Select<TaskPriority>
              value={priority}
              onChange={setPriority}
              disabled={saving}
              style={{ width: 100 }}
              options={PRIORITIES.map((p) => ({ value: p, label: p.toUpperCase() }))}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              认领人
            </Text>
            <AutoComplete
              value={assignee}
              onChange={setAssignee}
              options={ASSIGNEE_SUGGESTIONS.map((value) => ({ value }))}
              allowClear
              disabled={saving}
              style={{ width: 110 }}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              截止日期
            </Text>
            <DatePicker
              value={due ? dayjs(due) : null}
              onChange={(d) => setDue(d ? d.format('YYYY-MM-DD') : null)}
              disabled={saving}
              style={{ width: 150 }}
            />
          </div>
        </Space>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
            图片（粘贴截图 / 上传；创建后自动上传到任务）
          </Text>
          <Space wrap size={8}>
            <Image.PreviewGroup>
              {pending.map((p) => (
                <div key={p.key} style={{ position: 'relative', display: 'inline-block' }}>
                  <Image
                    src={p.url}
                    width={84}
                    height={84}
                    style={{
                      objectFit: 'cover',
                      borderRadius: 6,
                      border: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  />
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removePending(p.key)}
                    style={{ position: 'absolute', top: 2, right: 2, opacity: 0.9 }}
                  />
                </div>
              ))}
            </Image.PreviewGroup>
            <Upload
              accept="image/png,image/jpeg,image/webp,image/gif"
              showUploadList={false}
              multiple
              disabled={saving}
              customRequest={handleUpload}
            >
              <div
                tabIndex={0}
                style={{
                  width: 84,
                  height: 84,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  cursor: 'pointer',
                  border: `1px dashed ${token.colorBorder}`,
                  borderRadius: 6,
                  color: token.colorTextTertiary,
                  background: token.colorFillQuaternary,
                }}
              >
                <UploadOutlined />
                <span style={{ fontSize: 11 }}>上传/粘贴</span>
              </div>
            </Upload>
          </Space>
        </div>
      </Space>
    </Modal>
  );
}
