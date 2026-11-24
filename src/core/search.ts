import type { Folder, Note } from './types';

export type SearchScope = 'section' | 'note' | 'folder';

export interface SearchHit {
  scope: SearchScope;
  id: string;
  noteId?: string;
  folderId?: string;
  title: string;
  snippet: string;
  keyword?: string;
  subClass?: string | null;
}

export function snippetAround(text: string, query: string, radius = 42): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!query.trim()) return flat.slice(0, radius * 2);
  const at = flat.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at < 0) return flat.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + query.trim().length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

function has(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

export function searchWorkspace(query: string, scope: SearchScope, notes: Note[], folders: Folder[]): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits: SearchHit[] = [];
  if (scope === 'folder') {
    for (const folder of folders) {
      const hay = [folder.code ?? '', folder.name, folder.description].join('\n');
      if (!has(hay, q)) continue;
      const where = has(folder.name, q) ? folder.name : has(folder.code ?? '', q) ? (folder.code ?? '') : folder.description;
      hits.push({
        scope,
        id: folder.id,
        folderId: folder.id,
        title: folder.code ? `${folder.code} ${folder.name}` : folder.name,
        snippet: snippetAround(where || folder.description || folder.name, q),
      });
    }
    return hits;
  }
  if (scope === 'note') {
    for (const note of notes) {
      if (!has(`${note.title}\n${note.body}`, q)) continue;
      const inTitle = has(note.title, q);
      hits.push({
        scope,
        id: note.id,
        noteId: note.id,
        title: note.title || 'Untitled note',
        snippet: snippetAround(inTitle ? note.title : note.body, q),
      });
    }
    return hits;
  }
  for (const note of notes) {
    for (const section of note.parsed_sections) {
      const blobs = [
        section.keyword,
        section.subClass ?? '',
        ...section.chapters.flatMap((chapter) => [chapter.name, chapter.body]),
      ];
      const matched = blobs.find((blob) => has(blob, q));
      if (!matched && !has(section.keyword, q)) continue;
      if (!matched) continue;
      hits.push({
        scope: 'section',
        id: `${note.id}:${section.lineStart}:${section.keyword}`,
        noteId: note.id,
        title: section.subClass ? `${section.keyword} : ${section.subClass}` : section.keyword,
        snippet: snippetAround(matched, q),
        keyword: section.keyword,
        subClass: section.subClass,
      });
    }
  }
  return hits;
}
