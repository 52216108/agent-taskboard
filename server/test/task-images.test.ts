import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG } from '../src/config';
import {
  extForMime,
  isValidName,
  saveImage,
  deleteImage,
  taskImagePath,
  contentTypeForName,
} from '../src/task-images';

let dir: string;
const orig = CONFIG.taskImagesDir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'board-img-'));
  CONFIG.taskImagesDir = dir; // 模块在调用时读 CONFIG.taskImagesDir，可运行时覆盖
});
afterEach(() => {
  CONFIG.taskImagesDir = orig;
  rmSync(dir, { recursive: true, force: true });
});

describe('task-images', () => {
  it('extForMime 白名单', () => {
    expect(extForMime('image/png')).toBe('png');
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('image/webp')).toBe('webp');
    expect(extForMime('image/gif')).toBe('gif');
    expect(extForMime('image/bmp')).toBeNull();
    expect(extForMime('text/plain')).toBeNull();
  });
  it('isValidName 拒绝穿越/非法', () => {
    expect(isValidName('abc.png')).toBe(true);
    expect(isValidName('A_b-1.webp')).toBe(true);
    expect(isValidName('../etc/passwd')).toBe(false);
    expect(isValidName('a/b.png')).toBe(false);
    expect(isValidName('a.txt')).toBe(false);
    expect(isValidName('a.png.txt')).toBe(false);
    expect(isValidName('')).toBe(false);
  });
  it('saveImage 落盘返回唯一名，deleteImage 幂等', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { name } = saveImage(7, buf, 'image/png');
    expect(name).toMatch(/^[0-9a-f-]+\.png$/);
    const p = taskImagePath(7, name);
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p)).toEqual(buf);
    deleteImage(7, name);
    expect(existsSync(p)).toBe(false);
    deleteImage(7, name); // 再删不报错
  });
  it('saveImage 拒绝非白名单 mime', () => {
    expect(() => saveImage(7, Buffer.from([1]), 'image/bmp')).toThrow();
  });
  it('contentTypeForName 映射', () => {
    expect(contentTypeForName('x.png')).toBe('image/png');
    expect(contentTypeForName('x.jpg')).toBe('image/jpeg');
  });
  it('taskImagePath 拒绝非法名', () => {
    expect(() => taskImagePath(7, '../x.png')).toThrow();
  });
});
