import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LangProvider } from '../i18n';
import { saveShowDiffs, saveSystemNotifications } from '../prefs';
import { SettingsMenu } from './SettingsMenu';

afterEach(() => {
  saveShowDiffs(false);
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function setup(lang: 'en' | 'pt-BR' = 'en') {
  render(
    <LangProvider lang={lang}>
      <SettingsMenu onLanguage={() => {}} />
    </LangProvider>,
  );
}

describe('SettingsMenu theme', () => {
  it('switches to dark and back to system, remembering the choice', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const select = screen.getByLabelText('Theme');
    expect(select).toHaveValue('system');
    await user.selectOptions(select, 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('acc.theme')).toBe('dark');
    await user.selectOptions(select, 'system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('shows the stored choice and Portuguese labels', async () => {
    localStorage.setItem('acc.theme', 'light');
    const user = userEvent.setup();
    setup('pt-BR');
    await user.click(screen.getByRole('button', { name: /Configura/ }));
    const select = screen.getByLabelText('Tema');
    expect(select).toHaveValue('light');
    expect(screen.getByRole('option', { name: 'Escuro' })).toBeInTheDocument();
  });
});

describe('SettingsMenu file changes', () => {
  it('is off by default and the choice is remembered', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const box = screen.getByRole('checkbox', { name: 'Show file changes' });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    expect(localStorage.getItem('acc.showDiffs')).toBe('1');
    await user.click(box);
    expect(localStorage.getItem('acc.showDiffs')).toBe('0');
  });
  it('still works when storage throws', async () => {
    const user = userEvent.setup();
    setup('pt-BR');
    await user.click(screen.getByRole('button', { name: /Configura/ }));
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    await user.click(screen.getByRole('checkbox', { name: 'Mostrar alterações dos arquivos' }));
    expect(screen.getByRole('checkbox', { name: 'Mostrar alterações dos arquivos' })).toBeChecked();
    spy.mockRestore();
  });
});

describe('SettingsMenu system notifications', () => {
  afterEach(() => {
    saveSystemNotifications(false);
    vi.unstubAllGlobals();
  });
  function stub(permission: NotificationPermission, answer: NotificationPermission = permission) {
    const requestPermission = vi.fn(async () => {
      N.permission = answer;
      return answer;
    });
    class N {
      static permission = permission;
      static requestPermission = requestPermission;
    }
    vi.stubGlobal('Notification', N);
    return requestPermission;
  }
  const open = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /Settings|Configura/ }));

  it('is off by default; turning it on asks the browser and shows the result', async () => {
    const ask = stub('default', 'granted');
    const user = userEvent.setup();
    setup();
    await open(user);
    const box = screen.getByRole('checkbox', { name: 'System notifications' });
    expect(box).not.toBeChecked();
    expect(screen.getByText(/asks for permission/)).toBeInTheDocument();
    await user.click(box);
    expect(ask).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(box).toBeChecked());
    expect(screen.getByText(/^Allowed/)).toBeInTheDocument();
    expect(localStorage.getItem('acc.notify')).toBe('1');
    await user.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(localStorage.getItem('acc.notify')).toBe('0');
  });

  it('stays off and says so when the browser blocks it', async () => {
    stub('default', 'denied');
    const user = userEvent.setup();
    setup('pt-BR');
    await open(user);
    const box = screen.getByRole('checkbox', { name: 'Notificações do sistema' });
    await user.click(box);
    await waitFor(() => expect(screen.getByText(/^Bloqueadas pelo navegador/)).toBeInTheDocument());
    expect(box).not.toBeChecked();
  });

  it('is disabled, without errors, when the browser has no Notification API', async () => {
    vi.stubGlobal('Notification', undefined);
    const user = userEvent.setup();
    setup();
    await open(user);
    expect(screen.getByRole('checkbox', { name: 'System notifications' })).toBeDisabled();
    expect(screen.getByText('Not available in this browser')).toBeInTheDocument();
  });
});
