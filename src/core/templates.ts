import type { SnippetTemplate } from './types';

export const TEMPLATE_CATEGORIES = [
  'App Blueprint',
  'Feature Spec',
  'Bug Report',
  'Management Plan',
  '4-Field Bot Prompt',
  'Custom Snippets',
] as const;

export function defaultTemplates(now: string): SnippetTemplate[] {
  const row = (id: string, category: string, name: string, body: string): SnippetTemplate => ({
    id, category, name, body, is_default: true, updated_at: now,
  });
  return [
    row('template-app-blueprint', 'App Blueprint', 'App Blueprint', `App : Blueprint {
  problem: ()
  users: ()
  screens: ()
  data: ()
  offline_rules: ()
  phase_1_cut: ()
}
`),
    row('template-feature-spec', 'Feature Spec', 'Feature Spec', `Feature : Spec {
  goal: ()
  trigger_ui: ()
  rules: ()
  edge_cases: ()
  done_when: ()
}
`),
    row('template-bug-report', 'Bug Report', 'Bug Report', `Bug : Report {
  expected: ()
  actual: ()
  steps: ()
}
`),
    row('template-management-plan', 'Management Plan', 'Management Plan', `Plan : Management {
  status: (idea | queued | active | blocked | done)
  owner: ()
  priority: ()
  blockers: ()
  next_action: ()
}
`),
    row('template-bot-prompt', '4-Field Bot Prompt', '4-Field Bot Prompt', `Prompt : Bot {
  goal: ()
  details: ()
  mode: (save | research | build | ask_first)
  constraints: ()
}
`),
  ];
}

export function sanitizeTemplates(value: unknown): SnippetTemplate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SnippetTemplate => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Partial<SnippetTemplate>;
    return typeof row.id === 'string' && typeof row.name === 'string' && typeof row.body === 'string';
  }).map((row) => ({
    id: row.id,
    category: typeof row.category === 'string' && row.category.trim() ? row.category : 'Custom Snippets',
    name: row.name,
    body: row.body,
    is_default: !!row.is_default,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
  }));
}

export function insertSnippet(body: string, start: number, end: number, snippet: string): { text: string; cursor: number } {
  const from = Math.max(0, Math.min(body.length, Math.min(start, end)));
  const to = Math.max(0, Math.min(body.length, Math.max(start, end)));
  const chunk = snippet.endsWith('\n') ? snippet : `${snippet}\n`;
  const text = body.slice(0, from) + chunk + body.slice(to);
  return { text, cursor: from + chunk.length };
}

export function snippetFromSelection(name: string, selection: string, now: string, category = 'Custom Snippets'): SnippetTemplate {
  return {
    id: crypto.randomUUID(),
    category,
    name: name.trim() || 'Snippet',
    body: selection,
    is_default: false,
    updated_at: now,
  };
}
