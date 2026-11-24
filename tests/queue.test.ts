import { describe, expect, it } from 'vitest';
import { makeNote, makeQueue } from '../src/core/factory';
import { approveAllStaged, approveItem, archiveRaw, createPromptItem, crossReference, dropItem, filterQueue, isRawInbox } from '../src/core/queue';

const NOW = '2026-11-24T12:00:00.000Z';

describe('fast prompt and Ari review queue', () => {
  it('creates a staged prompt and can approve it immediately', () => {
    const staged = createPromptItem({ bot_name: ' Code Partner ', goal: ' Review the practice diff ', details: 'Fictional', mode: 'build' }, NOW, 'q1');
    expect(staged.source_type).toBe('prompt_form');
    expect(staged.status).toBe('staged');
    expect(staged.bot_name).toBe('Code Partner');
    expect(staged.approved_at).toBeNull();
    const approved = createPromptItem({ bot_name: 'Study Coach', goal: 'Quiz', mode: 'ask_first', approveNow: true }, NOW, 'q2');
    expect(approved.status).toBe('approved');
    expect(approved.approved_at).toBe(NOW);
    expect(() => createPromptItem({ bot_name: ' ', goal: 'x', mode: 'save' }, NOW, 'q3')).toThrow(/Bot/);
  });

  it('walks raw, staged, cross-reference, approve, archive, and drop', () => {
    const raw = makeNote({ id: 'note-1', title: 'Weekly desk dump', body: 'Inbox : Sample {\n  triage: (Three fictional messages.)\n}\n', sync_mode: 'ari_inbox', triage_status: 'raw' });
    expect(isRawInbox(raw)).toBe(true);
    const organized = makeQueue({
      id: 'item-1',
      source_type: 'ari_organized',
      source_note_id: raw.id,
      bot_name: 'Inbox Triage',
      goal: 'Sort the fictional sample inbox',
      mode: 'ask_first',
      status: 'staged',
    });
    const form = makeQueue({ id: 'item-2', source_type: 'prompt_form', bot_name: 'Code Partner', goal: 'Compare snippets', mode: 'build', status: 'staged' });
    expect(crossReference(organized, [raw])?.title).toBe('Weekly desk dump');
    expect(crossReference(form, [raw])).toBeNull();
    const approved = approveAllStaged([organized, form], NOW);
    expect(approved.every((item) => item.status === 'approved' && item.approved_at === NOW)).toBe(true);
    const dropped = dropItem(form, NOW);
    expect(dropped.status).toBe('dropped');
    expect(approveItem(dropped, NOW).status).toBe('dropped');
    const archived = archiveRaw(raw, NOW);
    expect(archived.triage_status).toBe('archived');
    expect(isRawInbox(archived)).toBe(false);
    const history = filterQueue([approved[0], dropped, makeQueue({ id: 'd', source_type: 'prompt_form', bot_name: 'Release Notes', goal: 'Filed', mode: 'save', status: 'dispatched', ari_response: 'Saved a fictional summary.', dispatched_at: NOW })], 'dispatched');
    expect(history).toHaveLength(1);
    expect(history[0].ari_response).toContain('fictional');
  });
});
