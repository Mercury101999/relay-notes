import { useEffect, useState } from 'react';
import { DEFAULT_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../core/defaults';
import { SPOKEN_COMMANDS } from '../core/dictation';
import { TEMPLATE_CATEGORIES } from '../core/templates';
import { nowIso } from '../core/time';
import type { KeywordAlias, RoutingRule, SnippetTemplate, VoiceRule } from '../core/types';
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

      <WritingSettings />

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
          Spoken commands
        </label>
        <ul className="muted small">
          {SPOKEN_COMMANDS.map((command) => <li key={command.phrase}><strong>{command.phrase}</strong> — {command.effect}</li>)}
        </ul>
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
        <p>Phase 2 will add a Socandoo-style daily Journal with a star calendar. Routing, templates, formatting, and disperse are already in this version.</p>
      </section>
    </section>
  );
}

async function maybeExample(hasData: boolean, load: () => void) {
  if (hasData && !(await askConfirm('Replace the local workspace with the fictional example?', 'Load example'))) return;
  load();
}

function WritingSettings() {
  const store = useStore();
  const { routing_rules: rules, keyword_aliases: aliases, templates, format_on_save: formatOnSave } = store.ws.settings;
  return (
    <>
      <section className="card">
        <h2>Writing</h2>
        <label className="check-line">
          <input type="checkbox" checked={formatOnSave} onChange={(event) => store.updateSettings({ format_on_save: event.target.checked })} />
          Format on save
        </label>
        <p className="muted small">Off by default. When it is on, leaving the source editor formats the note. Unclosed blocks are never rewritten.</p>
      </section>
      <section className="card" data-testid="routing-rules">
        <h2>Keyword routing</h2>
        <p className="muted small">Exact <code>Keyword : SubClass</code> wins over <code>Keyword : *</code>, which wins over <code>* : *</code>. Use {'{Keyword}'}, {'{SubClass}'}, and {'{Chapter}'} in the targets.</p>
        {rules.map((rule, index) => (
          <div className="stack" key={rule.id}>
            <div className="dict-row">
              <input aria-label="Rule keyword" value={rule.keyword} placeholder="Keyword" onChange={(event) => store.updateSettings({ routing_rules: replaceRule(rules, index, { keyword: event.target.value }) })} />
              <span>:</span>
              <input aria-label="Rule subclass" value={rule.sub_class} placeholder="* or subclass" onChange={(event) => store.updateSettings({ routing_rules: replaceRule(rules, index, { sub_class: event.target.value }) })} />
              <button type="button" className="text-btn" onClick={() => store.updateSettings({ routing_rules: rules.filter((item) => item.id !== rule.id) })}>Remove</button>
            </div>
            <div className="dest-grid">
              <input aria-label="Rule folder" value={rule.folder} placeholder="Folder" onChange={(event) => store.updateSettings({ routing_rules: replaceRule(rules, index, { folder: event.target.value }) })} />
              <input aria-label="Rule note" value={rule.note} placeholder="Note" onChange={(event) => store.updateSettings({ routing_rules: replaceRule(rules, index, { note: event.target.value }) })} />
              <input aria-label="Rule section" value={rule.section} placeholder="Section" onChange={(event) => store.updateSettings({ routing_rules: replaceRule(rules, index, { section: event.target.value }) })} />
            </div>
          </div>
        ))}
        <button type="button" className="btn ghost" onClick={() => store.updateSettings({ routing_rules: [...rules, blankRule()] })}>Add rule</button>
      </section>
      <section className="card" data-testid="keyword-aliases">
        <h2>Keyword aliases</h2>
        <p className="muted small">Variants such as “relay notes” map to one canonical keyword so groups and folders do not split.</p>
        {aliases.map((alias, index) => (
          <div className="dict-row" key={alias.id}>
            <input aria-label="Alias" value={alias.alias} placeholder="relay notes" onChange={(event) => store.updateSettings({ keyword_aliases: replaceAlias(aliases, index, { alias: event.target.value }) })} />
            <span>→</span>
            <input aria-label="Canonical keyword" value={alias.canonical} placeholder="RelayNotes" onChange={(event) => store.updateSettings({ keyword_aliases: replaceAlias(aliases, index, { canonical: event.target.value }) })} />
            <button type="button" className="text-btn" onClick={() => store.updateSettings({ keyword_aliases: aliases.filter((item) => item.id !== alias.id) })}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn ghost" onClick={() => store.updateSettings({ keyword_aliases: [...aliases, { id: crypto.randomUUID(), alias: '', canonical: '' }] })}>Add alias</button>
      </section>
      <TemplateSettings templates={templates} onChange={(next) => store.updateSettings({ templates: next })} />
    </>
  );
}

function TemplateSettings({ templates, onChange }: { templates: SnippetTemplate[]; onChange: (next: SnippetTemplate[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <h2>Template clipboard</h2>
      {TEMPLATE_CATEGORIES.map((category) => {
        const rows = templates.filter((template) => template.category === category);
        if (!rows.length) return null;
        return (
          <div key={category}>
            <h3>{category}</h3>
            {rows.map((template) => (
              <div key={template.id} className="sub-item">
                <span>{template.name}</span>
                <button type="button" className="text-btn" onClick={() => onChange(templates.filter((item) => item.id !== template.id))}>Delete</button>
              </div>
            ))}
          </div>
        );
      })}
      {open && <NewTemplate onSave={(template) => { onChange([...templates, template]); setOpen(false); }} onCancel={() => setOpen(false)} />}
      {!open && <button type="button" className="btn ghost" onClick={() => setOpen(true)}>Add template</button>}
    </section>
  );
}

function NewTemplate({ onSave, onCancel }: { onSave: (template: SnippetTemplate) => void; onCancel: () => void }) {
  const [category, setCategory] = useState<string>('Custom Snippets');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  return (
    <div className="stack">
      <label className="field">Category
        <select aria-label="New template category" value={category} onChange={(event) => setCategory(event.target.value)}>
          {TEMPLATE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label className="field">Name<input aria-label="New template name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="field">Body<textarea aria-label="New template body" value={body} onChange={(event) => setBody(event.target.value)} /></label>
      <div className="row">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn" onClick={() => onSave({ id: crypto.randomUUID(), category, name: name.trim() || 'Snippet', body, updated_at: nowIso() })}>Save template</button>
      </div>
    </div>
  );
}

function blankRule(): RoutingRule {
  const now = nowIso();
  return { id: crypto.randomUUID(), keyword: '', sub_class: '*', folder: '', note: '', section: '', created_at: now, updated_at: now };
}

function replaceRule(rules: RoutingRule[], index: number, patch: Partial<RoutingRule>): RoutingRule[] {
  return rules.map((rule, i) => (i === index ? { ...rule, ...patch, updated_at: nowIso() } : rule));
}

function replaceAlias(aliases: KeywordAlias[], index: number, patch: Partial<KeywordAlias>): KeywordAlias[] {
  return aliases.map((alias, i) => (i === index ? { ...alias, ...patch } : alias));
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
