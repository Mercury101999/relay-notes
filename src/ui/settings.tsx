import { useEffect, useState } from 'react';
import { DEFAULT_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../core/defaults';
import type { VoiceRule } from '../core/types';
import { useStore } from '../state/store';
import { modelCached, openTrimPreview, prepareModel, removeModel, MODEL_LABEL } from '../voice/voice';
import { askConfirm, toast } from './toast';

export function SettingsPage() {
  const store = useStore();
  const { ws, user, sync } = store;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState<number | null>(null);
  const [cached, setCached] = useState(false);
  const [dict, setDict] = useState<VoiceRule[]>(ws.settings.voice_dictionary);

  useEffect(() => setDict(ws.settings.voice_dictionary), [ws.settings.voice_dictionary]);
  useEffect(() => { void modelCached().then(setCached).catch(() => setCached(false)); }, [voiceProgress]);

  async function run(action: () => Promise<string>) {
    setAuthMessage(null);
    try {
      setAuthMessage(await action());
    } catch (error) {
      setAuthMessage((error as Error).message);
    }
  }

  function saveDictionary(next: VoiceRule[]) {
    setDict(next);
    store.updateSettings({ voice_dictionary: next });
  }

  return (
    <section className="page" data-page="settings">
      <header className="page-head">
        <h1>Settings</h1>
        <p className="lede">Theme, account, sync, and on-device voice typing. Nothing here asks for a service role key.</p>
      </header>

      <section className="card">
        <h2>Appearance</h2>
        <div className="pills" role="group" aria-label="Theme">
          <button type="button" className={ws.settings.theme === 'dark' ? 'pill on' : 'pill'} onClick={() => store.setTheme('dark')}>Dark</button>
          <button type="button" className={ws.settings.theme === 'light' ? 'pill on' : 'pill'} onClick={() => store.setTheme('light')}>Light</button>
        </div>
        <p className="muted small">Dark is the default. The choice stays on this device and syncs with your account when you are signed in.</p>
      </section>

      <section className="card">
        <h2>Account</h2>
        {user ? (
          <>
            <p>Signed in{user.email ? ` as ${user.email}` : ''}.</p>
            <button type="button" className="btn" onClick={() => void run(() => store.signOut().then(() => 'Signed out. Notes remain on this device.'))}>Sign out</button>
          </>
        ) : (
          <>
            <label className="field">Email<input aria-label="Email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
            <label className="field">Password<input aria-label="Password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <div className="row wrap">
              <button type="button" className="btn primary" onClick={() => void run(() => store.signIn(email, password))}>Sign in</button>
              <button type="button" className="btn" onClick={() => void run(() => store.signUp(email, password))}>Create account</button>
              <button type="button" className="btn ghost" onClick={() => void run(() => store.sendMagicLink(email))}>Email a magic link</button>
            </div>
          </>
        )}
        {authMessage && <p className="summary">{authMessage}</p>}
        <p className="muted small">If email links bounce, add <code>{store.pagesOrigin}</code> in the Supabase dashboard under Authentication → URL Configuration (site URL and redirect URLs).</p>
      </section>

      <section className="card">
        <h2>Supabase</h2>
        <label className="field">Project URL
          <input aria-label="Supabase URL" value={ws.settings.supabase_url} onChange={(event) => store.updateSettings({ supabase_url: event.target.value.trim() })} />
        </label>
        <label className="field">Publishable key
          <input aria-label="Publishable key" type={showKey ? 'text' : 'password'} value={ws.settings.supabase_publishable_key} onChange={(event) => store.updateSettings({ supabase_publishable_key: event.target.value.trim() })} />
        </label>
        <div className="row wrap">
          <button type="button" className="btn ghost" onClick={() => setShowKey((value) => !value)}>{showKey ? 'Hide key' : 'View key'}</button>
          <button type="button" className="btn ghost" onClick={() => store.updateSettings({ supabase_url: DEFAULT_SUPABASE_URL, supabase_publishable_key: DEFAULT_PUBLISHABLE_KEY })}>Reset to defaults</button>
          <button type="button" className="btn primary" onClick={() => void store.syncNow()}>Sync now</button>
        </div>
        <p className="muted small">
          Status: {sync.status}{sync.at ? ` · ${sync.at}` : ''}{sync.error ? ` · ${sync.error}` : ''}. Local-only notes are never uploaded. Use the publishable key only.
        </p>
      </section>

      <section className="card">
        <h2>Voice typing</h2>
        <p className="muted">{MODEL_LABEL}. Audio is kept in memory only and wiped when you insert, discard, or close the recorder.</p>
        <label className="check-line">
          <input type="checkbox" checked={ws.settings.voice_commands_enabled} onChange={(event) => store.updateSettings({ voice_commands_enabled: event.target.checked })} />
          Spoken commands (new line, period, comma, question mark, and the rest)
        </label>
        <h3>Dictionary</h3>
        {dict.map((rule, index) => (
          <div className="dict-row" key={index}>
            <input aria-label="Replace" value={rule.from} placeholder="from" onChange={(event) => saveDictionary(dict.map((item, i) => i === index ? { ...item, from: event.target.value } : item))} />
            <span>→</span>
            <input aria-label="With" value={rule.to} placeholder="to" onChange={(event) => saveDictionary(dict.map((item, i) => i === index ? { ...item, to: event.target.value } : item))} />
            <button type="button" className="text-btn" onClick={() => saveDictionary(dict.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn ghost" onClick={() => saveDictionary([...dict, { from: '', to: '' }])}>Add replacement</button>
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => openTrimPreview({ rules: dict, commands: ws.settings.voice_commands_enabled, onInsert: (text) => toast(text || 'Nothing to insert') })}>Preview trim editor</button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setVoiceProgress(0);
              void prepareModel(setVoiceProgress).then(() => {
                setVoiceProgress(1);
                setCached(true);
                toast('Voice model is ready for offline use');
              }).catch((error: Error) => {
                setVoiceProgress(null);
                toast(error.message);
              });
            }}
          >
            Download for offline
          </button>
          <button type="button" className="btn ghost" onClick={() => void removeModel().then(() => { setCached(false); setVoiceProgress(null); toast('Voice model removed from this device'); })}>Remove voice model</button>
        </div>
        <p className="muted small">{cached ? 'Model files are in the on-device voice cache.' : 'Model files download on first transcription, not during install.'}{voiceProgress != null && voiceProgress < 1 ? ` Downloading ${Math.round(voiceProgress * 100)}%.` : ''}</p>
      </section>

      <section className="card">
        <h2>Workspace</h2>
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => download(store.exportJson())}>Export JSON</button>
          <label className="btn">
            Import JSON
            <input className="sr" type="file" accept="application/json" aria-label="Import JSON" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => {
                try { store.importJson(text); } catch (error) { toast((error as Error).message); }
              });
              event.target.value = '';
            }} />
          </label>
          <button type="button" className="btn" onClick={() => void maybeExample(store.ws.notes.length + store.ws.bots.length > 0, store.loadExample)}>Load example workspace</button>
          <button type="button" className="btn danger" onClick={() => void askConfirm('Clear bots, notes, folders, and queue items on this device?', 'Clear workspace').then((ok) => { if (ok) store.clearWorkspace(); })}>Clear local workspace</button>
        </div>
      </section>

      <section className="card phase2">
        <h2>Phase 2 roadmap</h2>
        <p>Phase 2 will add a full press-and-hold snippet and template clipboard, plus a Socandoo-style daily Journal with a star calendar.</p>
      </section>
    </section>
  );
}

async function maybeExample(hasData: boolean, load: () => void) {
  if (hasData && !(await askConfirm('Replace the local workspace with the fictional example?', 'Load example'))) return;
  load();
}

function download(json: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'relay-notes-workspace.json';
  link.click();
  URL.revokeObjectURL(url);
}
