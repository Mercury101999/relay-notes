import { describe, expect, it } from 'vitest';
import { makeNote } from '../src/core/factory';
import { organizeByKeyword, sectionToPrompt } from '../src/core/organize';
import { searchWorkspace, snippetAround } from '../src/core/search';
import { makeFolder } from '../src/core/factory';

const notes = [
  makeNote({
    id: 'n1',
    title: 'Practice syntax',
    body: 'Portfolio : StudyApp {\n  stack: (React and TypeScript practice)\n}\n',
  }),
  makeNote({
    id: 'n2',
    title: 'Other desk',
    body: 'Portfolio : Notes {\n  brief: (A second portfolio paragraph)\n}\nCareer {\n  brief: (Help desk listings)\n}\n',
  }),
];
const folders = [
  makeFolder({ id: 'f1', name: 'Practice', code: '2.1', description: 'Labs for the practice desk' }),
  makeFolder({ id: 'f2', name: 'Study', code: '4.0', description: 'Quizzes' }),
];

describe('auto-organize by keyword', () => {
  it('groups sections by keyword and sub-class', () => {
    const groups = organizeByKeyword(notes);
    const portfolio = groups.find((group) => group.keyword === 'Portfolio');
    expect(portfolio?.items).toHaveLength(2);
    expect(portfolio?.subGroups.map((sub) => sub.subClass)).toEqual(['Notes', 'StudyApp']);
    expect(groups.map((group) => group.keyword)).toEqual(['Career', 'Portfolio']);
  });

  it('pre-fills a prompt from a section', () => {
    const section = notes[0].parsed_sections[0];
    const prompt = sectionToPrompt(section);
    expect(prompt.goal).toContain('Portfolio');
    expect(prompt.details).toContain('React and TypeScript');
    expect(prompt.sub_class).toBe('StudyApp');
  });
});

describe('scoped search', () => {
  it('searches sections, notes, and folders with snippets', () => {
    const sections = searchWorkspace('typescript', 'section', notes, folders);
    expect(sections[0].scope).toBe('section');
    expect(sections[0].keyword).toBe('Portfolio');
    expect(sections[0].snippet.toLowerCase()).toContain('typescript');
    const noteHits = searchWorkspace('other desk', 'note', notes, folders);
    expect(noteHits.map((hit) => hit.noteId)).toEqual(['n2']);
    const folderHits = searchWorkspace('2.1', 'folder', notes, folders);
    expect(folderHits[0].title).toContain('Practice');
    expect(snippetAround('alpha beta gamma', 'beta')).toContain('beta');
    expect(searchWorkspace('   ', 'note', notes, folders)).toEqual([]);
  });
});
