/** Pure helpers for on-device dictation: audio buffers (in memory only) and text post-processing. */

export const SAMPLE_RATE = 16_000;

/** Overwrites float buffers with zeros (best effort release). */
export function wipe(...arrays: (Float32Array | null | undefined)[]) {
  for (const array of arrays) if (array && array.buffer.byteLength) array.fill(0);
}

/** Joins captured chunks into one buffer and zeroes the chunks. */
export function mergeChunks(chunks: Float32Array[]): Float32Array {
  let n = 0;
  for (const chunk of chunks) n += chunk.length;
  const out = new Float32Array(n);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
    chunk.fill(0);
  }
  chunks.length = 0;
  return out;
}

/** Linear-interpolation resampler to 16 kHz (Whisper's input rate). */
export function resample(input: Float32Array, fromRate: number, toRate = SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const n = Math.max(0, Math.floor(input.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const f = x - i0;
    const a = input[i0] ?? 0;
    const b = i0 + 1 < input.length ? input[i0 + 1] : a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

export interface Range {
  start: number;
  end: number;
}

/** Keeps [keep.start, keep.end] minus the cut ranges. Returns a new buffer; the input is untouched. */
export function applyEdits(audio: Float32Array, keep: Range, cuts: Range[], rate = SAMPLE_RATE): Float32Array {
  const s0 = Math.max(0, Math.floor(keep.start * rate));
  const s1 = Math.min(audio.length, Math.ceil(keep.end * rate));
  const sorted = cuts
    .map((cut) => {
      const a = Math.max(s0, Math.floor(Math.min(cut.start, cut.end) * rate));
      const b = Math.min(s1, Math.ceil(Math.max(cut.start, cut.end) * rate));
      return [a, b] as [number, number];
    })
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const segs: [number, number][] = [];
  let cursor = s0;
  for (const [a, b] of sorted) {
    if (a > cursor) segs.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (s1 > cursor) segs.push([cursor, s1]);
  const out = new Float32Array(segs.reduce((n, [a, b]) => n + (b - a), 0));
  let offset = 0;
  for (const [a, b] of segs) {
    out.set(audio.subarray(a, b), offset);
    offset += b - a;
  }
  return out;
}

export function keptSeconds(keep: Range, cuts: Range[]): number {
  let total = Math.max(0, keep.end - keep.start);
  const spans = cuts
    .map((cut) => [Math.max(keep.start, Math.min(cut.start, cut.end)), Math.min(keep.end, Math.max(cut.start, cut.end))] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let cursor = keep.start;
  for (const [a, b] of spans) {
    const start = Math.max(a, cursor);
    if (b > start) total -= b - start;
    cursor = Math.max(cursor, b);
  }
  return Math.max(0, total);
}

/** Peak envelope for drawing a waveform. */
export function peaks(audio: Float32Array, buckets: number): Float32Array {
  const count = Math.max(1, buckets);
  const out = new Float32Array(count);
  const per = audio.length / count;
  for (let i = 0; i < count; i++) {
    let max = 0;
    const a = Math.floor(i * per);
    const b = Math.min(audio.length, Math.floor((i + 1) * per));
    for (let j = a; j < b; j++) {
      const value = Math.abs(audio[j]);
      if (value > max) max = value;
    }
    out[i] = max;
  }
  return out;
}

export interface Rule {
  from: string;
  to: string;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** User dictionary: whole-word/phrase, case-insensitive. Longer phrases first. */
export function applyRules(text: string, rules: Rule[]): string {
  const list = rules.filter((rule) => rule.from.trim()).sort((a, b) => b.from.length - a.from.length);
  let next = text;
  for (const rule of list) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(rule.from.trim()).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
    next = next.replace(re, rule.to);
  }
  return next;
}

const PUNCT = String.raw`[\s,.;:!?]*`;
const COMMANDS: [RegExp, string][] = [
  [new RegExp(`[\\s,]*\\bnew paragraph\\b${PUNCT}`, 'gi'), '\n\n'],
  [new RegExp(`[\\s,]*\\b(?:new line|next line|line break)\\b${PUNCT}`, 'gi'), '\n'],
  [new RegExp(`[\\s,]*\\b(?:period|full stop)\\b[\\s,.]*`, 'gi'), '. '],
  [new RegExp(`[\\s,]*\\bcomma\\b[\\s,.]*`, 'gi'), ', '],
  [new RegExp(`[\\s,]*\\bquestion mark\\b[\\s,.?]*`, 'gi'), '? '],
  [new RegExp(`[\\s,]*\\bexclamation (?:mark|point)\\b[\\s,.!]*`, 'gi'), '! '],
  [new RegExp(`[\\s,]*\\bsemicolon\\b[\\s,.]*`, 'gi'), '; '],
  [new RegExp(`[\\s,]*\\bcolon\\b[\\s,.]*`, 'gi'), ': '],
  [new RegExp(`[\\s,]*\\b(?:dash|hyphen)\\b[\\s,.]*`, 'gi'), ' - '],
  [new RegExp(`[\\s,]*\\bopen quote\\b[\\s,.]*`, 'gi'), ' "'],
  [new RegExp(`[\\s,]*\\bclose quote\\b[\\s,.]*`, 'gi'), '" '],
];

export function applyCommands(text: string): string {
  let next = text;
  for (const [re, replacement] of COMMANDS) next = next.replace(re, replacement);
  return next;
}

/** Block-structure phrases. Applied after tidy so the inserted whitespace survives. */
export function applyStructureCommands(text: string): string {
  return text
    .replace(/\bopen block\b/gi, 'Keyword : SubClass {\n  chapter: (')
    .replace(/\bnew chapter\b/gi, '\n  chapter: (')
    .replace(/\bend block\b/gi, '\n}\n');
}

export const SPOKEN_COMMANDS: { phrase: string; effect: string }[] = [
  { phrase: 'new line', effect: 'Insert a line break' },
  { phrase: 'new paragraph', effect: 'Insert a blank line' },
  { phrase: 'period', effect: 'Insert a period' },
  { phrase: 'comma', effect: 'Insert a comma' },
  { phrase: 'question mark', effect: 'Insert a question mark' },
  { phrase: 'open block', effect: 'Start a Keyword : SubClass block' },
  { phrase: 'new chapter', effect: 'Insert a chapter line' },
  { phrase: 'end block', effect: 'Close the open block' },
];

/** Spacing and capitalisation cleanup. */
export function tidy(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=[^\s\n"])/g, '$1 ')
    .replace(/([.!?])\1+/g, '$1')
    .replace(/[,;:]+([.!?])/g, '$1')
    .replace(/ *\n */g, '\n')
    .replace(/(^|[.!?]\s+|\n)(["(]?)(\p{Ll})/gu, (_all, a: string, q: string, c: string) => a + q + c.toUpperCase())
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function postProcess(raw: string, rules: Rule[], commands: boolean): string {
  let text = raw.replace(/\[(?:BLANK_AUDIO|MUSIC|NOISE|INAUDIBLE)\]|\((?:music|silence)\)/gi, ' ').trim();
  text = applyRules(text, rules);
  if (commands) text = applyCommands(text);
  text = tidy(text);
  if (commands) text = applyStructureCommands(text);
  return text;
}
