import type { Note, QueueItem, QueueMode, QueueStatus } from './types';

export type PromptPrefill = Partial<PromptInput>;

export interface PromptInput {
  bot_name: string;
  goal: string;
  details?: string;
  mode: QueueMode;
  approveNow?: boolean;
  keyword?: string | null;
  sub_class?: string | null;
  source_note_id?: string | null;
}

export function createPromptItem(input: PromptInput, now: string, id: string): QueueItem {
  const bot = input.bot_name.trim();
  const goal = input.goal.trim();
  if (!bot) throw new Error('Bot is required');
  if (!goal) throw new Error('Goal is required');
  const approve = !!input.approveNow;
  return {
    id,
    user_id: null,
    source_note_id: input.source_note_id ?? null,
    source_type: 'prompt_form',
    bot_name: bot,
    goal,
    details: input.details ?? '',
    mode: input.mode,
    keyword: input.keyword ?? null,
    sub_class: input.sub_class ?? null,
    status: approve ? 'approved' : 'staged',
    ari_response: null,
    approved_at: approve ? now : null,
    dispatched_at: null,
    created_at: now,
    updated_at: now,
  };
}

export function approveItem(item: QueueItem, now: string): QueueItem {
  if (item.status === 'dropped' || item.status === 'dispatched' || item.status === 'saved') return item;
  return { ...item, status: 'approved', approved_at: item.approved_at ?? now, updated_at: now };
}

export function approveAllStaged(items: QueueItem[], now: string): QueueItem[] {
  return items.map((item) => (item.status === 'staged' ? approveItem(item, now) : item));
}

export function dropItem(item: QueueItem, now: string): QueueItem {
  if (item.status === 'dropped') return item;
  return { ...item, status: 'dropped', updated_at: now };
}

export function archiveRaw(note: Note, now: string): Note {
  return { ...note, triage_status: 'archived', updated_at: now };
}

export function isRawInbox(note: Note): boolean {
  return note.sync_mode === 'ari_inbox' && (note.triage_status === 'raw' || note.triage_status === 'organized');
}

export function crossReference(item: QueueItem, notes: Note[]): Note | null {
  if (!item.source_note_id) return null;
  return notes.find((note) => note.id === item.source_note_id) ?? null;
}

export function filterQueue(items: QueueItem[], status: QueueStatus | 'history' | 'staged'): QueueItem[] {
  const list = items.filter((item) => {
    if (status === 'staged') return item.status === 'staged';
    if (status === 'history') return item.status !== 'staged';
    return item.status === status;
  });
  return [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function itemsForBot(items: QueueItem[], botName: string): QueueItem[] {
  const key = botName.trim().toLowerCase();
  return items
    .filter((item) => item.bot_name.trim().toLowerCase() === key)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
