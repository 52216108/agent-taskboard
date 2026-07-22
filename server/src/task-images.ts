import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config';

// mime → 落盘扩展名（白名单）；不在表中即不支持。
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
// 扩展名 → 响应 content-type。
const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
// 合法文件名：仅 [A-Za-z0-9_-] + 白名单扩展名；拒绝 /、..、绝对路径等穿越。
const NAME_RE = /^[A-Za-z0-9_-]+\.(png|jpg|webp|gif)$/;

/** 某任务的图片目录绝对路径。 */
export function taskImageDir(taskId: number): string {
  return join(CONFIG.taskImagesDir, String(taskId));
}

/** 校验磁盘文件名是否合法（防路径穿越）。 */
export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

/** 单张图绝对路径；name 非法直接抛错（绝不 join 不可信输入）。 */
export function taskImagePath(taskId: number, name: string): string {
  if (!isValidName(name)) throw new Error(`非法图片名：${name}`);
  return join(taskImageDir(taskId), name);
}

/** mime → 扩展名，不支持返回 null。 */
export function extForMime(mime: string): string | null {
  return MIME_EXT[mime] ?? null;
}

/** 由文件名推响应 content-type。 */
export function contentTypeForName(name: string): string {
  const ext = name.split('.').pop() ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

/** 落盘一张图，返回生成的文件名；mime 非白名单抛错。 */
export function saveImage(taskId: number, buf: Buffer, mime: string): { name: string } {
  const ext = extForMime(mime);
  if (!ext) throw new Error(`不支持的图片类型：${mime}`);
  const name = `${randomUUID()}.${ext}`;
  const dir = taskImageDir(taskId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), buf);
  return { name };
}

/** 删一张图文件（幂等，不存在不报错）；name 非法抛错。 */
export function deleteImage(taskId: number, name: string): void {
  if (!isValidName(name)) throw new Error(`非法图片名：${name}`);
  rmSync(join(taskImageDir(taskId), name), { force: true });
}
