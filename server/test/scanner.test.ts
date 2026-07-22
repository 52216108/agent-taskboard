import { describe, it, expect } from 'vitest';
import { pickPrimarySubdir } from '../src/scanner';

describe('pickPrimarySubdir 多内层仓选主仓', () => {
  it('无内层仓 → null', () => {
    expect(pickPrimarySubdir('foo', [])).toBeNull();
  });

  it('唯一内层仓 → 就是它', () => {
    expect(pickPrimarySubdir('acme', ['acme-app'])).toBe('acme-app');
  });

  it('多内层仓 → 优先与外壳同名/同名前缀者（保证身份键稳定）', () => {
    // 外壳 acme 含 server + acme-app，应选 acme-app（与外壳同名前缀者优先）
    expect(pickPrimarySubdir('acme', ['server', 'acme-app'])).toBe('acme-app');
    // 与外壳完全同名的子仓优先
    expect(pickPrimarySubdir('foo', ['bar', 'foo'])).toBe('foo');
  });

  it('多内层仓且无同名候选 → 字典序第一（确定性，不随读取顺序漂移）', () => {
    expect(pickPrimarySubdir('foo', ['zeta', 'alpha', 'mid'])).toBe('alpha');
    // 输入顺序不同也得到同一结果
    expect(pickPrimarySubdir('foo', ['mid', 'zeta', 'alpha'])).toBe('alpha');
  });

  it('多个同名前缀候选 → 字典序最小者，且不随输入顺序漂移', () => {
    expect(pickPrimarySubdir('foo', ['foo-server', 'foo-app'])).toBe('foo-app');
    expect(pickPrimarySubdir('foo', ['foo-app', 'foo-server'])).toBe('foo-app');
  });

  it('精确同名优先于"同名-前缀"', () => {
    expect(pickPrimarySubdir('foo', ['foo-app', 'foo'])).toBe('foo');
    expect(pickPrimarySubdir('foo', ['foo', 'foo-app'])).toBe('foo');
  });
});
