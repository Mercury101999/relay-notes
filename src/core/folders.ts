import type { Folder, Note } from './types';

export function wouldCycle(folders: Folder[], id: string, parentId: string | null): boolean {
  let current = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === id || seen.has(current)) return true;
    seen.add(current);
    current = folders.find((folder) => folder.id === current)?.parent_id ?? null;
  }
  return false;
}

export function folderTree(folders: Folder[]): { folder: Folder; depth: number }[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const list = byParent.get(folder.parent_id) ?? [];
    list.push(folder);
    byParent.set(folder.parent_id, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true }) || a.name.localeCompare(b.name));
  }
  const out: { folder: Folder; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const folder of byParent.get(parent) ?? []) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      out.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const folder of folders) if (!seen.has(folder.id)) out.push({ folder, depth: 0 });
  return out;
}

export function moveFolder(folders: Folder[], id: string, dir: -1 | 1, now: string): Folder[] {
  const folder = folders.find((item) => item.id === id);
  if (!folder) return folders;
  const siblings = folders
    .filter((item) => item.parent_id === folder.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const index = siblings.findIndex((item) => item.id === id);
  const nextIndex = index + dir;
  if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) return folders;
  const next = siblings.slice();
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  const order = new Map(next.map((entry, idx) => [entry.id, idx]));
  return folders.map((entry) => (order.has(entry.id) ? { ...entry, sort_order: order.get(entry.id)!, updated_at: now } : entry));
}

export function deleteFolder(folders: Folder[], notes: Note[], id: string, now: string): { folders: Folder[]; notes: Note[]; removed: string[] } {
  const remove = new Set<string>();
  const walk = (folderId: string) => {
    if (remove.has(folderId)) return;
    remove.add(folderId);
    for (const folder of folders) if (folder.parent_id === folderId) walk(folder.id);
  };
  walk(id);
  return {
    folders: folders.filter((folder) => !remove.has(folder.id)),
    notes: notes.map((note) => (note.folder_id && remove.has(note.folder_id) ? { ...note, folder_id: null, updated_at: now } : note)),
    removed: [...remove],
  };
}
