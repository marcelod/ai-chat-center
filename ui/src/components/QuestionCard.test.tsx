import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '@shared/types';
import { ApiError } from '../api';
import { LangProvider } from '../i18n';
import { QuestionCard } from './QuestionCard';

type Q = Extract<ChatEvent, { kind: 'question' }>;
const Q1 = 'Qual cor você prefere?';
const ev = (over: Partial<Q> = {}): Q => ({
  kind: 'question',
  id: 'q1',
  ts: '2026-01-05T10:00:00.000Z',
  toolUseId: 'tu1',
  questions: [
    { question: Q1, header: 'Cor', options: [{ label: 'Blue', description: 'Cool' }, { label: 'Red' }] },
  ],
  ...over,
});

function setup(event: Q, p: { pending?: boolean; answersFromApp?: boolean; onAnswer?: () => Promise<void> } = {}) {
  const onAnswer = vi.fn(p.onAnswer ?? (async () => {}));
  const onRelease = vi.fn(async () => {});
  render(
    <LangProvider lang="en">
      <QuestionCard
        event={event}
        pending={p.pending ?? true}
        answersFromApp={p.answersFromApp ?? true}
        onAnswer={onAnswer}
        onRelease={onRelease}
      />
    </LangProvider>,
  );
  return { onAnswer, onRelease, user: userEvent.setup() };
}

describe('QuestionCard', () => {
  it('pending: picking an option and sending answers it', async () => {
    const { onAnswer, user } = setup(ev());
    expect(screen.getByText('Cool')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Blue/ }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAnswer).toHaveBeenCalledWith({ [Q1]: 'Blue' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('pending: Send stays disabled until every question has an answer', async () => {
    const two = ev({
      questions: [
        { question: 'A?', options: [{ label: 'a1' }] },
        { question: 'B?', options: [{ label: 'b1' }] },
      ],
    });
    const { onAnswer, user } = setup(two);
    await user.click(screen.getByRole('button', { name: /a1/ }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /b1/ }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAnswer).toHaveBeenCalledWith({ 'A?': 'a1', 'B?': 'b1' });
  });

  it('free text replaces the selected option', async () => {
    const { onAnswer, user } = setup(ev());
    await user.click(screen.getByRole('button', { name: /Blue/ }));
    await user.type(screen.getByRole('textbox', { name: 'Other answer' }), 'Green');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAnswer).toHaveBeenCalledWith({ [Q1]: 'Green' });
  });

  it('multiSelect joins the checked labels with ", "', async () => {
    const m = ev({ questions: [{ question: 'Colors?', multiSelect: true, options: [{ label: 'Red' }, { label: 'Green' }, { label: 'Blue' }] }] });
    const { onAnswer, user } = setup(m);
    await user.click(screen.getByRole('checkbox', { name: /Red/ }));
    await user.click(screen.getByRole('checkbox', { name: /Blue/ }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAnswer).toHaveBeenCalledWith({ 'Colors?': 'Red, Blue' });
  });

  it('"Answer in the terminal" releases the question', async () => {
    const { onRelease, user } = setup(ev());
    await user.click(screen.getByRole('button', { name: 'Answer in the terminal' }));
    expect(onRelease).toHaveBeenCalled();
  });

  it('a 409 shows "Already answered"', async () => {
    const { user } = setup(ev(), {
      onAnswer: async () => {
        throw new ApiError(409);
      },
    });
    await user.click(screen.getByRole('button', { name: /Blue/ }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Already answered')).toBeInTheDocument();
  });

  it('terminal: read-only, hint only when answers from the app are off', () => {
    setup(ev(), { pending: false, answersFromApp: false });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Answer in the terminal')).toBeInTheDocument();
    expect(screen.getByText(/\/cc answers on/)).toBeInTheDocument();
  });

  it('terminal with answers from the app on has no hint', () => {
    setup(ev(), { pending: false, answersFromApp: true });
    expect(screen.queryByText(/\/cc answers on/)).toBeNull();
  });

  it('answered: shows the answer, read-only', () => {
    setup(ev({ answers: { [Q1]: 'Blue' } }), { pending: true });
    expect(screen.getByText('Blue', { selector: '[data-answer]' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('answered with only answerText shows it', () => {
    setup(ev({ answerText: 'User answered: Blue' }), { pending: false });
    expect(screen.getByText('User answered: Blue')).toBeInTheDocument();
  });

  it('a failing release shows the send-failed text instead of rejecting', async () => {
    const onRelease = vi.fn(async () => {
      throw new ApiError(500);
    });
    render(
      <LangProvider lang="en">
        <QuestionCard event={ev()} pending answersFromApp onAnswer={async () => {}} onRelease={onRelease} />
      </LangProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Answer in the terminal' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
