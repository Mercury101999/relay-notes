export type WrapKind = 'block' | 'chapter' | 'check' | 'code' | 'route';

export interface WrapResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function lineBounds(text: string, index: number): { start: number; end: number; line: string } {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const next = text.indexOf('\n', index);
  const end = next === -1 ? text.length : next;
  return { start, end, line: text.slice(start, end) };
}

export function wrapSelection(body: string, start: number, end: number, kind: WrapKind): WrapResult {
  const from = clamp(Math.min(start, end), body.length);
  const to = clamp(Math.max(start, end), body.length);
  const selected = body.slice(from, to);
  if (kind === 'block') {
    const inner = selected || '';
    const insert = `Keyword : SubClass {\n  chapter: (${inner})\n}\n`;
    const cursor = from + insert.indexOf('(') + 1;
    const text = body.slice(0, from) + insert + body.slice(to);
    return { text, selectionStart: cursor, selectionEnd: cursor + inner.length };
  }
  if (kind === 'chapter') {
    const insert = `key: (${selected})`;
    const cursor = from + insert.indexOf('(') + 1;
    const text = body.slice(0, from) + insert + body.slice(to);
    return { text, selectionStart: cursor, selectionEnd: cursor + selected.length };
  }
  if (kind === 'check') {
    if (!selected) {
      const insert = '- [ ] ';
      const text = body.slice(0, from) + insert + body.slice(to);
      return { text, selectionStart: from + insert.length, selectionEnd: from + insert.length };
    }
    const lines = selected.split('\n');
    const next = lines.map((line) => (line.trim() && !line.trimStart().startsWith('- [ ]') ? `- [ ] ${line.replace(/^\s*/, '')}` : line)).join('\n');
    const text = body.slice(0, from) + next + body.slice(to);
    return { text, selectionStart: from, selectionEnd: from + next.length };
  }
  if (kind === 'code') {
    const unbalanced = (selected.match(/\{/g)?.length ?? 0) !== (selected.match(/\}/g)?.length ?? 0)
      || (selected.match(/\(/g)?.length ?? 0) !== (selected.match(/\)/g)?.length ?? 0)
      || selected.includes('```');
    const insert = unbalanced || selected.includes('```')
      ? `code: ((${selected}))`
      : `code: \`\`\`\n${selected}\n\`\`\``;
    const text = body.slice(0, from) + insert + body.slice(to);
    const origin = unbalanced || selected.includes('```') ? insert.indexOf('((') + 2 : insert.indexOf('\n') + 1;
    return { text, selectionStart: from + origin, selectionEnd: from + origin + selected.length };
  }
  const bounds = lineBounds(body, from);
  const header = /^[ \t]*[A-Za-z].*\{/.test(bounds.line) && !bounds.line.includes('->');
  if (header) {
    const brace = bounds.line.indexOf('{');
    const at = bounds.start + brace;
    const insert = ' -> Folder / Note / Section';
    const text = body.slice(0, at) + insert + body.slice(at);
    return { text, selectionStart: at + 4, selectionEnd: at + insert.length };
  }
  const insert = ' -> Folder / Note / Section';
  const text = body.slice(0, from) + insert + body.slice(to);
  return { text, selectionStart: from + 4, selectionEnd: from + insert.length };
}
