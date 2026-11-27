import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../i18n';
import { Composer } from './Composer';
import { classify, suggestions } from '../commands';

// Spec 2026-11-25-app-batch: the list of commands when `/` is typed in a background session.

let n = 0; // drafts persist per session id: a fresh one for each test

function composer(onCommand = vi.fn(async () => {}), onSend = vi.fn(async () => {}), bg = true, onScreenCommand?: (cmd: string) => void) {
  render(
    <LangProvider lang="en">
      <Composer sessionId={`b${++n}`} name="x" disabled={false} onSend={onSend} onCommand={bg ? onCommand : undefined} attachId="5e1b5e9b" onScreenCommand={onScreenCommand} />
    </LangProvider>,
  );
  return { onCommand, onSend };
}

describe('commands catalog', () => {
  it('suggests only what runs from the app, by the start of the name', () => {
    expect(suggestions('/').map((c) => c.cmd)).toEqual(['/compact', '/rename', '/model', '/effort', '/reload-plugins', '/ai-chat-center:cc']);
    expect(suggestions('/re').map((c) => c.cmd)).toEqual(['/rename', '/reload-plugins']);
    expect(suggestions('/compact now')).toEqual([]);
    expect(suggestions('hello')).toEqual([]);
  });

  it('with the session screen at hand, the screen-only commands are suggested too (spec 2026-11-27-session-screen-terminal)', () => {
    expect(suggestions('/c', { screen: true }).map((c) => c.cmd)).toEqual(['/compact', '/cost', '/context']);
    expect(suggestions('/', { screen: true }).map((c) => c.cmd)).toContain('/status');
    expect(suggestions('/', { screen: true }).map((c) => c.cmd)).not.toContain('/resume');
  });

  it('classifies: menus and screen-only commands are not sent; unknown ones (skills) are', () => {
    expect(classify('/compact')).toBe('app');
    expect(classify('/model sonnet')).toBe('app');
    expect(classify('/model')).toBe('terminal');
    expect(classify('/resume')).toBe('terminal');
    expect(classify('/status')).toBe('screen');
    expect(classify('/my-skill arg')).toBe('app');
  });
});

describe('command list in the composer', () => {
  it('typing / shows the list; Enter completes the highlighted one, Enter again sends it', async () => {
    const { onCommand } = composer();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), '/');
    expect(screen.getAllByRole('option').length).toBe(6);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}'); // /reload-plugins
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('/reload-plugins');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onCommand).toHaveBeenCalledWith('/reload-plugins');
  });

  it('a command with an argument gets a space to type it; a click picks', async () => {
    composer();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), '/ren');
    await user.click(screen.getByRole('option', { name: /\/rename/ }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('/rename ');
  });

  it('a terminal command is not sent: the app says to use claude attach', async () => {
    const { onCommand, onSend } = composer();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), '/resume{Enter}');
    expect(onCommand).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('claude attach 5e1b5e9b');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('/resume');
  });

  it('with the session screen at hand, a screen-only command is sent and the screen opened', async () => {
    const onScreen = vi.fn();
    const { onCommand } = composer(undefined, undefined, true, onScreen);
    await userEvent.setup().type(screen.getByRole('textbox'), '/context{Enter}');
    expect(onCommand).toHaveBeenCalledWith('/context');
    expect(await screen.findByText('/context sent. Its result is on the session screen.')).toBeTruthy();
    expect(onScreen).toHaveBeenCalledWith('/context');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed screen-only command does not open the screen', async () => {
    const onScreen = vi.fn();
    composer(vi.fn(async () => { throw Object.assign(new Error('409'), { status: 409 }); }), undefined, true, onScreen);
    await userEvent.setup().type(screen.getByRole('textbox'), '/status{Enter}');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onScreen).not.toHaveBeenCalled();
  });

  it('a screen-only command says its result shows only in the terminal', async () => {
    composer();
    await userEvent.setup().type(screen.getByRole('textbox'), '/status{Enter}');
    expect(screen.getByRole('alert').textContent).toContain('only shows its result');
  });

  it('Escape closes the list; no list in an interactive session', async () => {
    composer();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), '/');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('no list in an interactive session', async () => {
    composer(undefined, undefined, false);
    await userEvent.setup().type(screen.getByRole('textbox'), '/');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
