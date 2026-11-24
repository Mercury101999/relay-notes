import { parseNoteBody, sectionOffsets } from './parser';
import type { Chapter, ParsedSection } from './types';

export interface FoldState {
  sections: Record<string, boolean>;
  chapters: Record<string, boolean>;
}

export const emptyFoldState = (): FoldState => ({ sections: {}, chapters: {} });

export function sectionKey(section: ParsedSection): string {
  return `${section.lineStart}|${section.keyword}|${section.subClass ?? ''}`;
}

export function chapterKey(section: ParsedSection, chapter: Chapter, index: number): string {
  return `${sectionKey(section)}|${index}|${chapter.name}|${chapter.lineStart}`;
}

export function isSectionCollapsed(fold: FoldState, key: string): boolean {
  return !!fold.sections[key];
}

export function isChapterCollapsed(fold: FoldState, key: string): boolean {
  return !!fold.chapters[key];
}

export function toggleSection(fold: FoldState, key: string): FoldState {
  return { ...fold, sections: { ...fold.sections, [key]: !fold.sections[key] } };
}

export function toggleChapter(fold: FoldState, key: string): FoldState {
  return { ...fold, chapters: { ...fold.chapters, [key]: !fold.chapters[key] } };
}

export function expandSection(fold: FoldState, key: string): FoldState {
  if (!fold.sections[key]) return fold;
  return { ...fold, sections: { ...fold.sections, [key]: false } };
}

export function wordCount(text: string): number {
  const match = text.trim().match(/\S+/g);
  return match ? match.length : 0;
}

export function summaryChip(section: ParsedSection): string {
  const words = section.chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0);
  const label = section.subClass ? `${section.keyword} : ${section.subClass}` : section.keyword;
  const count = section.chapters.length;
  return `${label} · ${count} ${count === 1 ? 'chapter' : 'chapters'} · ${words} ${words === 1 ? 'word' : 'words'}`;
}

export function chapterChip(chapter: Chapter): string {
  const words = wordCount(chapter.body);
  return `${chapter.name} · ${words} ${words === 1 ? 'word' : 'words'}`;
}

export interface ViewBlock {
  kind: 'text' | 'section' | 'chapter';
  key: string;
  text?: string;
  chip?: string;
  collapsed?: boolean;
  keyword?: string;
  subClass?: string | null;
}

/** View projection. `source` is the original string, returned unchanged. */
export function projectView(body: string, fold: FoldState): { source: string; blocks: ViewBlock[]; chips: string[] } {
  const { sections } = parseNoteBody(body);
  const blocks: ViewBlock[] = [];
  const chips: string[] = [];
  let cursor = 0;
  sections.forEach((section) => {
    const off = sectionOffsets(body, section);
    if (off.start > cursor) {
      const text = body.slice(cursor, off.start);
      if (text.trim()) blocks.push({ kind: 'text', key: `t${cursor}`, text });
    }
    const key = sectionKey(section);
    const collapsed = isSectionCollapsed(fold, key);
    const chip = summaryChip(section);
    blocks.push({
      kind: 'section',
      key,
      chip,
      collapsed,
      keyword: section.keyword,
      subClass: section.subClass,
      text: collapsed ? undefined : body.slice(off.start, off.end),
    });
    if (collapsed) chips.push(chip);
    else {
      section.chapters.forEach((chapter, index) => {
        const ck = chapterKey(section, chapter, index);
        const chapterCollapsed = isChapterCollapsed(fold, ck);
        const cChip = chapterChip(chapter);
        blocks.push({
          kind: 'chapter',
          key: ck,
          chip: cChip,
          collapsed: chapterCollapsed,
          text: chapterCollapsed ? undefined : chapter.body,
        });
        if (chapterCollapsed) chips.push(cChip);
      });
    }
    cursor = off.end;
  });
  if (cursor < body.length) {
    const text = body.slice(cursor);
    if (text.trim()) blocks.push({ kind: 'text', key: `t${cursor}`, text });
  }
  return { source: body, blocks, chips };
}
