import { useEffect, useState } from 'react';
import * as api from './api';
import type { Language } from './api';
import { SessionList } from './components/SessionList';
import { ChatView } from './components/ChatView';
import { notificationsSupported } from './notify';
import { useLiveSessions } from './useLiveSessions';
import { useCollapsedList } from './useCollapsedList';
import { LangProvider, useT } from './i18n';

function NoToken() {
  const t = useT();
  return (
    <main className="flex h-full items-center justify-center p-4">
      <div className="max-w-md rounded-2xl border border-line bg-surface p-6">
        <h1 className="font-display text-xl font-semibold">{t('ui.noToken.title')}</h1>
        <p className="mt-2 text-sm text-muted">{t('ui.noToken.body')}</p>
      </div>
    </main>
  );
}

function Shell({ onLanguage }: { onLanguage: (l: Language) => void }) {
  const t = useT();
  const [answersFromApp, setAnswersFromApp] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsedList();
  const live = useLiveSessions();
  const { data, eventsById, pending, unread, selectedId, select, send, retry, error, loading } = live;
  const selected = data.connected.find((s) => s.sessionId === selectedId);

  const pendingId = selected?.pendingQuestion?.toolUseId;
  useEffect(() => {
    // `/cc answers on|off` is typed in the terminal, so re-read the setting whenever a question shows up.
    api
      .getConfig()
      .then((c) => setAnswersFromApp(Boolean(c.answersFromApp)))
      .catch(() => {});
  }, [pendingId, selectedId]);

  return (
    <div className="flex h-full">
      <aside
        className={`h-full w-full shrink-0 border-r border-line md:block ${
          collapsed ? 'md:w-[72px]' : 'md:w-[360px]'
        } ${
          selectedId ? 'hidden' : 'block'
        }`}
      >
        <SessionList
          connected={data.connected}
          others={data.others}
          unread={unread.counts}
          selectedId={selectedId}
          onSelect={select}
          onLanguage={onLanguage}
          error={error}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          notifications={{
            supported: notificationsSupported(),
            enabled: live.notify,
            onToggle: (on) => void live.setNotifications(on),
          }}
        />
      </aside>
      <main className={`min-w-0 flex-1 flex-col ${selectedId ? 'flex' : 'hidden md:flex'}`}>
        {selected ? (
          <ChatView
            key={selected.sessionId}
            session={selected}
            events={eventsById[selected.sessionId] ?? []}
            pending={pending[selected.sessionId] ?? []}
            loading={loading}
            onSend={(text) => send(selected.sessionId, text)}
            onRetry={(id) => void retry(selected.sessionId, id)}
            answersFromApp={answersFromApp}
            onAnswer={(id, answers) => api.answerQuestion(selected.sessionId, id, answers)}
            onRelease={(id) => api.releaseQuestion(selected.sessionId, id)}
            onRename={(name) => api.renameSession(selected.sessionId, name)}
            onBack={() => select(null)}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
            <h2 className="font-display text-lg font-semibold">{t('ui.selectConversation')}</h2>
            <p className="text-sm text-muted">{t('ui.selectConversationHint')}</p>
          </div>
        )}
      </main>
    </div>
  );
}

export function App() {
  const [lang, setLang] = useState<Language>('en');
  // null while a #pair= code is being traded for the token: nothing authenticated runs until it settles.
  const [token, setToken] = useState<boolean | null>(() => (api.isPairing() ? null : api.hasToken()));

  useEffect(() => api.onAuthLost(() => setToken(false)), []);

  useEffect(() => {
    if (token !== null) return;
    let live = true;
    void api.ready().then((ok) => {
      if (live) setToken(ok);
    });
    return () => {
      live = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api
      .getConfig()
      .then((c) => setLang(c.language))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const changeLanguage = (l: Language) => {
    setLang(l);
    api.setConfig({ language: l }).catch(() => {});
  };

  return (
    <LangProvider lang={lang}>{token === null ? null : token ? <Shell onLanguage={changeLanguage} /> : <NoToken />}</LangProvider>
  );
}
