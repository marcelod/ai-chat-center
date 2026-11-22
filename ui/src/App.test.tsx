import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderChange, SessionsResponse } from '@shared/types';

vi.mock('./api', () => ({
  hasToken: vi.fn(() => true),
  onAuthLost: vi.fn(() => () => {}),
  getSessions: vi.fn(),
  getEvents: vi.fn(async () => []),
  getConfig: vi.fn(async () => ({ language: 'en' })),
  setConfig: vi.fn(async (c: { language: string }) => c),
  openStream: vi.fn(() => () => {}),
  sendMessage: vi.fn(),
}));

import * as api from './api';
import { App } from './App';

const now = new Date();
const sessions: SessionsResponse = {
  connected: [
    {
      sessionId: 's1',
      name: 'billing-api',
      cwd: '/home/me/work/billing-api',
      state: 'busy',
      pendingAppMessageIds: [],
      lastEvent: { kind: 'assistant', id: 'e1', ts: now.toISOString(), text: 'Refactoring the invoice module' },
    },
    {
      sessionId: 's2',
      name: 'site',
      cwd: '/home/me/play/site',
      state: 'waiting',
      waitingKind: 'permission',
      pendingAppMessageIds: [],
    },
    { sessionId: 's3', name: 'old', cwd: '/tmp/old', state: 'disconnected', pendingAppMessageIds: [] },
  ],
  others: [
    { pid: 1, cwd: '/home/me/other/proj', kind: 'interactive', sessionId: 'o1', name: 'proj', status: 'idle' },
    { pid: 2, cwd: '/home/me/other/second', kind: 'interactive', sessionId: 'o2', name: 'second', status: 'busy' },
    { pid: 3, cwd: '/home/me/other/third', kind: 'interactive', sessionId: 'o3', name: 'third', status: 'waiting' },
  ],
};

beforeEach(() => {
  vi.mocked(api.hasToken).mockReturnValue(true);
  vi.mocked(api.getSessions).mockResolvedValue(sessions);
  vi.mocked(api.getConfig).mockResolvedValue({ language: 'en' });
});

describe('App', () => {
  it('renders connected sessions with status and preview', async () => {
    render(<App />);
    const row = (await screen.findByText('billing-api')).closest('[data-session]') as HTMLElement;
    expect(within(row).getByText('Refactoring the invoice module')).toBeInTheDocument();
    expect(row).toHaveAttribute('data-state', 'busy');
    expect(screen.getByText('Waiting for you in the terminal')).toBeInTheDocument();
    expect(screen.getByText('Disconnected — type /cc again')).toBeInTheDocument();
    expect(screen.getByText('Select a conversation')).toBeInTheDocument();
  });

  it('search filters by name and cwd', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('billing-api');
    const box = screen.getByRole('searchbox');
    await user.type(box, 'play/site');
    expect(screen.queryByText('billing-api')).not.toBeInTheDocument();
    expect(screen.getByText('site')).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'BILLING');
    expect(screen.getByText('billing-api')).toBeInTheDocument();
    expect(screen.queryByText('site')).not.toBeInTheDocument();
  });

  it('others section shows hint', async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = await screen.findByRole('button', { name: /Other open sessions \(3\)/ });
    expect(screen.queryByText(/type \/cc in the session's terminal/)).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText("To chat with them here, type /cc in the session's terminal.")).toBeInTheDocument();
    expect(screen.getByText('/home/me/other/proj')).toBeInTheDocument();
  });

  it('others row with status waiting shows the waiting label', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Other open sessions/ }));
    const row = screen.getByText('third').closest('li') as HTMLElement;
    expect(within(row).getByText('Status: waiting for you in the terminal')).toBeInTheDocument();
  });

  it('switching language re-renders labels', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('billing-api');
    expect(screen.getByPlaceholderText('Search by name or folder')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.selectOptions(screen.getByLabelText('Language'), 'pt-BR');
    expect(api.setConfig).toHaveBeenCalledWith({ language: 'pt-BR' });
    expect(await screen.findByPlaceholderText('Buscar por nome ou pasta')).toBeInTheDocument();
    expect(screen.getByText('Esperando por você no terminal')).toBeInTheDocument();
  });

  it('stream events for another session bump its badge without fetching events', async () => {
    let push: (c: ProviderChange) => void = () => {};
    vi.mocked(api.openStream).mockImplementation((cb) => {
      push = cb;
      return () => {};
    });
    vi.mocked(api.getEvents).mockClear();
    render(<App />);
    await screen.findByText('billing-api');
    act(() =>
      push({
        type: 'events',
        sessionId: 's1',
        events: [{ kind: 'assistant', id: 'new1', ts: new Date(Date.now() + 5000).toISOString(), text: 'Done!' }],
      }),
    );
    const row = screen.getByText('billing-api').closest('[data-session]') as HTMLElement;
    expect(within(row).getByText('1 unread')).toBeInTheDocument();
    expect(within(row).getByText('Done!')).toBeInTheDocument();
    expect(api.getEvents).not.toHaveBeenCalled();
  });

  it('missing token shows instructions', () => {
    vi.mocked(api.hasToken).mockReturnValue(false);
    render(<App />);
    expect(screen.getByText('Open the link shown by /cc')).toBeInTheDocument();
    expect(api.getSessions).not.toHaveBeenCalled();
  });
});
