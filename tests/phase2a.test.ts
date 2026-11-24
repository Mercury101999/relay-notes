import { describe, expect, it } from 'vitest';
import { applyConsolidate, blockMatches } from '../src/core/consolidate';
import { applyCommands, applyStructureCommands, postProcess } from '../src/core/dictation';
import { applyDisperse, appendUnderSection, planDisperse, privacyHits } from '../src/core/disperse';
import { exportWorkspace, importWorkspace } from '../src/core/export';
import { emptySettings, emptyWorkspace, makeFolder, makeNote, upgradeSettings } from '../src/core/factory';
import { formatNote } from '../src/core/format';
import { organizeByKeyword } from '../src/core/organize';
import { extractMentions, extractTags, parseDocument, parseNoteBody } from '../src/core/parser';
import { resolveDestination } from '../src/core/routing';
import { defaultTemplates } from '../src/core/templates';
import { executeSync, type SyncClient } from '../src/core/sync';
import { applyUndo } from '../src/core/undo';
import { wrapSelection } from '../src/core/wrap';
import type { KeywordAlias, Note, RoutingRule, Workspace } from '../src/core/types';

const aliases: KeywordAlias[] = [{ id: 'a1', alias: 'relay notes', canonical: 'RelayNotes' }];
const rules: RoutingRule[] = [{
  id: 'r1',
  keyword: 'M.C.I',
  sub_class: '*',
  folder: '2.3. M.C.I',
  note: '{SubClass}',
  section: '{Chapter}',
  created_at: '2026-11-24T00:00:00.000Z',
  updated_at: '2026-11-24T00:00:00.000Z',
}];

describe('parser upgrade', () => {
  it('keeps Phase 1 blocks and reads an inline route, tags, and mentions', () => {
    const body = `Color #0c1214 and #fff stay colors. Mail user@example.com is not a mention.

Portfolio : StudyApp #pwa @PA -> Briefs / Weekly desk dump / triage {
  overview: (hello #sync @Ari)
}

Career {
  brief: (plain)
}
`;
    const parsed = parseNoteBody(body);
    expect(parsed.keywords).toEqual(['Portfolio', 'Career']);
    expect(parsed.sections[0].subClass).toBe('StudyApp');
    expect(parsed.sections[0].route).toEqual({ folder: 'Briefs', note: 'Weekly desk dump', section: 'triage' });
    expect(parsed.sections[0].headerTags).toEqual(['pwa']);
    expect(parsed.sections[0].tags).toEqual(['pwa', 'sync']);
    expect(parsed.sections[0].mentions).toEqual(['PA', 'Ari']);
    expect(parsed.tags).toEqual(['pwa', 'sync']);
    expect(parsed.mentions).toEqual(['PA', 'Ari']);
    expect(extractTags('#feed #pwa')).toEqual(['pwa']);
    expect(extractMentions('user@example.com @Portfolio')).toEqual(['Portfolio']);
    expect(parsed.diagnostics).toEqual([]);
    const doc = parseDocument(body);
    expect(doc.nodes.filter((node) => node.kind === 'block')).toHaveLength(2);
  });

  it('reads code fences and double parentheses without breaking on braces', () => {
    const body = `Demo : Code {
  snippet: (\`\`\`ts
const x = () => { return (1); };
\`\`\`)
  bare: \`\`\`ts
const y = () => { return (2); };
\`\`\`
  guard: (( if (a) { b(); } ))
}
`;
    const { sections, diagnostics } = parseNoteBody(body);
    expect(diagnostics).toEqual([]);
    expect(sections).toHaveLength(1);
    expect(sections[0].chapters.map((chapter) => chapter.valueKind)).toEqual(['code_fence', 'code_fence', 'double_paren']);
    expect(sections[0].chapters[0].value).toContain('return (1)');
    expect(sections[0].chapters[0].fenceLang).toBe('ts');
    expect(sections[0].chapters[1].value).toContain('return (2)');
    expect(sections[0].chapters[2].value).toContain('if (a) { b(); }');
  });

  it('reports unclosed blocks with line numbers and leaves the text in place', () => {
    const body = `Broken {
  chapter: (never closes

Ok {
  item: (yes)
}
`;
    const parsed = parseNoteBody(body);
    expect(parsed.sections.map((section) => section.keyword)).toEqual(['Ok']);
    expect(parsed.diagnostics.map((item) => item.kind)).toEqual(expect.arrayContaining(['unclosed_paren', 'unclosed_brace']));
    expect(parsed.diagnostics[0].message).toMatch(/line \d+/);
    expect(parsed.diagnostics[0].line).toBeGreaterThan(0);
    const fence = parseNoteBody('Intro {\n  code: ```ts\nconst z = {\n');
    expect(fence.diagnostics.some((item) => item.kind === 'unclosed_fence')).toBe(true);
    const doubles = parseNoteBody('Intro {\n  code: (( if (a) {\n');
    expect(doubles.diagnostics.some((item) => item.kind === 'unclosed_double_paren')).toBe(true);
  });
});

describe('routing, aliases, and formatting', () => {
  it('resolves inline, exact, then wildcard routes with placeholders', () => {
    const block = parseNoteBody('M.C.I : Notes {\n  overview: (one)\n}\n').sections[0];
    expect(resolveDestination(block, rules, aliases)).toMatchObject({ folder: '2.3. M.C.I', note: 'Notes', section: 'overview', via: 'wildcard' });
    const exactRules: RoutingRule[] = [{ ...rules[0], id: 'exact', keyword: 'M.C.I', sub_class: 'Notes', folder: 'Exact', note: 'Fixed', section: 'S' }];
    expect(resolveDestination(block, [...exactRules, ...rules], aliases).via).toBe('exact');
    const inline = parseNoteBody('M.C.I : Notes -> Other / Place / Bit {\n  overview: (one)\n}\n').sections[0];
    expect(resolveDestination(inline, exactRules, aliases)).toMatchObject({ folder: 'Other', via: 'inline' });
    const typo = parseNoteBody('relay notes : Desk {\n  overview: (one)\n}\n').sections[0];
    const aliasRule: RoutingRule[] = [{ ...rules[0], keyword: 'RelayNotes', sub_class: '*', folder: '{Keyword}', note: '{SubClass}', section: 'Body' }];
    expect(resolveDestination(typo, aliasRule, aliases)).toMatchObject({ folder: 'RelayNotes', note: 'Desk', via: 'wildcard' });
  });

  it('formats idempotently, substitutes aliases, and refuses to touch unclosed text', () => {
    const messy = `relay notes:Desk{
overview:(  hello)
stack:(( if (a) { b(); } ))
}
`;
    const once = formatNote(messy, aliases);
    expect(once.diagnostics).toEqual([]);
    expect(once.text).toContain('RelayNotes : Desk {');
    expect(once.text).toContain('  overview: (  hello)');
    expect(once.text).toContain('  stack: (( if (a) { b(); } ))');
    const twice = formatNote(once.text, aliases);
    expect(twice.text).toBe(once.text);
    const broken = 'Broken {\n  chapter: (nope\n';
    const safe = formatNote(broken, aliases);
    expect(safe.text).toBe(broken);
    expect(safe.changed).toBe(false);
    expect(safe.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('writing helpers', () => {
  it('wraps a selection as a block, chapter, checklist, fence, or route', () => {
    expect(wrapSelection('alpha', 0, 5, 'block').text).toContain('chapter: (alpha)');
    expect(wrapSelection('', 0, 0, 'chapter').text).toBe('key: ()');
    expect(wrapSelection('one\ntwo', 0, 7, 'check').text).toBe('- [ ] one\n- [ ] two');
    const fenced = wrapSelection('const x = 1;', 0, 12, 'code');
    expect(fenced.text).toContain('```');
    expect(fenced.text).toContain('const x = 1;');
    const unsafe = wrapSelection('if (a) {', 0, 8, 'code');
    expect(unsafe.text).toContain('((');
    const routed = wrapSelection('Portfolio {\n}\n', 10, 10, 'route');
    expect(routed.text).toContain('-> Folder / Note / Section');
  });

  it('speaks open block, new chapter, and end block when commands are on', () => {
    expect(applyCommands('open quote hi')).toContain('"');
    const spoken = postProcess('open block then new chapter and end block', [], true);
    expect(spoken).toContain('Keyword : SubClass {');
    expect(spoken).toContain('chapter: (');
    expect(spoken).toContain('}');
    expect(postProcess('open block', [], false)).not.toContain('Keyword');
    expect(applyStructureCommands('End block')).toContain('}');
  });

  it('seeds five templates and round-trips them through export', () => {
    const templates = defaultTemplates('2026-11-24T00:00:00.000Z');
    expect(templates.map((template) => template.category)).toEqual([
      'App Blueprint', 'Feature Spec', 'Bug Report', 'Management Plan', '4-Field Bot Prompt',
    ]);
    expect(templates[0].body).toContain('phase_1_cut');
    expect(templates[3].body).toContain('idea | queued | active | blocked | done');
    expect(templates[4].body).toContain('ask_first');
    const ws = emptyWorkspace();
    ws.settings.templates = [...templates, { id: 'custom', category: 'Custom Snippets', name: 'Pin', body: 'pin: (fictional)', updated_at: '2026-11-24T00:00:00.000Z' }];
    const imported = importWorkspace(exportWorkspace(ws, '2026-11-24T00:00:00.000Z'), emptyWorkspace());
    expect(imported.settings.templates.some((template) => template.name === 'Pin')).toBe(true);
    expect(imported.settings.format_on_save).toBe(false);
    const legacy = upgradeSettings({
      theme: 'dark',
      voice_dictionary: [],
      voice_commands_enabled: true,
      supabase_url: 'https://example.supabase.co',
      supabase_publishable_key: 'sb_publishable_test',
      updated_at: '2020-01-01T00:00:00.000Z',
    } as unknown as Workspace['settings']);
    expect(legacy.format_on_save).toBe(false);
    expect(legacy.routing_rules).toEqual([]);
    expect(legacy.templates.some((template) => template.body.includes('offline_rules'))).toBe(true);
  });
});

describe('group, consolidate, and disperse', () => {
  const now = '2026-11-24T00:00:00.000Z';

  function localNote(body: string, title = 'Scratch'): Note {
    return makeNote({ title, body, sync_mode: 'local' }, now);
  }

  it('filters by keyword, subclass, tag, and mention together', () => {
    const notes = [
      localNote('Portfolio : StudyApp #pwa @PA {\n  overview: (one)\n}\n', 'A'),
      localNote('Career : Listings #sync {\n  brief: (two)\n}\n', 'B'),
    ];
    const groups = organizeByKeyword(notes, [{ id: 'x', alias: 'portfolio', canonical: 'Portfolio' }]);
    expect(groups.map((group) => group.keyword)).toContain('Portfolio');
    const picks = notes.flatMap((note) => note.parsed_sections.map((section) => ({ noteId: note.id, noteTitle: note.title, syncMode: note.sync_mode, section })));
    const canon = (keyword: string) => keyword;
    expect(picks.filter((pick) => blockMatches(pick, { keywords: ['Portfolio'], subClasses: ['StudyApp'], tags: ['pwa'], mentions: ['PA'], search: 'one' }, canon))).toHaveLength(1);
    expect(picks.filter((pick) => blockMatches(pick, { keywords: ['Portfolio'], subClasses: [], tags: ['sync'], mentions: [], search: '' }, canon))).toHaveLength(0);
  });

  it('consolidates a copy, archives originals, and undoes both', () => {
    const source = localNote('Keep the intro.\n\nPortfolio : StudyApp {\n  overview: (alpha)\n}\n\nTail stays.\n', 'Source');
    const notes = [source];
    const picks = source.parsed_sections.map((section) => ({ noteId: source.id, noteTitle: source.title, syncMode: source.sync_mode, section }));
    const copied = applyConsolidate({ picks, targetNoteId: null, folderId: null, newTitle: 'Bundle', mode: 'copy' }, notes, [], true, now);
    expect(copied.ok).toBe(true);
    expect(copied.createdNoteIds).toHaveLength(1);
    const bundle = copied.notes.find((note) => note.title === 'Bundle');
    expect(bundle?.sync_mode).toBe('local');
    expect(bundle?.body).toContain('overview: (alpha)');
    expect(copied.notes.find((note) => note.id === source.id)?.body).toContain('Keep the intro.');
    expect(copied.notes.find((note) => note.id === source.id)?.body).toContain('Tail stays.');
    const undone = applyUndo({ ...emptyWorkspace(), notes: copied.notes, folders: [] }, {
      id: 'u1', kind: 'consolidate', label: 'Undo consolidate', created_at: now,
      notes: [source], folders: [], createdNoteIds: copied.createdNoteIds, createdFolderIds: [],
    }, now);
    expect(undone.notes.map((note) => note.id)).toEqual([source.id]);
    expect(undone.notes[0].body).toContain('Tail stays.');

    const cloud = makeNote({ title: 'Cloud', body: 'Existing cloud text.\n', sync_mode: 'ari_reference' }, now);
    const blocked = applyConsolidate({ picks, targetNoteId: cloud.id, folderId: null, newTitle: '', mode: 'copy' }, [source, cloud], [], false, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.privacy).toHaveLength(1);
    expect(blocked.notes.find((note) => note.id === cloud.id)?.body).toBe(cloud.body);

    const archived = applyConsolidate({ picks, targetNoteId: null, folderId: null, newTitle: 'Bundle', mode: 'archive' }, notes, [], true, now);
    const left = archived.notes.find((note) => note.id === source.id);
    expect(left?.body).toContain('Keep the intro.');
    expect(left?.body).toContain('Tail stays.');
    expect(left?.body).not.toContain('overview: (alpha)');
  });

  it('disperses with a dry-run, appends without overwrite, keeps plain text, gates local-to-cloud, and undoes', () => {
    const folder = makeFolder({ name: 'Briefs' }, now);
    const cloud = makeNote({ title: 'Weekly desk dump', body: 'Existing cloud text.\n\n## triage\n\nKeep this section.\n', folder_id: folder.id, sync_mode: 'ari_inbox', triage_status: 'raw' }, now);
    const source = localNote(`Plain stays here.\n\nPortfolio : StudyApp -> Briefs / Weekly desk dump / triage {\n  overview: (routed hello)\n}\n\nCareer {\n  brief: (unrouted)\n}\n\nTail stays.\n`);
    const preview = planDisperse(source, [source, cloud], [folder], [], []);
    const routed = preview.rows.find((row) => row.keyword === 'Portfolio');
    const unrouted = preview.rows.find((row) => row.keyword === 'Career');
    expect(routed).toMatchObject({ folder: 'Briefs', note: 'Weekly desk dump', section: 'triage', via: 'inline', noteExists: true, folderExists: true });
    expect(unrouted?.via).toBe('unmapped');
    expect(preview.privacy).toHaveLength(1);
    expect(privacyHits(source, preview.rows, [source, cloud], [folder])).toHaveLength(1);

    const refused = applyDisperse(source, preview.rows, [source, cloud], [folder], [], [], 'move', false, now);
    expect(refused.ok).toBe(false);
    expect(refused.notes.find((note) => note.id === cloud.id)?.body).toBe(cloud.body);
    expect(refused.notes.find((note) => note.id === source.id)?.body).toContain('Plain stays here.');

    const moved = applyDisperse(source, preview.rows, [source, cloud], [folder], [], [], 'move', true, now);
    expect(moved.ok).toBe(true);
    const nextCloud = moved.notes.find((note) => note.id === cloud.id)!;
    const nextSource = moved.notes.find((note) => note.id === source.id)!;
    expect(nextCloud.body).toContain('Existing cloud text.');
    expect(nextCloud.body).toContain('Keep this section.');
    expect(nextCloud.body).toContain('routed hello');
    expect(nextSource.body).toContain('Plain stays here.');
    expect(nextSource.body).toContain('Tail stays.');
    expect(nextSource.body).toContain('unrouted');
    expect(nextSource.body).not.toContain('routed hello');

    const fresh = applyDisperse(source, [{ ...preview.rows[0], folder: 'Created', note: 'Fresh', section: 'intro', saveRule: true }], [source], [], rules, aliases, 'copy', true, now);
    expect(fresh.ok).toBe(true);
    expect(fresh.createdNoteIds).toHaveLength(1);
    expect(fresh.notes.find((note) => note.id === fresh.createdNoteIds[0])?.sync_mode).toBe('local');
    expect(fresh.rules.some((rule) => rule.keyword === 'Portfolio' && rule.folder === 'Created')).toBe(true);
    const restored = applyUndo({ ...emptyWorkspace(), notes: fresh.notes, folders: fresh.folders }, {
      id: 'u2', kind: 'disperse', label: 'Undo disperse', created_at: now,
      notes: [source], folders: [], createdNoteIds: fresh.createdNoteIds, createdFolderIds: fresh.createdFolderIds,
    }, now);
    expect(restored.notes).toHaveLength(1);
    expect(restored.notes[0].body).toContain('Plain stays here.');
    expect(restored.folders).toHaveLength(0);
    expect(appendUnderSection('Keep this section.\n', 'triage', 'Portfolio : StudyApp {\n  overview: (again)\n}\n')).toContain('Keep this section.');
  });
});

describe('sync isolation for the new fields', () => {
  it('never uploads a local note just because it has tags, mentions, or routing metadata', async () => {
    const local = makeNote({
      id: 'local-1',
      title: 'Stay',
      body: 'LOCAL_SECRET_PHRASE\n\nPortfolio : StudyApp #pwa @PA {\n  overview: (secret detail)\n}\n',
      sync_mode: 'local',
      updated_at: '2026-11-24T00:00:00.000Z',
    });
    const inbox = makeNote({
      id: 'inbox-1',
      title: 'Send',
      body: 'Portfolio : StudyApp {\n  overview: (public fictional)\n}\n',
      sync_mode: 'ari_inbox',
      triage_status: 'raw',
      updated_at: '2026-11-24T00:00:00.000Z',
    });
    const calls: { table: string; rows?: unknown }[] = [];
    const client: SyncClient = {
      async select() { return []; },
      async upsert(table, rows) {
        calls.push({ table, rows });
        if (table === 'notes' && JSON.stringify(rows).includes('LOCAL_SECRET_PHRASE')) throw new Error('local note reached upsert');
      },
      async remove() {},
      async selectSettings() { return null; },
      async upsertSettings(row) { calls.push({ table: 'user_settings', rows: [row] }); },
    };
    const settings = {
      ...emptySettings('2026-11-24T00:00:00.000Z'),
      routing_rules: rules,
      keyword_aliases: aliases,
      format_on_save: true,
    };
    const workspace: Workspace = { folders: [], bots: [], notes: [local, inbox], queue: [], settings, tombstones: [] };
    const outcome = await executeSync(client, 'user-1', workspace);
    const pushed = calls.find((call) => call.table === 'notes')?.rows as Note[];
    expect(pushed.map((note) => note.id)).toEqual(['inbox-1']);
    expect(JSON.stringify(pushed)).not.toContain('LOCAL_SECRET_PHRASE');
    expect(outcome.workspace.notes.find((note) => note.id === 'local-1')?.tags).toContain('pwa');
    const settingsRow = calls.find((call) => call.table === 'user_settings')?.rows as Record<string, unknown>[];
    expect(settingsRow[0].routing_rules).toEqual(rules);
    expect(settingsRow[0].format_on_save).toBe(true);
    expect(JSON.stringify(settingsRow)).not.toContain('LOCAL_SECRET_PHRASE');
  });
});
