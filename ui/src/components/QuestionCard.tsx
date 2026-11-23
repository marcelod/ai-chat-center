import { useState } from 'react';
import type { ChatEvent, Question } from '@shared/types';
import { useT } from '../i18n';

type QuestionEvent = Extract<ChatEvent, { kind: 'question' }>;
type Props = {
  event: QuestionEvent;
  /** The hub says this question is waiting for an answer from the app. */
  pending: boolean;
  answersFromApp: boolean;
  onAnswer: (answers: Record<string, string>) => Promise<void>;
  onRelease: () => Promise<void>;
};
type Draft = { picked: string[]; text: string };

const answerOf = (d: Draft | undefined): string => (d?.text.trim() ? d.text.trim() : (d?.picked ?? []).join(', '));

const optionBase = 'min-h-11 w-full rounded-xl border px-3.5 py-2 text-left text-sm';

function Shell({ header, children }: { header?: string; children: React.ReactNode }) {
  return (
    <div data-question className="w-[600px] max-w-full self-start rounded-[14px_14px_14px_4px] border border-line bg-surface p-4">
      {header && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{header}</p>}
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

function ReadOnlyOptions({ q }: { q: Question }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {q.options.map((o) => (
        <li key={o.label} className="rounded-xl border border-line bg-field px-3.5 py-2 text-sm text-muted">
          <span className="font-semibold text-ink">{o.label}</span>
          {o.description && <span className="block text-[13px]">{o.description}</span>}
        </li>
      ))}
    </ul>
  );
}

export function QuestionCard({ event, pending, answersFromApp, onAnswer, onRelease }: Props) {
  const t = useT();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [submitted, setSubmitted] = useState(false);
  const [already, setAlready] = useState(false);
  const [failed, setFailed] = useState(false);
  const { questions } = event;
  const answered = event.answers !== undefined || event.answerText !== undefined;

  if (answered) {
    return (
      <Shell header={t('ui.question.answered')}>
        {questions.map((q) => (
          <div key={q.question}>
            <p className="text-sm font-semibold">{q.question}</p>
            {event.answers?.[q.question] !== undefined && (
              <p data-answer className="mt-1 rounded-xl bg-field px-3.5 py-2 text-sm">
                {event.answers[q.question]}
              </p>
            )}
          </div>
        ))}
        {event.answerText && event.answers === undefined && <p className="rounded-xl bg-field px-3.5 py-2 text-sm">{event.answerText}</p>}
      </Shell>
    );
  }

  if (!pending) {
    return (
      <Shell>
        {questions.map((q) => (
          <div key={q.question}>
            {q.header && <p className="text-xs font-semibold uppercase tracking-wide text-muted">{q.header}</p>}
            <p className="mb-2 text-sm font-semibold">{q.question}</p>
            <ReadOnlyOptions q={q} />
          </div>
        ))}
        <p role="status" className="text-sm font-semibold text-waiting-text">
          {t('ui.question.answerInTerminalNotice')}
        </p>
        {!answersFromApp && <p className="text-[13px] text-muted">{t('ui.question.enableHint')}</p>}
      </Shell>
    );
  }

  const patch = (q: string, d: Partial<Draft>) => setDrafts((cur) => ({ ...cur, [q]: { ...(cur[q] ?? { picked: [], text: '' }), ...d } }));
  const ready = questions.every((q) => answerOf(drafts[q.question]) !== '');

  const submit = async () => {
    setSubmitted(true);
    setFailed(false);
    try {
      await onAnswer(Object.fromEntries(questions.map((q) => [q.question, answerOf(drafts[q.question])])));
    } catch (e) {
      const status = (e as { status?: unknown } | null)?.status;
      if (status === 409) setAlready(true);
      else {
        setFailed(true);
        setSubmitted(false);
      }
    }
  };

  return (
    <Shell>
      {questions.map((q) => {
        const d = drafts[q.question];
        return (
          <fieldset key={q.question} disabled={submitted} className="min-w-0">
            {q.header && <p className="text-xs font-semibold uppercase tracking-wide text-muted">{q.header}</p>}
            <legend className="mb-2 text-sm font-semibold">{q.question}</legend>
            <div className="flex flex-col gap-1.5">
              {q.options.map((o) => {
                const on = d?.picked.includes(o.label) ?? false;
                const cls = `${optionBase} ${on ? 'border-accent bg-field' : 'border-line bg-surface'} disabled:opacity-60`;
                const body = (
                  <>
                    <span className="font-semibold">{o.label}</span>
                    {o.description && <span className="block text-[13px] text-muted">{o.description}</span>}
                  </>
                );
                return q.multiSelect ? (
                  <label key={o.label} className={`${cls} flex cursor-pointer items-start gap-3`}>
                    <input
                      type="checkbox"
                      checked={on}
                      className="mt-1"
                      onChange={() =>
                        patch(q.question, { picked: on ? (d?.picked ?? []).filter((l) => l !== o.label) : [...(d?.picked ?? []), o.label], text: '' })
                      }
                    />
                    <span>{body}</span>
                  </label>
                ) : (
                  <button key={o.label} type="button" aria-pressed={on} className={cls} onClick={() => patch(q.question, { picked: [o.label], text: '' })}>
                    {body}
                  </button>
                );
              })}
              <input
                type="text"
                aria-label={t('ui.question.other')}
                placeholder={t('ui.question.other')}
                value={d?.text ?? ''}
                onChange={(e) => patch(q.question, { text: e.target.value })}
                className="min-h-11 rounded-xl border border-field-border bg-surface px-3.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
          </fieldset>
        );
      })}
      {already && (
        <p role="alert" className="text-sm text-danger">
          {t('ui.question.alreadyAnswered')}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {t('ui.composer.sendFailed')}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!ready || submitted}
          onClick={() => void submit()}
          className="min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-contrast disabled:opacity-40"
        >
          {t('ui.question.send')}
        </button>
        <button
          type="button"
          disabled={submitted}
          onClick={() => void onRelease()}
          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-muted underline disabled:opacity-40"
        >
          {t('ui.question.answerInTerminal')}
        </button>
      </div>
    </Shell>
  );
}
