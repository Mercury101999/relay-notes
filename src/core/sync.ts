import type { Bot, Folder, Note, QueueItem, Settings, SyncMode, Tombstone, Workspace } from './types';

export interface NoteSyncPlan {
  push: Note[];
  deleteIds: string[];
}

/** Local-only notes are never uploaded. Their ids are deleted remotely if a copy exists. */
export function planNoteSync(localNotes: Note[], remoteNotes: { id: string }[], tombstoneIds: string[] = []): NoteSyncPlan {
  const remoteIds = new Set(remoteNotes.map((note) => note.id));
  const deleteIds = new Set<string>(tombstoneIds);
  for (const note of localNotes) {
    if (note.sync_mode === 'local') deleteIds.add(note.id);
  }
  const push = localNotes.filter((note) => note.sync_mode !== 'local');
  return {
    push,
    deleteIds: [...deleteIds].filter((id) => remoteIds.has(id) || tombstoneIds.includes(id)),
  };
}

export function assertNoLocalNotes(notes: Note[]): Note[] {
  if (notes.some((note) => note.sync_mode === 'local')) {
    throw new Error('Refusing to push local-only notes');
  }
  return notes;
}

export function applySyncMode(note: Note, mode: SyncMode, now: string): Note {
  let triage = note.triage_status;
  if (mode === 'local') triage = 'none';
  else if (mode === 'ari_inbox') {
    if (triage === 'none' || triage === 'archived') triage = 'raw';
  } else triage = 'none';
  return { ...note, sync_mode: mode, triage_status: triage, updated_at: now };
}

function newer<T extends { updated_at: string }>(local: T, remote: T): T {
  return remote.updated_at > local.updated_at ? remote : local;
}

export function mergeNotes(local: Note[], remote: Note[], tombstones: Set<string>): Note[] {
  const map = new Map<string, Note>();
  for (const note of local) if (!tombstones.has(note.id)) map.set(note.id, note);
  for (const note of remote) {
    if (tombstones.has(note.id)) continue;
    const current = map.get(note.id);
    if (current?.sync_mode === 'local') continue;
    if (!current || note.updated_at > current.updated_at) map.set(note.id, note);
  }
  return [...map.values()];
}

export function mergeRows<T extends { id: string; updated_at: string }>(local: T[], remote: T[], tombstones: Set<string>): T[] {
  const map = new Map<string, T>();
  for (const row of local) if (!tombstones.has(row.id)) map.set(row.id, row);
  for (const row of remote) {
    if (tombstones.has(row.id)) continue;
    const current = map.get(row.id);
    if (!current) map.set(row.id, row);
    else map.set(row.id, newer(current, row));
  }
  return [...map.values()];
}

export function rowsToPush<T extends { id: string; updated_at: string }>(local: T[], remote: T[]): T[] {
  const remoteMap = new Map(remote.map((row) => [row.id, row]));
  return local.filter((row) => {
    const other = remoteMap.get(row.id);
    return !other || row.updated_at > other.updated_at;
  });
}

export function mergeSettings(local: Settings, remote: RemoteSettings | null): Settings {
  if (!remote) return local;
  if (remote.updated_at > local.updated_at) {
    return {
      ...local,
      theme: remote.theme,
      voice_dictionary: remote.voice_dictionary,
      voice_commands_enabled: remote.voice_commands_enabled,
      updated_at: remote.updated_at,
    };
  }
  return local;
}

export interface RemoteSettings {
  theme: Settings['theme'];
  voice_dictionary: Settings['voice_dictionary'];
  voice_commands_enabled: boolean;
  updated_at: string;
}

export interface SyncClient {
  select(table: string): Promise<unknown[]>;
  upsert(table: string, rows: unknown[]): Promise<void>;
  remove(table: string, ids: string[]): Promise<void>;
  selectSettings(): Promise<RemoteSettings | null>;
  upsertSettings(row: Record<string, unknown>): Promise<void>;
}

export interface SyncOutcome {
  workspace: Workspace;
  pushedNoteIds: string[];
  deletedNoteIds: string[];
}

function stamp<T extends { user_id: string | null }>(rows: T[], userId: string): T[] {
  return rows.map((row) => ({ ...row, user_id: userId }));
}

function tombstoneSet(list: Tombstone[], table: Tombstone['table']): Set<string> {
  return new Set(list.filter((item) => item.table === table).map((item) => item.id));
}

export async function executeSync(client: SyncClient, userId: string, local: Workspace): Promise<SyncOutcome> {
  const [remoteFolders, remoteBots, remoteNotesRaw, remoteQueue, remoteSettings] = await Promise.all([
    client.select('folders') as Promise<Folder[]>,
    client.select('bots') as Promise<Bot[]>,
    client.select('notes') as Promise<Note[]>,
    client.select('queue_items') as Promise<QueueItem[]>,
    client.selectSettings(),
  ]);
  const remoteNotes = remoteNotesRaw.filter((note) => note && typeof note.id === 'string');

  const folderTomb = tombstoneSet(local.tombstones, 'folders');
  const botTomb = tombstoneSet(local.tombstones, 'bots');
  const noteTomb = tombstoneSet(local.tombstones, 'notes');
  const queueTomb = tombstoneSet(local.tombstones, 'queue_items');

  const notes = mergeNotes(local.notes, remoteNotes, noteTomb);
  const folders = mergeRows(local.folders, remoteFolders, folderTomb);
  const bots = mergeRows(local.bots, remoteBots, botTomb);
  const queue = mergeRows(local.queue, remoteQueue, queueTomb);
  const settings = mergeSettings(local.settings, remoteSettings);

  const notePlan = planNoteSync(notes, remoteNotes, [...noteTomb]);
  const pushNotes = assertNoLocalNotes(stamp(notePlan.push.filter((note) => {
    const remote = remoteNotes.find((item) => item.id === note.id);
    return !remote || note.updated_at > remote.updated_at;
  }), userId));

  const pushFolders = stamp(rowsToPush(folders, remoteFolders), userId);
  const pushBots = stamp(rowsToPush(bots, remoteBots), userId);
  const pushQueue = stamp(rowsToPush(queue, remoteQueue), userId);

  const folderDeletes = [...folderTomb].filter((id) => remoteFolders.some((row) => row.id === id));
  const botDeletes = [...botTomb].filter((id) => remoteBots.some((row) => row.id === id));
  const queueDeletes = [...queueTomb].filter((id) => remoteQueue.some((row) => row.id === id));

  await client.remove('notes', notePlan.deleteIds);
  await client.remove('folders', folderDeletes);
  await client.remove('bots', botDeletes);
  await client.remove('queue_items', queueDeletes);
  await client.upsert('notes', pushNotes);
  await client.upsert('folders', pushFolders);
  await client.upsert('bots', pushBots);
  await client.upsert('queue_items', pushQueue);

  const settingsChanged = !remoteSettings || settings.updated_at > remoteSettings.updated_at;
  if (settingsChanged) {
    await client.upsertSettings({
      user_id: userId,
      theme: settings.theme,
      voice_dictionary: settings.voice_dictionary,
      voice_commands_enabled: settings.voice_commands_enabled,
      updated_at: settings.updated_at,
    });
  }

  const removed = new Set<string>([
    ...notePlan.deleteIds,
    ...folderDeletes,
    ...botDeletes,
    ...queueDeletes,
  ]);
  const tombstones = local.tombstones.filter((item) => !removed.has(item.id));

  return {
    workspace: {
      folders: folders.map((row) => ({ ...row, user_id: row.user_id ?? userId })),
      bots: bots.map((row) => ({ ...row, user_id: row.user_id ?? userId })),
      notes: notes.map((row) => ({ ...row, user_id: row.sync_mode === 'local' ? row.user_id : row.user_id ?? userId })),
      queue: queue.map((row) => ({ ...row, user_id: row.user_id ?? userId })),
      settings,
      tombstones,
    },
    pushedNoteIds: pushNotes.map((note) => note.id),
    deletedNoteIds: notePlan.deleteIds,
  };
}
