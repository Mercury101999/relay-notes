import type { BlockRoute, KeywordAlias, ParsedSection, RoutingRule } from './types';

export interface ResolvedDestination {
  folder: string;
  note: string;
  section: string;
  via: 'inline' | 'exact' | 'wildcard' | 'unmapped';
  ruleId?: string;
}

export function canonicalKeyword(keyword: string, aliases: KeywordAlias[]): string {
  const key = keyword.trim().toLowerCase();
  const hit = aliases.find((alias) => alias.alias.trim().toLowerCase() === key && alias.canonical.trim());
  return hit ? hit.canonical.trim() : keyword.trim();
}

export function fillPlaceholders(template: string, ctx: { Keyword: string; SubClass: string; Chapter: string }): string {
  return template.replace(/\{(Keyword|SubClass|Chapter)\}/g, (_all, key: 'Keyword' | 'SubClass' | 'Chapter') => ctx[key] ?? '');
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function routeOf(block: ParsedSection): BlockRoute | null {
  if (!block.route) return null;
  if (!block.route.folder.trim() && !block.route.note.trim() && !block.route.section.trim()) return null;
  return block.route;
}

export function resolveDestination(block: ParsedSection, rules: RoutingRule[], aliases: KeywordAlias[] = []): ResolvedDestination {
  const keyword = canonicalKeyword(block.keyword, aliases);
  const subClass = block.subClass?.trim() ?? '';
  const chapter = block.chapters[0]?.name ?? '';
  const ctx = { Keyword: keyword, SubClass: subClass, Chapter: chapter };
  const fill = (value: string) => fillPlaceholders(value, ctx).trim();

  const inline = routeOf(block);
  if (inline && inline.folder.trim()) {
    return {
      folder: fill(inline.folder),
      note: fill(inline.note),
      section: fill(inline.section),
      via: 'inline',
    };
  }

  const keywordRules = rules.filter((rule) => norm(canonicalKeyword(rule.keyword, aliases)) === norm(keyword) || norm(rule.keyword) === norm(keyword));
  const exact = keywordRules.find((rule) => norm(rule.sub_class) !== '*' && norm(rule.sub_class) === norm(subClass));
  const wildKeyword = keywordRules.find((rule) => rule.sub_class.trim() === '*');
  const wildSub = rules.find((rule) => rule.keyword.trim() === '*' && norm(rule.sub_class) !== '*' && norm(rule.sub_class) === norm(subClass));
  const wildAll = rules.find((rule) => rule.keyword.trim() === '*' && rule.sub_class.trim() === '*');
  const rule = exact ?? wildKeyword ?? wildSub ?? wildAll;
  if (!rule) return { folder: '', note: '', section: '', via: 'unmapped' };
  const via = exact ? 'exact' : 'wildcard';
  return {
    folder: fill(rule.folder),
    note: fill(rule.note),
    section: fill(rule.section),
    via,
    ruleId: rule.id,
  };
}

export function sanitizeRules(value: unknown): RoutingRule[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RoutingRule => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Partial<RoutingRule>;
    return typeof row.id === 'string' && typeof row.keyword === 'string' && typeof row.folder === 'string';
  }).map((row) => ({
    id: row.id,
    keyword: row.keyword,
    sub_class: typeof row.sub_class === 'string' ? row.sub_class : '*',
    folder: row.folder,
    note: typeof row.note === 'string' ? row.note : '',
    section: typeof row.section === 'string' ? row.section : '',
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
  }));
}

export function sanitizeAliases(value: unknown): KeywordAlias[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is KeywordAlias => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Partial<KeywordAlias>;
    return typeof row.id === 'string' && typeof row.alias === 'string' && typeof row.canonical === 'string';
  }).map((row) => ({ id: row.id, alias: row.alias, canonical: row.canonical }));
}

export function upsertRule(rules: RoutingRule[], next: Omit<RoutingRule, 'id' | 'created_at' | 'updated_at'> & { id?: string }, now: string): RoutingRule[] {
  const id = next.id ?? crypto.randomUUID();
  const row: RoutingRule = {
    id,
    keyword: next.keyword.trim(),
    sub_class: next.sub_class.trim() || '*',
    folder: next.folder.trim(),
    note: next.note.trim(),
    section: next.section.trim(),
    created_at: now,
    updated_at: now,
  };
  const index = rules.findIndex((rule) => rule.id === id || (rule.keyword.toLowerCase() === row.keyword.toLowerCase() && rule.sub_class.toLowerCase() === row.sub_class.toLowerCase()));
  if (index < 0) return [...rules, row];
  const previous = rules[index];
  const copy = rules.slice();
  copy[index] = { ...row, id: previous.id, created_at: previous.created_at, updated_at: now };
  return copy;
}
