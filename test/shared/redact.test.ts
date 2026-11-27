import { describe, expect, it } from 'vitest';
import { redactAppSecrets, stripAppBlocks, stripTerminalCodes } from '../../src/shared/redact.js';

describe('stripTerminalCodes', () => {
  it('removes colours, OSC titles, carriage returns and control characters, keeps tabs and newlines', () => {
    expect(stripTerminalCodes('\x1b[31mred\x1b[0m\x1b]0;title\x07 a\r\nb\tc\x07')).toBe('red a\nb\tc');
  });
  it('stays linear on many OSC or DCS openers without a terminator', () => {
    for (const s of ['\x1b]a'.repeat(50_000), '\x1bPa'.repeat(50_000)]) {
      const t = performance.now();
      expect(stripTerminalCodes(s)).toBe('a'.repeat(50_000));
      expect(performance.now() - t).toBeLessThan(300);
    }
    expect(stripTerminalCodes('\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\ \x1bPq#0\x1b\\ok')).toBe('link ok');
  });
});

describe('redactAppSecrets', () => {
  it('removes app links, link fragments, long hex runs and the given secrets', () => {
    const s = redactAppSecrets(
      'open http://127.0.0.1:4823/#token=abc and localhost:5173/x, frag #pair=zz, key 0123456789abcdef0123, word supersecretvalue',
      ['supersecretvalue'],
    );
    expect(s).not.toMatch(/127\.0\.0\.1|localhost|token=|pair=|0123456789abcdef|supersecretvalue/);
    expect(s).toContain('[app link removed]');
    expect(s).toContain('[redacted]');
  });
  it('takes the scheme with the address, and stays fast on a long run of letters', () => {
    expect(redactAppSecrets('go: http://localhost:1/x (or 1abc+x://127.0.0.1)')).toBe('go: [app link removed] (or 1[app link removed])');
    const t = Date.now();
    redactAppSecrets('x'.repeat(200_000));
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it('stays linear on long runs where a scheme could start at every letter (hex, a1a1…, a-a-…, dotted names)', () => {
    const hex = Array.from({ length: 100_000 }, (_, i) => '0123456789abcdef'[(i * 7) % 16]).join('');
    for (const s of [hex, 'a1'.repeat(50_000), 'a-'.repeat(50_000), 'a+'.repeat(50_000), 'pkg1.'.repeat(20_000)]) {
      const t = performance.now();
      redactAppSecrets(s);
      expect(performance.now() - t).toBeLessThan(300);
    }
  });
  it('removes the other loopback addresses too: [::1], 0.0.0.0 and any 127.x.y.z', () => {
    for (const link of ['http://[::1]:4823/#token=x', '0.0.0.0:5173/app', 'ws://127.1.2.3:9/a', '[::1]']) {
      const s = redactAppSecrets(`open ${link} now`);
      expect(s, link).toBe('open [app link removed] now');
    }
  });
  it('ignores short secrets and keeps ordinary text', () => {
    expect(redactAppSecrets('see https://example.com and abc123', ['abc'])).toBe('see https://example.com and abc123');
  });
});

describe('stripAppBlocks', () => {
  it('keeps only the body of app message blocks, without id or key', () => {
    const raw = 'before\n[AI Chat Center message id=m1 key=k9]\nhello\nthere\n[/AI Chat Center message]\nafter';
    expect(stripAppBlocks(raw)).toBe('before\nhello\nthere\nafter');
  });
  it('drops stray open and close tags', () => {
    expect(stripAppBlocks('[AI Chat Center message id=x key=y] hi [/AI Chat Center message]')).toBe('hi');
  });
  it('unescapes an escaped close tag in a body', () => {
    expect(stripAppBlocks('[AI Chat Center message id=a]\nx [\\/AI Chat Center message] y\n[/AI Chat Center message]')).toBe(
      'x [/AI Chat Center message] y',
    );
  });
});
