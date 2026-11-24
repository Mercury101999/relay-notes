import { parseNoteBody } from './parser';
import { sanitizeAliases, sanitizeRules } from './routing';
import { sanitizeTemplates } from './templates';
import type { Bot, Folder, Note, QueueItem, Settings, SyncMode, Tombstone, Workspace } from './types';
import { DEFAULT_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from './defaults';

const SYNC: SyncMode[] = ['local', 'ari_inbox', 'ari_reference'];
const BOT_STATUS = ['active', 'paused', 'idea', 'retired'];
const TRIAGE = ['none', 'raw', 'organized', 'archived'];
const SOURCE = ['prompt_form', 'ari_organized'];
const MODE = ['save', 'research', 'build', 'ask_first'];
const STATUS = ['staged', 'approved', 'dispatched', 'saved', 'dropped'];

export interface ExportFile {
  version: 1;
  exported_at: string;
  folders: Folder[];
  bots: Bot[];
  notes: Note[];
  queue_items: QueueItem[];
  settings: Pick<Settings, 'theme' | 'voice_dictionary' | 'voice_commands_enabled' | 'routing_rules' | 'keyword_aliases' | 'templates' | 'format_on_save' | 'updated_at'>;
  tombstones: Tombstone[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function rejectSecrets(value: unknown) {
  const blob = JSON.stringify(value);
  if (/"service_role"/i.test(blob) || /sb_secret_/i.test(blob) || /service_role/i.test(blob)) {
    throw new Error('Import refused: a service role key does not belong in a workspace file');
  }
}

function needString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${key}`);
  return value;
}

function asNote(row: unknown): Note {
  if (!isRecord(row)) throw new Error('Invalid note');
  const sync = needString(row, 'sync_mode') as Note['sync_mode'];
  const triage = (typeof row.triage_status === 'string' ? row.triage_status : 'none') as Note['triage_status'];
  if (!SYNC.includes(sync) || !TRIAGE.includes(triage)) throw new Error('Invalid note status');
  const body = typeof row.body === 'string' ? row.body : '';
  const parsed = parseNoteBody(body);
  return {
    id: needString(row, 'id'),
    user_id: typeof row.user_id === 'string' ? row.user_id : null,
    folder_id: typeof row.folder_id === 'string' ? row.folder_id : null,
    title: typeof row.title === 'string' ? row.title : 'Untitled note',
    body,
    parsed_sections: parsed.sections,
    keywords: parsed.keywords,
    tags: parsed.tags,
    mentions: parsed.mentions,
    sync_mode: sync,
    triage_status: triage,
    ari_summary: typeof row.ari_summary === 'string' ? row.ari_summary : null,
    pinned: !!row.pinned,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

function asFolder(row: unknown): Folder {
  if (!isRecord(row)) throw new Error('Invalid folder');
  return {
    id: needString(row, 'id'),
    user_id: typeof row.user_id === 'string' ? row.user_id : null,
    parent_id: typeof row.parent_id === 'string' ? row.parent_id : null,
    code: typeof row.code === 'string' ? row.code : null,
    name: needString(row, 'name'),
    description: typeof row.description === 'string' ? row.description : '',
    color: typeof row.color === 'string' ? row.color : '#2dd4bf',
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

function asBot(row: unknown): Bot {
  if (!isRecord(row)) throw new Error('Invalid bot');
  const status = (typeof row.status === 'string' ? row.status : 'idea') as Bot['status'];
  if (!BOT_STATUS.includes(status)) throw new Error('Invalid bot status');
  const todos = Array.isArray(row.todos) ? row.todos.filter(isRecord).map((todo) => ({
    id: typeof todo.id === 'string' ? todo.id : crypto.randomUUID(),
    text: typeof todo.text === 'string' ? todo.text : '',
    done: !!todo.done,
    created_at: typeof todo.created_at === 'string' ? todo.created_at : new Date().toISOString(),
  })) : [];
  return {
    id: needString(row, 'id'),
    user_id: typeof row.user_id === 'string' ? row.user_id : null,
    name: needString(row, 'name'),
    role: typeof row.role === 'string' ? row.role : '',
    avatar: typeof row.avatar === 'string' ? row.avatar : '🤖',
    accent_color: typeof row.accent_color === 'string' ? row.accent_color : '#0f766e',
    status,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    notes: typeof row.notes === 'string' ? row.notes : '',
    link_url: typeof row.link_url === 'string' ? row.link_url : null,
    todos,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

function asQueue(row: unknown): QueueItem {
  if (!isRecord(row)) throw new Error('Invalid queue item');
  const source = needString(row, 'source_type') as QueueItem['source_type'];
  const mode = needString(row, 'mode') as QueueItem['mode'];
  const status = needString(row, 'status') as QueueItem['status'];
  if (!SOURCE.includes(source) || !MODE.includes(mode) || !STATUS.includes(status)) throw new Error('Invalid queue item');
  return {
    id: needString(row, 'id'),
    user_id: typeof row.user_id === 'string' ? row.user_id : null,
    source_note_id: typeof row.source_note_id === 'string' ? row.source_note_id : null,
    source_type: source,
    bot_name: needString(row, 'bot_name'),
    goal: needString(row, 'goal'),
    details: typeof row.details === 'string' ? row.details : '',
    mode,
    keyword: typeof row.keyword === 'string' ? row.keyword : null,
    sub_class: typeof row.sub_class === 'string' ? row.sub_class : null,
    status,
    ari_response: typeof row.ari_response === 'string' ? row.ari_response : null,
    approved_at: typeof row.approved_at === 'string' ? row.approved_at : null,
    dispatched_at: typeof row.dispatched_at === 'string' ? row.dispatched_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

export function exportWorkspace(ws: Workspace, exportedAt: string): string {
  const file: ExportFile = {
    version: 1,
    exported_at: exportedAt,
    folders: ws.folders,
    bots: ws.bots,
    notes: ws.notes,
    queue_items: ws.queue,
    settings: {
      theme: ws.settings.theme,
      voice_dictionary: ws.settings.voice_dictionary,
      voice_commands_enabled: ws.settings.voice_commands_enabled,
      routing_rules: ws.settings.routing_rules,
      keyword_aliases: ws.settings.keyword_aliases,
      templates: ws.settings.templates,
      format_on_save: ws.settings.format_on_save,
      updated_at: ws.settings.updated_at,
    },
    tombstones: ws.tombstones,
  };
  return JSON.stringify(file, null, 2);
}

export function importWorkspace(text: string, previous: Workspace): Workspace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON');
  }
  rejectSecrets(parsed);
  if (!isRecord(parsed) || parsed.version !== 1) throw new Error('Unrecognized workspace file');
  if (!Array.isArray(parsed.folders) || !Array.isArray(parsed.bots) || !Array.isArray(parsed.notes) || !Array.isArray(parsed.queue_items)) {
    throw new Error('Workspace file is missing collections');
  }
  const settings = isRecord(parsed.settings) ? parsed.settings : {};
  const theme = settings.theme === 'light' ? 'light' : 'dark';
  const dictionary = Array.isArray(settings.voice_dictionary)
    ? settings.voice_dictionary.filter(isRecord).map((rule) => ({
      from: typeof rule.from === 'string' ? rule.from : '',
      to: typeof rule.to === 'string' ? rule.to : '',
    }))
    : [];
  return {
    folders: parsed.folders.map(asFolder),
    bots: parsed.bots.map(asBot),
    notes: parsed.notes.map(asNote),
    queue: parsed.queue_items.map(asQueue),
    tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones.filter(isRecord).map((item) => ({
      table: item.table as Tombstone['table'],
      id: String(item.id),
      deleted_at: typeof item.deleted_at === 'string' ? item.deleted_at : new Date().toISOString(),
    })).filter((item) => ['folders', 'bots', 'notes', 'queue_items'].includes(item.table) && item.id) : [],
    settings: {
      ...previous.settings,
      theme,
      voice_dictionary: dictionary,
      voice_commands_enabled: settings.voice_commands_enabled !== false,
      routing_rules: sanitizeRules(settings.routing_rules),
      keyword_aliases: sanitizeAliases(settings.keyword_aliases),
      templates: Array.isArray(settings.templates) ? sanitizeTemplates(settings.templates) : previous.settings.templates,
      format_on_save: settings.format_on_save === true,
      updated_at: typeof settings.updated_at === 'string' ? settings.updated_at : new Date().toISOString(),
      supabase_url: previous.settings.supabase_url || DEFAULT_SUPABASE_URL,
      supabase_publishable_key: previous.settings.supabase_publishable_key || DEFAULT_PUBLISHABLE_KEY,
    },
  };
}
