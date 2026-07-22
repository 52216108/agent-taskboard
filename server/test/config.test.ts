import { describe, expect, it } from 'vitest';
import { buildAllowedHosts, checkSecureBinding, hostnameOf, isLoopbackHost } from '../src/config';

describe('isLoopbackHost', () => {
  it('认本机地址', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]', ' 127.0.0.1 ']) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
  });

  it('通配地址与外部地址都不算本机', () => {
    // 0.0.0.0 / :: 覆盖所有接口，网络可达——这是最容易被误判成"本地"的一类
    for (const h of ['0.0.0.0', '::', '[::]', '192.168.1.10', '100.64.0.1', 'board.example.com', '']) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });

  it('主机名形式的前缀伪装不能冒充本机', () => {
    // 127.0.0.1.evil.com 能被 DNS 解析到任意地址；只认 IP 字面量才挡得住
    for (const h of ['127.0.0.1.evil.com', '127.0.0.1.nip.io', 'localhost.evil.com']) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
    expect(isLoopbackHost('::ffff:127.0.0.2')).toBe(true);
  });
});

describe('hostnameOf', () => {
  it('剥掉端口，保留 IPv6 方括号形式', () => {
    expect(hostnameOf('127.0.0.1:7788')).toBe('127.0.0.1');
    expect(hostnameOf('LocalHost:80')).toBe('localhost');
    expect(hostnameOf('[::1]:7788')).toBe('[::1]');
    expect(hostnameOf('[::1]')).toBe('[::1]');
    expect(hostnameOf(' board.local ')).toBe('board.local');
  });
});

describe('buildAllowedHosts', () => {
  it('默认放行本机 hostname（端口不参与判定）', () => {
    const hosts = buildAllowedHosts(undefined);
    for (const h of ['127.0.0.1', 'localhost', '[::1]']) {
      expect(hosts.has(h), h).toBe(true);
    }
  });

  it('拒绝未列入的 hostname（DNS rebinding 用的正是攻击者域名）', () => {
    const hosts = buildAllowedHosts(undefined);
    for (const h of ['evil.example.com', 'attacker.local']) {
      expect(hosts.has(h), h).toBe(false);
    }
  });

  it('BOARD_ALLOWED_HOSTS 放行隧道/反代域名，大小写与端口都归一', () => {
    const hosts = buildAllowedHosts(' MyMac.tailnet.ts.net , board.local:8080 ');
    expect(hosts.has('mymac.tailnet.ts.net')).toBe(true);
    expect(hosts.has('board.local')).toBe(true);
  });
});

describe('checkSecureBinding', () => {
  it('本机绑定无需 token', () => {
    expect(checkSecureBinding({ host: '127.0.0.1', token: null })).toBeNull();
  });

  it('网络可达且无 token 时拒绝启动', () => {
    const msg = checkSecureBinding({ host: '0.0.0.0', token: null });
    expect(msg).toContain('BOARD_TOKEN');
  });

  it('网络可达但已设 token 时放行', () => {
    expect(checkSecureBinding({ host: '0.0.0.0', token: 'secret' })).toBeNull();
  });
});
