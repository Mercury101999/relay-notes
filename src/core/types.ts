export type BotStatus = 'active' | 'paused' | 'idea' | 'retired';
export type SyncMode = 'local' | 'ari_inbox' | 'ari_reference';
export type TriageStatus = 'none' | 'raw' | 'organized' | 'archived';
export type QueueSource = 'prompt_form' | 'ari_organized';
export type QueueMode = 'save' | 'research' | 'build' | 'ask_first';
export type QueueStatus = 'staged' | 'approved' | 'dispatched' | 'saved' | 'dropped';
export type Theme = 'dark' | 'light';
export type TableName = 'folders' | 'bots' | 'notes' | 'queue_items';

export interface Folder {
  id: string;
  user_id: string | null;
  parent_id: string | null;
  code: string | null;
  name: string;
  description: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
}

export interface Bot {
  id: string;
  user_id: string | null;
  name: string;
  role: string;
  avatar: string;
  accent_color: string;
  status: BotStatus;
  tags: string[];
  notes: string;
  link_url: string | null;
  todos: Todo[];
  created_at: string;
  updated_at: string;
}

export type ChapterValueKind = 'paren' | 'double_paren' | 'code_fence';

export interface Chapter {
  name: string;
  /** Chapter value. `body` is the same string, kept for Phase 1 callers. */
  body: string;
  value: string;
  valueKind: ChapterValueKind;
  fenceLang?: string;
  startOffset: number;
  endOffset: number;
  lineStart: number;
  lineEnd: number;
}

export interface BlockRoute {
  folder: string;
  note: string;
  section: string;
}

export interface ParsedSection {
  id: string;
  keyword: string;
  subClass: string | null;
  route: BlockRoute | null;
  tags: string[];
  mentions: string[];
  /** Tokens that sit on the header line, not inside chapter values. */
  headerTags: string[];
  headerMentions: string[];
  chapters: Chapter[];
  lineStart: number;
  lineEnd: number;
  startOffset: number;
  endOffset: number;
  raw: string;
}

export type DiagnosticKind = 'unclosed_brace' | 'unclosed_paren' | 'unclosed_double_paren' | 'unclosed_fence';

export interface Diagnostic {
  kind: DiagnosticKind;
  line: number;
  message: string;
}

export interface Note {
  id: string;
  user_id: string | null;
  folder_id: string | null;
  title: string;
  body: string;
  parsed_sections: ParsedSection[];
  keywords: string[];
  tags: string[];
  mentions: string[];
  sync_mode: SyncMode;
  triage_status: TriageStatus;
  ari_summary: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface QueueItem {
  id: string;
  user_id: string | null;
  source_note_id: string | null;
  source_type: QueueSource;
  bot_name: string;
  goal: string;
  details: string;
  mode: QueueMode;
  keyword: string | null;
  sub_class: string | null;
  status: QueueStatus;
  ari_response: string | null;
  approved_at: string | null;
  dispatched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceRule {
  from: string;
  to: string;
}

export interface RoutingRule {
  id: string;
  keyword: string;
  sub_class: string;
  folder: string;
  note: string;
  section: string;
  created_at: string;
  updated_at: string;
}

export interface KeywordAlias {
  id: string;
  alias: string;
  canonical: string;
}

export interface SnippetTemplate {
  id: string;
  category: string;
  name: string;
  body: string;
  is_default?: boolean;
  updated_at: string;
}

export interface Settings {
  theme: Theme;
  voice_dictionary: VoiceRule[];
  voice_commands_enabled: boolean;
  routing_rules: RoutingRule[];
  keyword_aliases: KeywordAlias[];
  templates: SnippetTemplate[];
  format_on_save: boolean;
  supabase_url: string;
  supabase_publishable_key: string;
  updated_at: string;
}

export interface Tombstone {
  table: TableName;
  id: string;
  deleted_at: string;
}

export interface Workspace {
  folders: Folder[];
  bots: Bot[];
  notes: Note[];
  queue: QueueItem[];
  settings: Settings;
  tombstones: Tombstone[];
}
