// Text that leaves the app (the session screen, an exported conversation) must not carry anything that could
// open the app: the /cc link, the token, the per-connection key, the install secret. These are the pure
// filters shared by the hub (sessionScreen.ts) and the UI (conversation export).

/* eslint-disable no-control-regex */
const ANSI = [
  /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, // OSC (window title, hyperlinks)
  /\x1b[P^_][\s\S]*?\x1b\\/g, // DCS, PM, APC
  /\x1b\[[0-?]*[ -/]*[@-~]/g, // CSI (colours, cursor)
  /\x1b[()*+][0-9A-Za-z]/g, // character sets
  /\x1b[@-Z\\-_=>78]/g, // other two-byte escapes
];
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;
/* eslint-enable no-control-regex */
/**
 * Any address of the hub: the /cc link and anything else on this machine's loopback. A scheme starts only
 * after a non-letter (the leftmost match is the same), so a long run of letters is not rescanned from every
 * position.
 */
const APP_URL = /(?:(?<![a-z])[a-z][a-z0-9+.-]*:\/\/)?(?:127\.\d+\.\d+\.\d+|localhost|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:[/?#]\S*)?/gi;
/** Fragments of the link even without its address (`#token=…`, `#pair=…`). */
const LINK_PARTS = /[#?&](?:token|pair)=\S*/gi;
/** A long hex run: the token, the key, the secret, or a piece of one cut at the end of a line. */
const HEX_RUN = /[0-9a-fA-F]{16,}/g;

/** Terminal escape codes and control characters out; `\r\n` and lone `\r` become `\n`. Tabs stay. */
export function stripTerminalCodes(raw: string): string {
  let s = raw;
  for (const re of ANSI) s = s.replace(re, '');
  return s.replace(/\r\n?/g, '\n').replace(CONTROL, '');
}

/** The given secrets (8 characters or more), every app address, link fragment and long hex run, replaced. */
export function redactAppSecrets(text: string, secrets: string[] = []): string {
  let s = text;
  for (const secret of secrets) if (secret && secret.length >= 8) s = s.split(secret).join('[redacted]');
  return s.replace(APP_URL, '[app link removed]').replace(LINK_PARTS, '[app link removed]').replace(HEX_RUN, '[redacted]');
}

/** A whole app message block (see core/protocol.ts), or a stray opening or closing tag. */
const APP_BLOCK =
  /\[AI Chat Center message id=[^\]\s]+(?: key=[^\]\s]+)?\]\n([\s\S]*?)\n\[\/AI Chat Center message\]|\[AI Chat Center message(?: [^\]\n]*)?\]|\[\/AI Chat Center message\]/g;
const unescapeBody = (t: string) => t.replace(/\[(\\*)\\\/AI Chat Center message\]/g, '[$1/AI Chat Center message]');

/** App message blocks reduced to what the user wrote: no id, no key, no tags. */
export function stripAppBlocks(text: string): string {
  if (!text.includes('AI Chat Center message')) return text;
  return text.replace(APP_BLOCK, (_m, body: string | undefined) => (body === undefined ? '' : unescapeBody(body))).trim();
}
