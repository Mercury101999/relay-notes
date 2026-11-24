import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exampleWorkspace } from '../src/core/example';
import { exportWorkspace, importWorkspace } from '../src/core/export';
import { emptyWorkspace } from '../src/core/factory';
import { deleteFolder, moveFolder, wouldCycle } from '../src/core/folders';
import { isVoicePath, shouldPrecache, VOICE_CACHE } from '../src/core/precache';
import { parseRoute, routeHash } from '../src/core/routes';
import { summarize } from '../src/core/summary';
import { planNoteSync } from '../src/core/sync';

describe('workspace helpers', () => {
  it('ships fictional example data and keeps local notes out of a push', () => {
    const ws = exampleWorkspace(Date.parse('2026-11-24T00:00:00.000Z'));
    expect(JSON.stringify(ws)).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
    expect(ws.bots.map((bot) => bot.name)).toEqual(expect.arrayContaining(['Inbox Triage', 'Code Partner', 'Study Coach', 'Research Desk']));
    expect(ws.notes.some((note) => note.sync_mode === 'local')).toBe(true);
    const summary = summarize(ws);
    expect(summary).toMatchObject({ bots: 6, activeBots: 3, raw: 1, staged: 2, approved: 1 });
    const plan = planNoteSync(ws.notes, ws.notes.map((note) => ({ id: note.id })));
    expect(plan.push.some((note) => note.sync_mode === 'local')).toBe(false);
  });

  it('round-trips export and refuses a service role key', () => {
    const ws = exampleWorkspace(Date.parse('2026-11-24T00:00:00.000Z'));
    const json = exportWorkspace(ws, '2026-11-24T00:00:00.000Z');
    const imported = importWorkspace(json, emptyWorkspace());
    expect(imported.notes).toHaveLength(ws.notes.length);
    expect(imported.notes.find((note) => note.title === 'Practice syntax')?.parsed_sections.length).toBeGreaterThan(0);
    expect(json).not.toContain('service_role');
    expect(() => importWorkspace(JSON.stringify({ version: 1, service_role: 'nope', folders: [], bots: [], notes: [], queue_items: [] }), emptyWorkspace())).toThrow(/service role/i);
    expect(() => importWorkspace('{', emptyWorkspace())).toThrow(/JSON/);
  });

  it('reorders and deletes folders without cycles', () => {
    const ws = exampleWorkspace();
    expect(wouldCycle(ws.folders, ws.folders[0].id, ws.folders[1].id)).toBe(true);
    const moved = moveFolder(ws.folders, ws.folders[2].id, -1, '2026-11-24T00:00:00.000Z');
    const siblings = moved.filter((folder) => folder.parent_id === ws.folders[0].id).sort((a, b) => a.sort_order - b.sort_order);
    expect(siblings[0].id).toBe(ws.folders[2].id);
    const removed = deleteFolder(ws.folders, ws.notes, ws.folders[0].id, '2026-11-24T00:00:00.000Z');
    expect(removed.removed.length).toBeGreaterThan(1);
    expect(removed.notes.some((note) => note.folder_id === ws.folders[1].id)).toBe(false);
  });

  it('parses hashes', () => {
    expect(parseRoute('')).toEqual({ page: 'home' });
    expect(parseRoute('#/notes/keyword')).toEqual({ page: 'notes', panel: 'keyword' });
    expect(parseRoute('#/note/abc')).toEqual({ page: 'notes', noteId: 'abc' });
    expect(parseRoute('#/queue/staged')).toEqual({ page: 'queue', tab: 'staged' });
    expect(routeHash({ page: 'bots', botId: 'a b' })).toBe('#/bot/a%20b');
    expect(parseRoute(routeHash({ page: 'queue', tab: 'history' }))).toEqual({ page: 'queue', tab: 'history' });
  });

  it('keeps voice models out of the app-shell precache and on disk', () => {
    expect(isVoicePath('models/whisper-tiny.en/onnx/encoder_model_quantized.onnx')).toBe(true);
    expect(shouldPrecache('ort/ort-wasm-simd-threaded.wasm')).toBe(false);
    expect(shouldPrecache('assets/index.js')).toBe(true);
    expect(shouldPrecache('sw.js')).toBe(false);
    expect(VOICE_CACHE).toBe('relay-voice-v1');
    for (const file of [
      'public/models/whisper-tiny.en/config.json',
      'public/models/whisper-tiny.en/tokenizer.json',
      'public/models/whisper-tiny.en/onnx/encoder_model_quantized.onnx',
      'public/models/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx',
      'public/ort/ort-wasm-simd-threaded.mjs',
      'public/ort/ort-wasm-simd-threaded.wasm',
      'public/pcm-worklet.js',
    ]) {
      expect(statSync(file).size).toBeGreaterThan(200);
    }
    expect(statSync('public/models/whisper-tiny.en/onnx/encoder_model_quantized.onnx').size).toBeGreaterThan(1_000_000);
    expect(statSync('public/ort/ort-wasm-simd-threaded.wasm').size).toBeGreaterThan(1_000_000);
  });
});
