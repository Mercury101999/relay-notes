import { makeNote, withBody } from './factory';
import { appendUnderSection } from './disperse';
import type { Folder, Note, ParsedSection, SyncMode } from './types';

export interface BlockPick {
  noteId: string;
  noteTitle: string;
  syncMode: SyncMode;
  section: ParsedSection;
}

export interface GroupFilter {
  keywords: string[];
  subClasses: string[];
  tags: string[];
  mentions: string[];
  search: string;
}

export function blockMatches(pick: BlockPick, filter: GroupFilter, canonical: (keyword: string) => string): boolean {
  const keyword = canonical(pick.section.keyword);
  if (filter.keywords.length && !filter.keywords.some((item) => item.toLowerCase() === keyword.toLowerCase())) return false;
  if (filter.subClasses.length) {
    const sub = pick.section.subClass ?? '';
    if (!filter.subClasses.some((item) => item.toLowerCase() === sub.toLowerCase())) return false;
  }
  if (filter.tags.length && !filter.tags.some((tag) => pick.section.tags.some((item) => item.toLowerCase() === tag.toLowerCase()))) return false;
  if (filter.mentions.length && !filter.mentions.some((mention) => pick.section.mentions.some((item) => item.toLowerCase() === mention.toLowerCase()))) return false;
  const q = filter.search.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    keyword,
    pick.section.subClass ?? '',
    pick.noteTitle,
    ...pick.section.tags,
    ...pick.section.mentions,
    ...pick.section.chapters.flatMap((chapter) => [chapter.name, chapter.body]),
  ].join('\n').toLowerCase();
  return hay.includes(q);
}

export interface ConsolidateInput {
  picks: BlockPick[];
  targetNoteId: string | null;
  folderId: string | null;
  newTitle: string;
  mode: 'copy' | 'archive';
}

export interface ConsolidateResult {
  ok: boolean;
  notes: Note[];
  createdNoteIds: string[];
  privacy: { sourceTitle: string; targetTitle: string; blockLabel: string }[];
  touchedNoteIds: string[];
}

function groupedBody(picks: BlockPick[]): string {
  const groups = new Map<string, BlockPick[]>();
  for (const pick of picks) {
    const key = pick.section.subClass ?? '';
    const list = groups.get(key) ?? [];
    list.push(pick);
    groups.set(key, list);
  }
  let body = '';
  for (const [sub, list] of groups) {
    const heading = sub || 'No sub-class';
    for (const pick of list) body = appendUnderSection(body, heading, pick.section.raw);
  }
  return body;
}

export function consolidatePrivacy(picks: BlockPick[], target: Note | null): ConsolidateResult['privacy'] {
  if (!target || target.sync_mode === 'local') return [];
  return picks.filter((pick) => pick.syncMode === 'local').map((pick) => ({
    sourceTitle: pick.noteTitle || 'Untitled note',
    targetTitle: target.title || 'Untitled note',
    blockLabel: pick.section.subClass ? `${pick.section.keyword} : ${pick.section.subClass}` : pick.section.keyword,
  }));
}

export function applyConsolidate(
  input: ConsolidateInput,
  notes: Note[],
  folders: Folder[],
  privacyAccepted: boolean,
  now: string,
): ConsolidateResult {
  const targetExisting = input.targetNoteId ? notes.find((note) => note.id === input.targetNoteId) ?? null : null;
  const privacy = consolidatePrivacy(input.picks, targetExisting);
  if (privacy.length && !privacyAccepted) {
    return { ok: false, notes, createdNoteIds: [], privacy, touchedNoteIds: [] };
  }
  const anyLocal = input.picks.some((pick) => pick.syncMode === 'local');
  let next = notes.map((note) => ({ ...note }));
  const createdNoteIds: string[] = [];
  let target: Note;
  if (targetExisting) {
    target = next.find((note) => note.id === targetExisting.id)!;
  } else {
    const folderOk = input.folderId && folders.some((folder) => folder.id === input.folderId) ? input.folderId : null;
    const syncMode: SyncMode = anyLocal ? 'local' : 'ari_reference';
    target = makeNote({
      title: input.newTitle.trim() || 'Consolidated note',
      body: '',
      folder_id: folderOk,
      sync_mode: syncMode,
      triage_status: 'none',
    }, now);
    next = [...next, target];
    createdNoteIds.push(target.id);
  }
  const touched = new Set<string>([target.id]);
  target.body = `${target.body.replace(/\s*$/, '')}${target.body.trim() ? '\n\n' : ''}${groupedBody(input.picks)}`;

  if (input.mode === 'archive') {
    const byNote = new Map<string, BlockPick[]>();
    for (const pick of input.picks) {
      const list = byNote.get(pick.noteId) ?? [];
      list.push(pick);
      byNote.set(pick.noteId, list);
    }
    for (const [noteId, picks] of byNote) {
      if (noteId === target.id) continue;
      const source = next.find((note) => note.id === noteId);
      if (!source) continue;
      const ranges = picks.map((pick) => ({ start: pick.section.startOffset, end: pick.section.endOffset })).sort((a, b) => b.start - a.start);
      let body = source.body;
      for (const range of ranges) body = body.slice(0, range.start) + body.slice(range.end);
      source.body = body;
      if (!body.trim()) source.triage_status = 'archived';
      touched.add(source.id);
    }
  }

  next = next.map((note) => (touched.has(note.id) ? withBody(note, note.body, now) : note));
  return { ok: true, notes: next, createdNoteIds, privacy, touchedNoteIds: [...touched] };
}
