import { useEffect, useState } from 'react';
import type { PromptPrefill } from '../core/queue';
import { parseRoute, routeHash, type QueueTab, type Route } from '../core/routes';
import { useStore } from '../state/store';
import { BotsPage } from './bots';
import { HomePage } from './home';
import { IconBots, IconHome, IconNotes, IconQueue, IconSettings } from './icons';
import { NotesPage } from './notes';
import { QueuePage } from './queue';
import { SettingsPage } from './settings';

const TABS = [
  { id: 'home', label: 'Home', icon: IconHome },
  { id: 'notes', label: 'Notes', icon: IconNotes },
  { id: 'queue', label: 'Queue', icon: IconQueue },
  { id: 'bots', label: 'Bots', icon: IconBots },
  { id: 'settings', label: 'Settings', icon: IconSettings },
] as const;

export function Shell() {
  const { ready, user, sync, syncNow, undo, undoOrganize } = useStore();
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [prefill, setPrefill] = useState<PromptPrefill | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) history.replaceState(null, '', '#/');
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function go(next: Route, nextPrefill?: PromptPrefill | null) {
    const hash = routeHash(next);
    if (window.location.hash !== hash) window.location.hash = hash;
    else setRoute(next);
    if (nextPrefill !== undefined) setPrefill(nextPrefill);
  }

  function openPrompt(next?: PromptPrefill) {
    go({ page: 'queue', tab: 'form' }, next ?? {});
  }

  const page = route.page === 'notes' && route.noteId ? 'notes' : route.page;
  const label = !navigator.onLine ? 'Offline' : !user ? 'On this device' : sync.status === 'syncing' ? 'Syncing' : sync.status === 'error' ? 'Sync issue' : sync.status === 'synced' ? 'Synced' : 'On this device';

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">Relay <span>Notes</span></div>
        <nav aria-label="Primary">
          {TABS.map((tab) => (
            <button key={tab.id} type="button" aria-current={page === tab.id ? 'page' : undefined} onClick={() => go(tabRoute(tab.id))}>
              <tab.icon /> {tab.label}
            </button>
          ))}
        </nav>
        <button type="button" className={`sync-pill ${sync.status}`} onClick={() => void syncNow()}>
          <i /> {label}
        </button>
      </aside>
      <div className="frame">
        <header className="topbar">
          <div className="brand">Relay <span>Notes</span></div>
          <button type="button" className={`sync-pill ${sync.status}`} onClick={() => void syncNow()} aria-live="polite">
            <i /> {label}
          </button>
        </header>
        <main>
          {undo && (
            <div className="undo-banner" data-testid="undo-organize">
              <span>{undo.kind === 'disperse' ? 'Disperse is saved on this device.' : 'Consolidate is saved on this device.'}</span>
              <button type="button" onClick={() => undoOrganize()}>{undo.kind === 'disperse' ? 'Undo disperse' : 'Undo consolidate'}</button>
            </div>
          )}
          {!ready ? <p className="muted page">Opening your workspace…</p> : (
            <>
              {route.page === 'home' && <HomePage go={go} onPrompt={openPrompt} />}
              {route.page === 'notes' && <NotesPage route={route} go={(next) => go(next)} onPrompt={openPrompt} />}
              {route.page === 'queue' && <QueuePage tab={route.tab} prefill={prefill} onTab={(tab: QueueTab) => go({ page: 'queue', tab })} />}
              {route.page === 'bots' && <BotsPage route={route} go={go} onPrompt={openPrompt} />}
              {route.page === 'settings' && <SettingsPage />}
            </>
          )}
        </main>
        <nav className="tabbar" aria-label="Primary">
          {TABS.map((tab) => (
            <button key={tab.id} type="button" aria-current={page === tab.id ? 'page' : undefined} onClick={() => go(tabRoute(tab.id))}>
              <tab.icon /> {tab.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function tabRoute(id: typeof TABS[number]['id']): Route {
  if (id === 'home') return { page: 'home' };
  if (id === 'notes') return { page: 'notes' };
  if (id === 'queue') return { page: 'queue', tab: 'form' };
  if (id === 'bots') return { page: 'bots' };
  return { page: 'settings' };
}
