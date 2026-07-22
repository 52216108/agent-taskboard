import { execFile } from 'node:child_process';
import { CONFIG } from './config';
import type { GitInfo } from './types';

/** 执行一条 git 命令，带超时与缓冲上限；失败时 reject。 */
function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout: CONFIG.gitTimeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.toString().trim());
      },
    );
  });
}

/**
 * 把各种形态的 remote URL 归一成稳定身份键：
 *   git@github.com:owner/repo.git -> github.com/owner/repo
 *   https://github.com/owner/repo  -> github.com/owner/repo
 */
export function normalizeRemote(remote: string): string {
  let r = remote.trim().replace(/\.git$/, '');
  const ssh = r.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (ssh) return `${ssh[1]}/${ssh[2]}`.toLowerCase();
  const url = r.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([\w.-]+)\/(.+)$/i);
  if (url) return `${url[1]}/${url[2]}`.toLowerCase();
  return r.toLowerCase();
}

/**
 * 读取仓库的 git 概要。非仓库或无法读取时返回 isRepo:false，绝不抛出。
 * @param repoDir git 工作树所在目录（可能是项目根，也可能是嵌套子目录）
 * @param nested  该 git 是否来自子目录
 */
export async function getGitInfo(repoDir: string, nested: boolean): Promise<GitInfo> {
  try {
    const inside = await git(repoDir, ['rev-parse', '--is-inside-work-tree']);
    if (inside !== 'true') throw new Error('not a work tree');
  } catch {
    return { isRepo: false, branch: null, dirtyCount: 0, lastCommit: null, remote: null, nested };
  }
  const [branch, dirty, lastCommit, remote] = await Promise.all([
    git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => null),
    git(repoDir, ['status', '--porcelain']).catch(() => ''),
    git(repoDir, ['log', '-1', '--format=%cI']).catch(() => null),
    git(repoDir, ['remote', 'get-url', 'origin']).catch(() => null),
  ]);
  return {
    isRepo: true,
    branch: branch || null,
    dirtyCount: dirty ? dirty.split('\n').filter((l) => l.trim().length > 0).length : 0,
    lastCommit: lastCommit || null,
    remote: remote || null,
    nested,
  };
}
