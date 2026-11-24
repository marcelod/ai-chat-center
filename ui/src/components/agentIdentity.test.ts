import { describe, expect, it } from 'vitest';
import { agentIdentity } from './MessageBubble';

describe('agentIdentity', () => {
  it('gives initials from the first two words and a stable colour per name', () => {
    expect(agentIdentity('dev-c2-frontend').initials).toBe('DC');
    expect(agentIdentity('Fix stuck busy status').initials).toBe('FS');
    expect(agentIdentity('explorer').initials).toBe('EX');
    expect(agentIdentity('dev-c2-frontend').color).toBe(agentIdentity('dev-c2-frontend').color);
    expect(agentIdentity('dev-c1-backend').color).not.toBe(agentIdentity('dev-c2-frontend').color);
  });
});
