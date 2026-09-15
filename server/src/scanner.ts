import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Dirent } from 'node:fs';
import { CONFIG } from './config';
import { getGitInfo, normalizeRemote, NO_GIT } from './git';
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
 * 列出直接子目录里的 git 子仓名（多仓外壳的成员），字典序，跳过依赖/产物/点目录。
 * 只看一层：外壳里再套外壳不展开（没有这种用法，展开只会把扫描变成全盘遍历）。
 */
export function gitSubdirs(dir: string, entries: Dirent[] = readDirSafe(dir)): string[] {
  const subs: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    if (existsSync(join(dir, e.name, '.git'))) subs.push(e.name);
  }
  return subs.sort();
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

function mtimeOf(dir: string): string | null {
  try {
    return new Date(statSync(dir).mtimeMs).toISOString();
  } catch {
    return null;
  }
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

/** 所有扫描层不填、由 DB merge 层（enrich）覆盖的字段的默认值。 */
const DB_DEFAULTS = {
  dbId: null,
  pinned: false,
  archived: false,
  missing: false,
  stale: false,
  managed: { collected: 0, backlog: 0, todo: 0, doing: 0, review: 0, done: 0 },
  topPriority: null,
  overdue: 0,
} as const;

/** 待扫描的"仓级单元"：顶层仓/普通目录，或工作区里的一个子仓。git 调用按单元走并发池。 */
interface Unit {
  dir: string;
  name: string;
  parent: string | null;
  /** 所属外壳目录（子仓才有）；聚合时按目录归属，不按 name——两个 root 下同名外壳不能互相认领子仓 */
  parentDir?: string;
}

/** 多仓外壳：扫完成员子仓后再聚合成工作区项目。 */
interface Shell {
  dir: string;
  name: string;
  entries: Dirent[];
  subs: string[];
}

/** 扫描一个仓级单元（git 仓 / 普通目录 / 工作区子仓）。出错返回带 error 字段的占位项（错误隔离）。 */
async function scanUnit(u: Unit): Promise<ProjectInfo> {
  try {
    const entries = readDirSafe(u.dir);
    const names = new Set(entries.map((e) => e.name));
    const readme = findReadme(names);
    const git = await getGitInfo(u.dir);
    const pkg = readPkg(u.dir);
    const techStack = detectTechStack(names, pkg);

    const todoPath = join(u.dir, 'tasks', 'todo.md');
    const hasTasksFile = existsSync(todoPath);
    const todos = hasTasksFile
      ? parseTodoFile(todoPath)
      : { open: 0, doing: 0, done: 0, total: 0, items: [] };
    const description = pkg?.description?.trim() || readmeExcerpt(u.dir, readme);
    const displayName = pkg?.name || readmeTitle(u.dir, readme) || basename(u.dir);
    const key = git.remote ? normalizeRemote(git.remote) : safeRealpath(u.dir);

    return {
      key,
      path: u.dir,
      name: u.name,
      kind: 'repo',
      parent: u.parent,
      displayName,
      description: description || null,
      techStack,
      git,
      todos: { open: todos.open, doing: todos.doing, done: todos.done, total: todos.total },
      hasTasksFile,
      docs: {
        directory: existsSync(join(u.dir, 'DIRECTORY.md')),
        schema: existsSync(join(u.dir, 'SCHEMA.md')),
        api: existsSync(join(u.dir, 'API.md')),
      },
      lastActive: maxDate(git.lastCommit, mtimeOf(u.dir)),
      error: null,
      ...DB_DEFAULTS,
    };
  } catch (e) {
    return errorProject(u, e);
  }
}

/** 错误隔离：单目录失败不抛出，标在该项上，UI 可显示原因。 */
function errorProject(u: Unit, e: unknown): ProjectInfo {
  return {
    key: safeRealpath(u.dir),
    path: u.dir,
    name: u.name,
    kind: 'repo',
    parent: u.parent,
    displayName: basename(u.dir),
    description: null,
    techStack: [],
    git: { ...NO_GIT },
    todos: { open: 0, doing: 0, done: 0, total: 0 },
    hasTasksFile: false,
    docs: { directory: false, schema: false, api: false },
    lastActive: null,
    error: e instanceof Error ? e.message : String(e),
    ...DB_DEFAULTS,
  };
}

/**
 * 把外壳目录聚合成工作区项目：身份键 = 外壳 realpath；技术栈/改动数/最近活跃从成员子仓汇总；
 * 简介、展示名、todo.md、三层索引取外壳自己的（跨仓的文档通常就放在外壳层）。
 */
function workspaceProject(shell: Shell, children: ProjectInfo[]): ProjectInfo {
  const names = new Set(shell.entries.map((e) => e.name));
  const readme = findReadme(names);
  const pkg = readPkg(shell.dir);
  const techStack = [...new Set([...detectTechStack(names, pkg), ...children.flatMap((c) => c.techStack)])];
  const todoPath = join(shell.dir, 'tasks', 'todo.md');
  const hasTasksFile = existsSync(todoPath);
  const todos = hasTasksFile ? parseTodoFile(todoPath) : { open: 0, doing: 0, done: 0, total: 0, items: [] };
  const description = pkg?.description?.trim() || readmeExcerpt(shell.dir, readme);
  const displayName = pkg?.name || readmeTitle(shell.dir, readme) || shell.name;
  let lastActive = mtimeOf(shell.dir);
  let lastCommit: string | null = null;
  let dirtyCount = 0;
  for (const c of children) {
    lastActive = maxDate(lastActive, c.lastActive);
    lastCommit = maxDate(lastCommit, c.git.lastCommit);
    dirtyCount += c.git.dirtyCount;
  }
  return {
    key: safeRealpath(shell.dir),
    path: shell.dir,
    name: shell.name,
    kind: 'workspace',
    parent: null,
    displayName,
    description: description || null,
    techStack,
    git: { ...NO_GIT, dirtyCount, lastCommit },
    todos: { open: todos.open, doing: todos.doing, done: todos.done, total: todos.total },
    hasTasksFile,
    docs: {
      directory: existsSync(join(shell.dir, 'DIRECTORY.md')),
      schema: existsSync(join(shell.dir, 'SCHEMA.md')),
      api: existsSync(join(shell.dir, 'API.md')),
    },
    lastActive,
    error: null,
    ...DB_DEFAULTS,
  };
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * 扫描项目：roots 下的子目录（depth=1）+ extraProjects 指定的单独项目路径。
 * 候选目录分三类：
 * - 自身有 .git → 一个 repo 项目；
 * - 无 .git 但直接子目录里有 git 仓 → 一个 workspace 项目 + 每个子仓一个 repo 项目（name=`外壳/子仓`）；
 * - 两者皆无 → 有标记文件或 README 才算普通项目，否则不是项目。
 * 另：realpath 去重（折叠 symlink、多 root 指向同一处、extra 与 root 重合）、并发池 + 单目录错误隔离。
 * 返回顺序：顶层项目按最近活跃倒序，工作区的子项目紧跟在工作区之后（同样按活跃倒序）。
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

  // 第一阶段（纯 fs，便宜）：把候选目录分类成仓级单元与外壳；第二阶段再对单元并发跑 git。
  const units: Unit[] = [];
  const shells: Shell[] = [];
  for (const dir of candidates) {
    const entries = readDirSafe(dir);
    const names = new Set(entries.map((e) => e.name));
    const name = basename(dir);
    if (names.has('.git')) {
      units.push({ dir, name, parent: null });
      continue;
    }
    const subs = gitSubdirs(dir, entries);
    if (subs.length > 0) {
      shells.push({ dir, name, entries, subs });
      for (const s of subs) units.push({ dir: join(dir, s), name: `${name}/${s}`, parent: name, parentDir: dir });
      continue;
    }
    if (hasMarkers(names) || findReadme(names)) units.push({ dir, name, parent: null });
  }

  const scanned = await pMap(units, scanUnit, CONFIG.concurrency);
  const byParentDir = new Map<string, ProjectInfo[]>();
  const top: ProjectInfo[] = [];
  scanned.forEach((p, i) => {
    const parentDir = units[i].parentDir;
    if (parentDir) {
      const list = byParentDir.get(parentDir) ?? [];
      list.push(p);
      byParentDir.set(parentDir, list);
    } else top.push(p);
  });
  const workspaces: Array<{ ws: ProjectInfo; children: ProjectInfo[] }> = [];
  for (const shell of shells) {
    const children = byParentDir.get(shell.dir) ?? [];
    const ws = workspaceProject(shell, children);
    workspaces.push({ ws, children });
    top.push(ws);
  }

  const byActive = (a: ProjectInfo, b: ProjectInfo) => (b.lastActive ?? '').localeCompare(a.lastActive ?? '');
  top.sort(byActive);
  const out: ProjectInfo[] = [];
  for (const p of top) {
    out.push(p);
    const w = workspaces.find((x) => x.ws === p);
    if (w) out.push(...[...w.children].sort(byActive));
  }
  return out;
}

/** 在已扫描的列表项基础上，补充详情字段（完整 todo 条目 + README 摘录）。 */
export function buildDetail(p: ProjectInfo): ProjectDetail {
  const todo = parseTodoFile(join(p.path, 'tasks', 'todo.md'));
  const items: TodoItem[] = todo.items;
  const readme = findReadme(new Set(readDirSafe(p.path).map((e) => e.name)));
  return { ...p, todoItems: items, readmeExcerpt: readmeExcerpt(p.path, readme) };
}
