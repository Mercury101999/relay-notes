import { useMemo, useState } from 'react';
import { applyConsolidate, blockMatches, type BlockPick, type GroupFilter } from '../core/consolidate';
import { folderTree } from '../core/folders';
import { makeFolder, makeNote } from '../core/factory';
import { organizeByKeyword, sectionToPrompt } from '../core/organize';
import type { PromptPrefill } from '../core/queue';
import type { Route } from '../core/routes';
import { canonicalKeyword } from '../core/routing';
import { searchWorkspace, type SearchScope } from '../core/search';
import { nowIso } from '../core/time';
import type { Folder, Note, SyncMode } from '../core/types';
import type { OrganizeUndo } from '../core/undo';
import { useStore } from '../state/store';
import { NoteEditor } from './editor';
import { askConfirm, toast } from './toast';
import { ConsolidateDialog } from './writing';

export function NotesPage({ route, go, onPrompt }: { route: Extract<Route, { page: 'notes' }>; go: (route: Route) => void; onPrompt: (prefill: PromptPrefill) => void }) {
  const store = useStore();
  const { ws } = store;
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('section');
  const [filter, setFilter] = useState<'all' | 'local' | 'ari' | string>('all');
  const [draft, setDraft] = useState<Folder | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const note = ws.notes.find((item) => item.id === route.noteId) ?? null;
  const hits = useMemo(() => searchWorkspace(query, scope, ws.notes, ws.folders), [query, scope, ws.notes, ws.folders]);
  const tree = folderTree(ws.folders);
  const visibleNotes = ws.notes.filter((item) => {
    if (filter === 'local') return item.sync_mode === 'local';
    if (filter === 'ari') return item.sync_mode !== 'local';
    if (filter !== 'all') return item.folder_id === filter;
    return true;
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));

  function createNote() {
    const folderId = filter !== 'all' && filter !== 'local' && filter !== 'ari' ? filter : null;
    const created = makeNote({ title: 'Untitled note', body: '', folder_id: folderId, sync_mode: 'local' });
    store.saveNote(created);
    go({ page: 'notes', noteId: created.id });
  }

  async function removeNote(id: string) {
    if (!(await askConfirm('Delete this note from this device? A synced copy is removed from Supabase on the next sync.', 'Delete note'))) return;
    store.removeNote(id);
    go({ page: 'notes' });
  }

  async function removeFolder(id: string) {
    if (!(await askConfirm('Delete this folder and its nested folders? Notes inside them become unfiled.', 'Delete folder'))) return;
    store.removeFolder(id);
    if (filter === id) setFilter('all');
  }

  return (
    <section className={`page notes-page${note ? ' editing' : ''}`} data-page="notes">
      <div className="notes-list">
        <header className="page-head compact">
          <h1>Notes</h1>
          <button type="button" className="btn primary small" onClick={createNote}>New note</button>
        </header>
        <div className="search-row">
          <input aria-label="Search notes" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="Search scope" value={scope} onChange={(event) => setScope(event.target.value as SearchScope)}>
            <option value="section">Section / keyword</option>
            <option value="note">Note</option>
            <option value="folder">Folder</option>
          </select>
        </div>
        {query.trim() && (
          <div className="stack search-hits">
            {hits.length === 0 && <p className="muted">No matches.</p>}
            {hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                className="list-card linkish"
                onClick={() => {
                  if (hit.noteId) go({ page: 'notes', noteId: hit.noteId });
                  else if (hit.folderId) setFilter(hit.folderId);
                  setQuery('');
                }}
              >
                <strong>{hit.title}</strong>
                <span className="snippet">{hit.snippet}</span>
              </button>
            ))}
          </div>
        )}
        <div className="pills scroll">
          <button type="button" className={filter === 'all' && route.panel !== 'keyword' ? 'pill on' : 'pill'} onClick={() => { setFilter('all'); go({ page: 'notes' }); }}>All notes</button>
          <button type="button" className={filter === 'local' ? 'pill on' : 'pill'} onClick={() => setFilter('local')}>Local only</button>
          <button type="button" className={filter === 'ari' ? 'pill on' : 'pill'} onClick={() => setFilter('ari')}>Ari synced</button>
          <button type="button" className={route.panel === 'keyword' ? 'pill on' : 'pill'} onClick={() => go({ page: 'notes', panel: 'keyword' })}>By keyword</button>
        </div>
        <div className="folder-head">
          <h2>Folders</h2>
          <button type="button" className="text-btn" onClick={() => setDraft(makeFolder({ name: '' }))}>New folder</button>
        </div>
        <ul className="tree">
          {tree.map(({ folder, depth }) => (
            <li key={folder.id} style={{ paddingLeft: depth * 14 }}>
              <button type="button" className={filter === folder.id ? 'tree-name on' : 'tree-name'} onClick={() => { setFilter(folder.id); go({ page: 'notes' }); }}>
                <i className="dot" style={{ background: folder.color }} />
                {folder.code && <span className="code">{folder.code}</span>}
                {folder.name}
              </button>
              <span className="tree-actions">
                <button type="button" aria-label={`Move ${folder.name} up`} onClick={() => store.moveFolder(folder.id, -1)}>↑</button>
                <button type="button" aria-label={`Move ${folder.name} down`} onClick={() => store.moveFolder(folder.id, 1)}>↓</button>
                <button type="button" aria-label={`Edit ${folder.name}`} onClick={() => setDraft(folder)}>Edit</button>
                <button type="button" aria-label={`Delete ${folder.name}`} onClick={() => void removeFolder(folder.id)}>×</button>
              </span>
            </li>
          ))}
        </ul>
        {route.panel === 'keyword' ? (
          <KeywordBoard
            notes={ws.notes}
            folders={ws.folders}
            aliases={ws.settings.keyword_aliases}
            collapsed={collapsedGroups}
            onToggle={(key) => setCollapsedGroups((current) => ({ ...current, [key]: !current[key] }))}
            onOpen={(id) => go({ page: 'notes', noteId: id })}
            onPrompt={onPrompt}
          />
        ) : (
          <div className="stack">
            {visibleNotes.length === 0 && <p className="muted">No notes in this view.</p>}
            {visibleNotes.map((item) => (
              <button key={item.id} type="button" className="list-card linkish" onClick={() => go({ page: 'notes', noteId: item.id })}>
                <strong>{item.title || 'Untitled note'}</strong>
                <span className="muted">{syncLabel(item.sync_mode)}{item.keywords.length ? ` · ${item.keywords.slice(0, 3).join(', ')}` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {note && (
        <NoteEditor
          note={note}
          folders={ws.folders}
          rules={ws.settings.voice_dictionary}
          commands={ws.settings.voice_commands_enabled}
          onChange={store.saveNote}
          onBack={() => go({ page: 'notes', panel: route.panel })}
          onDelete={() => void removeNote(note.id)}
        />
      )}
      {draft && (
        <FolderDialog
          draft={draft}
          folders={ws.folders}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => {
            const error = store.saveFolder({ ...draft, updated_at: nowIso() });
            if (error) return error;
            setDraft(null);
            return null;
          }}
        />
      )}
    </section>
  );
}

function syncLabel(mode: SyncMode) {
  if (mode === 'local') return 'Local only';
  if (mode === 'ari_inbox') return 'Ari inbox';
  return 'Ari reference';
}

function KeywordBoard({
  notes, folders, aliases, collapsed, onToggle, onOpen, onPrompt,
}: {
  notes: Note[];
  folders: Folder[];
  aliases: ReturnType<typeof useStore>['ws']['settings']['keyword_aliases'];
  collapsed: Record<string, boolean>;
  onToggle: (key: string) => void;
  onOpen: (id: string) => void;
  onPrompt: (prefill: PromptPrefill) => void;
}) {
  const store = useStore();
  const [filter, setFilter] = useState<GroupFilter>({ keywords: [], subClasses: [], tags: [], mentions: [], search: '' });
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const canon = (keyword: string) => canonicalKeyword(keyword, aliases);
  const groups = organizeByKeyword(notes, aliases);
  const picks = useMemo(() => notes.flatMap((note) => note.parsed_sections.map((section): BlockPick => ({
    noteId: note.id,
    noteTitle: note.title,
    syncMode: note.sync_mode,
    section,
  }))), [notes]);
  const visible = picks.filter((pick) => blockMatches(pick, filter, canon));
  const visibleKey = new Set(visible.map((pick) => `${pick.noteId}:${pick.section.id}`));
  const tagOptions = [...new Set(picks.flatMap((pick) => pick.section.tags))];
  const mentionOptions = [...new Set(picks.flatMap((pick) => pick.section.mentions))];
  const keywordOptions = [...new Set(picks.map((pick) => canon(pick.section.keyword)))];
  const subOptions = [...new Set(picks.map((pick) => pick.section.subClass).filter((item): item is string => !!item))];
  function toggle(list: string[], value: string) {
    return list.some((item) => item.toLowerCase() === value.toLowerCase()) ? list.filter((item) => item.toLowerCase() !== value.toLowerCase()) : [...list, value];
  }
  function confirm(input: { targetNoteId: string | null; folderId: string | null; newTitle: string; mode: 'copy' | 'archive'; privacyAccepted: boolean }) {
    const chosen = picks.filter((pick) => selected.includes(`${pick.noteId}:${pick.section.id}`));
    const result = applyConsolidate({ picks: chosen, ...input }, notes, folders, input.privacyAccepted, nowIso());
    if (!result.ok) {
      toast('Confirm the local-to-cloud warning before consolidating.');
      return;
    }
    const before = new Set(result.touchedNoteIds.filter((id) => !result.createdNoteIds.includes(id)));
    const snapshot: OrganizeUndo = {
      id: crypto.randomUUID(),
      kind: 'consolidate',
      label: 'Undo consolidate',
      created_at: nowIso(),
      notes: notes.filter((note) => before.has(note.id)),
      folders: [],
      createdNoteIds: result.createdNoteIds,
      createdFolderIds: [],
    };
    store.commitOrganize(result.notes, folders, snapshot);
    setOpen(false);
    setSelected([]);
    toast('Blocks consolidated');
  }
  if (!groups.length) return <p className="muted">Parsed sections will gather here by keyword.</p>;
  return (
    <div className="stack keyword-board" data-testid="group-filters">
      <input aria-label="Filter blocks" placeholder="Filter by keyword, tag, or bot" value={filter.search} onChange={(event) => setFilter({ ...filter, search: event.target.value })} />
      <div className="pills">
        {keywordOptions.map((keyword) => <button key={keyword} type="button" className={filter.keywords.some((item) => item.toLowerCase() === keyword.toLowerCase()) ? 'pill on' : 'pill'} onClick={() => setFilter({ ...filter, keywords: toggle(filter.keywords, keyword) })}>{keyword}</button>)}
        {subOptions.map((sub) => <button key={sub} type="button" className={filter.subClasses.some((item) => item.toLowerCase() === sub.toLowerCase()) ? 'pill on' : 'pill'} onClick={() => setFilter({ ...filter, subClasses: toggle(filter.subClasses, sub) })}>{sub}</button>)}
        {tagOptions.map((tag) => <button key={tag} type="button" aria-label={`Filter tag ${tag}`} className={filter.tags.some((item) => item.toLowerCase() === tag.toLowerCase()) ? 'pill on' : 'pill'} onClick={() => setFilter({ ...filter, tags: toggle(filter.tags, tag) })}>#{tag}</button>)}
        {mentionOptions.map((mention) => <button key={mention} type="button" aria-label={`Filter mention ${mention}`} className={filter.mentions.some((item) => item.toLowerCase() === mention.toLowerCase()) ? 'pill on' : 'pill'} onClick={() => setFilter({ ...filter, mentions: toggle(filter.mentions, mention) })}>@{mention}</button>)}
      </div>
      <button type="button" className="btn" disabled={!selected.length} onClick={() => setOpen(true)}>Consolidate into Note</button>
      {groups.map((group) => {
        const items = group.items.filter((item) => visibleKey.has(`${item.noteId}:${item.section.id}`));
        if (!items.length) return null;
        const closed = collapsed[group.keyword];
        return (
          <article key={group.keyword} className="list-card">
            <button type="button" className="kw-toggle" aria-expanded={!closed} onClick={() => onToggle(group.keyword)}>
              {closed ? '▸' : '▾'} {group.keyword}
              <span className="muted">{items.length}</span>
            </button>
            {!closed && group.subGroups.map((sub) => {
              const subItems = sub.items.filter((item) => visibleKey.has(`${item.noteId}:${item.section.id}`));
              if (!subItems.length) return null;
              return (
                <div key={sub.subClass ?? '∅'} className="sub-group">
                  <h3>{sub.subClass ?? 'No sub-class'}</h3>
                  {subItems.map((item) => {
                    const key = `${item.noteId}:${item.section.id}`;
                    return (
                      <div key={key} className="sub-item">
                        <label className="check-line">
                          <input type="checkbox" aria-label={`Select ${item.section.keyword} from ${item.noteTitle}`} checked={selected.includes(key)} onChange={() => setSelected((current) => current.includes(key) ? current.filter((id) => id !== key) : [...current, key])} />
                          <span>
                            <strong>{item.noteTitle}</strong>
                            <span className="muted">{item.section.chapters.length} chapters{(item.section.tags ?? []).slice(0, 3).map((tag) => ` #${tag}`).join('')}{(item.section.mentions ?? []).slice(0, 3).map((mention) => ` @${mention}`).join('')}</span>
                          </span>
                        </label>
                        <div className="row">
                          <button type="button" className="btn ghost small" onClick={() => onOpen(item.noteId)}>Open note</button>
                          <button type="button" className="btn small" onClick={() => onPrompt({ ...sectionToPrompt(item.section), source_note_id: item.noteId })}>Send to prompt</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </article>
        );
      })}
      {open && (
        <ConsolidateDialog
          picks={picks.filter((pick) => selected.includes(`${pick.noteId}:${pick.section.id}`))}
          notes={notes}
          folders={folders}
          onClose={() => setOpen(false)}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}

function FolderDialog({
  draft, folders, onChange, onClose, onSave,
}: {
  draft: Folder;
  folders: Folder[];
  onChange: (folder: Folder) => void;
  onClose: () => void;
  onSave: () => string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-wrap">
      <div className="modal" role="dialog" aria-label="Folder">
        <h3>{draft.created_at === draft.updated_at ? 'New folder' : 'Edit folder'}</h3>
        <label className="field">Name<input aria-label="Folder name" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
        <label className="field">Code<input aria-label="Folder code" placeholder="2.3.1" value={draft.code ?? ''} onChange={(event) => onChange({ ...draft, code: event.target.value || null })} /></label>
        <label className="field">Description<textarea aria-label="Folder description" value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} /></label>
        <label className="field">Color<input aria-label="Folder color" type="color" value={draft.color} onChange={(event) => onChange({ ...draft, color: event.target.value })} /></label>
        <label className="field">Parent
          <select aria-label="Parent folder" value={draft.parent_id ?? ''} onChange={(event) => onChange({ ...draft, parent_id: event.target.value || null })}>
            <option value="">Top level</option>
            {folders.filter((folder) => folder.id !== draft.id).map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.code ? `${folder.code} ${folder.name}` : folder.name}</option>
            ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => setError(onSave())}>Save folder</button>
        </div>
      </div>
    </div>
  );
}
