import { parseNoteBody } from './parser';
import { canonicalKeyword } from './routing';
import type { Diagnostic, KeywordAlias, ParsedSection } from './types';

export interface FormatResult {
  text: string;
  diagnostics: Diagnostic[];
  changed: boolean;
}

function formatChapter(chapter: ParsedSection['chapters'][number]): string {
  if (chapter.valueKind === 'double_paren') return `  ${chapter.name}: ((${chapter.value}))`;
  if (chapter.valueKind === 'code_fence') {
    const lang = chapter.fenceLang ?? '';
    const value = chapter.value.replace(/\n$/, '');
    return `  ${chapter.name}: \`\`\`${lang}\n${value}\n\`\`\``;
  }
  return `  ${chapter.name}: (${chapter.value})`;
}

function formatRoute(section: ParsedSection): string {
  if (!section.route) return '';
  const parts: string[] = [];
  if (section.route.folder) parts.push(section.route.folder.trim());
  if (section.route.note || section.route.section) parts.push(section.route.note.trim());
  if (section.route.section) parts.push(section.route.section.trim());
  if (!parts.length) return '';
  return ` -> ${parts.join(' / ')}`;
}

export function formatBlock(section: ParsedSection, aliases: KeywordAlias[] = []): string {
  const keyword = canonicalKeyword(section.keyword, aliases);
  const sub = section.subClass ? ` : ${section.subClass}` : '';
  const tags = section.headerTags.map((tag) => `#${tag}`).join(' ');
  const mentions = section.headerMentions.map((mention) => `@${mention}`).join(' ');
  const extra = [tags, mentions].filter(Boolean).join(' ');
  const lines = [`${keyword}${sub}${formatRoute(section)}${extra ? ` ${extra}` : ''} {`];
  for (const chapter of section.chapters) lines.push(formatChapter(chapter));
  lines.push('}');
  return lines.join('\n');
}

/** Deterministic block layout. Unclosed constructs are reported and the text is left unchanged. */
export function formatNote(body: string, aliases: KeywordAlias[] = []): FormatResult {
  const parsed = parseNoteBody(body);
  if (parsed.diagnostics.length) return { text: body, diagnostics: parsed.diagnostics, changed: false };
  const parts: string[] = [];
  let cursor = 0;
  for (const section of parsed.sections) {
    const plain = body.slice(cursor, section.startOffset).replace(/^\n+/, '').replace(/\n+$/, '');
    if (plain.trim()) parts.push(plain);
    parts.push(formatBlock(section, aliases));
    cursor = section.endOffset;
  }
  const tail = body.slice(cursor).replace(/^\n+/, '').replace(/\n+$/, '');
  if (tail.trim()) parts.push(tail);
  const text = parts.length ? `${parts.join('\n\n')}\n` : '';
  return { text, diagnostics: [], changed: text !== body };
}
