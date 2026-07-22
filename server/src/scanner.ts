import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Dirent } from 'node:fs';
import { CONFIG } from './config';
import { getGitInfo, normalizeRemote } from './git';
import { parseTodoFile } from './todo-parser';
import { detectTechStack } from './tech-stack';
import type { ProjectInfo, ProjectDetail, TodoItem } from './types';

/** 判定"真项目"的标记文件/目录。 */
const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'requirements.txt',
  'pyproject.toml',
  'Gemfile',
  'composer.json',
  'pubspec.yaml',
  'deno.json',
];

/** 扫描时跳过的目录名（构建产物 / 依赖 / 缓存）。 */
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.venv',
  '__pycache__',
  '.next',
  '.git',
]);

function readDirSafe(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function hasMarkers(names: Set<string>): boolean {
  if (PROJECT_MARKERS.some((m) => names.has(m))) return true;
  // 苹果原生工程没有上面的标记文件，但有 .xcodeproj
  return [...names].some((n) => n.endsWith('.xcodeproj'));
}

function findReadme(names: Set<string>): string | null {
  for (const n of names) if (/^readme(\.md|\.txt)?$/i.test(n)) return n;
  return null;
}

/**
 * 从内层含 .git 的子目录名里选出"主仓"（纯函数，无 fs 访问，便于单测）：
 * - 0 个 → null；1 个 → 它；
 * - 多个 → 优先与外壳同名 / 以"外壳名-"打头者（如 acme/acme-app），
 *   以此保证多仓外壳的身份键稳定；没有同名候选则取字典序第一，保证确定性
 *   （不随目录读取顺序漂移）。
 */
export function pickPrimarySubdir(shell: string, subNames: string[]): string | null {
  if (subNames.length === 0) return null;
  if (subNames.length === 1) return subNames[0];
  // 先排序再挑：多个"同名前缀"子仓（如 foo/ 含 foo-app+foo-server）时取字典序最小者，
  // 结果不随目录读取顺序漂移；且精确同名("foo")天然排在"foo-xxx"之前，优先精确匹配。
  const sorted = [...subNames].sort();
  return sorted.find((n) => n === shell || n.startsWith(shell + '-')) ?? sorted[0];
}

/**
 * 在直接子目录里定位"主内层 git 仓"的绝对路径（处理 acme/acme-app 这类外壳嵌套）。
 * 原先只认"恰好 1 个"内层仓；现支持多内层仓（如 acme 同时含 server + acme-app），
 * 交给 pickPrimarySubdir 确定性选主仓，避免多仓外壳被整个漏扫 → DB 行误判"目录已消失"。
 */
function findPrimaryGitSubdir(dir: string, entries: Dirent[]): string | null {
  const subNames: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    if (existsSync(join(dir, e.name, '.git'))) subNames.push(e.name);
  }
  const primary = pickPrimarySubdir(basename(dir), subNames);
  return primary ? join(dir, primary) : null;
}

interface PkgJson {
  name?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPkg(dir: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PkgJson;
  } catch {
    return null;
  }
}

/** 取 README 首段（跳过标题/空行/徽章），用作项目简介回退。 */
function readmeExcerpt(dir: string, readme: string | null): string | null {
  if (!readme) return null;
  let text: string;
  try {
    text = readFileSync(join(dir, readme), 'utf8');
  } catch {
    return null;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue; // 标题
    if (/^[![]|^<|^---/.test(line)) continue; // 徽章 / HTML / 分隔线
    return line.length > 200 ? line.slice(0, 200) + '…' : line;
  }
  return null;
}

/** 取 README 第一个一级/二级标题作为展示名回退。 */
function readmeTitle(dir: string, readme: string | null): string | null {
  if (!readme) return null;
  try {
    const text = readFileSync(join(dir, readme), 'utf8');
    const m = text.match(/^\s{0,3}#{1,2}\s+(.*\S)/m);
    return m ? m[1].replace(/[#*`]/g, '').trim() : null;
  } catch {
    return null;
  }
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  // 按真实时刻比较：git 的 %cI 带时区偏移（+08:00），mtime 是 UTC（Z），字典序不等价于时间序
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/** 简单并发限制 map，保持顺序。 */
async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, limit: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** 扫描单个候选目录。非项目返回 null；出错返回带 error 字段的占位项（错误隔离）。 */
async function scanOne(dir: string): Promise<ProjectInfo | null> {
  try {
    const entries = readDirSafe(dir);
    const names = new Set(entries.map((e) => e.name));
    const hasGitTop = names.has('.git');
    const readme = findReadme(names);

    // 解析 git：根目录优先，否则取主嵌套 git 子目录（多仓外壳取主仓）
    let gitDir = dir;
    let nested = false;
    if (!hasGitTop) {
      const sub = findPrimaryGitSubdir(dir, entries);
      if (sub) {
        gitDir = sub;
        nested = true;
      }
    }

    // 真项目判定：自身有标记 / 有 README / 有嵌套 git，三者皆无则不是项目
    if (!hasMarkers(names) && !readme && !nested) return null;

    const git = await getGitInfo(gitDir, nested);

    // 技术栈：合并根目录与嵌套 git 目录的标记 + package.json
    const subNames = nested ? new Set(readDirSafe(gitDir).map((e) => e.name)) : new Set<string>();
    const pkg = readPkg(dir) ?? (nested ? readPkg(gitDir) : null);
    const techStack = detectTechStack(new Set([...names, ...subNames]), pkg);

    const todoPath = join(dir, 'tasks', 'todo.md');
    const hasTasksFile = existsSync(todoPath);
    const todos = hasTasksFile
      ? parseTodoFile(todoPath)
      : { open: 0, doing: 0, done: 0, total: 0, items: [] };
    const description = pkg?.description?.trim() || readmeExcerpt(dir, readme);
    const displayName = pkg?.name || readmeTitle(dir, readme) || basename(dir);

    let mtime: string | null = null;
    try {
      mtime = new Date(statSync(dir).mtimeMs).toISOString();
    } catch {
      /* ignore */
    }

    const key = git.remote ? normalizeRemote(git.remote) : safeRealpath(dir);

    return {
      key,
      path: dir,
      name: basename(dir),
      displayName,
      description: description || null,
      techStack,
      git,
      todos: { open: todos.open, doing: todos.doing, done: todos.done, total: todos.total },
      hasTasksFile,
      docs: {
        directory: existsSync(join(dir, 'DIRECTORY.md')),
        schema: existsSync(join(dir, 'SCHEMA.md')),
        api: existsSync(join(dir, 'API.md')),
      },
      lastActive: maxDate(git.lastCommit, mtime),
      error: null,
      dbId: null,
      pinned: false,
      archived: false,
      missing: false,
      managed: { collected: 0, backlog: 0, todo: 0, doing: 0, review: 0, done: 0 },
      topPriority: null,
      overdue: 0,
    };
  } catch (e) {
    // 错误隔离：单目录失败不抛出，标在该项上，UI 可显示原因
    return {
      key: safeRealpath(dir),
      path: dir,
      name: basename(dir),
      displayName: basename(dir),
      description: null,
      techStack: [],
      git: { isRepo: false, branch: null, dirtyCount: 0, lastCommit: null, remote: null, nested: false },
      todos: { open: 0, doing: 0, done: 0, total: 0 },
      hasTasksFile: false,
      docs: { directory: false, schema: false, api: false },
      lastActive: null,
      error: e instanceof Error ? e.message : String(e),
      dbId: null,
      pinned: false,
      archived: false,
      missing: false,
      managed: { collected: 0, backlog: 0, todo: 0, doing: 0, review: 0, done: 0 },
      topPriority: null,
      overdue: 0,
    };
  }
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * 扫描项目（depth=1）：roots 下的子目录 + extraProjects 指定的单独项目路径。
 * - realpath 去重（折叠 symlink、多 root 指向同一处、extra 与 root 重合）
 * - 并发池 + 单目录错误隔离
 * - 按最近活跃倒序返回
 */
export async function scanProjects(roots: string[], extraProjects: string[] = []): Promise<ProjectInfo[]> {
  const seen = new Set<string>();
  const candidates: string[] = [];

  const addCandidate = (full: string) => {
    if (!existsSync(full)) return;
    const real = safeRealpath(full);
    if (seen.has(real)) return;
    seen.add(real);
    candidates.push(full);
  };

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readDirSafe(root)) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      addCandidate(join(root, entry.name));
    }
  }

  // 额外项目（BOARD_PROJECTS 指定、位于扫描根之外）：直接作为项目候选，去重后并入
  for (const p of extraProjects) addCandidate(p);

  const scanned = await pMap(candidates, scanOne, CONFIG.concurrency);
  const projects = scanned.filter((p): p is ProjectInfo => p !== null);
  projects.sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''));
  return projects;
}

/** 在已扫描的列表项基础上，补充详情字段（完整 todo 条目 + README 摘录）。 */
export function buildDetail(p: ProjectInfo): ProjectDetail {
  const todo = parseTodoFile(join(p.path, 'tasks', 'todo.md'));
  const items: TodoItem[] = todo.items;
  const readme = findReadme(new Set(readDirSafe(p.path).map((e) => e.name)));
  return { ...p, todoItems: items, readmeExcerpt: readmeExcerpt(p.path, readme) };
}
