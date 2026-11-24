import { parseNoteBody } from './parser';
import { sanitizeAliases, sanitizeRules } from './routing';
import { defaultTemplates, sanitizeTemplates } from './templates';
import type { Bot, BotStatus, Folder, Note, QueueItem, QueueMode, QueueSource, QueueStatus, Settings, SyncMode, Todo, Workspace } from './types';
import { DEFAULT_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from './defaults';
import { nowIso, uid } from './time';

export function emptySettings(now = nowIso()): Settings {
  return {
    theme: 'dark',
    voice_dictionary: [],
    voice_commands_enabled: true,
    routing_rules: [],
    keyword_aliases: [],
    templates: defaultTemplates(now),
    format_on_save: false,
    supabase_url: DEFAULT_SUPABASE_URL,
    supabase_publishable_key: DEFAULT_PUBLISHABLE_KEY,
    updated_at: now,
  };
}

export function upgradeSettings(raw: Partial<Settings> | undefined, now?: string): Settings {
  const base = emptySettings(now ?? raw?.updated_at ?? '1970-01-01T00:00:00.000Z');
  const merged: Settings = { ...base, ...raw, templates: raw?.templates ? sanitizeTemplates(raw.templates) : base.templates };
  if (merged.theme !== 'light' && merged.theme !== 'dark') merged.theme = 'dark';
  merged.routing_rules = sanitizeRules(merged.routing_rules);
  merged.keyword_aliases = sanitizeAliases(merged.keyword_aliases);
  if (!Array.isArray(raw?.templates)) merged.templates = base.templates;
  if (typeof merged.format_on_save !== 'boolean') merged.format_on_save = false;
  if (typeof merged.voice_commands_enabled !== 'boolean') merged.voice_commands_enabled = true;
  if (!Array.isArray(merged.voice_dictionary)) merged.voice_dictionary = [];
  return merged;
}

export function emptyWorkspace(): Workspace {
  return { folders: [], bots: [], notes: [], queue: [], settings: emptySettings('1970-01-01T00:00:00.000Z'), tombstones: [] };
}

export function makeFolder(partial: Partial<Folder> & { name: string }, now = nowIso()): Folder {
  return {
    id: partial.id ?? uid(),
    user_id: partial.user_id ?? null,
    parent_id: partial.parent_id ?? null,
    code: partial.code ?? null,
    name: partial.name,
    description: partial.description ?? '',
    color: partial.color ?? '#2dd4bf',
    sort_order: partial.sort_order ?? 0,
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
  };
}

export function makeBot(partial: Partial<Bot> & { name: string }, now = nowIso()): Bot {
  return {
    id: partial.id ?? uid(),
    user_id: partial.user_id ?? null,
    name: partial.name,
    role: partial.role ?? '',
    avatar: partial.avatar ?? '🤖',
    accent_color: partial.accent_color ?? '#0f766e',
    status: partial.status ?? 'idea',
    tags: partial.tags ?? [],
    notes: partial.notes ?? '',
    link_url: partial.link_url ?? null,
    todos: partial.todos ?? [],
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
  };
}

export function makeTodo(text: string, done = false, now = nowIso()): Todo {
  return { id: uid(), text, done, created_at: now };
}

export function makeNote(partial: Partial<Note> & { title: string; body?: string }, now = nowIso()): Note {
  const body = partial.body ?? '';
  const parsed = parseNoteBody(body);
  const useGiven = !!(partial.parsed_sections && partial.keywords);
  return {
    id: partial.id ?? uid(),
    user_id: partial.user_id ?? null,
    folder_id: partial.folder_id ?? null,
    title: partial.title,
    body,
    parsed_sections: useGiven ? partial.parsed_sections! : parsed.sections,
    keywords: useGiven ? partial.keywords! : parsed.keywords,
    tags: partial.tags ?? parsed.tags,
    mentions: partial.mentions ?? parsed.mentions,
    sync_mode: partial.sync_mode ?? 'local',
    triage_status: partial.triage_status ?? 'none',
    ari_summary: partial.ari_summary ?? null,
    pinned: partial.pinned ?? false,
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
  };
}

export function withBody(note: Note, body: string, now = nowIso()): Note {
  const parsed = parseNoteBody(body);
  return {
    ...note,
    body,
    parsed_sections: parsed.sections,
    keywords: parsed.keywords,
    tags: parsed.tags,
    mentions: parsed.mentions,
    updated_at: now,
  };
}

export function makeQueue(partial: Partial<QueueItem> & { bot_name: string; goal: string; source_type: QueueSource; mode: QueueMode; status: QueueStatus }, now = nowIso()): QueueItem {
  return {
    id: partial.id ?? uid(),
    user_id: partial.user_id ?? null,
    source_note_id: partial.source_note_id ?? null,
    source_type: partial.source_type,
    bot_name: partial.bot_name,
    goal: partial.goal,
    details: partial.details ?? '',
    mode: partial.mode,
    keyword: partial.keyword ?? null,
    sub_class: partial.sub_class ?? null,
    status: partial.status,
    ari_response: partial.ari_response ?? null,
    approved_at: partial.approved_at ?? null,
    dispatched_at: partial.dispatched_at ?? null,
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
  };
}

export function reparseAll(notes: Note[]): Note[] {
  return notes.map((note) => withBody(note, note.body, note.updated_at));
}

export function botStatusLabel(status: BotStatus): string {
  return status[0].toUpperCase() + status.slice(1);
}

export const SYNC_LABEL: Record<SyncMode, string> = {
  local: 'Local only',
  ari_inbox: 'Ari Inbox (Raw)',
  ari_reference: 'Ari Reference',
};
