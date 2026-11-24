import type { Note, ParsedSection } from './types';

export interface OrganizedItem {
  noteId: string;
  noteTitle: string;
  section: ParsedSection;
}

export interface SubGroup {
  subClass: string | null;
  items: OrganizedItem[];
}

export interface KeywordGroup {
  keyword: string;
  items: OrganizedItem[];
  subGroups: SubGroup[];
}

export function organizeByKeyword(notes: Pick<Note, 'id' | 'title' | 'parsed_sections'>[]): KeywordGroup[] {
  const map = new Map<string, { display: string; items: OrganizedItem[] }>();
  for (const note of notes) {
    for (const section of note.parsed_sections) {
      const key = section.keyword.trim().toLowerCase();
      if (!key) continue;
      let group = map.get(key);
      if (!group) {
        group = { display: section.keyword, items: [] };
        map.set(key, group);
      }
      group.items.push({ noteId: note.id, noteTitle: note.title, section });
    }
  }
  const groups: KeywordGroup[] = [...map.values()].map((group) => {
    const subs = new Map<string, SubGroup>();
    for (const item of group.items) {
      const subKey = (item.section.subClass ?? '').toLowerCase();
      let sub = subs.get(subKey);
      if (!sub) {
        sub = { subClass: item.section.subClass, items: [] };
        subs.set(subKey, sub);
      }
      sub.items.push(item);
    }
    const subGroups = [...subs.values()].sort((a, b) => (a.subClass ?? '').localeCompare(b.subClass ?? ''));
    return { keyword: group.display, items: group.items, subGroups };
  });
  groups.sort((a, b) => a.keyword.localeCompare(b.keyword));
  return groups;
}

export function sectionToPrompt(section: ParsedSection): { goal: string; details: string; keyword: string; sub_class: string | null } {
  const label = section.subClass ? `${section.keyword}: ${section.subClass}` : section.keyword;
  const details = section.chapters.map((chapter) => `${chapter.name}: ${chapter.body.trim()}`).join('\n\n');
  return {
    goal: `Work the ${label} section`,
    details,
    keyword: section.keyword,
    sub_class: section.subClass,
  };
}
