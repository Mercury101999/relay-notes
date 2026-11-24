-- Relay Notes public schema.
-- Row Level Security is enabled on every public table and limited to the signed-in owner
-- (auth.uid() = user_id). The anon role has no table privileges.
-- A server-side allowlist lives in the unexposed private schema. It is not part of this file
-- and contains no personal data.
--
-- Sync writes in foreign-key order: deletes run queue_items, notes, bots, folders; upserts run
-- folders (parents first), notes, bots, queue_items, user_settings. A note's folder_id or a queue
-- item's source_note_id that the server does not hold is sent as null in the upload only.
--
-- Client rule: notes with sync_mode = 'local' are never uploaded. Only ari_inbox and
-- ari_reference notes are written to public.notes. Switching a note back to local deletes
-- the remote row and keeps the on-device copy.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.folders (id) on delete cascade,
  code text,
  name text not null,
  description text not null default '',
  color text not null default '#2dd4bf',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  role text not null default '',
  avatar text not null default '🤖',
  accent_color text not null default '#0f766e',
  status text not null default 'idea' check (status in ('active', 'paused', 'idea', 'retired')),
  tags text[] not null default '{}',
  notes text not null default '',
  link_url text,
  todos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete set null,
  title text not null,
  body text not null default '',
  parsed_sections jsonb not null default '[]'::jsonb,
  keywords text[] not null default '{}',
  tags text[] not null default '{}',
  mentions text[] not null default '{}',
  sync_mode text not null default 'ari_inbox' check (sync_mode in ('local', 'ari_inbox', 'ari_reference')),
  triage_status text not null default 'raw' check (triage_status in ('none', 'raw', 'organized', 'archived')),
  ari_summary text,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.queue_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_note_id uuid references public.notes (id) on delete set null,
  source_type text not null check (source_type in ('prompt_form', 'ari_organized')),
  bot_name text not null,
  goal text not null,
  details text not null default '',
  mode text not null check (mode in ('save', 'research', 'build', 'ask_first')),
  keyword text,
  sub_class text,
  status text not null default 'staged' check (status in ('staged', 'approved', 'dispatched', 'saved', 'dropped')),
  ari_response text,
  approved_at timestamptz,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark', 'light')),
  voice_dictionary jsonb not null default '[]'::jsonb,
  voice_commands_enabled boolean not null default true,
  routing_rules jsonb not null default '[]'::jsonb,
  keyword_aliases jsonb not null default '[]'::jsonb,
  templates jsonb not null default '[]'::jsonb,
  format_on_save boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists folders_user_idx on public.folders (user_id, parent_id, sort_order);
create index if not exists bots_user_idx on public.bots (user_id, status);
create index if not exists notes_user_idx on public.notes (user_id, sync_mode, triage_status);
create index if not exists notes_folder_idx on public.notes (folder_id);
create index if not exists notes_tags_idx on public.notes using gin (tags);
create index if not exists notes_mentions_idx on public.notes using gin (mentions);

-- Additive columns for databases created before the writing tools.
alter table public.notes add column if not exists tags text[] not null default '{}';
alter table public.notes add column if not exists mentions text[] not null default '{}';
alter table public.user_settings add column if not exists routing_rules jsonb not null default '[]'::jsonb;
alter table public.user_settings add column if not exists keyword_aliases jsonb not null default '[]'::jsonb;
alter table public.user_settings add column if not exists templates jsonb not null default '[]'::jsonb;
alter table public.user_settings add column if not exists format_on_save boolean not null default false;
create index if not exists queue_user_idx on public.queue_items (user_id, status, bot_name);

drop trigger if exists folders_updated_at on public.folders;
create trigger folders_updated_at before update on public.folders
for each row execute function public.set_updated_at();
drop trigger if exists bots_updated_at on public.bots;
create trigger bots_updated_at before update on public.bots
for each row execute function public.set_updated_at();
drop trigger if exists notes_updated_at on public.notes;
create trigger notes_updated_at before update on public.notes
for each row execute function public.set_updated_at();
drop trigger if exists queue_updated_at on public.queue_items;
create trigger queue_updated_at before update on public.queue_items
for each row execute function public.set_updated_at();
drop trigger if exists settings_updated_at on public.user_settings;
create trigger settings_updated_at before update on public.user_settings
for each row execute function public.set_updated_at();

alter table public.folders enable row level security;
alter table public.bots enable row level security;
alter table public.notes enable row level security;
alter table public.queue_items enable row level security;
alter table public.user_settings enable row level security;

revoke all on public.folders, public.bots, public.notes, public.queue_items, public.user_settings from anon;
-- New tables in public do not pick up anon privileges by default either.
alter default privileges for role postgres in schema public revoke all on tables from anon;
grant select, insert, update, delete on public.folders, public.bots, public.notes, public.queue_items, public.user_settings to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['folders', 'bots', 'notes', 'queue_items']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (auth.uid() = user_id)', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (auth.uid() = user_id)', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (auth.uid() = user_id)', t);
  end loop;
end $$;

drop policy if exists user_settings_select on public.user_settings;
drop policy if exists user_settings_insert on public.user_settings;
drop policy if exists user_settings_update on public.user_settings;
drop policy if exists user_settings_delete on public.user_settings;
create policy user_settings_select on public.user_settings for select to authenticated using (auth.uid() = user_id);
create policy user_settings_insert on public.user_settings for insert to authenticated with check (auth.uid() = user_id);
create policy user_settings_update on public.user_settings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy user_settings_delete on public.user_settings for delete to authenticated using (auth.uid() = user_id);
