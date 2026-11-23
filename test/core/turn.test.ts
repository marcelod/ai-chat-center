import { describe, it, expect, beforeEach } from 'vitest';
import { getTurnOrigin, setTurnOrigin, clearTurnOrigin, promptOrigin } from '../../src/core/turn.js';
import { tmpDir } from '../helpers/tmp.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
});

const block = (key: string) => `[AI Chat Center message id=x key=${key}]\ntexto\n[/AI Chat Center message]`;

describe('turn origin', () => {
  it('getTurnOrigin is null without a file, then round-trips and clears', async () => {
    expect(await getTurnOrigin('s1')).toBeNull();
    await setTurnOrigin('s1', 'app');
    expect(await getTurnOrigin('s1')).toBe('app');
    await clearTurnOrigin('s1');
    expect(await getTurnOrigin('s1')).toBeNull();
  });

  it('promptOrigin is app only for a block with the session key, anywhere in the prompt', () => {
    expect(promptOrigin(block('k1'), 'k1')).toBe('app');
    expect(promptOrigin(`before\n${block('k1')}\nafter`, 'k1')).toBe('app');
    expect(promptOrigin(block('k2'), 'k1')).toBe('terminal');
    expect(promptOrigin('hello', 'k1')).toBe('terminal');
    expect(promptOrigin(block('k1'), undefined)).toBe('terminal');
    expect(promptOrigin(undefined, 'k1')).toBe('terminal');
  });
});
