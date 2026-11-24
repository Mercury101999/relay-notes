import { makeBot, makeFolder, makeNote, makeQueue, emptySettings } from './factory';
import type { Workspace } from './types';
import { hoursAgo } from './time';

const PRACTICE_BODY = `Fictional sample. The practice desk keeps practice notes on this device.

Portfolio : StudyApp {
  overview: (A short practice paragraph about the study app.
It can span lines and include (nested) parentheses without breaking the block.)
  stack: (React and TypeScript, with a small practice checklist.)
}

Plain text between blocks stays plain and still highlights the word practice.

Career : Listings {
  brief: (Look for public help-desk listings only. This fictional sample does not apply for anything.)
  followup: (Save three roles to compare next week.)
}

Trailing practice note.
`;

const RAW_BODY = `Fictional weekly dump for Ari.

Inbox : Sample {
  triage: (Three fictional messages arrived. None of them are real mail, and nothing here should be sent.)
  ask: (Draft a short sorting checklist for the fictional sample inbox.)
}

Keep this raw until it is archived.
`;

export function exampleWorkspace(now = Date.now()): Workspace {
  const t = (hours: number) => hoursAgo(hours, now);
  const studio = makeFolder({ id: '20000000-0000-4000-8000-000000000001', name: 'Studio', code: '2.0', color: '#2dd4bf', sort_order: 0, description: 'Fictional studio tree' }, t(48));
  const practice = makeFolder({ id: '20000000-0000-4000-8000-000000000002', name: 'Practice', code: '2.1', parent_id: studio.id, color: '#34d399', sort_order: 0, description: 'Practice diffs and labs' }, t(47));
  const research = makeFolder({ id: '20000000-0000-4000-8000-000000000003', name: 'Research', code: '2.3', parent_id: studio.id, color: '#60a5fa', sort_order: 1, description: 'Fictional research briefs' }, t(46));
  const briefs = makeFolder({ id: '20000000-0000-4000-8000-000000000004', name: 'Briefs', code: '2.3.1', parent_id: research.id, color: '#93c5fd', sort_order: 0, description: 'Short fictional briefs' }, t(45));
  const study = makeFolder({ id: '20000000-0000-4000-8000-000000000005', name: 'Study', code: '4.0', color: '#fbbf24', sort_order: 1, description: 'Quizzes and drills' }, t(40));

  const inbox = makeBot({
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Inbox Triage',
    role: 'Sorts a fictional sample inbox',
    avatar: '📥',
    accent_color: '#0f766e',
    status: 'active',
    tags: ['triage', 'mail'],
    notes: 'Fictional sample. It does not send, forward, or delete real messages.',
    todos: [
      { id: '31000000-0000-4000-8000-000000000001', text: 'Sort the fictional sample threads', done: false, created_at: t(5) },
      { id: '31000000-0000-4000-8000-000000000002', text: 'Archive the practice digest', done: true, created_at: t(8) },
    ],
    created_at: t(72),
    updated_at: t(2),
  });
  const code = makeBot({
    id: '30000000-0000-4000-8000-000000000002',
    name: 'Code Partner',
    role: 'Reviews practice diffs',
    avatar: '🛠️',
    accent_color: '#0f766e',
    status: 'active',
    tags: ['practice', 'code'],
    notes: 'Fictional sample. Ask it to review a practice diff. It does not open real repositories.',
    link_url: 'https://example.com/practice',
    todos: [
      { id: '31000000-0000-4000-8000-000000000003', text: 'Review the open practice diff', done: false, created_at: t(4) },
      { id: '31000000-0000-4000-8000-000000000004', text: 'Leave a fictional comment', done: true, created_at: t(9) },
    ],
    created_at: t(70),
    updated_at: t(3),
  });
  const studyBot = makeBot({
    id: '30000000-0000-4000-8000-000000000003',
    name: 'Study Coach',
    role: 'Quizzes on common ports',
    avatar: '📚',
    accent_color: '#1d4ed8',
    status: 'paused',
    tags: ['study'],
    notes: 'Fictional sample. A pause means no quiz is running.',
    todos: [
      { id: '31000000-0000-4000-8000-000000000005', text: 'Quiz on common ports', done: false, created_at: t(6) },
    ],
    created_at: t(60),
    updated_at: t(6),
  });
  const scout = makeBot({
    id: '30000000-0000-4000-8000-000000000004',
    name: 'Job Scout',
    role: 'Looks for roles that match a short brief',
    avatar: '🔭',
    accent_color: '#0f766e',
    status: 'active',
    tags: ['career', 'research'],
    notes: 'Fictional sample. Ask it for a weekly pass over public listings. It does not apply for anything.',
    todos: [
      { id: '31000000-0000-4000-8000-000000000006', text: "Draft this week's search brief", done: false, created_at: t(3) },
      { id: '31000000-0000-4000-8000-000000000007', text: 'Save three roles to compare', done: true, created_at: t(11) },
    ],
    created_at: t(50),
    updated_at: t(3),
  });
  const researchBot = makeBot({
    id: '30000000-0000-4000-8000-000000000005',
    name: 'Research Desk',
    role: 'Collects public sources for a fictional brief',
    avatar: '🔍',
    accent_color: '#64748b',
    status: 'idea',
    tags: ['research'],
    notes: 'Fictional sample. Still an idea, not a running assistant.',
    todos: [],
    created_at: t(30),
    updated_at: t(20),
  });
  const release = makeBot({
    id: '30000000-0000-4000-8000-000000000006',
    name: 'Release Notes',
    role: 'Writes fictional release notes',
    avatar: '📝',
    accent_color: '#94a3b8',
    status: 'retired',
    tags: ['writing'],
    notes: 'Fictional sample. Retired, so it stays on the shelf.',
    todos: [],
    created_at: t(90),
    updated_at: t(24),
  });

  const practiceNote = makeNote({
    id: '40000000-0000-4000-8000-000000000001',
    title: 'Practice syntax',
    body: PRACTICE_BODY,
    folder_id: practice.id,
    sync_mode: 'local',
    triage_status: 'none',
    pinned: true,
    created_at: t(10),
    updated_at: t(1),
  });
  const rawNote = makeNote({
    id: '40000000-0000-4000-8000-000000000002',
    title: 'Weekly desk dump',
    body: RAW_BODY,
    folder_id: briefs.id,
    sync_mode: 'ari_inbox',
    triage_status: 'raw',
    ari_summary: null,
    created_at: t(8),
    updated_at: t(2),
  });
  const reference = makeNote({
    id: '40000000-0000-4000-8000-000000000003',
    title: 'Public port list',
    body: 'Reference : Ports {\n  common: (A fictional reminder that 80, 443, and 22 show up in practice quizzes.)\n}\n',
    folder_id: study.id,
    sync_mode: 'ari_reference',
    triage_status: 'none',
    created_at: t(15),
    updated_at: t(7),
  });

  const organized = makeQueue({
    id: '50000000-0000-4000-8000-000000000001',
    source_type: 'ari_organized',
    source_note_id: rawNote.id,
    bot_name: 'Inbox Triage',
    goal: 'Sort the fictional sample inbox',
    details: 'Turn the fictional weekly dump into a checklist. Do not contact anyone.',
    mode: 'ask_first',
    keyword: 'Inbox',
    sub_class: 'Sample',
    status: 'staged',
    created_at: t(2),
    updated_at: t(2),
  });
  const stagedForm = makeQueue({
    id: '50000000-0000-4000-8000-000000000002',
    source_type: 'prompt_form',
    bot_name: 'Code Partner',
    goal: 'Compare two fictional practice snippets',
    details: 'Fictional sample only. No repository access.',
    mode: 'build',
    status: 'staged',
    created_at: t(4),
    updated_at: t(4),
  });
  const approved = makeQueue({
    id: '50000000-0000-4000-8000-000000000003',
    source_type: 'prompt_form',
    bot_name: 'Study Coach',
    goal: 'Hold a fictional port quiz',
    details: 'Five questions, answers stay on this device.',
    mode: 'research',
    status: 'approved',
    approved_at: t(5),
    created_at: t(6),
    updated_at: t(5),
  });
  const dispatched = makeQueue({
    id: '50000000-0000-4000-8000-000000000004',
    source_type: 'prompt_form',
    bot_name: 'Release Notes',
    goal: 'File the fictional release notes',
    details: 'A sample paragraph is enough.',
    mode: 'save',
    status: 'dispatched',
    approved_at: t(26),
    dispatched_at: t(25),
    ari_response: 'Saved a fictional summary. No messages were sent.',
    created_at: t(27),
    updated_at: t(25),
  });
  const saved = makeQueue({
    id: '50000000-0000-4000-8000-000000000005',
    source_type: 'prompt_form',
    bot_name: 'Job Scout',
    goal: 'Keep the fictional brief',
    details: 'Hold it quietly.',
    mode: 'save',
    status: 'saved',
    created_at: t(12),
    updated_at: t(12),
  });
  const dropped = makeQueue({
    id: '50000000-0000-4000-8000-000000000006',
    source_type: 'ari_organized',
    source_note_id: rawNote.id,
    bot_name: 'Inbox Triage',
    goal: 'Drop this fictional item',
    details: 'Not worth staging.',
    mode: 'ask_first',
    status: 'dropped',
    created_at: t(9),
    updated_at: t(9),
  });

  return {
    folders: [studio, practice, research, briefs, study],
    bots: [inbox, code, studyBot, scout, researchBot, release],
    notes: [practiceNote, rawNote, reference],
    queue: [organized, stagedForm, approved, dispatched, saved, dropped],
    settings: { ...emptySettings(t(1)), theme: 'dark', updated_at: t(1) },
    tombstones: [],
  };
}
