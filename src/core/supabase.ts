import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sanitizeAliases, sanitizeRules } from './routing';
import { sanitizeTemplates } from './templates';
import type { RemoteSettings, SyncClient } from './sync';

export function createRelayClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
  });
}

function asSettings(row: Record<string, unknown> | null): RemoteSettings | null {
  if (!row) return null;
  const theme = row.theme === 'light' ? 'light' : 'dark';
  const voice_dictionary = Array.isArray(row.voice_dictionary)
    ? row.voice_dictionary.filter((rule): rule is { from: string; to: string } => !!rule && typeof rule === 'object' && typeof (rule as { from?: unknown }).from === 'string')
      .map((rule) => ({ from: rule.from, to: typeof rule.to === 'string' ? rule.to : '' }))
    : [];
  return {
    theme,
    voice_dictionary,
    voice_commands_enabled: row.voice_commands_enabled !== false,
    routing_rules: sanitizeRules(row.routing_rules),
    keyword_aliases: sanitizeAliases(row.keyword_aliases),
    templates: sanitizeTemplates(row.templates),
    format_on_save: row.format_on_save === true,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
  };
}

export function asSyncClient(client: SupabaseClient): SyncClient {
  return {
    async select(table) {
      const { data, error } = await client.from(table).select('*');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown[];
    },
    async upsert(table, rows) {
      if (!rows.length) return;
      const payload = table === 'notes'
        ? (rows as { sync_mode?: string }[]).filter((row) => row.sync_mode !== 'local')
        : rows;
      if (table === 'notes' && payload.length !== rows.length) {
        throw new Error('Refusing to push local-only notes');
      }
      const { error } = await client.from(table).upsert(payload);
      if (error) throw new Error(error.message);
    },
    async remove(table, ids) {
      if (!ids.length) return;
      const { error } = await client.from(table).delete().in('id', ids);
      if (error) throw new Error(error.message);
    },
    async selectSettings() {
      const { data, error } = await client.from('user_settings').select('*').maybeSingle();
      if (error) throw new Error(error.message);
      return asSettings((data as Record<string, unknown> | null) ?? null);
    },
    async upsertSettings(row) {
      const { error } = await client.from('user_settings').upsert(row);
      if (error) throw new Error(error.message);
    },
  };
}
