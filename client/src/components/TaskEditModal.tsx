import { useEffect, useState } from 'react';
import {
  Modal,
  Input,
  Select,
  AutoComplete,
  DatePicker,
  Space,
  Button,
  Alert,
  App as AntApp,
  Typography,
  Upload,
  Image,
  theme,
} from 'antd';
import type { UploadProps } from 'antd';
import dayjs from 'dayjs';
import { UploadOutlined, DeleteOutlined } from '@ant-design/icons';
import type { Task, TaskPriority, TaskStatus, TaskType, TaskImage } from '../types';
import { updateTask, rejectTask, uploadTaskImage, deleteTaskImage, taskImageUrl } from '../api';
import { BOARD_STATUSES, TASK_STATUS_META, TASK_TYPE_OPTIONS } from '../util';

const { Text } = Typography;

// AntD customRequest 的入参类型（避免手写 ad-hoc 类型与 rc-upload 真实签名漂移）
type UploadReq = Parameters<NonNullable<UploadProps['customRequest']>>[0];

const PRIORITIES: TaskPriority[] = ['p0', 'p1', 'p2', 'p3'];
// 认领人下拉提示：只预置 agent 名，人名由使用者自由输入（AutoComplete 不限定取值）
const ASSIGNEE_SUGGESTIONS = ['claude', 'codex'];
// 六状态（看板列顺序）+ 归档，供详情弹窗手动改状态
const STATUSES: Array<{ value: TaskStatus; label: string }> = [
  ...BOARD_STATUSES.map((s) => ({ value: s as TaskStatus, label: TASK_STATUS_META[s].label })),
  { value: 'archived', label: '归档' },
];

/** 任务详情/编辑弹窗，供看板卡片与全局任务视图复用。 */
export default function TaskEditModal({
  task,
  open,
  onClose,
  onSaved,
}: {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = AntApp.useApp();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('p2');
  const [taskType, setTaskType] = useState<TaskType>('feature');
  const [status, setStatus] = useState<TaskStatus>('collected'); // 与新建默认对齐；实际渲染时被 useEffect 覆盖为真实状态
  const [due, setDue] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState<TaskImage[]>([]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const { token } = theme.useToken();

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? '');
    setPriority(task.priority);
    setTaskType(task.taskType);
    setStatus(task.status);
    setDue(task.dueDate);
    setAssignee(task.assignee ?? '');
    setImages(task.images ?? []);
    setRejectOpen(false);
    setRejectReason('');
  }, [task]);

  if (!task) return null;

  const save = () => {
    if (!title.trim()) {
      message.warning('标题不能为空');
      return;
    }
    if (assignee.trim().length > 32) {
      message.warning('认领人不能超过 32 字符');
      return;
    }
    setSaving(true);
    updateTask(task.id, {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      taskType,
      status,
      dueDate: due,
      assignee: assignee.trim() || null,
    })
      .then(() => {
        onSaved();
        onClose();
      })
      .catch((e) => message.error(String(e.message ?? e)))
      .finally(() => setSaving(false));
  };

  const archive = () => {
    updateTask(task.id, { status: 'archived' })
      .then(() => {
        message.success('已归档');
        onSaved();
        onClose();
      })
      .catch((e) => message.error(String(e.message ?? e)));
  };

  const doReject = () => {
    const reason = rejectReason.trim();
    if (!reason) {
      message.warning('请填写打回原因');
      return;
    }
    setRejecting(true);
    rejectTask(task.id, reason)
      .then(() => {
        message.success('已打回 → 待开发');
        onSaved();
        onClose();
      })
      .catch((e) => message.error(String(e.message ?? e)))
      .finally(() => setRejecting(false));
  };

  const handleUpload = async (opt: UploadReq) => {
    const file = opt.file as File;
    try {
      const { name } = await uploadTaskImage(task.id, file, file.type);
      setImages((prev) => [...prev, { name, addedAt: new Date().toISOString() }]);
      opt.onSuccess?.({});
    } catch (e) {
      opt.onError?.(e as Error);
      message.error(`上传失败：${String((e as Error).message ?? e)}`);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith('image/'));
    if (imgs.length === 0) return; // 非图片粘贴 → 放行默认行为
    e.preventDefault();
    for (const it of imgs) {
      const blob = it.getAsFile();
      if (!blob) continue;
      try {
        const { name } = await uploadTaskImage(task.id, blob, blob.type);
        setImages((prev) => [...prev, { name, addedAt: new Date().toISOString() }]);
      } catch (err) {
        message.error(`粘贴上传失败：${String((err as Error).message ?? err)}`);
      }
    }
  };

  const handleDeleteImage = async (name: string) => {
    try {
      await deleteTaskImage(task.id, name);
      setImages((prev) => prev.filter((i) => i.name !== name));
    } catch (e) {
      message.error(`删除失败：${String((e as Error).message ?? e)}`);
    }
  };

  return (
    <Modal
      title={`任务 #${task.id}`}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="archive" danger onClick={archive} style={{ float: 'left' }}>
          归档
        </Button>,
        task.status === 'review' && (
          <Button key="reject" danger onClick={() => setRejectOpen((v) => !v)} style={{ float: 'left' }}>
            打回…
          </Button>
        ),
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={save}>
          保存
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12} onPaste={handlePaste}>
        {task.rejectReason && (
          <Alert
            type="warning"
            showIcon
            message="上轮验收打回"
            description={<span style={{ whiteSpace: 'pre-wrap' }}>{task.rejectReason}</span>}
          />
        )}
        {rejectOpen && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              打回原因（回灌给 agent，任务将退回「待开发」）
            </Text>
            <Input.TextArea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              maxLength={500}
              showCount
              placeholder="哪里不过关、期望改成什么样…"
            />
            <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setRejectOpen(false)}>
                取消
              </Button>
              <Button size="small" type="primary" danger loading={rejecting} onClick={doReject}>
                确认打回
              </Button>
            </div>
          </div>
        )}
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            标题
          </Text>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} onPressEnter={save} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            描述（agent 看任务时的上下文）
          </Text>
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
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
              style={{ width: 100 }}
              options={PRIORITIES.map((p) => ({ value: p, label: p.toUpperCase() }))}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              状态
            </Text>
            <Select<TaskStatus>
              value={status}
              onChange={setStatus}
              style={{ width: 110 }}
              options={STATUSES}
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
              style={{ width: 150 }}
            />
          </div>
        </Space>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
            图片（粘贴截图 / 上传；agent 在 task here 里能看到图片路径）
          </Text>
          <Space wrap size={8}>
            <Image.PreviewGroup>
              {images.map((img) => (
                <div key={img.name} style={{ position: 'relative', display: 'inline-block' }}>
                  <Image
                    src={taskImageUrl(task.id, img.name)}
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
                    onClick={() => handleDeleteImage(img.name)}
                    style={{ position: 'absolute', top: 2, right: 2, opacity: 0.9 }}
                  />
                </div>
              ))}
            </Image.PreviewGroup>
            <Upload
              accept="image/png,image/jpeg,image/webp,image/gif"
              showUploadList={false}
              multiple
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
        {task.source === 'todo_md' && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            来源：从 tasks/todo.md 导入
          </Text>
        )}
      </Space>
    </Modal>
  );
}
