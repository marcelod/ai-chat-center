import { useEffect, useState } from 'react';
import * as api from './api';
import type { Language } from './api';
import { SessionList } from './components/SessionList';
import { ChatView } from './components/ChatView';
import { NewSessionDialog } from './components/NewSessionDialog';
import { notificationsSupported } from './notify';
import { useLiveSessions } from './useLiveSessions';
import { useAppWindow } from './useAppWindow';
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
  useAppWindow(select);
  const [newOpen, setNewOpen] = useState(false);
  /** A message picked in the list search: its conversation opens with the search bar on that text. */
  const [hitSearch, setHitSearch] = useState<{ sid: string; q: string; n: number } | null>(null);
  /** The short id of a session started from the app: selected as soon as it connects. */
  const [startedBg, setStartedBg] = useState<string | null>(null);
  useEffect(() => {
    if (!startedBg) return;
    const s = data.connected.find((x) => x.bgId === startedBg && x.state !== 'disconnected');
    if (s) {
      select(s.sessionId);
      setStartedBg(null);
    }
  }, [startedBg, data.connected, select]);

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
      {newOpen && (
        <NewSessionDialog
          loadFolders={api.listFolders}
          onStart={async (input) => {
            const r = await api.newSession(input);
            if (r.bgId) setStartedBg(r.bgId);
            await live.refresh();
          }}
          onClose={() => setNewOpen(false)}
        />
      )}
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
          usage={data.usage}
          unread={unread.counts}
          selectedId={selectedId}
          onSelect={select}
          onLanguage={onLanguage}
          error={error}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onNewSession={() => setNewOpen(true)}
          onSearch={api.searchAll}
          onOpenHit={(hit, q) => {
            setHitSearch((h) => ({ sid: hit.sessionId, q, n: (h?.n ?? 0) + 1 }));
            select(hit.sessionId);
          }}
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
            key={hitSearch?.sid === selected.sessionId ? `${selected.sessionId}:${hitSearch.n}` : selected.sessionId}
            initialSearch={hitSearch?.sid === selected.sessionId ? hitSearch.q : undefined}
            session={selected}
            events={eventsById[selected.sessionId] ?? []}
            pending={pending[selected.sessionId] ?? []}
            loading={loading}
            onSend={(text) => send(selected.sessionId, text)}
            onUpload={(file) => api.uploadAttachment(selected.sessionId, file)}
            onRetry={(id) => void retry(selected.sessionId, id)}
            answersFromApp={answersFromApp}
            onAnswer={(id, answers) => api.answerQuestion(selected.sessionId, id, answers)}
            onRelease={(id) => api.releaseQuestion(selected.sessionId, id)}
            onRename={(name) => api.renameSession(selected.sessionId, name)}
            onRemove={() => live.remove(selected.sessionId)}
            onPin={async (pinned) => {
              await api.pinSession(selected.sessionId, pinned);
              await live.refresh();
            }}
            onDisconnect={async () => {
              await api.disconnectSession(selected.sessionId);
              await live.refresh();
            }}
            onSetBackground={(bg) => api.setBackground(selected.sessionId, bg)}
            onUploadBackground={(file) => api.uploadBackgroundImage(selected.sessionId, file)}
            onLoadBackgroundImage={() => api.getBackgroundImage(selected.sessionId)}
            onResume={async () => {
              await api.resumeSession(selected.sessionId);
              await live.refresh();
            }}
            onCommand={(text) => api.sendCommand(selected.sessionId, text)}
            onOpenTerminal={() => api.openTerminal(selected.sessionId)}
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
