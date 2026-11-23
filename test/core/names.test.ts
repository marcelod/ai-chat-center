import { describe, it, expect, beforeEach } from 'vitest';
import { getDisplayName, setDisplayName, validDisplayName } from '../../src/core/names.js';
import { tmpDir } from '../helpers/tmp.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
});

describe('names', () => {
  it('sets, gets and clears', async () => {
    expect(await getDisplayName('s1')).toBeNull();
    await setDisplayName('s1', 'My chat');
    expect(await getDisplayName('s1')).toBe('My chat');
    await setDisplayName('s1', '');
    expect(await getDisplayName('s1')).toBeNull();
  });
  it('rejects an invalid session id', async () => {
    await expect(setDisplayName('../x', 'a')).rejects.toThrow();
  });
  it('validDisplayName', () => {
    for (const bad of ['  ', ' a', 'a ', 'a'.repeat(81), 5, null, undefined, {}]) expect(validDisplayName(bad)).toBeNull();
    expect(validDisplayName('')).toBe('');
    expect(validDisplayName('a'.repeat(80))).toBe('a'.repeat(80));
    expect(validDisplayName('ok name')).toBe('ok name');
  });
});
