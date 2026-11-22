import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { enqueue, drain, peek, clearInbox, sweepClaimed, countUnsigned } from '../../src/core/inbox.js';
import { paths } from '../../src/core/paths.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const errno = (code: string) => Object.assign(new Error(code), { code });
const names = () => fs.readdirSync(paths().inboxDir('s1')).sort();

describe('inbox', () => {
  it('enqueue/drain keeps order', async () => {
    for (const t of ['a', 'b', 'c']) await enqueue('s1', t);
    expect((await peek('s1')).map((m) => m.text)).toEqual(['a', 'b', 'c']);
    expect((await drain('s1')).map((m) => m.text)).toEqual(['a', 'b', 'c']);
    expect(await drain('s1')).toEqual([]);
  });
  it('concurrent drains never throw and deliver each message once', async () => {
    for (let i = 0; i < 50; i++) await enqueue('s1', String(i));
    const got = await Promise.all([drain('s1'), drain('s1'), drain('s1'), drain('s1')]);
    const all = got.flat().map((m) => m.text);
    expect(all).toHaveLength(50);
    expect(new Set(all).size).toBe(50);
    // each drain keeps queue order among the messages it claimed
    for (const g of got) expect(g.map((m) => Number(m.text))).toEqual([...g.map((m) => Number(m.text))].sort((a, b) => a - b));
    expect(await drain('s1')).toEqual([]);
    expect(fs.readdirSync(paths().inboxDir('s1'))).toEqual([]);
  });
  it('a message is claimed by rename before it is read: a claimed file is never delivered again', async () => {
    await enqueue('s1', 'a');
    const [f] = fs.readdirSync(paths().inboxDir('s1'));
    fs.renameSync(path.join(paths().inboxDir('s1'), f), path.join(paths().inboxDir('s1'), `${f}.claimed-other`));
    expect(await drain('s1')).toEqual([]);
    expect(await peek('s1')).toEqual([]);
    await clearInbox('s1');
    expect(fs.readdirSync(paths().inboxDir('s1'))).toEqual([]);
  });
  it('a malformed message is claimed and dropped, not re-read forever', async () => {
    fs.mkdirSync(paths().inboxDir('s1'), { recursive: true });
    fs.writeFileSync(path.join(paths().inboxDir('s1'), '000000000000001-000001-x.msg'), '{not json');
    await enqueue('s1', 'ok');
    expect((await drain('s1')).map((m) => m.text)).toEqual(['ok']);
    expect(fs.readdirSync(paths().inboxDir('s1'))).toEqual([]);
  });
  it('leaves no tmp files named .msg', async () => {
    await enqueue('s1', 'a');
    const files = fs.readdirSync(paths().inboxDir('s1'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{15}-\d{6}-.+\.msg$/);
  });

  // Audit R2-N2 (R2 drainloss repro): a persistent EPERM deleting the 2nd claimed file made drain throw,
  // losing the 1st message (already read and deleted) and stranding the 2nd as .claimed-*.
  it('a claimed message is delivered even when deleting the claimed file fails', async () => {
    await enqueue('s1', 'one');
    await enqueue('s1', 'two');
    const real = fsp.rm.bind(fsp);
    let n = 0;
    vi.spyOn(fsp, 'rm').mockImplementation(async (p, o) => {
      if (String(p).includes('.claimed-') && ++n >= 2) throw errno('EPERM');
      return real(p, o);
    });
    expect((await drain('s1')).map((m) => m.text)).toEqual(['one', 'two']);
    vi.restoreAllMocks();
    expect(names()).toHaveLength(1);
    expect(names()[0]).toContain('.msg.claimed-'); // left for the sweep
    expect(await drain('s1')).toEqual([]); // never delivered twice
    expect(await peek('s1')).toEqual([]);
  });
  it('a transient read error on a claimed file is retried and the message delivered in the same pass', async () => {
    await enqueue('s1', 'a');
    const real = fsp.readFile.bind(fsp);
    let fails = 2;
    vi.spyOn(fsp, 'readFile').mockImplementation((async (p: string, o: unknown) => {
      if (String(p).includes('.claimed-') && fails-- > 0) throw errno('EBUSY');
      return real(p, o as never);
    }) as never);
    expect((await drain('s1')).map((m) => m.text)).toEqual(['a']);
    expect(names()).toEqual([]);
  });
  it('a claimed file that still cannot be read is put back as .msg for the next pass, never dropped', async () => {
    await enqueue('s1', 'stuck');
    await enqueue('s1', 'fine');
    const real = fsp.readFile.bind(fsp);
    let reads = 0;
    vi.spyOn(fsp, 'readFile').mockImplementation((async (p: string, o: unknown) => {
      if (String(p).includes('.claimed-')) {
        const raw = String(await real(p, 'utf8'));
        if (raw.includes('stuck')) {
          reads++;
          throw errno('EIO');
        }
      }
      return real(p, o as never);
    }) as never);
    expect((await drain('s1')).map((m) => m.text)).toEqual(['fine']);
    expect(reads).toBe(4); // first read + 3 retries
    vi.restoreAllMocks();
    expect(names()).toHaveLength(1);
    expect(names()[0]).toMatch(/\.msg$/);
    expect((await drain('s1')).map((m) => m.text)).toEqual(['stuck']);
  });
  // Audit R4-L3: an old claimed file is put back as .msg (re-delivery is safer than loss), unless its id
  // is among the delivered ones: then it is deleted.
  it('sweepClaimed puts back claimed files older than the limit, deletes delivered ones, keeps fresh ones', async () => {
    await enqueue('s1', 'queued');
    const dir = paths().inboxDir('s1');
    const old = Date.now() - 2 * 3600_000;
    fs.writeFileSync(path.join(dir, `001-000001-x.msg.claimed-${old}-u1`), JSON.stringify({ id: 'x', text: 'x', createdAt: '' }));
    fs.writeFileSync(path.join(dir, `002-000001-d.msg.claimed-${old}-u3`), JSON.stringify({ id: 'd', text: 'd', createdAt: '' }));
    fs.writeFileSync(path.join(dir, `y.msg.claimed-${Date.now()}-u2`), '{}');
    // older naming (no claim time): falls back to the file mtime
    fs.writeFileSync(path.join(dir, 'z.msg.claimed-0d6e2c9a-uuid'), '{}');
    fs.utimesSync(path.join(dir, 'z.msg.claimed-0d6e2c9a-uuid'), new Date(old), new Date(old));
    expect(await sweepClaimed('s1', 3600_000, new Set(['d']))).toBe(3);
    const left = names();
    expect(left.some((n) => n.startsWith('y.msg.claimed-'))).toBe(true);
    expect(left).toContain('001-000001-x.msg');
    expect(left).toContain('z.msg');
    expect(left.some((n) => n.startsWith('002-'))).toBe(false);
    expect(left).toHaveLength(4);
    expect(await sweepClaimed('nobody', 3600_000)).toBe(0);
  });
  it('a claim marker whose holder died is removed at once, by the sweep and by the next drain', async () => {
    await enqueue('s1', 'a');
    const [f] = names();
    const marker = path.join(paths().inboxDir('s1'), `${f}.claim`);
    const { spawnSync } = await import('node:child_process');
    const dead = spawnSync(process.execPath, ['-e', '']).pid!;
    fs.writeFileSync(marker, String(dead));
    expect(await drain('s1')).toEqual([]); // held: skipped this pass, the dead holder's marker removed
    expect(fs.existsSync(marker)).toBe(false);
    expect((await drain('s1')).map((m) => m.text)).toEqual(['a']);
    await enqueue('s1', 'b');
    const [g] = names();
    fs.writeFileSync(path.join(paths().inboxDir('s1'), `${g}.claim`), String(dead));
    expect(await sweepClaimed('s1', 3600_000)).toBe(1);
    fs.writeFileSync(path.join(paths().inboxDir('s1'), `${g}.claim`), String(process.pid)); // a live holder
    expect(await sweepClaimed('s1', 3600_000)).toBe(0);
    expect(await drain('s1')).toEqual([]);
  });

  // CI, windows-latest: 4 concurrent drains of 50 messages delivered 51. Windows renames through an open
  // handle: two drains that both opened the same .msg could both rename it (A to its claimed name, then
  // B moves that same file on to its own), and both read it. A claim now first takes an exclusive
  // marker (<name>.msg.claim, created with O_EXCL); only its holder renames the message.
  it('a message whose claim marker another drain holds is skipped, and claimed once the marker is gone', async () => {
    await enqueue('s1', 'a');
    const [f] = names();
    fs.writeFileSync(path.join(paths().inboxDir('s1'), `${f}.claim`), '');
    expect(await drain('s1')).toEqual([]);
    expect((await peek('s1')).map((m) => m.text)).toEqual(['a']);
    fs.rmSync(path.join(paths().inboxDir('s1'), `${f}.claim`));
    expect((await drain('s1')).map((m) => m.text)).toEqual(['a']);
    expect(names()).toEqual([]);
  });
  it('the claim marker is removed after the claim, also when the message was already taken', async () => {
    await enqueue('s1', 'a');
    vi.spyOn(fsp, 'rename').mockImplementationOnce(async () => {
      throw errno('ENOENT');
    });
    expect(await drain('s1')).toEqual([]);
    vi.restoreAllMocks();
    expect(names().some((n) => n.endsWith('.claim'))).toBe(false);
  });
  it('sweepClaimed removes stale claim markers (never the message), so a put-back message is claimable again', async () => {
    await enqueue('s1', 'kept');
    const [f] = names();
    const marker = path.join(paths().inboxDir('s1'), `${f}.claim`);
    fs.writeFileSync(marker, '');
    const old = new Date(Date.now() - 2 * 3600_000);
    fs.utimesSync(marker, old, old);
    expect(await sweepClaimed('s1', 3600_000)).toBe(1);
    expect(names()).toEqual([f]);
    expect((await drain('s1')).map((m) => m.text)).toEqual(['kept']);
  });
  it('many concurrent drains, repeated, deliver every message exactly once', async () => {
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 40; i++) await enqueue('s1', `${round}-${i}`);
      const got = await Promise.all(Array.from({ length: 8 }, () => drain('s1')));
      const all = got.flat().map((m) => m.text);
      expect(all).toHaveLength(40);
      expect(new Set(all).size).toBe(40);
      expect(names()).toEqual([]);
    }
  });

  // Audit R3-F6: Windows antivirus briefly holds a just-written file; a bare rename made the POST fail (500).
  it('enqueue retries a transient EPERM/EBUSY/EACCES on its rename', async () => {
    const real = fsp.rename.bind(fsp);
    let fails = 2;
    vi.spyOn(fsp, 'rename').mockImplementation(async (a, b) => {
      if (String(a).endsWith('.tmp') && fails-- > 0) throw errno('EPERM');
      return real(a, b);
    });
    await enqueue('s1', 'x');
    vi.restoreAllMocks();
    expect((await peek('s1')).map((m) => m.text)).toEqual(['x']);
  });
  it('the claim rename retries transient errors; ENOENT still means another drain took it', async () => {
    await enqueue('s1', 'x');
    const real = fsp.rename.bind(fsp);
    let fails = 2;
    vi.spyOn(fsp, 'rename').mockImplementation(async (a, b) => {
      if (String(b).includes('.claimed-') && fails-- > 0) throw errno('EBUSY');
      return real(a, b);
    });
    expect((await drain('s1')).map((m) => m.text)).toEqual(['x']);
  });
});


// Audit R4-M2 / S4-S2: a message is judged BEFORE its claimed file is deleted. One that fails the check
// is never delivered and never silently lost: it is kept as <name>.msg.unsigned.
describe('drain with a judge', () => {
  it('delivers, keeps aside as .unsigned, or drops, as the judge says', async () => {
    for (const t of ['ok', 'old', 'replayed']) await enqueue('s1', t);
    const got = await drain('s1', (m) => (m.text === 'ok' ? 'deliver' : m.text === 'old' ? 'unsigned' : 'drop'));
    expect(got.map((m) => m.text)).toEqual(['ok']);
    const left = names();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/^\d{15}-\d{6}-.+\.msg\.unsigned$/);
    expect(JSON.parse(fs.readFileSync(path.join(paths().inboxDir('s1'), left[0]), 'utf8')).text).toBe('old');
    expect(await countUnsigned('s1')).toBe(1);
    expect(await drain('s1', () => 'deliver')).toEqual([]); // never listed again
    await clearInbox('s1');
    expect(names()).toEqual([]);
    expect(await countUnsigned('nobody')).toBe(0);
  });
  it('the delivered messages are recorded before their claimed files are deleted', async () => {
    await enqueue('s1', 'a');
    let seenFiles: string[] = [];
    const got = await drain('s1', () => 'deliver', async (ms) => {
      expect(ms.map((m) => m.text)).toEqual(['a']);
      seenFiles = names();
    });
    expect(got.map((m) => m.text)).toEqual(['a']);
    expect(seenFiles.some((n) => n.includes('.msg.claimed-'))).toBe(true);
    expect(names()).toEqual([]);
  });
  it('a failing record still delivers (the messages are claimed)', async () => {
    await enqueue('s1', 'a');
    const got = await drain('s1', () => 'deliver', async () => {
      throw new Error('disk full');
    });
    expect(got.map((m) => m.text)).toEqual(['a']);
  });
});
