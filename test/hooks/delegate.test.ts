import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';
import { VERSION } from '../../src/core/version.js';
import { compareVersions, newerScript } from '../../src/hooks/delegate.js';

let root: string;
let prevHome: string | undefined;
const record = () => path.join(root, 'state', 'plugin.json');

/** A fake installed version folder: <cache>/<version>/{.claude-plugin/plugin.json, dist/<entries>}. */
function install(cache: string, version: string, body = ''): string {
  const dir = path.join(cache, version);
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ai-chat-center', version }));
  fs.writeFileSync(path.join(dir, 'dist', 'waiter.mjs'), body);
  return fs.realpathSync(path.join(dir, 'dist'));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-delegate-'));
  prevHome = process.env.AI_CHAT_CENTER_HOME;
  process.env.AI_CHAT_CENTER_HOME = path.join(root, 'state');
  fs.mkdirSync(path.join(root, 'state'));
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.AI_CHAT_CENTER_HOME;
  else process.env.AI_CHAT_CENTER_HOME = prevHome;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('compareVersions', () => {
  it('compares x.y.z numerically', () => {
    expect(compareVersions('0.6.10', '0.6.9')).toBe(1);
    expect(compareVersions('0.6.5', '0.6.5')).toBe(0);
    expect(compareVersions('0.5.9', '1.0.0')).toBe(-1);
  });
});

describe('an older copy runs the newest installed one', () => {
  it('the first hook records its own version folder; the same version runs itself', () => {
    const cache = path.join(root, 'cache');
    const own = install(cache, '0.6.5');
    expect(newerScript('waiter.mjs', own, '0.6.5')).toBeNull();
    expect(JSON.parse(fs.readFileSync(record(), 'utf8'))).toEqual({ version: '0.6.5', dist: own });
  });
  it('a session on an old version runs the newer sibling', () => {
    const cache = path.join(root, 'cache');
    const old = install(cache, '0.6.5');
    const fresh = install(cache, '0.6.6');
    expect(newerScript('waiter.mjs', fresh, '0.6.6')).toBeNull(); // the updated session records 0.6.6
    expect(newerScript('waiter.mjs', old, '0.6.5')).toBe(path.join(fresh, 'waiter.mjs'));
  });
  it('a newer hook takes over the record from an older one', () => {
    const cache = path.join(root, 'cache');
    const old = install(cache, '0.6.5');
    const fresh = install(cache, '0.6.6');
    newerScript('waiter.mjs', old, '0.6.5');
    newerScript('waiter.mjs', fresh, '0.6.6');
    expect(JSON.parse(fs.readFileSync(record(), 'utf8')).version).toBe('0.6.6');
    newerScript('waiter.mjs', old, '0.6.5'); // the old one never writes an older version back
    expect(JSON.parse(fs.readFileSync(record(), 'utf8')).version).toBe('0.6.6');
  });
  it('never runs a folder outside its own install (not a sibling)', () => {
    const old = install(path.join(root, 'cache'), '0.6.5');
    const other = install(path.join(root, 'elsewhere'), '0.9.0');
    fs.mkdirSync(path.dirname(record()), { recursive: true });
    fs.writeFileSync(record(), JSON.stringify({ version: '0.9.0', dist: other }));
    expect(newerScript('waiter.mjs', old, '0.6.5')).toBeNull();
  });
  it('never runs a folder whose plugin.json says another version', () => {
    const cache = path.join(root, 'cache');
    const old = install(cache, '0.6.5');
    const fake = install(cache, '0.7.0');
    fs.writeFileSync(path.join(cache, '0.7.0', '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '0.6.0' }));
    fs.writeFileSync(record(), JSON.stringify({ version: '0.7.0', dist: fake }));
    expect(newerScript('waiter.mjs', old, '0.6.5')).toBeNull();
  });
  it('a newer folder that was removed: runs itself and records itself again', () => {
    const cache = path.join(root, 'cache');
    const old = install(cache, '0.6.5');
    const fresh = install(cache, '0.6.6');
    newerScript('waiter.mjs', fresh, '0.6.6');
    fs.rmSync(path.join(cache, '0.6.6'), { recursive: true });
    expect(newerScript('waiter.mjs', old, '0.6.5')).toBeNull();
    expect(JSON.parse(fs.readFileSync(record(), 'utf8'))).toEqual({ version: '0.6.5', dist: old });
  });
  it('a development copy (not in a version folder) never records itself nor delegates', () => {
    const dev = path.join(root, 'repo', 'plugin');
    fs.mkdirSync(path.join(dev, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(dev, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dev, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '0.6.5' }));
    expect(newerScript('waiter.mjs', path.join(dev, 'dist'), '0.6.5')).toBeNull();
    expect(fs.existsSync(record())).toBe(false);
  });
  it('a broken record is ignored', () => {
    const own = install(path.join(root, 'cache'), '0.6.5');
    fs.mkdirSync(path.dirname(record()), { recursive: true });
    fs.writeFileSync(record(), '{not json');
    expect(newerScript('waiter.mjs', own, '0.6.5')).toBeNull();
    expect(JSON.parse(fs.readFileSync(record(), 'utf8')).version).toBe('0.6.5');
  });
});

describe('delegateToNewer end to end', () => {
  it("an old entry runs the newer copy's script once, in the same process, with the same argv", () => {
    const cache = path.join(root, 'cache');
    const delegateSrc = path.resolve('src/hooks/delegate.ts');
    // The newer copy only prints what it got; the old entry is a tiny script calling delegateToNewer.
    // The old entry is bundled with the real version.ts: it is VERSION, the newer copy one patch above.
    const [maj, min, pat] = VERSION.split('.').map(Number);
    const newer = `${maj}.${min}.${pat + 1}`;
    const fresh = install(cache, newer, "console.log('new', process.argv[2]);\n");
    const old = install(cache, VERSION);
    fs.writeFileSync(record(), JSON.stringify({ version: newer, dist: fresh }));
    // The old copy's entry, bundled like plugin/dist (the real delegate.ts inside).
    const entry = path.join(old, 'waiter.mjs');
    buildSync({
      stdin: {
        contents:
          `import { delegateToNewer } from ${JSON.stringify(delegateSrc)};\n` +
          `if (!(await delegateToNewer('waiter.mjs', import.meta.url))) console.log('old');\n`,
        resolveDir: path.dirname(delegateSrc),
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node18',
      outfile: entry,
      logLevel: 'silent',
    });
    const r = spawnSync(process.execPath, [entry, 'stop'], { env: { ...process.env, AI_CHAT_CENTER_HOME: path.join(root, 'state') }, encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('new stop');
    // without a newer copy it runs itself
    fs.writeFileSync(record(), JSON.stringify({ version: VERSION, dist: old }));
    expect(spawnSync(process.execPath, [entry, 'stop'], { env: { ...process.env, AI_CHAT_CENTER_HOME: path.join(root, 'state') }, encoding: 'utf8' }).stdout.trim()).toBe('old');
  });
});
