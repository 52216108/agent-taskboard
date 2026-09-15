import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanProjects, gitSubdirs } from '../src/scanner';

// 真目录 + 真 git init 扫一遍：扫描器的分类逻辑（仓 / 工作区+子仓 / 普通目录 / 非项目）全在 fs 与 git 上，
// 纯函数单测覆盖不到"外壳无 .git、子目录有 .git"这层判断。临时目录在 tmpdir 下，测完删掉。
function gitInit(dir: string, remote?: string) {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
}

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'board-scan-'));
  // 多仓外壳：自身无 .git，两个 git 子仓 + 一个普通子目录 + 自己的 README
  mkdirSync(join(root, 'acme'));
  writeFileSync(join(root, 'acme', 'README.md'), '# Acme 工作区\n\n三个仓合在一起。\n');
  gitInit(join(root, 'acme', 'acme-app'), 'git@github.com:acme/acme-app.git');
  gitInit(join(root, 'acme', 'server'), 'https://github.com/acme/server.git');
  mkdirSync(join(root, 'acme', 'docs'));
  writeFileSync(join(root, 'acme', 'docs', 'README.md'), '# docs\n');
  // 顶层单仓
  gitInit(join(root, 'solo'), 'git@github.com:acme/solo.git');
  // 无 git 但有 README 的普通项目
  mkdirSync(join(root, 'plain'));
  writeFileSync(join(root, 'plain', 'README.md'), '# Plain\n');
  // 什么都没有 → 不是项目
  mkdirSync(join(root, 'empty'));
  // 依赖目录 → 跳过
  mkdirSync(join(root, 'node_modules', 'x', '.git'), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('gitSubdirs 列出外壳里的 git 子仓', () => {
  it('只取直接子目录里含 .git 的，字典序，跳过普通子目录', () => {
    expect(gitSubdirs(join(root, 'acme'))).toEqual(['acme-app', 'server']);
    expect(gitSubdirs(join(root, 'solo'))).toEqual([]);
  });
});

describe('scanProjects 分类：单仓 / 工作区+子仓 / 普通目录 / 非项目', () => {
  it('外壳 → 一个 workspace + 每个子仓一个 repo（name=外壳/子仓，parent=外壳），且紧跟其后', async () => {
    const list = await scanProjects([root]);
    const names = list.map((p) => p.name);
    expect(names).toContain('acme');
    expect(names).toContain('acme/acme-app');
    expect(names).toContain('acme/server');
    expect(names).not.toContain('acme/docs'); // 普通子目录不是子仓
    expect(names).not.toContain('empty'); // 无标记无 README 不是项目
    expect(names.some((n) => n.includes('node_modules'))).toBe(false);

    const ws = list.find((p) => p.name === 'acme')!;
    expect(ws.kind).toBe('workspace');
    expect(ws.parent).toBeNull();
    expect(ws.key).toBe(realpathSync(join(root, 'acme'))); // 身份键 = 外壳 realpath，不借子仓 remote
    expect(ws.git.isRepo).toBe(false);
    expect(ws.displayName).toBe('Acme 工作区'); // 外壳自己的 README 标题

    const app = list.find((p) => p.name === 'acme/acme-app')!;
    expect(app.kind).toBe('repo');
    expect(app.parent).toBe('acme');
    expect(app.key).toBe('github.com/acme/acme-app'); // 子仓与顶层仓同规则：归一化 remote
    expect(app.path).toBe(join(root, 'acme', 'acme-app'));
    expect(app.git.isRepo).toBe(true);

    // 子项目紧跟在工作区之后（列表/侧栏据此分组）
    const i = names.indexOf('acme');
    expect(new Set(names.slice(i + 1, i + 3))).toEqual(new Set(['acme/acme-app', 'acme/server']));
  });

  it('顶层单仓与普通目录仍是 repo 形态', async () => {
    const list = await scanProjects([root]);
    const solo = list.find((p) => p.name === 'solo')!;
    expect(solo.kind).toBe('repo');
    expect(solo.parent).toBeNull();
    expect(solo.key).toBe('github.com/acme/solo');
    const plain = list.find((p) => p.name === 'plain')!;
    expect(plain.kind).toBe('repo');
    expect(plain.git.isRepo).toBe(false);
    expect(plain.key).toBe(realpathSync(join(root, 'plain')));
  });

  it('多 root 指向同一目录 → realpath 去重', async () => {
    const list = await scanProjects([root, root]);
    expect(list.filter((p) => p.name === 'solo')).toHaveLength(1);
  });
});
