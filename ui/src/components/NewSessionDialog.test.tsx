import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../i18n';
import { NewSessionDialog, validName } from './NewSessionDialog';
import { ApiError, type FolderListing } from '../api';

// Spec 2026-11-25-app-batch: a new background session from the app.

const folders = [
  { cwd: '/home/me/billing', lastUsed: '2026-11-25T00:00:00.000Z' },
  { cwd: '/home/me/site', lastUsed: '2026-11-24T00:00:00.000Z' },
];

const tree: Record<string, FolderListing> = {
  '/home/me': { path: '/home/me', parent: null, entries: [{ name: 'new-proj', path: '/home/me/new-proj' }], truncated: false },
  '/home/me/new-proj': { path: '/home/me/new-proj', parent: '/home/me', entries: [], truncated: false },
};
const fakeBrowse = vi.fn(async (p?: string, hidden?: boolean) => {
  void hidden;
  const l = tree[p ?? '/home/me'];
  if (!l) throw Object.assign(new ApiError(403, 'folder-outside'));
  return l;
});

function open(onStart = vi.fn(async () => {}), onClose = vi.fn(), opts: { recent?: typeof folders; browse?: typeof fakeBrowse; lang?: 'en' | 'pt-BR' } = {}) {
  render(
    <LangProvider lang={opts.lang ?? 'en'}>
      <NewSessionDialog loadFolders={async () => opts.recent ?? folders} browse={opts.browse ?? fakeBrowse} onStart={onStart} onClose={onClose} />
    </LangProvider>,
  );
  return { onStart, onClose };
}

describe('NewSessionDialog', () => {
  it('starts in the chosen folder with the chosen name, model and effort, then closes', async () => {
    const { onStart, onClose } = open();
    const user = userEvent.setup();
    const folder = await screen.findByRole('combobox', { name: 'Folder' });
    expect((folder as HTMLSelectElement).value).toBe('/home/me/billing'); // most recent first
    await user.selectOptions(folder, '/home/me/site');
    await user.type(screen.getByRole('textbox', { name: 'Name (optional)' }), 'site fixes');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'sonnet');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Effort' }), 'high');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStart).toHaveBeenCalledWith({ cwd: '/home/me/site', name: 'site fixes', model: 'sonnet', effort: 'high' });
    expect(onClose).toHaveBeenCalled();
  });

  it('defaults send only the folder', async () => {
    const { onStart } = open();
    await screen.findByRole('combobox', { name: 'Folder' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start' }));
    expect(onStart).toHaveBeenCalledWith({ cwd: '/home/me/billing' });
  });

  it('an invalid name blocks Start', async () => {
    open();
    const user = userEvent.setup();
    await screen.findByRole('combobox', { name: 'Folder' });
    await user.type(screen.getByRole('textbox', { name: 'Name (optional)' }), 'a"b');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(validName('ação 2')).toBe(true);
    expect(validName('a&b')).toBe(false);
  });

  it('a failure shows the output of claude --bg and keeps the dialog open', async () => {
    const onStart = vi.fn(async () => Promise.reject(Object.assign(new Error('502'), { status: 502, detail: 'Workspace not trusted.' })));
    const { onClose } = open(onStart);
    await screen.findByRole('combobox', { name: 'Folder' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Workspace not trusted.');
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('any folder (spec 2026-11-25-any-folder)', () => {
    it('browses from the home folder, enters a subfolder, uses it and starts there', async () => {
      const { onStart } = open();
      const user = userEvent.setup();
      await screen.findByRole('combobox', { name: 'Folder' });
      await user.click(screen.getByRole('button', { name: 'Browse folders…' }));
      const browser = await screen.findByRole('group', { name: 'Folder browser' });
      await within(browser).findByRole('button', { name: 'new-proj' });
      expect(screen.getByRole('button', { name: 'Up one folder' })).toBeDisabled(); // the home folder: no parent
      await user.click(within(browser).getByRole('button', { name: 'new-proj' }));
      expect(await within(browser).findByText('No subfolders here.')).toBeTruthy();
      expect((screen.getByRole('textbox', { name: 'Or type or paste a full path' }) as HTMLInputElement).value).toBe('/home/me/new-proj');
      expect(screen.getByRole('button', { name: 'Up one folder' })).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Use this folder' }));
      expect(screen.queryByRole('group', { name: 'Folder browser' })).toBeNull();
      expect((screen.getByRole('combobox', { name: 'Folder' }) as HTMLSelectElement).value).toBe('/home/me/new-proj');
      await user.click(screen.getByRole('button', { name: 'Start' }));
      expect(onStart).toHaveBeenCalledWith({ cwd: '/home/me/new-proj' });
    });

    it('a typed path goes there with Enter (never starts the session); a path outside home shows the hub refusal', async () => {
      const { onStart } = open();
      const user = userEvent.setup();
      await screen.findByRole('combobox', { name: 'Folder' });
      await user.click(screen.getByRole('button', { name: 'Browse folders…' }));
      await within(screen.getByRole('group', { name: 'Folder browser' })).findByRole('button', { name: 'new-proj' });
      const field = screen.getByRole('textbox', { name: 'Or type or paste a full path' });
      await user.clear(field);
      await user.type(field, '/etc{Enter}');
      expect((await screen.findByRole('alert')).textContent).toBe('Only folders inside your home folder can be used.');
      expect(onStart).not.toHaveBeenCalled();
      await user.clear(field);
      await user.type(field, '/home/me/new-proj{Enter}');
      expect(await screen.findByText('No subfolders here.')).toBeTruthy();
      expect(fakeBrowse).toHaveBeenLastCalledWith('/home/me/new-proj', false);
    });

    it('"show hidden folders" asks the hub again with hidden', async () => {
      const browse = vi.fn(fakeBrowse);
      open(undefined, undefined, { browse });
      const user = userEvent.setup();
      await screen.findByRole('combobox', { name: 'Folder' });
      await user.click(screen.getByRole('button', { name: 'Browse folders…' }));
      await screen.findByRole('button', { name: 'new-proj' });
      await user.click(screen.getByRole('checkbox', { name: 'Show hidden folders' }));
      expect(browse).toHaveBeenLastCalledWith('/home/me', true);
    });

    it('with no recent folder, the browser opens at once', async () => {
      open(undefined, undefined, { recent: [] });
      expect(await screen.findByRole('group', { name: 'Folder browser' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    });

    it('says the truncation', async () => {
      const browse = vi.fn(async () => ({ path: '/home/me', parent: null, entries: [{ name: 'a', path: '/home/me/a' }], truncated: true }));
      open(undefined, undefined, { browse });
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Browse folders…' }));
      expect(await screen.findByText('Only the first 1 folders are shown.')).toBeTruthy();
    });

    it('an untrusted folder says how to trust it, in both languages', async () => {
      const onStart = vi.fn(async () => Promise.reject(Object.assign(new ApiError(502, 'untrusted'), { detail: 'Workspace not trusted' })));
      open(onStart, undefined, { lang: 'pt-BR' });
      await screen.findByRole('combobox', { name: 'Pasta' });
      await userEvent.setup().click(screen.getByRole('button', { name: 'Iniciar' }));
      const msg = (await screen.findByRole('alert')).textContent;
      expect(msg).toContain('/home/me/billing');
      expect(msg).toContain('rode claude uma vez');
    });
  });
});
