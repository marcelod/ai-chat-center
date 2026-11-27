import { describe, expect, it } from 'vitest';
import { IMAGE_EXTENSIONS, MARKDOWN_EXTENSIONS, PANEL_EXTENSIONS, PDF_EXTENSIONS, panelFileKind, TEXT_EXTENSIONS } from '../../src/shared/fileTypes.js';

// Specs 2026-11-26-side-panel and 2026-11-27-side-panel-file-types: the file types the side panel opens,
// shared by the hub and the app.

describe('panelFileKind', () => {
  it('maps every listed extension to its kind, case ignored', () => {
    for (const e of MARKDOWN_EXTENSIONS) expect(panelFileKind(`a.${e.toUpperCase()}`)).toBe('markdown');
    for (const e of IMAGE_EXTENSIONS) expect(panelFileKind(`dir/a.${e}`)).toBe('image');
    for (const e of TEXT_EXTENSIONS) expect(panelFileKind(`a.${e}`)).toBe('text');
    for (const e of PDF_EXTENSIONS) expect(panelFileKind(`a.${e}`)).toBe('pdf');
  });
  it('leaves out formats that usually hold secrets, binaries and names without an extension', () => {
    for (const n of ['.env', 'a.env', 'a.ini', 'a.conf', 'a.pem', 'a.key', 'id_rsa', 'a.exe', 'a.bin', 'a.zip', 'Makefile', 'a.mdx', 'a.md5', 'a.']) {
      expect(panelFileKind(n), n).toBeNull();
    }
  });
  it('lists each extension once, longest first (for a regular expression alternation)', () => {
    expect(new Set(PANEL_EXTENSIONS).size).toBe(PANEL_EXTENSIONS.length);
    for (let i = 1; i < PANEL_EXTENSIONS.length; i++) expect(PANEL_EXTENSIONS[i - 1].length).toBeGreaterThanOrEqual(PANEL_EXTENSIONS[i].length);
    expect(PANEL_EXTENSIONS.length).toBe(MARKDOWN_EXTENSIONS.length + IMAGE_EXTENSIONS.length + TEXT_EXTENSIONS.length + PDF_EXTENSIONS.length);
  });
});
