import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chapterChip, chapterKey, emptyFoldState, expandSection, isChapterCollapsed, isSectionCollapsed, sectionKey, summaryChip, toggleChapter, toggleSection, type FoldState } from '../core/fold';
import { addHighlightWord, cycleIndex, findOccurrences, removeHighlightWord, rulerFraction, wordAt, type Occurrence } from '../core/highlight';
import { chapterBodyRanges, replaceChapterBody, replaceRange, sectionOffsets } from '../core/parser';
import { SYNC_LABEL, withBody } from '../core/factory';
import { applySyncMode } from '../core/sync';
import { nowIso } from '../core/time';
import type { Folder, Note, SyncMode, VoiceRule } from '../core/types';
import { openVoice } from '../voice/voice';
import { IconMic } from './icons';

interface Props {
  note: Note;
  folders: Folder[];
  rules: VoiceRule[];
  commands: boolean;
  onChange: (note: Note) => void;
  onBack: () => void;
  onDelete: () => void;
}

export function NoteEditor({ note, folders, rules, commands, onChange, onBack, onDelete }: Props) {
  const [mode, setMode] = useState<'fold' | 'source'>('fold');
  const [fold, setFold] = useState<FoldState>(emptyFoldState);
  const [words, setWords] = useState<string[]>([]);
  const [cursors, setCursors] = useState<Record<string, number>>({});
  const [jump, setJump] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const occurrences = useMemo(() => findOccurrences(note.body, words), [note.body, words]);
  const hold = useRef({ timer: 0, fired: false });

  useEffect(() => {
    if (jump == null) return;
    const target = scrollerRef.current?.querySelector<HTMLElement>(`[data-start="${jump}"]`);
    if (target && scrollerRef.current) {
      const scroller = scrollerRef.current;
      const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop += top - scroller.clientHeight / 3;
      return;
    }
    const area = sourceRef.current;
    if (area && mode === 'source') {
      const line = note.body.slice(0, jump).split('\n').length - 1;
      area.scrollTop = Math.max(0, line * 22 - 40);
      const occ = occurrences.find((item) => item.start === jump);
      area.setSelectionRange(jump, occ ? occ.end : jump);
    }
  }, [jump, fold, mode, note.body, occurrences]);

  function commit(next: Note) {
    onChange(next);
  }

  function highlight(word: string) {
    setWords((current) => addHighlightWord(current, word));
  }

  function beginHold(word: string) {
    hold.current.fired = false;
    window.clearTimeout(hold.current.timer);
    hold.current.timer = window.setTimeout(() => {
      hold.current.fired = true;
      highlight(word);
    }, 400);
  }

  function endHold() {
    window.clearTimeout(hold.current.timer);
  }

  function jumpTo(offset: number) {
    for (const section of note.parsed_sections) {
      const off = sectionOffsets(note.body, section);
      if (offset < off.start || offset >= off.end) continue;
      const key = sectionKey(section);
      setFold((current) => {
        let next = expandSection(current, key);
        const slice = note.body.slice(off.start, off.end);
        const open = slice.indexOf('{');
        if (open >= 0) {
          chapterBodyRanges(slice.slice(open + 1)).forEach((range, index) => {
            const chapter = section.chapters[index];
            if (!chapter) return;
            const start = off.start + open + 1 + range.bodyStart;
            const end = off.start + open + 1 + range.bodyEnd;
            if (offset >= start && offset <= end) {
              const ck = chapterKey(section, chapter, index);
              if (next.chapters[ck]) next = { ...next, chapters: { ...next.chapters, [ck]: false } };
            }
          });
        }
        return next;
      });
      if (isSectionCollapsed(fold, key)) setMode('fold');
    }
    setJump(offset);
  }

  function cycle(word: string, dir: 1 | -1) {
    const list = occurrences.filter((item) => item.word === word);
    if (!list.length) return;
    const current = cursors[word] ?? (dir === 1 ? -1 : 0);
    const next = cycleIndex(current, list.length, dir);
    setCursors((map) => ({ ...map, [word]: next }));
    jumpTo(list[next].start);
  }

  function insertDictation(text: string) {
    const area = sourceRef.current;
    if (mode === 'source' && area && document.activeElement === area) {
      const start = area.selectionStart;
      const end = area.selectionEnd;
      const prefix = note.body.slice(0, start);
      const spacer = prefix && !/\s$/.test(prefix) ? ' ' : '';
      commit(withBody(note, prefix + spacer + text + note.body.slice(end), nowIso()));
      return;
    }
    const base = note.body.replace(/\s*$/, '');
    commit(withBody(note, `${base}\n${text}\n`, nowIso()));
  }

  function renderWords(text: string, base: number, editKey: string) {
    const nodes: ReactNode[] = [];
    const re = /\p{L}[\p{L}\p{N}'’-]*|\p{N}+/gu;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      if (match.index > last) nodes.push(text.slice(last, match.index));
      const start = base + match.index;
      const token = match[0];
      const occ = occurrences.find((item) => item.start === start);
      nodes.push(
        <span
          key={start}
          className={occ ? `word hit${jump === start ? ' current' : ''}` : 'word'}
          data-word={token.toLowerCase()}
          data-start={start}
          style={occ ? { backgroundColor: occ.wash } : undefined}
          onPointerDown={() => beginHold(token)}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onContextMenu={(event) => event.preventDefault()}
          onClick={(event) => {
            if (event.altKey) {
              event.preventDefault();
              highlight(token);
              return;
            }
            if (hold.current.fired) {
              hold.current.fired = false;
              return;
            }
            setEditing(editKey);
          }}
        >
          {token}
        </span>,
      );
      last = match.index + token.length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
  }

  const activeJump = jump;

  return (
    <article className="editor" data-testid="note-editor">
      <div className="editor-toolbar">
        <button type="button" className="btn ghost small" onClick={onBack}>Back</button>
        <div className="seg">
          <button type="button" className={mode === 'fold' ? 'on' : ''} onClick={() => setMode('fold')} aria-pressed={mode === 'fold'}>Fold</button>
          <button type="button" className={mode === 'source' ? 'on' : ''} onClick={() => setMode('source')} aria-pressed={mode === 'source'}>Source</button>
        </div>
        <button
          type="button"
          className="btn ghost small mic"
          onClick={() => openVoice({ rules, commands, onInsert: insertDictation })}
        >
          <IconMic /> Dictate
        </button>
        <button type="button" className="btn ghost small danger-text" onClick={onDelete}>Delete</button>
      </div>
      <label className="field title-field">
        <span className="sr">Title</span>
        <input
          aria-label="Title"
          value={note.title}
          onChange={(event) => commit({ ...note, title: event.target.value, updated_at: nowIso() })}
        />
      </label>
      <div className="editor-meta">
        <label className="field grow">
          <span>Folder</span>
          <select
            aria-label="Folder"
            value={note.folder_id ?? ''}
            onChange={(event) => commit({ ...note, folder_id: event.target.value || null, updated_at: nowIso() })}
          >
            <option value="">No folder</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.code ? `${folder.code} ${folder.name}` : folder.name}</option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Ari sync</span>
          <select
            aria-label="Ari sync"
            value={note.sync_mode}
            onChange={(event) => commit(applySyncMode(note, event.target.value as SyncMode, nowIso()))}
          >
            {(Object.keys(SYNC_LABEL) as SyncMode[]).map((modeKey) => (
              <option key={modeKey} value={modeKey}>{SYNC_LABEL[modeKey]}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small sync-hint">
        {note.sync_mode === 'local'
          ? 'Local only. This note stays in IndexedDB and is never uploaded.'
          : note.sync_mode === 'ari_inbox'
            ? 'Ari Inbox. The note syncs as raw until Ari organizes it.'
            : 'Ari Reference. Synced as a non-private reference.'}
      </p>
      {!!note.keywords.length && (
        <div className="tags" aria-label="Keywords">
          {note.keywords.map((keyword) => <span key={keyword} className="tag">{keyword}</span>)}
        </div>
      )}
      {!!words.length && (
        <div className="hl-chips">
          {words.map((word) => {
            const color = occurrences.find((item) => item.word === word);
            const count = occurrences.filter((item) => item.word === word).length;
            return (
              <span key={word} className="hl-chip">
                <i style={{ background: color?.mark ?? '#2dd4bf' }} />
                {word}
                <em>{count}</em>
                <button type="button" aria-label={`Previous ${word}`} onClick={() => cycle(word, -1)}>↑</button>
                <button type="button" aria-label={`Next ${word}`} onClick={() => cycle(word, 1)}>↓</button>
                <button type="button" aria-label={`Clear ${word}`} onClick={() => setWords((current) => removeHighlightWord(current, word))}>×</button>
              </span>
            );
          })}
          <button type="button" className="btn ghost small" onClick={() => setWords([])}>Clear all</button>
        </div>
      )}
      <div className="editor-pane">
        <div className="editor-scroll" ref={scrollerRef}>
          {mode === 'source' ? (
            <div className="source-wrap">
              <pre className="source-back" aria-hidden="true">{renderHighlightedSource(note.body, occurrences, activeJump)}</pre>
              <textarea
                ref={sourceRef}
                className="note-source"
                aria-label="Note source"
                value={note.body}
                spellCheck={false}
                onChange={(event) => commit(withBody(note, event.target.value, nowIso()))}
                onScroll={(event) => {
                  const back = event.currentTarget.previousElementSibling as HTMLElement | null;
                  if (back) {
                    back.scrollTop = event.currentTarget.scrollTop;
                    back.scrollLeft = event.currentTarget.scrollLeft;
                  }
                }}
                onClick={(event) => {
                  if (!event.altKey) return;
                  const found = wordAt(event.currentTarget.value, event.currentTarget.selectionStart);
                  if (found) highlight(found.word);
                }}
                onPointerDown={(event) => {
                  const area = event.currentTarget;
                  const timer = window.setTimeout(() => {
                    const found = wordAt(area.value, area.selectionStart);
                    if (found) highlight(found.word);
                  }, 420);
                  const stop = () => {
                    window.clearTimeout(timer);
                    area.removeEventListener('pointerup', stop);
                    area.removeEventListener('pointercancel', stop);
                  };
                  area.addEventListener('pointerup', stop);
                  area.addEventListener('pointercancel', stop);
                }}
              />
            </div>
          ) : (
            <div className="fold-view">
              <FoldBody
                note={note}
                fold={fold}
                editing={editing}
                occurrences={occurrences}
                renderWords={renderWords}
                onToggleSection={(key) => setFold((current) => toggleSection(current, key))}
                onToggleChapter={(key) => setFold((current) => toggleChapter(current, key))}
                onEdit={setEditing}
                onText={(start, end, value) => commit(withBody(note, replaceRange(note.body, start, end, value), nowIso()))}
                onChapter={(lineStart, index, value) => commit(withBody(note, replaceChapterBody(note.body, lineStart, index, value), nowIso()))}
              />
            </div>
          )}
        </div>
        <div className="ruler" data-testid="overview-ruler" aria-hidden={occurrences.length === 0}>
          {occurrences.map((item) => (
            <button
              key={`${item.word}-${item.start}`}
              type="button"
              className="ruler-tick"
              style={{ top: `${rulerFraction(item.start, note.body.length) * 100}%`, background: item.mark }}
              aria-label={`Jump to ${item.word}`}
              onClick={() => jumpTo(item.start)}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

function renderHighlightedSource(text: string, occurrences: Occurrence[], jump: number | null) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  occurrences.forEach((item) => {
    if (item.start < cursor) return;
    if (item.start > cursor) nodes.push(text.slice(cursor, item.start));
    nodes.push(
      <mark key={item.start} data-start={item.start} style={{ backgroundColor: item.wash }} className={jump === item.start ? 'current' : undefined}>
        {text.slice(item.start, item.end)}
      </mark>,
    );
    cursor = item.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function FoldBody({
  note, fold, editing, renderWords, onToggleSection, onToggleChapter, onEdit, onText, onChapter,
}: {
  note: Note;
  fold: FoldState;
  editing: string | null;
  occurrences: Occurrence[];
  renderWords: (text: string, base: number, editKey: string) => ReactNode;
  onToggleSection: (key: string) => void;
  onToggleChapter: (key: string) => void;
  onEdit: (key: string | null) => void;
  onText: (start: number, end: number, value: string) => void;
  onChapter: (lineStart: number, index: number, value: string) => void;
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  note.parsed_sections.forEach((section) => {
    const off = sectionOffsets(note.body, section);
    if (off.start > cursor) {
      parts.push(
        <Freeform
          key={`t-${cursor}`}
          text={note.body.slice(cursor, off.start)}
          start={cursor}
          end={off.start}
          editing={editing === `t-${cursor}`}
          renderWords={renderWords}
          editKey={`t-${cursor}`}
          onEdit={() => onEdit(`t-${cursor}`)}
          onCommit={(value) => { onText(cursor, off.start, value); onEdit(null); }}
        />,
      );
    }
    const key = sectionKey(section);
    const collapsed = isSectionCollapsed(fold, key);
    const label = section.subClass ? `${section.keyword} : ${section.subClass}` : section.keyword;
    parts.push(
      <section key={key} className={`section-block${collapsed ? ' collapsed' : ''}`}>
        <div className="section-head">
          <button type="button" className="chevron" aria-expanded={!collapsed} aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`} onClick={() => onToggleSection(key)}>
            {collapsed ? '▸' : '▾'}
          </button>
          <button type="button" className="kw-head" onClick={() => onToggleSection(key)}>
            <strong>{section.keyword}</strong>
            {section.subClass && <span className="sub"> : {section.subClass}</span>}
          </button>
          {collapsed && <span className="chip-summary">{summaryChip(section)}</span>}
        </div>
        {!collapsed && section.chapters.map((chapter, index) => {
          const ck = chapterKey(section, chapter, index);
          const chapterCollapsed = isChapterCollapsed(fold, ck);
          const ranges = chapterBodyRanges(note.body.slice(off.start, off.end).slice(note.body.slice(off.start, off.end).indexOf('{') + 1));
          const range = ranges[index];
          const open = note.body.slice(off.start, off.end).indexOf('{');
          const bodyStart = range ? off.start + open + 1 + range.bodyStart : off.start;
          return (
            <div key={ck} className="chapter">
              <div className="chapter-head">
                <button type="button" className="chevron" aria-expanded={!chapterCollapsed} aria-label={chapterCollapsed ? `Expand ${chapter.name}` : `Collapse ${chapter.name}`} onClick={() => onToggleChapter(ck)}>
                  {chapterCollapsed ? '▸' : '▾'}
                </button>
                <button type="button" className="chapter-name" onClick={() => onToggleChapter(ck)}>{chapter.name}</button>
                {chapterCollapsed && <span className="chip-summary">{chapterChip(chapter)}</span>}
              </div>
              {!chapterCollapsed && (
                editing === ck ? (
                  <textarea
                    aria-label={`${chapter.name} text`}
                    defaultValue={chapter.body}
                    autoFocus
                    onBlur={(event) => { onChapter(section.lineStart, index, event.target.value); onEdit(null); }}
                  />
                ) : (
                  <div className="prose" onDoubleClick={() => onEdit(ck)}>
                    {renderWords(chapter.body, bodyStart, ck)}
                  </div>
                )
              )}
            </div>
          );
        })}
      </section>,
    );
    cursor = off.end;
  });
  if (cursor <= note.body.length) {
    const text = note.body.slice(cursor);
    parts.push(
      <Freeform
        key={`t-${cursor}`}
        text={text}
        start={cursor}
        end={note.body.length}
        editing={editing === `t-${cursor}`}
        renderWords={renderWords}
        editKey={`t-${cursor}`}
        onEdit={() => onEdit(`t-${cursor}`)}
        onCommit={(value) => { onText(cursor, note.body.length, value); onEdit(null); }}
      />,
    );
  }
  return <>{parts}</>;
}

function Freeform({
  text, editing, renderWords, editKey, onEdit, onCommit,
}: {
  text: string;
  start: number;
  end: number;
  editing: boolean;
  renderWords: (text: string, base: number, editKey: string) => ReactNode;
  editKey: string;
  onEdit: () => void;
  onCommit: (value: string) => void;
}) {
  if (!text.trim() && !editing) return null;
  if (editing) {
    return (
      <textarea
        className="freeform-edit"
        aria-label="Freeform text"
        defaultValue={text}
        autoFocus
        onBlur={(event) => onCommit(event.target.value)}
      />
    );
  }
  return (
    <div className="prose freeform">
      {renderWords(text, editKey.startsWith('t-') ? Number(editKey.slice(2)) : 0, editKey)}
      <button type="button" className="text-btn" onClick={onEdit}>Edit text</button>
    </div>
  );
}
