import { describe, expect, it } from 'vitest';
import { emptySettings, makeFolder, makeNote, makeQueue } from '../src/core/factory';
import { describeSyncErrors, executeSync, sortFoldersTopologically, type SyncClient } from '../src/core/sync';
import type { Folder, Note, QueueItem, Workspace } from '../src/core/types';

const T = '2026-11-24T00:00:00.000Z';

interface Call { op: 'select' | 'upsert' | 'remove' | 'settings'; table: string; rows?: unknown[]; ids?: string[] }

/** In-memory server that enforces the same foreign keys as public.notes / public.queue_items / public.folders. */
function fakeServer(options: { failUpsert?: string[]; failSelect?: string[]; seed?: Partial<Record<string, object[]>> } = {}) {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    folders: new Map(), bots: new Map(), notes: new Map(), queue_items: new Map(),
  };
  for (const [table, rows] of Object.entries(options.seed ?? {})) for (const row of rows ?? []) tables[table].set((row as { id: string }).id, row as Record<string, unknown>);
  const calls: Call[] = [];
  const client: SyncClient = {
    async select(table) {
      calls.push({ op: 'select', table });
      if (options.failSelect?.includes(table)) throw new Error(`${table} select failed`);
      return [...tables[table].values()];
    },
    async upsert(table, rows) {
      if (!rows.length) return;
      calls.push({ op: 'upsert', table, rows });
      if (options.failUpsert?.includes(table)) throw new Error('insert or update violates foreign key constraint');
      for (const row of rows as Record<string, unknown>[]) {
        if (table === 'notes' && row.folder_id && !tables.folders.has(row.folder_id as string)) throw new Error('violates foreign key constraint "notes_folder_id_fkey"');
        if (table === 'queue_items' && row.source_note_id && !tables.notes.has(row.source_note_id as string)) throw new Error('violates foreign key constraint "queue_items_source_note_id_fkey"');
      }
      if (table === 'folders') {
        const ids = new Set([...tables.folders.keys(), ...(rows as Folder[]).map((row) => row.id)]);
        for (const row of rows as Folder[]) if (row.parent_id && !ids.has(row.parent_id)) throw new Error('violates foreign key constraint "folders_parent_id_fkey"');
      }
      for (const row of rows as { id: string }[]) tables[table].set(row.id, row as Record<string, unknown>);
    },
    async remove(table, ids) {
      if (!ids.length) return;
      calls.push({ op: 'remove', table, ids });
      ids.forEach((id) => tables[table].delete(id));
    },
    async selectSettings() {
      if (options.failSelect?.includes('user_settings')) throw new Error('settings select failed');
      return null;
    },
    async upsertSettings(row) { calls.push({ op: 'settings', table: 'user_settings', rows: [row] }); },
  };
  return { client, calls, tables };
}

function ws(partial: Partial<Workspace>): Workspace {
  return { folders: [], bots: [], notes: [], queue: [], settings: emptySettings(T), tombstones: [], ...partial };
}

describe('sync write order and foreign keys', () => {
  it('uploads a new folder before a synced note inside it', async () => {
    const parent = makeFolder({ id: 'f-parent', name: 'Parent' }, T);
    const child = makeFolder({ id: 'f-child', name: 'Child', parent_id: 'f-parent' }, T);
    const inside = makeNote({ id: 'n-1', title: 'Inside', sync_mode: 'ari_inbox', folder_id: 'f-child' }, T);
    const { client, calls, tables } = fakeServer();
    const outcome = await executeSync(client, 'user-1', ws({ folders: [child, parent], notes: [inside] }));
    expect(outcome.errors).toEqual([]);
    const upserts = calls.filter((call) => call.op === 'upsert').map((call) => call.table);
    expect(upserts.indexOf('folders')).toBeLessThan(upserts.indexOf('notes'));
    const folderRows = calls.find((call) => call.op === 'upsert' && call.table === 'folders')?.rows as Folder[];
    expect(folderRows.map((row) => row.id)).toEqual(['f-parent', 'f-child']);
    expect(tables.notes.get('n-1')?.folder_id).toBe('f-child');
    expect(outcome.pushedNoteIds).toEqual(['n-1']);
  });

  it('clears folder_id in the upload when the folder cannot reach the server, without touching local data', async () => {
    const folder = makeFolder({ id: 'f-1', name: 'Fails' }, T);
    const inside = makeNote({ id: 'n-1', title: 'Inside', sync_mode: 'ari_reference', folder_id: 'f-1' }, T);
    const { client, tables } = fakeServer({ failUpsert: ['folders'] });
    const outcome = await executeSync(client, 'user-1', ws({ folders: [folder], notes: [inside] }));
    expect(outcome.errors.map((item) => item.table)).toEqual(['folders']);
    expect(tables.notes.get('n-1')?.folder_id).toBeNull();
    expect(inside.folder_id).toBe('f-1');
    expect(outcome.workspace.notes.find((row) => row.id === 'n-1')?.folder_id).toBe('f-1');
  });

  it('keeps the local folder when the server copy only lost it to an earlier cleared upload', async () => {
    const folder = makeFolder({ id: 'f-1', name: 'Pending' }, T);
    const mine = makeNote({ id: 'n-1', title: 'Mine', sync_mode: 'ari_inbox', folder_id: 'f-1', updated_at: T }, T);
    const serverCopy = { ...mine, folder_id: null, updated_at: '2026-11-24T05:00:00.000Z' };
    const { client } = fakeServer({ failUpsert: ['folders'], seed: { notes: [serverCopy] } });
    const outcome = await executeSync(client, 'user-1', ws({ folders: [folder], notes: [mine] }));
    expect(outcome.workspace.notes.find((row) => row.id === 'n-1')?.folder_id).toBe('f-1');
  });

  it('clears source_note_id for a queue item made from a local-only note', async () => {
    const local = makeNote({ id: 'n-local', title: 'Private', sync_mode: 'local', body: 'LOCAL_SECRET_PHRASE' }, T);
    const item: QueueItem = makeQueue({ id: 'q-1', source_type: 'prompt_form', bot_name: 'Ari', goal: 'Plan', mode: 'save', status: 'staged', source_note_id: 'n-local' }, T);
    const { client, calls, tables } = fakeServer();
    const outcome = await executeSync(client, 'user-1', ws({ notes: [local], queue: [item] }));
    expect(outcome.errors).toEqual([]);
    expect(tables.queue_items.get('q-1')?.source_note_id).toBeNull();
    expect(outcome.workspace.queue.find((row) => row.id === 'q-1')?.source_note_id).toBe('n-local');
    expect(JSON.stringify(calls)).not.toContain('LOCAL_SECRET_PHRASE');
    expect(tables.notes.has('n-local')).toBe(false);
  });

  it('keeps source_note_id when the note is synced in the same run', async () => {
    const synced = makeNote({ id: 'n-1', title: 'Synced', sync_mode: 'ari_inbox' }, T);
    const item = makeQueue({ id: 'q-1', source_type: 'prompt_form', bot_name: 'Ari', goal: 'Plan', mode: 'save', status: 'staged', source_note_id: 'n-1' }, T);
    const { client, tables } = fakeServer();
    await executeSync(client, 'user-1', ws({ notes: [synced], queue: [item] }));
    expect(tables.queue_items.get('q-1')?.source_note_id).toBe('n-1');
  });

  it('one failing table does not block the others and is named in the error', async () => {
    const note = makeNote({ id: 'n-1', title: 'Synced', sync_mode: 'ari_inbox' }, T);
    const item = makeQueue({ id: 'q-1', source_type: 'prompt_form', bot_name: 'Ari', goal: 'Plan', mode: 'save', status: 'staged' }, T);
    const folder = makeFolder({ id: 'f-1', name: 'Folder' }, T);
    const settings = { ...emptySettings('2026-11-24T01:00:00.000Z'), format_on_save: true };
    const { client, calls, tables } = fakeServer({ failUpsert: ['notes'] });
    const outcome = await executeSync(client, 'user-1', ws({ folders: [folder], notes: [note], queue: [item], settings,
      tombstones: [{ table: 'notes', id: 'gone', deleted_at: T }] }));
    expect(outcome.errors.map((e) => e.table)).toEqual(['notes']);
    expect(describeSyncErrors(outcome.errors)).toMatch(/^notes: /);
    expect(tables.folders.has('f-1')).toBe(true);
    expect(tables.queue_items.has('q-1')).toBe(true);
    expect(calls.some((call) => call.op === 'settings')).toBe(true);
    expect(outcome.pushedNoteIds).toEqual([]);
    expect(outcome.workspace.notes.find((row) => row.id === 'n-1')).toBeTruthy();
  });

  it('keeps tombstones for a table whose delete failed and clears others', async () => {
    const { client } = fakeServer({ seed: { folders: [{ id: 'f-gone' }], notes: [{ id: 'n-gone', updated_at: T } as unknown as Note] } });
    const failing: SyncClient = { ...client, async remove(table, ids) { if (table === 'folders') throw new Error('nope'); return client.remove(table, ids); } };
    const outcome = await executeSync(failing, 'user-1', ws({ tombstones: [
      { table: 'folders', id: 'f-gone', deleted_at: T },
      { table: 'notes', id: 'n-gone', deleted_at: T },
    ] }));
    expect(outcome.errors.map((e) => e.table)).toEqual(['folders']);
    expect(outcome.workspace.tombstones.map((t) => t.id)).toEqual(['f-gone']);
  });

  it('deletes children before parents', async () => {
    const { client, calls } = fakeServer({ seed: { folders: [{ id: 'f' }], notes: [{ id: 'n', updated_at: T } as unknown as Note], queue_items: [{ id: 'q', updated_at: T } as unknown as QueueItem], bots: [{ id: 'b', updated_at: T } as unknown as { id: string }] } });
    await executeSync(client, 'user-1', ws({ tombstones: [
      { table: 'folders', id: 'f', deleted_at: T }, { table: 'notes', id: 'n', deleted_at: T },
      { table: 'queue_items', id: 'q', deleted_at: T }, { table: 'bots', id: 'b', deleted_at: T },
    ] }));
    expect(calls.filter((call) => call.op === 'remove').map((call) => call.table)).toEqual(['queue_items', 'notes', 'bots', 'folders']);
  });

  it('never uploads local notes even when other tables fail', async () => {
    const local = makeNote({ id: 'n-local', title: 'Private', sync_mode: 'local', body: 'LOCAL_SECRET_PHRASE', folder_id: 'f-1' }, T);
    const shared = makeNote({ id: 'n-1', title: 'Shared', sync_mode: 'ari_inbox' }, T);
    const folder = makeFolder({ id: 'f-1', name: 'F' }, T);
    const { client, calls, tables } = fakeServer({ failUpsert: ['folders', 'bots'], seed: { notes: [{ ...local, sync_mode: 'ari_inbox', updated_at: '2026-11-20T00:00:00.000Z' }] } });
    const outcome = await executeSync(client, 'user-1', ws({ folders: [folder], notes: [local, shared] }));
    const noteRows = calls.filter((call) => call.op === 'upsert' && call.table === 'notes').flatMap((call) => call.rows as Note[]);
    expect(noteRows.map((row) => row.id)).toEqual(['n-1']);
    expect(JSON.stringify(calls.filter((c) => c.op !== 'select'))).not.toContain('LOCAL_SECRET_PHRASE');
    expect(tables.notes.has('n-local')).toBe(false);
    expect(outcome.workspace.notes.find((row) => row.id === 'n-local')?.body).toBe('LOCAL_SECRET_PHRASE');
  });

  it('skips a table whose select failed without blocking the rest', async () => {
    const folder = makeFolder({ id: 'f-1', name: 'F' }, T);
    const note = makeNote({ id: 'n-1', title: 'Shared', sync_mode: 'ari_inbox', folder_id: 'f-1' }, T);
    const { client, tables } = fakeServer({ failSelect: ['bots'] });
    const outcome = await executeSync(client, 'user-1', ws({ folders: [folder], notes: [note] }));
    expect(outcome.errors.map((e) => e.table)).toEqual(['bots']);
    expect(tables.notes.get('n-1')?.folder_id).toBe('f-1');
  });

  it('sorts nested folders parents first', () => {
    const rows = [{ id: 'c', parent_id: 'b' }, { id: 'b', parent_id: 'a' }, { id: 'a', parent_id: null }, { id: 'x', parent_id: 'missing' }];
    expect(sortFoldersTopologically(rows).map((row) => row.id)).toEqual(['a', 'b', 'c', 'x']);
  });
});
