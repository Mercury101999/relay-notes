import { useMemo, useState } from 'react';
import { findFolderByName, findNoteByTitle, planDisperse, privacyHits, sectionExists, type DisperseRow } from '../core/disperse';
import { TEMPLATE_CATEGORIES } from '../core/templates';
import type { WrapKind } from '../core/wrap';
import type { BlockPick } from '../core/consolidate';
import type { Folder, KeywordAlias, Note, RoutingRule, SnippetTemplate } from '../core/types';

export function QuickBar({ onWrap, onTemplates, onFormat, onDisperse, onSnippet }: {
  onWrap: (kind: WrapKind) => void;
  onTemplates: () => void;
  onFormat: () => void;
  onDisperse: () => void;
  onSnippet: () => void;
}) {
  return (
    <div className="quick-wrap" data-testid="quick-wrap">
      <button type="button" className="btn ghost small" aria-label="Wrap block" onClick={() => onWrap('block')}>{`{ }`}</button>
      <button type="button" className="btn ghost small" aria-label="Wrap chapter" onClick={() => onWrap('chapter')}>{`( )`}</button>
      <button type="button" className="btn ghost small" aria-label="Checklist" onClick={() => onWrap('check')}>{`[ ]`}</button>
      <button type="button" className="btn ghost small" aria-label="Code fence" onClick={() => onWrap('code')}>```</button>
      <button type="button" className="btn ghost small" aria-label="Insert route" onClick={() => onWrap('route')}>{'->'}</button>
      <button type="button" className="btn small" aria-label="Templates" onClick={onTemplates}>Templates</button>
      <button type="button" className="btn small" aria-label="Format" onClick={onFormat}>Format</button>
      <button type="button" className="btn small" aria-label="Disperse" onClick={onDisperse}>Disperse</button>
      <button type="button" className="btn ghost small" aria-label="Save selection as snippet" onClick={onSnippet}>Save snippet</button>
    </div>
  );
}

export function TemplateDrawer({ templates, onClose, onInsert, onSave, onDelete }: {
  templates: SnippetTemplate[];
  onClose: () => void;
  onInsert: (body: string) => void;
  onSave: (template: SnippetTemplate) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState<SnippetTemplate | null>(null);
  const categories = [...TEMPLATE_CATEGORIES];
  for (const template of templates) if (!categories.includes(template.category as typeof categories[number])) categories.push(template.category as typeof categories[number]);
  return (
    <div className="modal-wrap">
      <div className="modal" role="dialog" aria-label="Templates" data-testid="template-drawer">
        <h3>Templates</h3>
        {categories.map((category) => {
          const rows = templates.filter((template) => template.category === category);
          if (!rows.length && category !== 'Custom Snippets') return null;
          return (
            <section key={category}>
              <h4>{category}</h4>
              {rows.map((template) => (
                <div key={template.id} className="sub-item">
                  <button type="button" className="btn ghost small" onClick={() => onInsert(template.body)}>{template.name}</button>
                  <span className="row">
                    <button type="button" className="text-btn" onClick={() => setDraft(template)}>Edit</button>
                    <button type="button" className="text-btn" onClick={() => onDelete(template.id)}>Delete</button>
                  </span>
                </div>
              ))}
            </section>
          );
        })}
        {draft ? (
          <TemplateForm draft={draft} onChange={setDraft} onSave={() => { onSave(draft); setDraft(null); }} onCancel={() => setDraft(null)} />
        ) : (
          <button type="button" className="btn" onClick={() => setDraft({ id: crypto.randomUUID(), category: 'Custom Snippets', name: '', body: '', updated_at: new Date().toISOString() })}>New snippet</button>
        )}
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function TemplateForm({ draft, onChange, onSave, onCancel }: {
  draft: SnippetTemplate;
  onChange: (template: SnippetTemplate) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="stack">
      <label className="field">Category
        <select aria-label="Template category" value={draft.category} onChange={(event) => onChange({ ...draft, category: event.target.value })}>
          {TEMPLATE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
        </select>
      </label>
      <label className="field">Name<input aria-label="Template name" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
      <label className="field">Body<textarea aria-label="Template body" value={draft.body} onChange={(event) => onChange({ ...draft, body: event.target.value })} /></label>
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary" onClick={onSave}>Save template</button>
      </div>
    </div>
  );
}

export function SnippetDialog({ selection, onClose, onSave }: {
  selection: string;
  onClose: () => void;
  onSave: (name: string, category: string, body: string) => void;
}) {
  const [name, setName] = useState('Snippet');
  const [category, setCategory] = useState('Custom Snippets');
  return (
    <div className="modal-wrap">
      <div className="modal" role="dialog" aria-label="Save snippet">
        <h3>Save selection as snippet</h3>
        <label className="field">Name<input aria-label="Snippet name" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field">Category
          <select aria-label="Snippet category" value={category} onChange={(event) => setCategory(event.target.value)}>
            {TEMPLATE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <pre className="review">{selection}</pre>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => onSave(name, category, selection)}>Save snippet</button>
        </div>
      </div>
    </div>
  );
}

export function DisperseDialog({
  note, notes, folders, rules, aliases, onClose, onConfirm,
}: {
  note: Note;
  notes: Note[];
  folders: Folder[];
  rules: RoutingRule[];
  aliases: KeywordAlias[];
  onClose: () => void;
  onConfirm: (rows: DisperseRow[], mode: 'move' | 'copy', privacyAccepted: boolean) => void;
}) {
  const seeded = useMemo(() => planDisperse(note, notes, folders, rules, aliases).rows, [note, notes, folders, rules, aliases]);
  const [rows, setRows] = useState<DisperseRow[]>(seeded);
  const [mode, setMode] = useState<'move' | 'copy'>('move');
  const [accepted, setAccepted] = useState(false);
  const shown = rows.map((row) => decorate(row, notes, folders));
  const privacy = privacyHits(note, shown, notes, folders);
  const ready = shown.some((row) => row.folder.trim() && row.note.trim());
  return (
    <div className="modal-wrap">
      <div className="modal" role="dialog" aria-label="Disperse preview" data-testid="disperse-preview">
        <h3>Disperse dry-run</h3>
        <p className="muted small">Nothing is written until you confirm. Plain text and unmapped blocks stay in this note.</p>
        <div className="pills" role="group" aria-label="Disperse mode">
          <button type="button" className={mode === 'move' ? 'pill on' : 'pill'} onClick={() => setMode('move')}>Move</button>
          <button type="button" className={mode === 'copy' ? 'pill on' : 'pill'} onClick={() => setMode('copy')}>Copy</button>
        </div>
        {shown.map((row, index) => (
          <article key={row.blockId} className="row-card">
            <strong>{row.subClass ? `${row.keyword} : ${row.subClass}` : row.keyword}</strong>
            <span className="muted small">{row.via === 'unmapped' ? 'Unmapped — pick a destination' : `Via ${row.via}`}</span>
            <div className="dest-grid">
              <label className="field">Folder<input aria-label={`Folder for ${row.keyword}`} value={row.folder} onChange={(event) => updateRow(setRows, index, { folder: event.target.value })} /></label>
              <label className="field">Note<input aria-label={`Note for ${row.keyword}`} value={row.note} onChange={(event) => updateRow(setRows, index, { note: event.target.value })} /></label>
              <label className="field">Section<input aria-label={`Section for ${row.keyword}`} value={row.section} onChange={(event) => updateRow(setRows, index, { section: event.target.value })} /></label>
            </div>
            <span className="muted small">{destinationStatus(row)}</span>
            <label className="check-line">
              <input type="checkbox" aria-label={`Save rule for ${row.keyword}`} checked={row.saveRule} onChange={(event) => updateRow(setRows, index, { saveRule: event.target.checked })} />
              Save rule for next time
            </label>
          </article>
        ))}
        {!!privacy.length && (
          <div className="banner-amber" data-testid="privacy-warning">
            <strong>Local only notes stay local unless you confirm.</strong>
            <ul>
              {privacy.map((hit) => <li key={`${hit.blockLabel}-${hit.targetTitle}`}>{hit.blockLabel} would be written into synced note “{hit.targetTitle}”.</li>)}
            </ul>
            <label className="check-line">
              <input type="checkbox" aria-label="Confirm local to cloud" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
              I understand these local blocks will be written into a synced note.
            </label>
          </div>
        )}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!ready || (privacy.length > 0 && !accepted)} onClick={() => onConfirm(shown, mode, accepted)}>Confirm disperse</button>
        </div>
      </div>
    </div>
  );
}

function decorate(row: DisperseRow, notes: Note[], folders: Folder[]): DisperseRow {
  const folder = findFolderByName(folders, row.folder);
  const target = folder ? findNoteByTitle(notes, folder.id, row.note) : undefined;
  return {
    ...row,
    folderExists: !!folder,
    noteExists: !!target,
    sectionExists: target ? sectionExists(target.body, row.section) : false,
  };
}

function destinationStatus(row: DisperseRow): string {
  if (!row.folder.trim() || !row.note.trim()) return 'No destination yet';
  const folder = row.folderExists ? 'folder exists' : 'folder will be created';
  const note = row.noteExists ? 'note exists' : 'note will be created';
  const section = !row.section.trim() ? 'appends at end' : row.sectionExists ? 'section exists' : 'section will be created';
  return `${row.folder} / ${row.note}${row.section ? ` / ${row.section}` : ''} — ${folder}, ${note}, ${section}`;
}

function updateRow(setRows: (value: DisperseRow[] | ((current: DisperseRow[]) => DisperseRow[])) => void, index: number, patch: Partial<DisperseRow>) {
  setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
}

export function ConsolidateDialog({
  picks, notes, folders, onClose, onConfirm,
}: {
  picks: BlockPick[];
  notes: Note[];
  folders: Folder[];
  onClose: () => void;
  onConfirm: (input: { targetNoteId: string | null; folderId: string | null; newTitle: string; mode: 'copy' | 'archive'; privacyAccepted: boolean }) => void;
}) {
  const [folderId, setFolderId] = useState<string>(folders[0]?.id ?? '');
  const [target, setTarget] = useState<string>('new');
  const [title, setTitle] = useState('Consolidated note');
  const [mode, setMode] = useState<'copy' | 'archive'>('copy');
  const [accepted, setAccepted] = useState(false);
  const inFolder = notes.filter((note) => (folderId ? note.folder_id === folderId : !note.folder_id));
  const existing = target === 'new' ? null : notes.find((note) => note.id === target) ?? null;
  const privacy = existing && existing.sync_mode !== 'local'
    ? picks.filter((pick) => pick.syncMode === 'local')
    : [];
  const groups = new Map<string, BlockPick[]>();
  for (const pick of picks) {
    const key = pick.section.subClass ?? 'No sub-class';
    groups.set(key, [...(groups.get(key) ?? []), pick]);
  }
  return (
    <div className="modal-wrap">
      <div className="modal" role="dialog" aria-label="Consolidate preview" data-testid="consolidate-preview">
        <h3>Consolidate into note</h3>
        {[...groups.entries()].map(([name, items]) => (
          <section key={name}>
            <h4>{name}</h4>
            {items.map((item) => <p key={`${item.noteId}-${item.section.id}`} className="muted small">{item.noteTitle} · {item.section.keyword}</p>)}
          </section>
        ))}
        <label className="field">Folder
          <select aria-label="Consolidate folder" value={folderId} onChange={(event) => { setFolderId(event.target.value); setTarget('new'); }}>
            <option value="">No folder</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <label className="field">Note
          <select aria-label="Consolidate note" value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="new">New note</option>
            {inFolder.map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}
          </select>
        </label>
        {target === 'new' && <label className="field">Title<input aria-label="New consolidated title" value={title} onChange={(event) => setTitle(event.target.value)} /></label>}
        <div className="pills" role="group" aria-label="Consolidate mode">
          <button type="button" className={mode === 'copy' ? 'pill on' : 'pill'} onClick={() => setMode('copy')}>Copy</button>
          <button type="button" className={mode === 'archive' ? 'pill on' : 'pill'} onClick={() => setMode('archive')}>Archive originals</button>
        </div>
        {target === 'new' && picks.some((pick) => pick.syncMode === 'local') && <p className="muted small">The new note stays Local only.</p>}
        {!!privacy.length && (
          <div className="banner-amber" data-testid="consolidate-privacy">
            <strong>A local block is aimed at a synced note.</strong>
            <ul>{privacy.map((pick) => <li key={pick.section.id}>{pick.noteTitle} → {existing?.title}</li>)}</ul>
            <label className="check-line">
              <input type="checkbox" aria-label="Confirm consolidate privacy" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
              I understand these local blocks will be written into a synced note.
            </label>
          </div>
        )}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={privacy.length > 0 && !accepted} onClick={() => onConfirm({ targetNoteId: target === 'new' ? null : target, folderId: folderId || null, newTitle: title, mode, privacyAccepted: accepted })}>Confirm consolidate</button>
        </div>
      </div>
    </div>
  );
}
