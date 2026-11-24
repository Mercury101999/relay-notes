import { describe, expect, it } from 'vitest';
import { makeNote, emptySettings } from '../src/core/factory';
import { applySyncMode, assertNoLocalNotes, executeSync, mergeNotes, planNoteSync, type SyncClient } from '../src/core/sync';
import type { Note, Workspace } from '../src/core/types';

function note(partial: Partial<Note> & { title: string; sync_mode: Note['sync_mode'] }): Note {
  return makeNote({ body: partial.body ?? partial.title, triage_status: partial.sync_mode === 'ari_inbox' ? 'raw' : 'none', ...partial });
}

describe('sync privacy guard', () => {
  it('never places local-only notes in the push set and deletes a remote copy when switched back', () => {
    const local = note({ id: 'local-1', title: 'Private scratch', sync_mode: 'local' });
    const inbox = note({ id: 'inbox-1', title: 'Raw dump', sync_mode: 'ari_inbox' });
    const reference = note({ id: 'ref-1', title: 'Port list', sync_mode: 'ari_reference' });
    const switched = applySyncMode({ ...inbox, id: 'switched' }, 'local', '2026-11-24T00:00:00.000Z');
    expect(switched.sync_mode).toBe('local');
    expect(switched.triage_status).toBe('none');
    const plan = planNoteSync([local, inbox, reference, switched], [{ id: 'local-1' }, { id: 'inbox-1' }, { id: 'switched' }]);
    expect(plan.push.map((item) => item.id).sort()).toEqual(['inbox-1', 'ref-1']);
    expect(plan.push.every((item) => item.sync_mode !== 'local')).toBe(true);
    expect(plan.deleteIds).toEqual(expect.arrayContaining(['local-1', 'switched']));
    expect(plan.deleteIds).not.toContain('inbox-1');
    expect(() => assertNoLocalNotes([...plan.push, local])).toThrow(/local-only/);
  });

  it('keeps a local note intact when a remote row with the same id is newer', () => {
    const local = note({ id: 'n', title: 'On device', sync_mode: 'local', body: 'secret practice', updated_at: '2026-11-01T00:00:00.000Z' });
    const remote = note({ id: 'n', title: 'Remote overwrite', sync_mode: 'ari_inbox', body: 'should not win', updated_at: '2026-11-20T00:00:00.000Z' });
    const merged = mergeNotes([local], [remote], new Set());
    expect(merged).toHaveLength(1);
    expect(merged[0].body).toBe('secret practice');
    expect(merged[0].sync_mode).toBe('local');
  });

  it('does not upsert local notes through the sync client', async () => {
    const calls: { op: string; table: string; rows?: unknown; ids?: string[] }[] = [];
    const local = note({ id: 'local-1', title: 'Stay', sync_mode: 'local', updated_at: '2026-11-24T00:00:00.000Z' });
    const remoteCopy = note({ id: 'local-1', title: 'Stay', sync_mode: 'ari_inbox', updated_at: '2026-11-20T00:00:00.000Z' });
    const inbox = note({ id: 'inbox-1', title: 'Send', sync_mode: 'ari_inbox', updated_at: '2026-11-24T00:00:00.000Z', ari_summary: null });
    const client: SyncClient = {
      async select(table) {
        calls.push({ op: 'select', table });
        if (table === 'notes') return [remoteCopy];
        return [];
      },
      async upsert(table, rows) {
        calls.push({ op: 'upsert', table, rows });
        if (table === 'notes' && (rows as Note[]).some((row) => row.sync_mode === 'local')) {
          throw new Error('local note reached upsert');
        }
      },
      async remove(table, ids) { calls.push({ op: 'remove', table, ids }); },
      async selectSettings() { return null; },
      async upsertSettings(row) { calls.push({ op: 'upsert', table: 'user_settings', rows: [row] }); },
    };
    const workspace: Workspace = {
      folders: [],
      bots: [],
      notes: [local, inbox],
      queue: [],
      settings: { ...emptySettings('2026-11-24T00:00:00.000Z'), theme: 'dark' },
      tombstones: [],
    };
    const outcome = await executeSync(client, 'user-1', workspace);
    const noteUpsert = calls.find((call) => call.op === 'upsert' && call.table === 'notes');
    const pushed = (noteUpsert?.rows ?? []) as Note[];
    expect(pushed.map((row) => row.id)).toEqual(['inbox-1']);
    expect(pushed.every((row) => row.sync_mode !== 'local')).toBe(true);
    expect(outcome.deletedNoteIds).toContain('local-1');
    expect(outcome.workspace.notes.find((row) => row.id === 'local-1')?.body).toBe(local.body);
    expect(calls.find((call) => call.op === 'remove' && call.table === 'notes')?.ids).toContain('local-1');
  });

  it('pulls Ari organization onto a synced note when the remote row is newer', () => {
    const local = note({ id: 'inbox-1', title: 'Raw', sync_mode: 'ari_inbox', triage_status: 'raw', updated_at: '2026-11-01T00:00:00.000Z' });
    const remote = note({
      id: 'inbox-1',
      title: 'Raw',
      sync_mode: 'ari_inbox',
      triage_status: 'organized',
      ari_summary: 'Three fictional threads.',
      updated_at: '2026-11-20T00:00:00.000Z',
    });
    const [merged] = mergeNotes([local], [remote], new Set());
    expect(merged.triage_status).toBe('organized');
    expect(merged.ari_summary).toBe('Three fictional threads.');
  });
});
