import { describe, expect, it } from 'vitest';
import { addHighlightWord, colorForIndex, findOccurrences, removeHighlightWord, rulerFraction, wordAt } from '../src/core/highlight';

const TEXT = 'Practice the practice lab. Practice ports.';

describe('multi-word highlights', () => {
  it('finds every whole-word occurrence and assigns distinct colors', () => {
    const words = addHighlightWord(addHighlightWord([], 'Practice'), 'lab');
    expect(words).toEqual(['practice', 'lab']);
    const hits = findOccurrences(TEXT, words);
    const practice = hits.filter((hit) => hit.word === 'practice');
    expect(practice).toHaveLength(3);
    expect(practice.map((hit) => TEXT.slice(hit.start, hit.end).toLowerCase())).toEqual(['practice', 'practice', 'practice']);
    expect(hits.find((hit) => hit.word === 'lab')?.start).toBe(TEXT.toLowerCase().indexOf('lab'));
    expect(practice[0].wash).not.toBe(hits.find((hit) => hit.word === 'lab')?.wash);
    expect(colorForIndex(0).mark).not.toBe(colorForIndex(1).mark);
    const fractions = practice.map((hit) => rulerFraction(hit.start, TEXT.length));
    expect(fractions[0]).toBeLessThan(fractions[1]);
    expect(fractions[2]).toBeLessThanOrEqual(1);
  });

  it('does not match inside a longer word and can clear one highlight', () => {
    expect(findOccurrences('practical practice', ['practice']).map((hit) => hit.start)).toEqual(['practical practice'.indexOf('practice', 1)]);
    expect(removeHighlightWord(['practice', 'lab'], 'Practice')).toEqual(['lab']);
    expect(wordAt(TEXT, 1)?.word.toLowerCase()).toBe('practice');
    expect(wordAt(TEXT, TEXT.length + 2)).toBeNull();
  });
});
