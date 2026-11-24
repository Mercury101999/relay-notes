import { describe, expect, it } from 'vitest';
import { parseNoteBody, replaceChapterBody, sectionOffsets } from '../src/core/parser';

const SAMPLE = `Fictional sample before the blocks.

Portfolio : StudyApp {
  overview: (A short practice paragraph about the study app.
It can span lines and include (nested) parentheses.)
  stack: (React and TypeScript)
}

Plain text between blocks.

Career {
  brief: (Look for public listings only.)
}

Trailing note.
`;

describe('structured syntax parser', () => {
  it('parses multiple sections, optional subclass, chapters, and line ranges', () => {
    const { sections, keywords } = parseNoteBody(SAMPLE);
    expect(keywords).toEqual(['Portfolio', 'Career']);
    expect(sections).toHaveLength(2);
    expect(sections[0].keyword).toBe('Portfolio');
    expect(sections[0].subClass).toBe('StudyApp');
    expect(sections[0].chapters.map((chapter) => chapter.name)).toEqual(['overview', 'stack']);
    expect(sections[0].chapters[0].body).toContain('(nested)');
    expect(sections[0].chapters[0].body).toContain('\n');
    expect(sections[0].chapters[0].lineEnd).toBeGreaterThan(sections[0].chapters[0].lineStart);
    expect(sections[1].subClass).toBeNull();
    expect(sections[1].chapters[0].body).toBe('Look for public listings only.');
  });

  it('dedupes keywords case-insensitively and keeps the first spelling', () => {
    const { keywords } = parseNoteBody('Alpha {\n  a: (one)\n}\nalpha {\n  b: (two)\n}\n');
    expect(keywords).toEqual(['Alpha']);
  });

  it('keeps freeform text from becoming a section and survives malformed input', () => {
    const body = `See the set { not a header
because this is prose.
}
Broken {
  chapter: (never closes

Ok {
  item: (yes)
}
`;
    const { sections } = parseNoteBody(body);
    expect(sections.map((section) => section.keyword)).toEqual(['Ok']);
    expect(sections[0].chapters[0].body).toBe('yes');
  });

  it('parses a same-line block and an empty block', () => {
    const { sections } = parseNoteBody('Idea { }\nCareer { brief: (hello) }\n');
    expect(sections[0].keyword).toBe('Idea');
    expect(sections[0].chapters).toEqual([]);
    expect(sections[1].chapters[0].body).toBe('hello');
  });

  it('returns nothing for an empty note', () => {
    expect(parseNoteBody('').sections).toEqual([]);
    expect(parseNoteBody('just prose\nwithout a block').keywords).toEqual([]);
  });

  it('replaces a chapter body without disturbing its neighbors', () => {
    const next = replaceChapterBody(SAMPLE, parseNoteBody(SAMPLE).sections[0].lineStart, 1, 'Vite and TypeScript');
    const again = parseNoteBody(next);
    expect(again.sections[0].chapters[1].body).toBe('Vite and TypeScript');
    expect(again.sections[0].chapters[0].body).toContain('nested');
    expect(again.sections[1].chapters[0].body).toContain('public listings');
    const off = sectionOffsets(next, again.sections[0]);
    expect(next.slice(off.start, off.end)).toContain('Vite and TypeScript');
  });
});
