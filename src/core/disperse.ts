import { makeFolder, makeNote, withBody } from './factory';
import { parseNoteBody } from './parser';
import { canonicalKeyword, resolveDestination, upsertRule } from './routing';
import type { Folder, KeywordAlias, Note, RoutingRule, SyncMode } from './types';

export interface DisperseRow {
  blockId: string;
  keyword: string;
  subClass: string | null;
  raw: string;
  start: number;
  end: number;
  folder: string;
  note: string;
  section: string;
  via: 'inline' | 'exact' | 'wildcard' | 'unmapped';
  folderExists: boolean;
  noteExists: boolean;
  sectionExists: boolean;
  saveRule: boolean;
}

export interface PrivacyHit {
  blockLabel: string;
  sourceTitle: string;
  targetTitle: string;
}

export interface DispersePreview {
  rows: DisperseRow[];
  privacy: PrivacyHit[];
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function findFolderByName(folders: Folder[], name: string): Folder | undefined {
  const key = norm(name);
  if (!key) return undefined;
  return folders.find((folder) => norm(folder.name) === key || norm(`${folder.code ?? ''} ${folder.name}`) === key);
}

export function findNoteByTitle(notes: Note[], folderId: string | null, title: string): Note | undefined {
  const key = norm(title);
  if (!key) return undefined;
  return notes.find((note) => norm(note.title) === key && (folderId == null || note.folder_id === folderId));
}

export function sectionMarker(section: string): string {
  return `## ${section.trim()}`;
}

export function sectionExists(body: string, section: string): boolean {
  if (!section.trim()) return true;
  const marker = sectionMarker(section);
  return body.split('\n').some((line) => line.trim() === marker);
}

export function appendUnderSection(body: string, section: string, blockRaw: string): string {
  const addition = blockRaw.trim().replace(/\s+$/, '');
  if (!addition) return body;
  if (!section.trim()) {
    const base = body.replace(/\s*$/, '');
    return `${base}${base ? '\n\n' : ''}${addition}\n`;
  }
  const marker = sectionMarker(section);
  const lines = body.replace(/\s*$/, '').split('\n');
  const start = lines.findIndex((line) => line.trim() === marker);
  if (start < 0) {
    const base = lines.join('\n');
    return `${base}${base ? '\n\n' : ''}${marker}\n\n${addition}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, end);
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  const after = lines.slice(end);
  const merged = [...before, '', addition, ...(after.length ? ['', ...after] : [])];
  return `${merged.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function removeRanges(body: string, ranges: { start: number; end: number }[]): string {
  const sorted = ranges.slice().sort((a, b) => b.start - a.start);
  let next = body;
  for (const range of sorted) next = next.slice(0, range.start) + next.slice(range.end);
  return next;
}

export function planDisperse(source: Note, notes: Note[], folders: Folder[], rules: RoutingRule[], aliases: KeywordAlias[] = []): DispersePreview {
  const parsed = parseNoteBody(source.body);
  const rows: DisperseRow[] = parsed.sections.map((section) => {
    const dest = resolveDestination(section, rules, aliases);
    const folder = findFolderByName(folders, dest.folder);
    const note = folder ? findNoteByTitle(notes, folder.id, dest.note) : undefined;
    return {
      blockId: section.id,
      keyword: section.keyword,
      subClass: section.subClass,
      raw: section.raw,
      start: section.startOffset,
      end: section.endOffset,
      folder: dest.folder,
      note: dest.note,
      section: dest.section,
      via: dest.via,
      folderExists: !!folder,
      noteExists: !!note,
      sectionExists: note ? sectionExists(note.body, dest.section) : false,
      saveRule: false,
    };
  });
  return { rows, privacy: privacyHits(source, rows, notes, folders) };
}

export function privacyHits(source: Note, rows: Pick<DisperseRow, 'keyword' | 'subClass' | 'folder' | 'note'>[], notes: Note[], folders: Folder[]): PrivacyHit[] {
  if (source.sync_mode !== 'local') return [];
  const hits: PrivacyHit[] = [];
  for (const row of rows) {
    if (!row.folder.trim() || !row.note.trim()) continue;
    const folder = findFolderByName(folders, row.folder);
    if (!folder) continue;
    const target = findNoteByTitle(notes, folder.id, row.note);
    if (!target || target.sync_mode === 'local' || target.id === source.id) continue;
    hits.push({
      blockLabel: row.subClass ? `${row.keyword} : ${row.subClass}` : row.keyword,
      sourceTitle: source.title || 'Untitled note',
      targetTitle: target.title || 'Untitled note',
    });
  }
  return hits;
}

export interface DisperseApplyResult {
  ok: boolean;
  notes: Note[];
  folders: Folder[];
  createdNoteIds: string[];
  createdFolderIds: string[];
  privacy: PrivacyHit[];
  rules: RoutingRule[];
  touchedNoteIds: string[];
}

function syncForNew(source: Note): SyncMode {
  return source.sync_mode === 'local' ? 'local' : source.sync_mode;
}

export function applyDisperse(
  source: Note,
  rows: DisperseRow[],
  notes: Note[],
  folders: Folder[],
  rules: RoutingRule[],
  aliases: KeywordAlias[],
  mode: 'move' | 'copy',
  privacyAccepted: boolean,
  now: string,
): DisperseApplyResult {
  const privacy = privacyHits(source, rows, notes, folders);
  if (privacy.length && !privacyAccepted) {
    return { ok: false, notes, folders, createdNoteIds: [], createdFolderIds: [], privacy, rules, touchedNoteIds: [] };
  }
  const active = rows.filter((row) => row.folder.trim() && row.note.trim());
  let nextFolders = folders.slice();
  let nextNotes = notes.map((note) => ({ ...note }));
  const createdFolderIds: string[] = [];
  const createdNoteIds: string[] = [];
  const touched = new Set<string>([source.id]);

  const additions = new Map<string, { section: string; raw: string }[]>();
  const noteIdByKey = new Map<string, string>();

  for (const row of active) {
    let folder = findFolderByName(nextFolders, row.folder);
    if (!folder) {
      folder = makeFolder({ name: row.folder.trim() }, now);
      nextFolders = [...nextFolders, folder];
      createdFolderIds.push(folder.id);
    }
    let target = findNoteByTitle(nextNotes, folder.id, row.note);
    const key = `${folder.id}\n${norm(row.note)}`;
    if (!target) {
      const reserved = noteIdByKey.get(key);
      target = reserved ? nextNotes.find((note) => note.id === reserved) : undefined;
    }
    if (!target) {
      target = makeNote({
        title: row.note.trim(),
        body: '',
        folder_id: folder.id,
        sync_mode: syncForNew(source),
        triage_status: syncForNew(source) === 'ari_inbox' ? 'raw' : 'none',
      }, now);
      nextNotes = [...nextNotes, target];
      createdNoteIds.push(target.id);
      noteIdByKey.set(key, target.id);
    }
    touched.add(target.id);
    const list = additions.get(target.id) ?? [];
    list.push({ section: row.section, raw: row.raw });
    additions.set(target.id, list);
  }

  if (mode === 'move') {
    const sourceNote = nextNotes.find((note) => note.id === source.id);
    if (sourceNote) {
      sourceNote.body = removeRanges(sourceNote.body, active.map((row) => ({ start: row.start, end: row.end })));
    }
  }

  for (const [id, chunks] of additions) {
    const target = nextNotes.find((note) => note.id === id);
    if (!target) continue;
    let body = id === source.id ? (nextNotes.find((note) => note.id === source.id)?.body ?? target.body) : target.body;
    for (const chunk of chunks) body = appendUnderSection(body, chunk.section, chunk.raw);
    target.body = body;
  }

  nextNotes = nextNotes.map((note) => (touched.has(note.id) ? withBody(note, note.body, now) : note));

  let nextRules = rules;
  for (const row of active) {
    if (!row.saveRule) continue;
    nextRules = upsertRule(nextRules, {
      keyword: canonicalKeyword(row.keyword, aliases),
      sub_class: row.subClass?.trim() || '*',
      folder: row.folder,
      note: row.note,
      section: row.section,
    }, now);
  }

  return {
    ok: true,
    notes: nextNotes,
    folders: nextFolders,
    createdNoteIds,
    createdFolderIds,
    privacy,
    rules: nextRules,
    touchedNoteIds: [...touched],
  };
}
