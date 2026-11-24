import type { BlockRoute, ChapterValueKind, Diagnostic, DiagnosticKind, ParsedSection } from './types';

const WORD = String.raw`[A-Za-z][A-Za-z0-9+/#&.'-]{0,60}(?:[ \t]+[A-Za-z0-9+/#&.'-]{1,60}){0,6}`;
const CHAPTER_RE = new RegExp(`(${WORD})[ \\t]*:[ \\t]*(\\(\\(|\\(|\`\`\`)`, 'g');

export interface PlainNode {
  kind: 'plain';
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface BlockNode {
  kind: 'block';
  id: string;
  keyword: string;
  subClass?: string;
  route?: BlockRoute;
  tags: string[];
  mentions: string[];
  chapters: ChapterNode[];
  startOffset: number;
  endOffset: number;
  lineStart: number;
  lineEnd: number;
  raw: string;
}

export interface ChapterNode {
  name: string;
  value: string;
  valueKind: ChapterValueKind;
  fenceLang?: string;
  startOffset: number;
  endOffset: number;
  lineStart: number;
  lineEnd: number;
}

export type AstNode = PlainNode | BlockNode;

export interface DocumentAST {
  nodes: AstNode[];
  diagnostics: Diagnostic[];
}

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

function diagnostic(kind: DiagnosticKind, line: number): Diagnostic {
  const message = {
    unclosed_brace: `Unclosed { on line ${line}. Add a } to finish this block.`,
    unclosed_paren: `Unclosed ( on line ${line}. Close the parenthesis so this chapter can be read.`,
    unclosed_double_paren: `Unclosed (( on line ${line}. Close the double parenthesis so the code stays intact.`,
    unclosed_fence: `Unclosed code fence on line ${line}. Add a closing \`\`\` so the block can be read.`,
  }[kind];
  return { kind, line, message };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function isHexColor(token: string): boolean {
  return /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{4}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(token);
}

export function extractTags(text: string): string[] {
  const tags: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = matchTagAt(text, i);
    if (!hit) continue;
    tags.push(hit.name);
    i = hit.end - 1;
  }
  return dedupe(tags);
}

export function extractMentions(text: string): string[] {
  const mentions: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = matchMentionAt(text, i);
    if (!hit) continue;
    mentions.push(hit.name);
    i = hit.end - 1;
  }
  return dedupe(mentions);
}

function matchTagAt(text: string, i: number): { name: string; end: number } | null {
  if (text[i] !== '#') return null;
  if (i > 0 && /[A-Za-z0-9#]/.test(text[i - 1])) return null;
  const match = /^#([A-Za-z0-9][A-Za-z0-9_-]*)/.exec(text.slice(i));
  if (!match || isHexColor(match[1])) return null;
  return { name: match[1], end: i + match[0].length };
}

function matchMentionAt(text: string, i: number): { name: string; end: number } | null {
  if (text[i] !== '@') return null;
  if (i > 0 && /[A-Za-z0-9._%+-]/.test(text[i - 1])) return null;
  const match = /^@([A-Za-z][A-Za-z0-9_]*)/.exec(text.slice(i));
  if (!match) return null;
  const after = i + match[0].length;
  if (text[after] === '.' && /[A-Za-z0-9]/.test(text[after + 1] ?? '')) return null;
  return { name: match[1], end: after };
}

type Fail = { failAt: number; kind: DiagnosticKind };
type FenceRead = { lang: string; valueStart: number; valueEnd: number; close: number } | Fail;

function readFence(text: string, openIdx: number): FenceRead {
  let i = openIdx + 3;
  let lang = '';
  if (text[i] && text[i] !== '\n' && text[i] !== '\r') {
    const langMatch = /^[A-Za-z0-9_+-]*/.exec(text.slice(i));
    lang = langMatch?.[0] ?? '';
    i += lang.length;
  }
  while (text[i] === ' ' || text[i] === '\t') i++;
  if (text[i] === '\r') i++;
  if (text[i] !== '\n') {
    const close = text.indexOf('```', i);
    if (close < 0) return { failAt: openIdx, kind: 'unclosed_fence' };
    return { lang, valueStart: i, valueEnd: close, close };
  }
  const valueStart = i + 1;
  const rest = text.slice(valueStart);
  if (rest.startsWith('```')) return { lang, valueStart, valueEnd: valueStart, close: valueStart };
  const match = /\n[ \t]*```/.exec(rest);
  if (!match) return { failAt: openIdx, kind: 'unclosed_fence' };
  return {
    lang,
    valueStart,
    valueEnd: valueStart + match.index,
    close: valueStart + match.index + match[0].length - 3,
  };
}

function findClosingDouble(text: string, openIdx: number): number | Fail {
  for (let i = openIdx + 2; i < text.length - 1; i++) {
    if (text[i] === ')' && text[i + 1] === ')') return i;
  }
  return { failAt: openIdx, kind: 'unclosed_double_paren' };
}

function findClosingParen(text: string, openIdx: number): number | Fail {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text.startsWith('```', i)) {
      const fence = readFence(text, i);
      if ('kind' in fence) return fence;
      i = fence.close + 2;
      continue;
    }
    if (text.startsWith('((', i)) {
      const close = findClosingDouble(text, i);
      if (typeof close !== 'number') return close;
      i = close + 1;
      continue;
    }
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return { failAt: openIdx, kind: 'unclosed_paren' };
}

function findClosingBrace(text: string, openIdx: number): number | Fail {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text.startsWith('```', i)) {
      const fence = readFence(text, i);
      if ('kind' in fence) return fence;
      i = fence.close + 2;
      continue;
    }
    if (text.startsWith('((', i)) {
      const close = findClosingDouble(text, i);
      if (typeof close !== 'number') return close;
      i = close + 1;
      continue;
    }
    if (text[i] === '(') {
      const close = findClosingParen(text, i);
      if (typeof close !== 'number') return close;
      i = close;
      continue;
    }
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return { failAt: openIdx, kind: 'unclosed_brace' };
}

function headerRestOk(rest: string): boolean {
  const trimmed = rest.trim();
  if (trimmed === '' || trimmed === '}') return true;
  return new RegExp(`^${WORD}[ \\t]*:[ \\t]*(?:\\(\\(|\\(|\`\`\`)`).test(trimmed);
}

interface HeaderMatch {
  keyword: string;
  subClass: string | null;
  route: BlockRoute | null;
  tags: string[];
  mentions: string[];
  braceIndex: number;
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function parseRoute(path: string): BlockRoute | null {
  const segments = path.split('/').map((part) => part.trim()).filter(Boolean);
  if (!segments.length) return null;
  if (segments.length === 1) return { folder: segments[0], note: '', section: '' };
  if (segments.length === 2) return { folder: segments[0], note: segments[1], section: '' };
  return { folder: segments[0], note: segments[1], section: segments.slice(2).join(' / ') };
}

function parseHeaderPrefix(prefix: string): Omit<HeaderMatch, 'braceIndex'> | null {
  const tags: string[] = [];
  const mentions: string[] = [];
  let text = '';
  for (let i = 0; i < prefix.length; i++) {
    const tag = matchTagAt(prefix, i);
    if (tag) {
      tags.push(tag.name);
      i = tag.end - 1;
      continue;
    }
    const mention = matchMentionAt(prefix, i);
    if (mention) {
      mentions.push(mention.name);
      i = mention.end - 1;
      continue;
    }
    text += prefix[i];
  }
  const arrow = text.indexOf('->');
  let route: BlockRoute | null = null;
  let head = text;
  if (arrow >= 0) {
    route = parseRoute(text.slice(arrow + 2));
    head = text.slice(0, arrow);
  }
  const match = new RegExp(`^\\s*(${WORD})(?:[ \\t]*:[ \\t]*(${WORD}))?\\s*$`).exec(head);
  if (!match) return null;
  return {
    keyword: collapse(match[1]),
    subClass: match[2] ? collapse(match[2]) : null,
    route,
    tags: dedupe(tags),
    mentions: dedupe(mentions),
  };
}

function matchHeaderLine(line: string): HeaderMatch | null {
  const braceIndex = line.indexOf('{');
  if (braceIndex < 0) return null;
  if (!headerRestOk(line.slice(braceIndex + 1))) return null;
  const prefix = parseHeaderPrefix(line.slice(0, braceIndex));
  if (!prefix) return null;
  return { ...prefix, braceIndex };
}

interface ScannedChapter {
  name: string;
  value: string;
  valueKind: ChapterValueKind;
  fenceLang?: string;
  headerStart: number;
  bodyStart: number;
  bodyEnd: number;
  end: number;
}

function scanChapters(slice: string): ScannedChapter[] {
  const chapters: ScannedChapter[] = [];
  let cursor = 0;
  while (cursor < slice.length) {
    CHAPTER_RE.lastIndex = cursor;
    const hit = CHAPTER_RE.exec(slice);
    if (!hit) break;
    const opener = hit[2];
    const openerAt = hit.index + hit[0].length - opener.length;
    const name = collapse(hit[1]);
    if (opener === '```') {
      const fence = readFence(slice, openerAt);
      if ('kind' in fence) {
        cursor = openerAt + 3;
        continue;
      }
      chapters.push({
        name,
        value: slice.slice(fence.valueStart, fence.valueEnd),
        valueKind: 'code_fence',
        fenceLang: fence.lang || undefined,
        headerStart: hit.index,
        bodyStart: fence.valueStart,
        bodyEnd: fence.valueEnd,
        end: fence.close + 3,
      });
      cursor = fence.close + 3;
      continue;
    }
    if (opener === '((') {
      const close = findClosingDouble(slice, openerAt);
      if (typeof close !== 'number') {
        cursor = openerAt + 2;
        continue;
      }
      chapters.push({
        name,
        value: slice.slice(openerAt + 2, close),
        valueKind: 'double_paren',
        headerStart: hit.index,
        bodyStart: openerAt + 2,
        bodyEnd: close,
        end: close + 2,
      });
      cursor = close + 2;
      continue;
    }
    const close = findClosingParen(slice, openerAt);
    if (typeof close !== 'number') {
      cursor = openerAt + 1;
      continue;
    }
    const innerStart = openerAt + 1;
    const fenceAt = indexOfFence(slice, innerStart, close);
    if (fenceAt >= 0) {
      const fence = readFence(slice, fenceAt);
      if (!('kind' in fence) && fence.close < close) {
        chapters.push({
          name,
          value: slice.slice(fence.valueStart, fence.valueEnd),
          valueKind: 'code_fence',
          fenceLang: fence.lang || undefined,
          headerStart: hit.index,
          bodyStart: fence.valueStart,
          bodyEnd: fence.valueEnd,
          end: close + 1,
        });
        cursor = close + 1;
        continue;
      }
    }
    chapters.push({
      name,
      value: slice.slice(innerStart, close),
      valueKind: 'paren',
      headerStart: hit.index,
      bodyStart: innerStart,
      bodyEnd: close,
      end: close + 1,
    });
    cursor = close + 1;
  }
  return chapters;
}

function indexOfFence(text: string, start: number, end: number): number {
  const at = text.slice(start, end).search(/```/);
  return at < 0 ? -1 : start + at;
}

export interface BodyRange {
  name: string;
  headerStart: number;
  bodyStart: number;
  bodyEnd: number;
}

/** Chapter ranges inside one section slice. Offsets are relative to `slice`. */
export function chapterBodyRanges(slice: string): BodyRange[] {
  return scanChapters(slice).map((chapter) => ({
    name: chapter.name,
    headerStart: chapter.headerStart,
    bodyStart: chapter.bodyStart,
    bodyEnd: chapter.bodyEnd,
  }));
}

function lineEndOffset(body: string, index: number): number {
  const nl = body.indexOf('\n', index);
  return nl === -1 ? body.length : nl + 1;
}

function addFail(list: Diagnostic[], fail: Fail, body: string, braceAt: number) {
  list.push(diagnostic(fail.kind, lineOf(body, fail.failAt)));
  if (fail.kind !== 'unclosed_brace') list.push(diagnostic('unclosed_brace', lineOf(body, braceAt)));
}

function scanLoose(body: string, covered: { start: number; end: number }[], existing: Diagnostic[]): Diagnostic[] {
  const extra: Diagnostic[] = [];
  const seen = new Set(existing.map((item) => `${item.kind}:${item.line}`));
  const skip = covered.slice().sort((a, b) => a.start - b.start);
  let i = 0;
  while (i < body.length) {
    const cover = skip.find((range) => i >= range.start && i < range.end);
    if (cover) {
      i = cover.end;
      continue;
    }
    let fail: Fail | null = null;
    let next = i + 1;
    if (body.startsWith('```', i)) {
      const fence = readFence(body, i);
      if ('kind' in fence) fail = fence;
      else next = fence.close + 3;
    } else if (body.startsWith('((', i)) {
      const close = findClosingDouble(body, i);
      if (typeof close !== 'number') fail = close;
      else next = close + 2;
    } else if (body[i] === '(') {
      const close = findClosingParen(body, i);
      if (typeof close !== 'number') fail = close;
      else next = close + 1;
    }
    if (fail) {
      const item = diagnostic(fail.kind, lineOf(body, fail.failAt));
      const key = `${item.kind}:${item.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        extra.push(item);
      }
      i = fail.failAt + (fail.kind === 'unclosed_fence' ? 3 : fail.kind === 'unclosed_double_paren' ? 2 : 1);
      continue;
    }
    i = next;
  }
  return extra;
}

export function parseDocument(body: string): DocumentAST {
  const diagnostics: Diagnostic[] = [];
  const blocks: { start: number; end: number; node: BlockNode }[] = [];
  let i = 0;
  while (i < body.length) {
    const nl = body.indexOf('\n', i);
    const lineEnd = nl === -1 ? body.length : nl;
    const line = body.slice(i, lineEnd).replace(/\r$/, '');
    const header = matchHeaderLine(line);
    if (!header) {
      i = nl === -1 ? body.length : nl + 1;
      continue;
    }
    const openOffset = i + header.braceIndex;
    const close = findClosingBrace(body, openOffset);
    if (typeof close !== 'number') {
      addFail(diagnostics, close, body, openOffset);
      i = nl === -1 ? body.length : nl + 1;
      continue;
    }
    const startOffset = offsetOfLine(body, lineOf(body, i));
    const endOffset = lineEndOffset(body, close);
    const raw = body.slice(startOffset, endOffset);
    const inner = body.slice(openOffset + 1, close);
    const scanned = scanChapters(inner);
    const chapters: ChapterNode[] = scanned.map((chapter) => {
      const start = openOffset + 1 + chapter.bodyStart;
      const end = openOffset + 1 + chapter.bodyEnd;
      return {
        name: chapter.name,
        value: chapter.value,
        valueKind: chapter.valueKind,
        fenceLang: chapter.fenceLang,
        startOffset: start,
        endOffset: end,
        lineStart: lineOf(body, start),
        lineEnd: lineOf(body, Math.max(start, end - 1)),
      };
    });
    const tags = dedupe([...header.tags, ...extractTags(raw)]);
    const mentions = dedupe([...header.mentions, ...extractMentions(raw)]);
    const lineStart = lineOf(body, startOffset);
    const node: BlockNode = {
      kind: 'block',
      id: `${lineStart}:${header.keyword}:${header.subClass ?? ''}`,
      keyword: header.keyword,
      subClass: header.subClass ?? undefined,
      route: header.route ?? undefined,
      tags,
      mentions,
      chapters,
      startOffset,
      endOffset,
      lineStart,
      lineEnd: lineOf(body, close),
      raw,
    };
    blocks.push({ start: startOffset, end: endOffset, node });
    i = endOffset;
  }
  const covered = blocks.map((block) => ({ start: block.start, end: block.end }));
  diagnostics.push(...scanLoose(body, covered, diagnostics));
  const nodes: AstNode[] = [];
  let cursor = 0;
  for (const block of blocks) {
    if (block.start > cursor) {
      nodes.push({ kind: 'plain', text: body.slice(cursor, block.start), startOffset: cursor, endOffset: block.start });
    }
    nodes.push(block.node);
    cursor = block.end;
  }
  if (cursor < body.length || !nodes.length) {
    nodes.push({ kind: 'plain', text: body.slice(cursor), startOffset: cursor, endOffset: body.length });
  }
  diagnostics.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
  return { nodes, diagnostics: dedupeDiagnostics(diagnostics) };
}

function dedupeDiagnostics(list: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const item of list) {
    const key = `${item.kind}:${item.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function toSection(node: BlockNode): ParsedSection {
  return {
    id: node.id,
    keyword: node.keyword,
    subClass: node.subClass ?? null,
    route: node.route ?? null,
    tags: node.tags,
    mentions: node.mentions,
    headerTags: extractTags(node.raw.slice(0, node.raw.indexOf('{'))),
    headerMentions: extractMentions(node.raw.slice(0, node.raw.indexOf('{'))),
    chapters: node.chapters.map((chapter) => ({
      name: chapter.name,
      body: chapter.value,
      value: chapter.value,
      valueKind: chapter.valueKind,
      fenceLang: chapter.fenceLang,
      startOffset: chapter.startOffset,
      endOffset: chapter.endOffset,
      lineStart: chapter.lineStart,
      lineEnd: chapter.lineEnd,
    })),
    lineStart: node.lineStart,
    lineEnd: node.lineEnd,
    startOffset: node.startOffset,
    endOffset: node.endOffset,
    raw: node.raw,
  };
}

export function parseNoteBody(body: string): { sections: ParsedSection[]; keywords: string[]; tags: string[]; mentions: string[]; diagnostics: Diagnostic[] } {
  const doc = parseDocument(body);
  const sections = doc.nodes.filter((node): node is BlockNode => node.kind === 'block').map(toSection);
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const key = section.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(section.keyword);
  }
  return {
    sections,
    keywords,
    tags: extractTags(body),
    mentions: extractMentions(body),
    diagnostics: doc.diagnostics,
  };
}

export function sectionOffsets(body: string, section: ParsedSection): { start: number; end: number } {
  if (Number.isFinite(section.startOffset) && Number.isFinite(section.endOffset) && section.endOffset >= section.startOffset) {
    return { start: section.startOffset, end: section.endOffset };
  }
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
  const section = sections.find((item) => item.lineStart === lineStart);
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
