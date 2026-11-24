import { describe, expect, it } from 'vitest';
import { applyCommands, applyEdits, applyRules, keptSeconds, mergeChunks, peaks, postProcess, resample, wipe } from '../src/core/dictation';

describe('voice dictation helpers', () => {
  it('wipes buffers and zeroes chunks after a merge', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([3]);
    const chunks = [a, b];
    const merged = mergeChunks(chunks);
    expect([...merged]).toEqual([1, 2, 3]);
    expect([...a, ...b]).toEqual([0, 0, 0]);
    expect(chunks).toHaveLength(0);
    wipe(merged);
    expect([...merged]).toEqual([0, 0, 0]);
    wipe(null, undefined);
  });

  it('trims and cuts a middle range without touching the source buffer', () => {
    const audio = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const copy = audio.slice();
    const out = applyEdits(audio, { start: 0, end: 1 }, [{ start: 0.3, end: 0.5 }], 10);
    expect([...out]).toEqual([0, 1, 2, 5, 6, 7, 8, 9]);
    expect([...audio]).toEqual([...copy]);
    expect(keptSeconds({ start: 0, end: 1 }, [{ start: 0.3, end: 0.5 }])).toBeCloseTo(0.8);
    const trimmed = applyEdits(audio, { start: 0.2, end: 0.5 }, [], 10);
    expect([...trimmed]).toEqual([2, 3, 4]);
    expect(peaks(audio, 5)[0]).toBe(1);
  });

  it('resamples by linear interpolation', () => {
    const input = new Float32Array([0, 10]);
    const out = resample(input, 2, 4);
    expect(out.length).toBe(4);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(5);
  });

  it('applies dictionary phrases before spoken commands', () => {
    const rules = [{ from: 'job scout', to: 'the desk' }, { from: 'scout', to: 'skip' }];
    expect(applyRules('Ask the job scout tomorrow', rules)).toBe('Ask the the desk tomorrow');
    expect(applyRules('visit new york', [{ from: 'york', to: 'Yorkshire' }, { from: 'new york', to: 'NYC' }])).toBe('visit NYC');
    const commanded = applyCommands('hello new line world period next line done question mark');
    expect(commanded).toContain('\n');
    expect(commanded).toContain('.');
    expect(commanded).toContain('?');
    const processed = postProcess('ask job scout new paragraph status colon ready [BLANK_AUDIO]', rules, true);
    expect(processed.startsWith('Ask the desk')).toBe(true);
    expect(processed).toContain('\n');
    expect(processed).not.toContain('BLANK_AUDIO');
    expect(postProcess('comma please', [], false)).not.toBe(', Please');
  });

  it('covers the spoken punctuation commands', () => {
    const raw = 'open quote hi close quote exclamation mark wait semicolon go colon stop dash end';
    const text = applyCommands(raw);
    expect(text).toContain('"');
    expect(text).toContain('!');
    expect(text).toContain(';');
    expect(text).toContain(':');
    expect(text).toContain(' - ');
  });
});
