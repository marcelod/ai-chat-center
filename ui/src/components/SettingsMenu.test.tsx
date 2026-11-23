import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LangProvider } from '../i18n';
import { SettingsMenu } from './SettingsMenu';

afterEach(() => {
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
