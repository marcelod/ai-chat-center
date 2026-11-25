import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../i18n';
import { NewSessionDialog, validName } from './NewSessionDialog';

// Spec 2026-11-25-app-batch: a new background session from the app.

const folders = [
  { cwd: '/home/me/billing', lastUsed: '2026-11-25T00:00:00.000Z' },
  { cwd: '/home/me/site', lastUsed: '2026-11-24T00:00:00.000Z' },
];

function open(onStart = vi.fn(async () => {}), onClose = vi.fn()) {
  render(
    <LangProvider lang="en">
      <NewSessionDialog loadFolders={async () => folders} onStart={onStart} onClose={onClose} />
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
});
