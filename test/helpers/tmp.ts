import { afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Audit S5-I3: every temp folder a test creates is removed after that test (a full run used to leave
// hundreds of acc-* folders in the system temp folder). Importing this module registers the afterEach.

const made: string[] = [];

/** A new folder in the system temp folder, removed after the current test. */
export function tmpDir(prefix = 'acc-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}

/** Removes a folder, retrying while a file in it is still busy (Windows) or being written (a hub's log). */
export function removeDir(d: string): void {
  try {
    fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch {
    /* best effort: never fail a test over its cleanup */
  }
}

afterEach(() => {
  for (const d of made.splice(0)) removeDir(d);
});
