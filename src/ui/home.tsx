import { makeNote } from '../core/factory';
import { openTodos, stagedPreview, summarize } from '../core/summary';
import { formatWhen } from '../core/time';
import type { PromptPrefill } from '../core/queue';
import type { Route } from '../core/routes';
import { useStore } from '../state/store';

export function HomePage({ go, onPrompt }: { go: (route: Route) => void; onPrompt: (prefill?: PromptPrefill) => void }) {
  const { ws, ready, loadExample, saveNote } = useStore();
  const summary = summarize(ws);
  const todos = openTodos(ws.bots).slice(0, 6);
  const staged = stagedPreview(ws.queue);
  const empty = ready && !ws.bots.length && !ws.notes.length && !ws.queue.length;

  return (
    <section className="page" data-page="home">
      <header className="page-head">
        <h1>Relay Notes</h1>
        <p className="lede">A private roster for the notes, prompts, and assistants you run. Status stays on this device until a note is opted into Ari.</p>
      </header>
      <div className="tiles">
        <button type="button" className="tile slate" onClick={() => go({ page: 'bots' })}>
          <strong className="num">{summary.activeBots}</strong>
          <span>active of {summary.bots} bots</span>
        </button>
        <button type="button" className="tile green" onClick={() => go({ page: 'queue', tab: 'raw' })}>
          <strong className="num">{summary.raw}</strong>
          <span>Raw inbox</span>
        </button>
        <button type="button" className="tile amber" onClick={() => go({ page: 'queue', tab: 'staged' })}>
          <strong className="num">{summary.staged}</strong>
          <span>Staged</span>
        </button>
        <button type="button" className="tile blue" onClick={() => go({ page: 'queue', tab: 'history' })}>
          <strong className="num">{summary.approved}</strong>
          <span>Approved</span>
        </button>
      </div>
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={() => {
          const created = makeNote({ title: 'Untitled note', body: '', sync_mode: 'local' });
          saveNote(created);
          go({ page: 'notes', noteId: created.id });
        }}>New note</button>
        <button type="button" className="btn" onClick={() => onPrompt()}>Fast prompt form</button>
      </div>
      {empty && (
        <div className="empty-card">
          <h2>Nothing on the desk yet</h2>
          <p className="muted">Start a note, or load a fictional example workspace with Inbox Triage, Code Partner, Study Coach, and Research Desk.</p>
          <button type="button" className="btn primary" onClick={loadExample}>Load example workspace</button>
        </div>
      )}
      <section className="block">
        <div className="block-head">
          <h2>Open to-dos</h2>
          <span className="count">{todos.length}</span>
        </div>
        {todos.length === 0 && <p className="muted">No open to-dos.</p>}
        <div className="stack">
          {todos.map((todo) => (
            <button key={todo.todoId} type="button" className="list-card linkish" onClick={() => go({ page: 'bots', botId: todo.botId })}>
              <strong>{todo.text}</strong>
              <span className="muted">{todo.botName}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="block">
        <div className="block-head">
          <h2>Staged for review</h2>
          <span className="count">{summary.staged}</span>
        </div>
        {staged.length === 0 && <p className="muted">The staged queue is clear.</p>}
        <div className="stack">
          {staged.map((item) => (
            <button key={item.id} type="button" className="list-card linkish" onClick={() => go({ page: 'queue', tab: 'staged' })}>
              <strong>{item.goal}</strong>
              <span className="muted">{item.bot_name} · {item.source_type === 'ari_organized' ? 'Ari organized' : 'Prompt form'} · {formatWhen(item.updated_at)}</span>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
