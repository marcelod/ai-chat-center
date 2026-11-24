/** Plugin version. Kept equal to plugin/.claude-plugin/plugin.json and package.json by test/core/version.test.ts. */
export const VERSION = '0.4.5';

/**
 * The hub <-> waiter message protocol (today: inbox messages signed `v2|sid|id|createdAt|text`). The hook and
 * the waiter record it in the session's registration; the hub refuses to queue a message for a session whose
 * registration carries another protocol (or none): that session runs another copy of the plugin, which would
 * drop the message (audit R5-M1). Bump it with EVERY change of the message or signature format
 * (test/core/version.test.ts pins the two together).
 */
export const PROTOCOL = 2;
