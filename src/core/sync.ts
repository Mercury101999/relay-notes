import type { Bot, Folder, KeywordAlias, Note, QueueItem, RoutingRule, Settings, SnippetTemplate, SyncMode, Tombstone, Workspace } from './types';

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
      routing_rules: remote.routing_rules,
      keyword_aliases: remote.keyword_aliases,
      templates: remote.templates,
      format_on_save: remote.format_on_save,
      updated_at: remote.updated_at,
    };
  }
  return local;
}

export interface RemoteSettings {
  theme: Settings['theme'];
  voice_dictionary: Settings['voice_dictionary'];
  voice_commands_enabled: boolean;
  routing_rules: RoutingRule[];
  keyword_aliases: KeywordAlias[];
  templates: SnippetTemplate[];
  format_on_save: boolean;
  updated_at: string;
}

export interface SyncClient {
  select(table: string): Promise<unknown[]>;
  upsert(table: string, rows: unknown[]): Promise<void>;
  remove(table: string, ids: string[]): Promise<void>;
  selectSettings(): Promise<RemoteSettings | null>;
  upsertSettings(row: Record<string, unknown>): Promise<void>;
}

export type SyncTable = 'folders' | 'bots' | 'notes' | 'queue_items' | 'user_settings';

export interface SyncTableError {
  table: SyncTable;
  message: string;
}

export interface SyncOutcome {
  workspace: Workspace;
  pushedNoteIds: string[];
  deletedNoteIds: string[];
  /** Tables that failed this run. Other tables still synced. */
  errors: SyncTableError[];
}

function stamp<T extends { user_id: string | null }>(rows: T[], userId: string): T[] {
  return rows.map((row) => ({ ...row, user_id: userId }));
}

function tombstoneSet(list: Tombstone[], table: Tombstone['table']): Set<string> {
  return new Set(list.filter((item) => item.table === table).map((item) => item.id));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Orders folders so a parent is always written before its children. Cycles keep input order. */
export function sortFoldersTopologically<T extends { id: string; parent_id: string | null }>(rows: T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out: T[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (row: T) => {
    if (done.has(row.id) || visiting.has(row.id)) return;
    visiting.add(row.id);
    const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
    if (parent) visit(parent);
    visiting.delete(row.id);
    done.add(row.id);
    out.push(row);
  };
  rows.forEach(visit);
  return out;
}

/**
 * Copies of folder rows for upload. A parent that is neither on the server nor in this upload is
 * sent as null so the foreign key holds. Local rows are not changed.
 */
export function folderPayload(push: Folder[], serverFolderIds: Set<string>): Folder[] {
  const ids = new Set<string>([...serverFolderIds, ...push.map((row) => row.id)]);
  return sortFoldersTopologically(push).map((row) => (
    row.parent_id && !ids.has(row.parent_id) ? { ...row, parent_id: null } : { ...row }
  ));
}

/** Copies of note rows for upload with folder_id cleared when the folder is not on the server. */
export function notePayload(push: Note[], serverFolderIds: Set<string>): Note[] {
  return push.map((row) => (
    row.folder_id && !serverFolderIds.has(row.folder_id) ? { ...row, folder_id: null } : { ...row }
  ));
}

/** Copies of queue rows with source_note_id cleared when that note is local-only or not on the server. */
export function queuePayload(push: QueueItem[], serverNoteIds: Set<string>, localOnlyIds: Set<string>): QueueItem[] {
  return push.map((row) => (
    row.source_note_id && (localOnlyIds.has(row.source_note_id) || !serverNoteIds.has(row.source_note_id))
      ? { ...row, source_note_id: null }
      : { ...row }
  ));
}

async function load<T>(table: SyncTable, run: () => Promise<T>, errors: SyncTableError[]): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    errors.push({ table, message: message(error) });
    return null;
  }
}

/**
 * Pulls every table, merges, then writes in foreign-key order. Deletes run children first
 * (queue_items, notes, bots, folders). Upserts run parents first (folders, notes, bots,
 * queue_items, user_settings). Each table has its own error, and one failure does not stop the
 * rest. Tombstones clear only for tables whose delete succeeded.
 */
export async function executeSync(client: SyncClient, userId: string, local: Workspace): Promise<SyncOutcome> {
  const errors: SyncTableError[] = [];
  const failed = (table: SyncTable) => errors.some((item) => item.table === table);
  const fail = (table: SyncTable, error: unknown) => { if (!failed(table)) errors.push({ table, message: message(error) }); };

  const [remoteFoldersRaw, remoteBotsRaw, remoteNotesRaw, remoteQueueRaw, remoteSettings] = await Promise.all([
    load('folders', () => client.select('folders') as Promise<Folder[]>, errors),
    load('bots', () => client.select('bots') as Promise<Bot[]>, errors),
    load('notes', () => client.select('notes') as Promise<Note[]>, errors),
    load('queue_items', () => client.select('queue_items') as Promise<QueueItem[]>, errors),
    load('user_settings', () => client.selectSettings(), errors),
  ]);
  const foldersLoaded = remoteFoldersRaw !== null;
  const botsLoaded = remoteBotsRaw !== null;
  const notesLoaded = remoteNotesRaw !== null;
  const queueLoaded = remoteQueueRaw !== null;
  const settingsLoaded = !failed('user_settings');
  const remoteFolders = remoteFoldersRaw ?? [];
  const remoteBots = remoteBotsRaw ?? [];
  const remoteQueue = remoteQueueRaw ?? [];
  const remoteNotes = (remoteNotesRaw ?? []).filter((note) => note && typeof note.id === 'string');

  const folderTomb = tombstoneSet(local.tombstones, 'folders');
  const botTomb = tombstoneSet(local.tombstones, 'bots');
  const noteTomb = tombstoneSet(local.tombstones, 'notes');
  const queueTomb = tombstoneSet(local.tombstones, 'queue_items');

  const remoteFolderIds = new Set(remoteFolders.map((row) => row.id));
  const mergedNotes = mergeNotes(local.notes, remoteNotes, noteTomb);
  // A null folder_id on the server can come from an earlier upload that cleared a folder the
  // server did not have yet. Keep the local folder in that case.
  const localById = new Map(local.notes.map((row) => [row.id, row]));
  const notes = mergedNotes.map((row) => {
    const mine = localById.get(row.id);
    if (mine && mine !== row && row.folder_id === null && mine.folder_id && foldersLoaded && !remoteFolderIds.has(mine.folder_id)) {
      return { ...row, folder_id: mine.folder_id };
    }
    return row;
  });
  const folders = mergeRows(local.folders, remoteFolders, folderTomb);
  const bots = mergeRows(local.bots, remoteBots, botTomb);
  const remoteNoteIdSet = new Set(remoteNotes.map((row) => row.id));
  const localOnlyNoteIds = new Set(notes.filter((row) => row.sync_mode === 'local').map((row) => row.id));
  const localQueueById = new Map(local.queue.map((row) => [row.id, row]));
  // Same rule for queue links to a note the server does not hold: keep the on-device link.
  const queue = mergeRows(local.queue, remoteQueue, queueTomb).map((row) => {
    const mine = localQueueById.get(row.id);
    if (mine && mine !== row && row.source_note_id === null && mine.source_note_id && notesLoaded
      && (localOnlyNoteIds.has(mine.source_note_id) || !remoteNoteIdSet.has(mine.source_note_id))) {
      return { ...row, source_note_id: mine.source_note_id };
    }
    return row;
  });
  const settings = mergeSettings(local.settings, remoteSettings);

  const notePlan = planNoteSync(notes, remoteNotes, [...noteTomb]);
  const pushNotes = assertNoLocalNotes(stamp(notePlan.push.filter((note) => {
    const remote = remoteNotes.find((item) => item.id === note.id);
    return !remote || note.updated_at > remote.updated_at;
  }), userId));
  const pushFolders = stamp(rowsToPush(folders, remoteFolders), userId);
  const pushBots = stamp(rowsToPush(bots, remoteBots), userId);
  const pushQueue = stamp(rowsToPush(queue, remoteQueue), userId);

  const queueDeletes = [...queueTomb].filter((id) => remoteQueue.some((row) => row.id === id));
  const folderDeletes = [...folderTomb].filter((id) => remoteFolders.some((row) => row.id === id));
  const botDeletes = [...botTomb].filter((id) => remoteBots.some((row) => row.id === id));

  const removed = new Set<string>();
  const clearedTables = new Set<Tombstone['table']>();
  const remove = async (table: Exclude<SyncTable, 'user_settings'>, ids: string[], loaded: boolean) => {
    if (!loaded) return false;
    try {
      await client.remove(table, ids);
      ids.forEach((id) => removed.add(id));
      clearedTables.add(table);
      return true;
    } catch (error) {
      fail(table, error);
      return false;
    }
  };

  // Deletes: children before parents.
  await remove('queue_items', queueDeletes, queueLoaded);
  const notesDeleted = await remove('notes', notePlan.deleteIds, notesLoaded);
  await remove('bots', botDeletes, botsLoaded);
  const foldersDeleted = await remove('folders', folderDeletes, foldersLoaded);

  // Folder ids the server has now. A failed folder delete leaves those rows in place.
  const serverFolderIds = new Set([...remoteFolderIds].filter((id) => !foldersDeleted || !folderDeletes.includes(id)));

  // Upserts: parents before children.
  if (foldersLoaded) {
    try {
      const payload = folderPayload(pushFolders.filter((row) => !folderTomb.has(row.id)), serverFolderIds);
      await client.upsert('folders', payload);
      payload.forEach((row) => serverFolderIds.add(row.id));
    } catch (error) {
      fail('folders', error);
    }
  }

  const localOnlyIds = localOnlyNoteIds;
  const serverNoteIds = new Set(remoteNotes.map((row) => row.id).filter((id) => !(notesDeleted && notePlan.deleteIds.includes(id))));
  let pushedNoteIds: string[] = [];
  if (notesLoaded) {
    try {
      const payload = assertNoLocalNotes(notePayload(pushNotes, serverFolderIds));
      await client.upsert('notes', payload);
      pushedNoteIds = payload.map((row) => row.id);
      pushedNoteIds.forEach((id) => serverNoteIds.add(id));
    } catch (error) {
      fail('notes', error);
    }
  }

  if (botsLoaded) {
    try {
      await client.upsert('bots', pushBots);
    } catch (error) {
      fail('bots', error);
    }
  }

  // Queue links need the server's note list. Without it, wait for the next run.
  if (queueLoaded && notesLoaded) {
    try {
      await client.upsert('queue_items', queuePayload(pushQueue, serverNoteIds, localOnlyIds));
    } catch (error) {
      fail('queue_items', error);
    }
  }

  const settingsChanged = !remoteSettings || settings.updated_at > remoteSettings.updated_at;
  if (settingsLoaded && settingsChanged) {
    try {
      await client.upsertSettings({
        user_id: userId,
        theme: settings.theme,
        voice_dictionary: settings.voice_dictionary,
        voice_commands_enabled: settings.voice_commands_enabled,
        routing_rules: settings.routing_rules,
        keyword_aliases: settings.keyword_aliases,
        templates: settings.templates,
        format_on_save: settings.format_on_save,
        updated_at: settings.updated_at,
      });
    } catch (error) {
      fail('user_settings', error);
    }
  }

  // Tombstones clear per table, only for ids that table's successful delete covered.
  const tombstones = local.tombstones.filter((item) => !(clearedTables.has(item.table) && removed.has(item.id)));

  return {
    workspace: {
      folders: folders.map((row) => ({ ...row, user_id: row.user_id ?? userId })),
      bots: bots.map((row) => ({ ...row, user_id: row.user_id ?? userId })),
      notes: notes.map((row) => ({ ...row, user_id: row.sync_mode === 'local' ? row.user_id : row.user_id ?? userId })),
      queue: queue.map((row) => ({ ...row, user_id: row.user_id ?? userId })),
      settings,
      tombstones,
    },
    pushedNoteIds,
    deletedNoteIds: notesDeleted ? notePlan.deleteIds : [],
    errors,
  };
}

/** Short text for the sync pill and Settings, naming each failed table. */
export function describeSyncErrors(errors: SyncTableError[]): string {
  return errors.map((item) => `${item.table}: ${item.message}`).join('; ');
}
