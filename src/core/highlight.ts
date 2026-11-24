export interface HighlightColor {
  wash: string;
  mark: string;
}

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { wash: 'rgba(45, 212, 191, 0.38)', mark: '#2dd4bf' },
  { wash: 'rgba(251, 191, 36, 0.42)', mark: '#fbbf24' },
  { wash: 'rgba(96, 165, 250, 0.42)', mark: '#60a5fa' },
  { wash: 'rgba(244, 114, 182, 0.42)', mark: '#f472b6' },
  { wash: 'rgba(167, 139, 250, 0.42)', mark: '#a78bfa' },
  { wash: 'rgba(74, 222, 128, 0.40)', mark: '#4ade80' },
  { wash: 'rgba(251, 146, 60, 0.42)', mark: '#fb923c' },
  { wash: 'rgba(248, 113, 113, 0.40)', mark: '#f87171' },
];

export function colorForIndex(index: number): HighlightColor {
  if (index < HIGHLIGHT_COLORS.length) return HIGHLIGHT_COLORS[index];
  const hue = (index * 47) % 360;
  return { wash: `hsla(${hue}, 78%, 62%, 0.40)`, mark: `hsl(${hue}, 78%, 62%)` };
}

export interface Occurrence {
  word: string;
  wash: string;
  mark: string;
  start: number;
  end: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

export function addHighlightWord(words: string[], word: string): string[] {
  const next = normalizeWord(word);
  if (!next) return words;
  if (words.some((item) => normalizeWord(item) === next)) return words;
  return [...words, next];
}

export function removeHighlightWord(words: string[], word: string): string[] {
  const next = normalizeWord(word);
  return words.filter((item) => normalizeWord(item) !== next);
}

export function findOccurrences(text: string, words: string[]): Occurrence[] {
  const out: Occurrence[] = [];
  words.forEach((word, index) => {
    const needle = normalizeWord(word);
    if (!needle) return;
    const color = colorForIndex(index);
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'giu');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      out.push({
        word: needle,
        wash: color.wash,
        mark: color.mark,
        start: match.index,
        end: match.index + match[0].length,
      });
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  });
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

export function rulerFraction(start: number, length: number): number {
  if (length <= 1) return 0;
  return Math.min(1, Math.max(0, start / length));
}

export function wordAt(text: string, index: number): { word: string; start: number; end: number } | null {
  if (!text || index < 0 || index > text.length) return null;
  const re = /\p{L}[\p{L}\p{N}'’-]*|\p{N}+/gu;
  let match: RegExpExecArray | null;
  const probe = Math.min(index, Math.max(0, text.length - 1));
  while ((match = re.exec(text))) {
    const start = match.index;
    const end = start + match[0].length;
    if (probe >= start && probe < end) return { word: match[0], start, end };
    if (start > probe) break;
  }
  return null;
}

export function cycleIndex(current: number, length: number, dir: 1 | -1): number {
  if (length <= 0) return 0;
  return (current + dir + length) % length;
}
