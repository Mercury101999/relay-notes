import { useMemo, useState } from 'react';
import { botStatusLabel, makeBot, makeTodo } from '../core/factory';
import { itemsForBot } from '../core/queue';
import type { PromptPrefill } from '../core/queue';
import type { Route } from '../core/routes';
import { formatWhen, nowIso, uid } from '../core/time';
import type { Bot, BotStatus } from '../core/types';
import { useStore } from '../state/store';
import { askConfirm } from './toast';

const STATUSES: BotStatus[] = ['active', 'paused', 'idea', 'retired'];

export function BotsPage({ route, go, onPrompt }: { route: Extract<Route, { page: 'bots' }>; go: (route: Route) => void; onPrompt: (prefill: PromptPrefill) => void }) {
  const store = useStore();
  const bot = store.ws.bots.find((item) => item.id === route.botId) ?? null;
  if (bot) {
    return <BotDetail bot={bot} queue={store.ws.queue} onBack={() => go({ page: 'bots' })} onChange={store.saveBot} onDelete={async () => {
      if (await askConfirm(`Delete ${bot.name}? This removes the card from this device.`, 'Delete bot')) {
        store.removeBot(bot.id);
        go({ page: 'bots' });
      }
    }} onPrompt={onPrompt} />;
  }
  return <BotList go={go} />;
}

function BotList({ go }: { go: (route: Route) => void }) {
  const { ws, saveBot } = useStore();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<BotStatus | 'all'>('all');
  const [tag, setTag] = useState('all');
  const tags = useMemo(() => [...new Set(ws.bots.flatMap((bot) => bot.tags))].sort(), [ws.bots]);
  const bots = ws.bots.filter((bot) => {
    const hay = `${bot.name} ${bot.role} ${bot.notes}`.toLowerCase();
    if (query && !hay.includes(query.trim().toLowerCase())) return false;
    if (status !== 'all' && bot.status !== status) return false;
    if (tag !== 'all' && !bot.tags.includes(tag)) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="page" data-page="bots">
      <header className="page-head compact">
        <h1>Bots</h1>
        <button
          type="button"
          className="btn primary small"
          onClick={() => {
            const created = makeBot({ name: 'New bot', status: 'idea', notes: 'Fictional sample. Rename this card before you rely on it.' });
            const error = saveBot(created);
            if (!error) go({ page: 'bots', botId: created.id });
          }}
        >
          New bot
        </button>
      </header>
      <input aria-label="Search bots" placeholder="Search name, role, or notes" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="pills scroll">
        <button type="button" className={status === 'all' ? 'pill on' : 'pill'} onClick={() => setStatus('all')}>All</button>
        {STATUSES.map((item) => (
          <button key={item} type="button" className={status === item ? `pill on status-${item}` : 'pill'} onClick={() => setStatus(item)}>{botStatusLabel(item)}</button>
        ))}
      </div>
      {!!tags.length && (
        <label className="field">Tag
          <select aria-label="Filter by tag" value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="all">All tags</option>
            {tags.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      )}
      <div className="bot-grid">
        {bots.length === 0 && <p className="muted">No bots match.</p>}
        {bots.map((item) => (
          <button key={item.id} type="button" className="bot-card" onClick={() => go({ page: 'bots', botId: item.id })}>
            <span className="avatar" style={{ borderColor: item.accent_color }}>{item.avatar}</span>
            <span>
              <strong>{item.name}</strong>
              <span className="muted">{item.role || 'No role yet'}</span>
            </span>
            <em className={`status-pill status-${item.status}`}>{botStatusLabel(item.status)}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function BotDetail({
  bot, queue, onBack, onChange, onDelete, onPrompt,
}: {
  bot: Bot;
  queue: ReturnType<typeof useStore>['ws']['queue'];
  onBack: () => void;
  onChange: (bot: Bot) => string | null;
  onDelete: () => Promise<void>;
  onPrompt: (prefill: PromptPrefill) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [todo, setTodo] = useState('');
  const items = itemsForBot(queue, bot.name);
  function save(next: Bot) {
    const message = onChange({ ...next, updated_at: nowIso() });
    setError(message);
  }
  return (
    <section className="page detail" data-page="bot-detail">
      <button type="button" className="btn ghost small" onClick={onBack}>Back</button>
      <div className="identity">
        <label className="avatar xl" style={{ borderColor: bot.accent_color }}>
          <span>{bot.avatar}</span>
          <input aria-label="Avatar" value={bot.avatar} onChange={(event) => save({ ...bot, avatar: event.target.value })} />
        </label>
        <div>
          <input className="name-input" aria-label="Bot name" value={bot.name} onChange={(event) => save({ ...bot, name: event.target.value })} />
          <input className="role-input" aria-label="Role" value={bot.role} placeholder="Role" onChange={(event) => save({ ...bot, role: event.target.value })} />
          <span className={`status-pill status-${bot.status}`}>{botStatusLabel(bot.status)}</span>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="pills" role="group" aria-label="Status">
        {STATUSES.map((status) => (
          <button key={status} type="button" className={bot.status === status ? `pill on status-${status}` : 'pill'} aria-pressed={bot.status === status} onClick={() => save({ ...bot, status })}>{botStatusLabel(status)}</button>
        ))}
      </div>
      <label className="field">Tags
        <input aria-label="Tags" value={bot.tags.join(', ')} placeholder="practice, research" onChange={(event) => save({ ...bot, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} />
      </label>
      <div className="tags">{bot.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}</div>
      <label className="field">Link
        <input aria-label="Link" value={bot.link_url ?? ''} placeholder="https://example.com" onChange={(event) => save({ ...bot, link_url: event.target.value || null })} />
      </label>
      {bot.link_url && <a className="btn wide" href={bot.link_url} target="_blank" rel="noreferrer">Open link</a>}
      <h2>Notes</h2>
      <textarea aria-label="Bot notes" value={bot.notes} rows={4} onChange={(event) => save({ ...bot, notes: event.target.value })} />
      <h2>To-dos</h2>
      <ul className="todo-list">
        {bot.todos.map((item) => (
          <li key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={item.done}
                aria-label={item.text}
                onChange={() => save({ ...bot, todos: bot.todos.map((todoItem) => todoItem.id === item.id ? { ...todoItem, done: !todoItem.done } : todoItem) })}
              />
              <span className={item.done ? 'done' : ''}>{item.text}</span>
            </label>
            <button type="button" className="text-btn danger-text" onClick={() => save({ ...bot, todos: bot.todos.filter((todoItem) => todoItem.id !== item.id) })}>Delete</button>
          </li>
        ))}
      </ul>
      <form className="todo-add" onSubmit={(event) => {
        event.preventDefault();
        if (!todo.trim()) return;
        save({ ...bot, todos: [...bot.todos, { ...makeTodo(todo.trim()), id: uid() }] });
        setTodo('');
      }}>
        <input aria-label="New to-do" placeholder="What should happen next" value={todo} onChange={(event) => setTodo(event.target.value)} />
        <button type="submit" className="btn primary wide">Add to-do</button>
      </form>
      <div className="block-head">
        <h2>Queue & routed items</h2>
        <span className="count">{items.length}</span>
      </div>
      <div className="stack">
        {items.length === 0 && <p className="muted">No queue items for this bot yet.</p>}
        {items.map((item) => (
          <article key={item.id} className="list-card">
            <strong>{item.goal}</strong>
            <span className="muted">{item.status} · {formatWhen(item.updated_at)}</span>
            {item.ari_response && <p className="summary">{item.ari_response}</p>}
          </article>
        ))}
      </div>
      <button type="button" className="btn primary wide" onClick={() => onPrompt({ bot_name: bot.name })}>New prompt for {bot.name}</button>
      <button type="button" className="btn danger wide" onClick={() => void onDelete()}>Delete bot</button>
    </section>
  );
}
