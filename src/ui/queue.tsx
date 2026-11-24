import { useEffect, useState } from 'react';
import { approveItem, archiveRaw, createPromptItem, crossReference, dropItem, filterQueue, isRawInbox } from '../core/queue';
import type { PromptPrefill } from '../core/queue';
import type { QueueMode, QueueItem } from '../core/types';
import { formatWhen, nowIso, uid } from '../core/time';
import { useStore } from '../state/store';
import { openVoice } from '../voice/voice';
import { IconMic } from './icons';
import { askConfirm } from './toast';

const MODES: { id: QueueMode; label: string }[] = [
  { id: 'save', label: 'Save' },
  { id: 'research', label: 'Research' },
  { id: 'build', label: 'Build' },
  { id: 'ask_first', label: 'Ask first' },
];

export function QueuePage({ tab, prefill, onTab }: { tab: 'form' | 'raw' | 'staged' | 'history'; prefill: PromptPrefill | null; onTab: (tab: 'form' | 'raw' | 'staged' | 'history') => void }) {
  const store = useStore();
  return (
    <section className="page" data-page="queue">
      <header className="page-head">
        <h1>Queue</h1>
        <p className="lede">Stage a prompt yourself, or review what Ari organized from a raw note.</p>
      </header>
      <div className="pills" role="tablist" aria-label="Queue views">
        {([['form', 'Fast prompt'], ['raw', 'Raw inbox'], ['staged', 'Staged'], ['history', 'History']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'pill on' : 'pill'} onClick={() => onTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'form' && <PromptForm prefill={prefill} onStaged={() => onTab('staged')} />}
      {tab === 'raw' && <RawInbox />}
      {tab === 'staged' && <StagedView />}
      {tab === 'history' && <HistoryView />}
      <p className="sr">{store.ws.queue.length} queue items</p>
    </section>
  );
}

function PromptForm({ prefill, onStaged }: { prefill: PromptPrefill | null; onStaged: () => void }) {
  const { ws, saveQueueItem } = useStore();
  const [bot, setBot] = useState(prefill?.bot_name ?? '');
  const [goal, setGoal] = useState(prefill?.goal ?? '');
  const [details, setDetails] = useState(prefill?.details ?? '');
  const [mode, setMode] = useState<QueueMode>(prefill?.mode ?? 'ask_first');
  const [meta, setMeta] = useState({ keyword: prefill?.keyword ?? null, sub_class: prefill?.sub_class ?? null, source_note_id: prefill?.source_note_id ?? null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!prefill) return;
    setBot(prefill.bot_name ?? '');
    setGoal(prefill.goal ?? '');
    setDetails(prefill.details ?? '');
    if (prefill.mode) setMode(prefill.mode);
    setMeta({ keyword: prefill.keyword ?? null, sub_class: prefill.sub_class ?? null, source_note_id: prefill.source_note_id ?? null });
  }, [prefill]);

  function dictate(into: 'goal' | 'details') {
    openVoice({
      rules: ws.settings.voice_dictionary,
      commands: ws.settings.voice_commands_enabled,
      onInsert: (text) => {
        const append = (current: string) => current && !/\s$/.test(current) ? `${current} ${text}` : `${current}${text}`;
        if (into === 'goal') setGoal((current) => append(current));
        else setDetails((current) => append(current));
      },
    });
  }

  function submit(approveNow: boolean) {
    try {
      const item = createPromptItem({
        bot_name: bot,
        goal,
        details,
        mode,
        approveNow,
        keyword: meta.keyword,
        sub_class: meta.sub_class,
        source_note_id: meta.source_note_id,
      }, nowIso(), uid());
      saveQueueItem(item);
      setGoal('');
      setDetails('');
      setError(null);
      if (!approveNow) onStaged();
      else onStaged();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <form className="card form" data-testid="prompt-form" onSubmit={(event) => { event.preventDefault(); submit(false); }}>
      <h2>Fast prompt</h2>
      <label className="field">Bot
        <input aria-label="Bot" list="bot-names" value={bot} onChange={(event) => setBot(event.target.value)} placeholder="Pick a bot or type a name" />
        <datalist id="bot-names">{ws.bots.map((item) => <option key={item.id} value={item.name} />)}</datalist>
      </label>
      <div className="field">
        <span className="label-row">
          <label htmlFor="prompt-goal">Goal</label>
          <button type="button" className="btn ghost small mic" onClick={() => dictate('goal')}><IconMic /> Dictate goal</button>
        </span>
        <input id="prompt-goal" aria-label="Goal" value={goal} onChange={(event) => setGoal(event.target.value)} />
      </div>
      <div className="field">
        <span className="label-row">
          <label htmlFor="prompt-details">Details</label>
          <button type="button" className="btn ghost small mic" onClick={() => dictate('details')}><IconMic /> Dictate details</button>
        </span>
        <textarea id="prompt-details" aria-label="Details" value={details} onChange={(event) => setDetails(event.target.value)} rows={5} />
      </div>
      <div className="field">
        <span>Mode</span>
        <div className="pills" role="group" aria-label="Mode">
          {MODES.map((item) => (
            <button key={item.id} type="button" className={mode === item.id ? 'pill on' : 'pill'} aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>{item.label}</button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row end wrap">
        <button type="button" className="btn" onClick={() => submit(true)}>Approve immediately</button>
        <button type="submit" className="btn primary">Stage prompt</button>
      </div>
    </form>
  );
}

function RawInbox() {
  const { ws, saveNote, removeNote } = useStore();
  const notes = ws.notes.filter(isRawInbox).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (!notes.length) return <p className="muted">No raw Ari notes. Opt a note into Ari Inbox to queue it for triage.</p>;
  return (
    <div className="stack">
      {notes.map((note) => (
        <article key={note.id} className="list-card">
          <div className="block-head">
            <h3>{note.title || 'Untitled note'}</h3>
            <span className="tag">{note.triage_status}</span>
          </div>
          {note.ari_summary && <p className="summary">{note.ari_summary}</p>}
          <p className="snippet">{note.body.slice(0, 220)}</p>
          <div className="row end">
            <button type="button" className="btn ghost" onClick={() => saveNote(archiveRaw(note, nowIso()))}>Archive raw note</button>
            <button type="button" className="btn danger" onClick={() => void askConfirm('Delete this raw note from this device?', 'Delete raw note').then((ok) => { if (ok) removeNote(note.id); })}>Delete raw note</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function StagedView() {
  const { ws, saveQueueItem, saveNote, removeNote } = useStore();
  const staged = filterQueue(ws.queue, 'staged');
  const [xref, setXref] = useState<string | null>(null);
  const note = xref ? ws.notes.find((item) => item.id === xref) ?? null : null;
  if (!staged.length) return <p className="muted">Nothing is staged. A fast prompt or an Ari-organized item will land here.</p>;
  return (
    <div className="staged-layout">
      <div className="row end">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            const now = nowIso();
            for (const item of ws.queue) {
              if (item.status === 'staged') saveQueueItem(approveItem(item, now));
            }
          }}
        >
          Approve all
        </button>
      </div>
      {note && (
        <aside className="crossref" data-testid="crossref">
          <div className="block-head">
            <h3>{note.title}</h3>
            <button type="button" className="btn ghost small" onClick={() => setXref(null)}>Close</button>
          </div>
          <p className="muted small">{note.sync_mode} · {note.triage_status}</p>
          {note.ari_summary && <p className="summary">{note.ari_summary}</p>}
          <pre>{note.body}</pre>
          <div className="row end wrap">
            <button type="button" className="btn ghost" onClick={() => saveNote(archiveRaw(note, nowIso()))}>Archive raw note</button>
            <button type="button" className="btn danger" onClick={() => void askConfirm('Delete the raw note? Staged items keep their text.', 'Delete raw note').then((ok) => { if (ok) { removeNote(note.id); setXref(null); } })}>Delete raw note</button>
          </div>
        </aside>
      )}
      <div className="stack">
        {staged.map((item) => (
          <StagedCard key={item.id} item={item} onXref={() => item.source_note_id && setXref(item.source_note_id)} hasNote={!!crossReference(item, ws.notes)} />
        ))}
      </div>
    </div>
  );
}

function StagedCard({ item, onXref, hasNote }: { item: QueueItem; onXref: () => void; hasNote: boolean }) {
  const { ws, saveQueueItem } = useStore();
  const [draft, setDraft] = useState(item);
  useEffect(() => setDraft(item), [item]);
  function patch(partial: Partial<QueueItem>) {
    const next = { ...draft, ...partial, updated_at: nowIso() };
    setDraft(next);
    saveQueueItem(next);
  }
  return (
    <article className="list-card">
      <div className="block-head">
        <h3>{item.goal}</h3>
        <span className="tag">{item.source_type === 'ari_organized' ? 'Ari organized' : 'Prompt form'}</span>
      </div>
      <p className="muted small">{formatWhen(item.created_at)}</p>
      <label className="field">Bot
        <input aria-label={`Bot for ${item.goal}`} list="bot-names" value={draft.bot_name} onChange={(event) => patch({ bot_name: event.target.value })} />
      </label>
      <label className="field">Goal
        <input aria-label={`Goal for ${item.goal}`} value={draft.goal} onChange={(event) => patch({ goal: event.target.value })} />
      </label>
      <label className="field">Details
        <textarea aria-label={`Details for ${item.goal}`} value={draft.details} onChange={(event) => patch({ details: event.target.value })} rows={3} />
      </label>
      <div className="pills" role="group" aria-label={`Mode for ${item.goal}`}>
        {MODES.map((mode) => (
          <button key={mode.id} type="button" className={draft.mode === mode.id ? 'pill on' : 'pill'} onClick={() => patch({ mode: mode.id })}>{mode.label}</button>
        ))}
      </div>
      <div className="row end wrap">
        {item.source_note_id && <button type="button" className="btn ghost" onClick={onXref} disabled={!hasNote && !ws.notes.some((note) => note.id === item.source_note_id)}>Cross-reference raw note</button>}
        <button type="button" className="btn ghost" onClick={() => saveQueueItem(dropItem(item, nowIso()))}>Drop</button>
        <button type="button" className="btn primary" onClick={() => saveQueueItem(approveItem(item, nowIso()))}>Approve</button>
      </div>
    </article>
  );
}

function HistoryView() {
  const { ws } = useStore();
  const [filter, setFilter] = useState<'approved' | 'dispatched' | 'saved' | 'dropped' | 'history'>('approved');
  const items = filterQueue(ws.queue, filter);
  return (
    <div>
      <div className="pills">
        {(['approved', 'dispatched', 'saved', 'dropped', 'history'] as const).map((status) => (
          <button key={status} type="button" className={filter === status ? 'pill on' : 'pill'} onClick={() => setFilter(status)}>
            {status === 'history' ? 'All history' : status[0].toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>
      <div className="stack">
        {items.length === 0 && <p className="muted">Nothing in this lane.</p>}
        {items.map((item) => (
          <article key={item.id} className="list-card">
            <div className="block-head">
              <h3>{item.goal}</h3>
              <span className={`tag status-${item.status}`}>{item.status}</span>
            </div>
            <p className="muted">{item.bot_name} · {item.mode} · {item.source_type === 'ari_organized' ? 'Ari organized' : 'Prompt form'}</p>
            {item.details && <p>{item.details}</p>}
            {item.approved_at && <p className="muted small">Approved {formatWhen(item.approved_at)}</p>}
            {item.dispatched_at && <p className="muted small">Dispatched {formatWhen(item.dispatched_at)}</p>}
            {item.ari_response && <blockquote className="summary">{item.ari_response}</blockquote>}
          </article>
        ))}
      </div>
    </div>
  );
}
