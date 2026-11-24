import type { Folder, Note, Settings, Tombstone, Workspace } from './types';

export interface OrganizeUndo {
  id: string;
  kind: 'disperse' | 'consolidate';
  label: string;
  created_at: string;
  notes: Note[];
  folders: Folder[];
  createdNoteIds: string[];
  createdFolderIds: string[];
  settings?: Settings;
}

export function applyUndo(ws: Workspace, undo: OrganizeUndo, now: string): Workspace {
  const dropNotes = new Set(undo.createdNoteIds);
  const dropFolders = new Set(undo.createdFolderIds);
  const notes = new Map(ws.notes.filter((note) => !dropNotes.has(note.id)).map((note) => [note.id, note]));
  for (const note of undo.notes) notes.set(note.id, note);
  const folders = new Map(ws.folders.filter((folder) => !dropFolders.has(folder.id)).map((folder) => [folder.id, folder]));
  for (const folder of undo.folders) folders.set(folder.id, folder);
  const tombstones: Tombstone[] = [
    ...ws.tombstones,
    ...undo.createdNoteIds.map((id) => ({ table: 'notes' as const, id, deleted_at: now })),
    ...undo.createdFolderIds.map((id) => ({ table: 'folders' as const, id, deleted_at: now })),
  ];
  return {
    ...ws,
    notes: [...notes.values()],
    folders: [...folders.values()],
    settings: undo.settings ?? ws.settings,
    tombstones,
  };
}
