import { describe, expect, it } from 'vitest';
import { chapterKey, emptyFoldState, isChapterCollapsed, isSectionCollapsed, projectView, sectionKey, summaryChip, toggleChapter, toggleSection } from '../src/core/fold';
import { parseNoteBody } from '../src/core/parser';

const BODY = `Portfolio : StudyApp {
  overview: (One two three four)
  stack: (React and TypeScript)
}
`;

describe('collapsible sections', () => {
  it('toggles section and chapter state without rewriting the source', () => {
    const { sections } = parseNoteBody(BODY);
    const key = sectionKey(sections[0]);
    const chapter = chapterKey(sections[0], sections[0].chapters[0], 0);
    let fold = emptyFoldState();
    expect(isSectionCollapsed(fold, key)).toBe(false);
    fold = toggleSection(fold, key);
    expect(isSectionCollapsed(fold, key)).toBe(true);
    fold = toggleChapter(fold, chapter);
    expect(isChapterCollapsed(fold, chapter)).toBe(true);
    const view = projectView(BODY, fold);
    expect(view.source).toBe(BODY);
    expect(view.chips[0]).toBe(summaryChip(sections[0]));
    expect(view.blocks.find((block) => block.kind === 'section')?.text).toBeUndefined();
    expect(view.blocks.some((block) => block.text?.includes('React and TypeScript'))).toBe(false);
  });

  it('builds a summary chip with chapter and word counts', () => {
    const { sections } = parseNoteBody(BODY);
    expect(summaryChip(sections[0])).toBe('Portfolio : StudyApp · 2 chapters · 7 words');
    const open = projectView(BODY, emptyFoldState());
    expect(open.source).toBe(BODY);
    expect(open.blocks.some((block) => block.text === 'React and TypeScript')).toBe(true);
  });
});
