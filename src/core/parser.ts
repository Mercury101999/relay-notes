import type { Chapter, ParsedSection } from './types';

const WORD = String.raw`[A-Za-z][A-Za-z0-9+/#&.'-]{0,60}(?:[ \t]+[A-Za-z0-9+/#&.'-]{1,60}){0,6}`;
const HEADER = new RegExp(`^([ \\t]*)(${WORD})[ \\t]*(?::[ \\t]*(${WORD}))?[ \\t]*\\{(.*)$`);

export function lineOf(body: string, offset: number): number {
  let line = 1;
  const end = Math.min(Math.max(0, offset), body.length);
  for (let i = 0; i < end; i++) if (body[i] === '\n') line++;
  return line;
}

export function offsetOfLine(body: string, line: number): number {
  if (line <= 1) return 0;
  let n = 1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\n') {
      n++;
      if (n === line) return i + 1;
    }
  }
  return body.length;
}

function findClosingBrace(text: string, openIdx: number): number | null {
  let brace = 0;
  let paren = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(') paren++;
    else if (c === ')') paren = Math.max(0, paren - 1);
    else if (paren === 0 && c === '{') brace++;
    else if (paren === 0 && c === '}') {
      brace--;
      if (brace === 0) return i;
    }
  }
  return null;
}

function findClosingParen(text: string, openIdx: number): number | null {
  let paren = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(') paren++;
    else if (c === ')') {
      paren--;
      if (paren === 0) return i;
    }
  }
  return null;
}

export interface BodyRange {
  name: string;
  headerStart: number;
  bodyStart: number;
  bodyEnd: number;
}

/** Chapter ranges inside one section slice. Offsets are relative to `slice`. */
export function chapterBodyRanges(slice: string): BodyRange[] {
  const ranges: BodyRange[] = [];
  const re = new RegExp(`(${WORD})[ \\t]*:[ \\t]*\\(`, 'g');
  let i = 0;
  while (i < slice.length) {
    re.lastIndex = i;
    const hit = re.exec(slice);
    if (!hit) break;
    const parenStart = hit.index + hit[0].length - 1;
    const close = findClosingParen(slice, parenStart);
    if (close == null) {
      i = parenStart + 1;
      continue;
    }
    ranges.push({
      name: hit[1].trim().replace(/\s+/g, ' '),
      headerStart: hit.index,
      bodyStart: parenStart + 1,
      bodyEnd: close,
    });
    i = close + 1;
  }
  return ranges;
}

function headerRestOk(rest: string): boolean {
  const trimmed = rest.trim();
  if (trimmed === '' || trimmed === '}') return true;
  return new RegExp(`^${WORD}[ \\t]*:[ \\t]*\\(`).test(trimmed);
}

export function parseNoteBody(body: string): { sections: ParsedSection[]; keywords: string[] } {
  const lines = body.split('\n');
  const starts: number[] = [];
  let acc = 0;
  for (const line of lines) {
    starts.push(acc);
    acc += line.length + 1;
  }
  const sections: ParsedSection[] = [];
  let i = 0;
  let guard = 0;
  while (i < lines.length && guard++ < lines.length + 5) {
    const line = lines[i].replace(/\r$/, '');
    const match = HEADER.exec(line);
    if (!match || !headerRestOk(match[4] ?? '')) {
      i++;
      continue;
    }
    const braceAt = match[0].lastIndexOf('{');
    const openOffset = starts[i] + braceAt;
    const close = findClosingBrace(body, openOffset);
    if (close == null) {
      i++;
      continue;
    }
    const keyword = match[2].trim().replace(/\s+/g, ' ');
    const subRaw = match[3] ? match[3].trim().replace(/\s+/g, ' ') : '';
    const chapters: Chapter[] = chapterBodyRanges(body.slice(openOffset + 1, close)).map((range) => ({
      name: range.name,
      body: body.slice(openOffset + 1 + range.bodyStart, openOffset + 1 + range.bodyEnd),
      lineStart: lineOf(body, openOffset + 1 + range.bodyStart),
      lineEnd: lineOf(body, openOffset + 1 + range.bodyEnd),
    }));
    const lineEnd = lineOf(body, close);
    sections.push({
      keyword,
      subClass: subRaw || null,
      chapters,
      lineStart: i + 1,
      lineEnd,
    });
    const next = lineEnd; // 1-based line of `}` is the next 0-based index
    i = next > i ? next : i + 1;
  }
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const key = section.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(section.keyword);
  }
  return { sections, keywords };
}

export function sectionOffsets(body: string, section: ParsedSection): { start: number; end: number } {
  const start = offsetOfLine(body, section.lineStart);
  const lineStart = offsetOfLine(body, section.lineEnd);
  const nl = body.indexOf('\n', lineStart);
  const end = nl === -1 ? body.length : nl + 1;
  return { start, end: Math.max(start, end) };
}

export interface NoteSegment {
  kind: 'text' | 'section';
  start: number;
  end: number;
  section?: ParsedSection;
}

export function segmentsOf(body: string): NoteSegment[] {
  const { sections } = parseNoteBody(body);
  const parts: NoteSegment[] = [];
  let cursor = 0;
  for (const section of sections) {
    const off = sectionOffsets(body, section);
    if (off.start > cursor) parts.push({ kind: 'text', start: cursor, end: off.start });
    parts.push({ kind: 'section', start: off.start, end: off.end, section });
    cursor = off.end;
  }
  if (cursor < body.length) parts.push({ kind: 'text', start: cursor, end: body.length });
  if (!parts.length) parts.push({ kind: 'text', start: 0, end: body.length });
  return parts;
}

export function replaceRange(body: string, start: number, end: number, insert: string): string {
  return body.slice(0, start) + insert + body.slice(end);
}

export function replaceChapterBody(body: string, lineStart: number, chapterIndex: number, nextBody: string): string {
  const { sections } = parseNoteBody(body);
  const section = sections.find((s) => s.lineStart === lineStart);
  if (!section) return body;
  const off = sectionOffsets(body, section);
  const slice = body.slice(off.start, off.end);
  const open = slice.indexOf('{');
  if (open < 0) return body;
  const inner = slice.slice(open + 1);
  const ranges = chapterBodyRanges(inner);
  const range = ranges[chapterIndex];
  if (!range) return body;
  const absStart = off.start + open + 1 + range.bodyStart;
  const absEnd = off.start + open + 1 + range.bodyEnd;
  return body.slice(0, absStart) + nextBody + body.slice(absEnd);
}
