/**
 * On-device voice typing: record -> trim/cut -> transcribe locally (Whisper) -> review -> insert.
 * Audio lives only in memory (Float32Arrays), is never written to storage, and is zeroed when the
 * text is accepted, discarded, or the modal closes.
 */
import { SAMPLE_RATE, applyEdits, keptSeconds, mergeChunks, peaks, postProcess, resample, wipe, type Range, type Rule } from '../core/dictation';
import { VOICE_CACHE } from '../core/precache';
import { toast } from '../ui/toast';

export const MODEL_FILES = [
  'models/whisper-tiny.en/onnx/encoder_model_quantized.onnx',
  'models/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx',
  'ort/ort-wasm-simd-threaded.wasm',
];
export const MODEL_LABEL = 'Whisper tiny.en (8-bit), about 56 MB including the runtime';
const MAX_SECONDS = 300;

export function appBase(): string {
  return new URL('./', document.baseURI).href;
}

type WorkerMsg =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; ms: number }
  | { type: 'transcribing' }
  | { type: 'result'; text: string; ms: number; seconds: number }
  | { type: 'error'; message: string };

let worker: Worker | null = null;
let listener: ((message: WorkerMsg) => void) | null = null;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../voiceWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => listener?.(event.data as WorkerMsg);
    worker.onerror = (event) => listener?.({ type: 'error', message: event.message || 'Voice engine failed to start' });
  }
  return worker;
}

function killWorker() {
  worker?.terminate();
  worker = null;
  listener = null;
}

export function prepareModel(onProgress: (fraction: number) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    listener = (message) => {
      if (message.type === 'progress') onProgress(message.total ? message.loaded / message.total : 0);
      else if (message.type === 'ready') {
        listener = null;
        resolve(message.ms);
      } else if (message.type === 'error') {
        listener = null;
        reject(new Error(message.message));
      }
    };
    getWorker().postMessage({ type: 'load', base: appBase() });
  });
}

export async function modelCached(): Promise<boolean> {
  if (!('caches' in self)) return false;
  const cache = await caches.open(VOICE_CACHE);
  for (const file of MODEL_FILES) {
    if (!(await cache.match(new URL(file, appBase()).href))) return false;
  }
  return true;
}

export async function removeModel() {
  killWorker();
  await caches.delete(VOICE_CACHE);
}

export const voiceSupported = () => typeof navigator.mediaDevices?.getUserMedia === 'function'
  && (typeof AudioWorkletNode !== 'undefined' || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined' || typeof AudioContext !== 'undefined')
  && typeof WebAssembly !== 'undefined';

let active: VoiceSession | null = null;

export function abortVoice() {
  active?.destroy();
  active = null;
  killWorker();
}

export interface VoiceOptions {
  rules: Rule[];
  commands: boolean;
  onInsert: (text: string) => void;
  presetAudio?: Float32Array;
}

export function openVoice(options: VoiceOptions) {
  if (!options.presetAudio && !voiceSupported()) {
    toast('Voice typing needs a microphone and WebAssembly in this browser');
    return;
  }
  active?.destroy();
  active = new VoiceSession(options);
}

/** Opens the trim editor on a short in-memory tone. Nothing is stored. */
export function openTrimPreview(options: Omit<VoiceOptions, 'presetAudio'>) {
  const rate = SAMPLE_RATE;
  const n = rate * 2;
  const audio = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = 0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * 2 * t));
    audio[i] = Math.sin(2 * Math.PI * 196 * t) * 0.45 * env
      + Math.sin(2 * Math.PI * 740 * t) * 0.12 * (t > 0.7 && t < 1.25 ? 1 : 0.25);
  }
  openVoice({ ...options, presetAudio: audio });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === false || value == null) {
      /* skip */
    } else if (key in node && key !== 'list') {
      try { (node as unknown as Record<string, unknown>)[key] = value; } catch { node.setAttribute(key, String(value)); }
    } else node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

class VoiceSession {
  private root: HTMLElement;
  private body: HTMLElement;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private audio: Float32Array | null = null;
  private keep: Range = { start: 0, end: 0 };
  private cuts: Range[] = [];
  private timer = 0;
  private dead = false;
  private player: { ctx: AudioContext; buf: AudioBuffer; src: AudioBufferSourceNode } | null = null;

  constructor(private options: VoiceOptions) {
    this.body = el('div', { class: 'voice-body' });
    this.root = el('div', { class: 'modal-wrap voice-wrap', 'data-testid': 'voice-modal' },
      el('div', { class: 'modal voice', role: 'dialog', 'aria-label': 'Voice typing' },
        el('div', { class: 'row' },
          el('h3', { class: 'grow', text: 'Voice typing' }),
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Discard', onclick: () => this.close() }, 'Close')),
        this.body,
        el('p', { class: 'muted small', text: 'Transcribed on this device. Audio stays in memory only and is erased when you finish.' })));
    document.body.append(this.root);
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
    if (options.presetAudio) {
      this.audio = options.presetAudio;
      this.keep = { start: 0, end: this.audio.length / SAMPLE_RATE };
      this.cuts = [];
      this.trim();
      return;
    }
    void this.record();
  }

  private close() {
    this.destroy();
    if (active === this) active = null;
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    window.clearInterval(this.timer);
    this.stopMic();
    this.stopPreview();
    for (const chunk of this.chunks) chunk.fill(0);
    this.chunks.length = 0;
    wipe(this.audio);
    this.audio = null;
    this.root.remove();
  }

  private stopMic() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    try { this.node?.disconnect(); } catch { /* already stopped */ }
    this.node = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private async record() {
    this.body.replaceChildren();
    this.body.append(el('p', { class: 'muted', text: 'Waiting for the microphone…' }));
    let rate = SAMPLE_RATE;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.dead) {
        this.stopMic();
        return;
      }
      this.ctx = new AudioContext();
      rate = this.ctx.sampleRate;
      const source = this.ctx.createMediaStreamSource(this.stream);
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      try {
        await this.ctx.audioWorklet.addModule(new URL('pcm-worklet.js', appBase()).href);
        const worklet = new AudioWorkletNode(this.ctx, 'pcm-capture');
        this.node = worklet;
        source.connect(worklet);
        worklet.connect(mute);
      } catch {
        const processor = this.ctx.createScriptProcessor(4096, 1, 1);
        this.node = processor;
        source.connect(processor);
        processor.onaudioprocess = (event) => {
          if (this.dead) return;
          const copy = new Float32Array(event.inputBuffer.getChannelData(0));
          this.consume(copy);
        };
      }
      mute.connect(this.ctx.destination);
    } catch (error) {
      this.stopMic();
      this.body.replaceChildren(
        el('p', { text: (error as Error).name === 'NotAllowedError' ? 'Microphone permission was denied.' : `Couldn’t start the microphone: ${(error as Error).message}` }),
        el('div', { class: 'row end' }, el('button', { class: 'btn ghost', type: 'button', onclick: () => this.close() }, 'Close')),
      );
      return;
    }
    if (this.node instanceof AudioWorkletNode) {
      this.node.port.onmessage = (event) => {
        if (event.data instanceof Float32Array) this.consume(event.data);
      };
    }
    const level = el('div', { class: 'level' }, el('span'));
    const clock = el('span', { class: 'clock', text: '0:00' });
    const started = performance.now();
    this.timer = window.setInterval(() => {
      const seconds = (performance.now() - started) / 1000;
      clock.textContent = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      if (seconds >= MAX_SECONDS) void stop();
    }, 250);
    const stop = async () => {
      window.clearInterval(this.timer);
      const node = this.node;
      if (node instanceof AudioWorkletNode) {
        await new Promise<void>((resolve) => {
          const previous = node.port.onmessage;
          node.port.onmessage = (event) => {
            if (event.data === 'flushed') resolve();
            else previous?.call(node.port, event);
          };
          node.port.postMessage('flush');
          window.setTimeout(resolve, 500);
        });
      }
      this.stopMic();
      if (this.dead) return;
      const raw = mergeChunks(this.chunks);
      this.audio = resample(raw, rate, SAMPLE_RATE);
      wipe(raw);
      if (!this.audio || this.audio.length < SAMPLE_RATE * 0.3) {
        wipe(this.audio);
        this.audio = null;
        toast('Nothing recorded');
        void this.record();
        return;
      }
      this.keep = { start: 0, end: this.audio.length / SAMPLE_RATE };
      this.cuts = [];
      this.trim();
    };
    this.body.replaceChildren(
      el('div', { class: 'rec' }, el('span', { class: 'rec-dot' }), el('span', { text: 'Recording' }), clock),
      level,
      el('p', { class: 'muted small', text: 'Up to 5 minutes. Audio is not saved.' }),
      el('div', { class: 'row end' },
        el('button', { class: 'btn ghost', type: 'button', onclick: () => this.close() }, 'Cancel'),
        el('button', { class: 'btn danger', type: 'button', onclick: () => void stop() }, 'Stop')),
    );
  }

  private consume(data: Float32Array) {
    this.chunks.push(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const bar = this.body.querySelector('.level > span') as HTMLElement | null;
    if (bar) bar.style.width = `${Math.min(100, Math.sqrt(sum / data.length) * 400)}%`;
  }

  private trim() {
    if (!this.audio) return;
    this.body.replaceChildren();
    const audio = this.audio;
    const duration = audio.length / SAMPLE_RATE;
    const canvas = el('canvas', { class: 'wave', 'data-testid': 'voice-trim', 'aria-label': 'Recording waveform. Drag the handles to trim. Drag across the middle to select a part to cut.' });
    const info = el('p', { class: 'muted small' });
    let selection: Range | null = null;
    const cutButton = el('button', { class: 'btn ghost', type: 'button', disabled: true, onclick: () => { if (selection) { this.cuts.push(selection); selection = null; draw(); } } }, 'Cut selection') as HTMLButtonElement;
    const undoButton = el('button', { class: 'btn ghost', type: 'button', onclick: () => { this.cuts.pop(); draw(); } }, 'Undo cut') as HTMLButtonElement;
    const playButton = el('button', { class: 'btn ghost', type: 'button', onclick: () => this.player ? this.stopPreview(playButton) : this.preview(playButton) }, 'Play') as HTMLButtonElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let envelope: Float32Array | null = null;
    const xOf = (time: number) => (time / duration) * canvas.width;
    const timeOf = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
    };
    const draw = () => {
      const width = canvas.clientWidth * dpr || 600;
      const height = 120 * dpr;
      if (canvas.width !== width) {
        canvas.width = width;
        canvas.height = height;
        envelope = peaks(audio, Math.floor(width / (2 * dpr)));
      }
      envelope ??= peaks(audio, Math.floor(width / (2 * dpr)));
      const context = canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, width, height);
      const barWidth = width / envelope.length;
      for (let i = 0; i < envelope.length; i++) {
        const time = ((i + 0.5) / envelope.length) * duration;
        const kept = time >= this.keep.start && time <= this.keep.end && !this.cuts.some((cut) => time >= Math.min(cut.start, cut.end) && time <= Math.max(cut.start, cut.end));
        const value = Math.max(1.5 * dpr, envelope[i] * height * 0.9);
        context.fillStyle = kept ? '#2dd4bf' : 'rgba(45, 212, 191, 0.18)';
        context.fillRect(i * barWidth + barWidth * 0.15, (height - value) / 2, barWidth * 0.7, value);
      }
      for (const cut of this.cuts) {
        context.fillStyle = 'rgba(248, 113, 113, 0.28)';
        context.fillRect(xOf(Math.min(cut.start, cut.end)), 0, xOf(Math.abs(cut.end - cut.start)), height);
      }
      if (selection) {
        context.fillStyle = 'rgba(251, 191, 36, 0.28)';
        context.fillRect(xOf(Math.min(selection.start, selection.end)), 0, xOf(Math.abs(selection.end - selection.start)), height);
      }
      context.fillStyle = 'rgba(0, 0, 0, 0.45)';
      context.fillRect(0, 0, xOf(this.keep.start), height);
      context.fillRect(xOf(this.keep.end), 0, width - xOf(this.keep.end), height);
      for (const time of [this.keep.start, this.keep.end]) {
        context.fillStyle = '#fbbf24';
        context.fillRect(xOf(time) - 1.5 * dpr, 0, 3 * dpr, height);
        context.beginPath();
        context.arc(xOf(time), height / 2, 7 * dpr, 0, Math.PI * 2);
        context.fill();
      }
      const kept = keptSeconds(this.keep, this.cuts);
      info.textContent = `Keeping ${kept.toFixed(1)} s of ${duration.toFixed(1)} s${this.cuts.length ? ` · ${this.cuts.length} cut${this.cuts.length > 1 ? 's' : ''}` : ''}`;
      cutButton.disabled = !selection || Math.abs(selection.end - selection.start) < 0.05;
      undoButton.disabled = !this.cuts.length;
    };
    let drag: 'start' | 'end' | 'sel' | null = null;
    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      const time = timeOf(event.clientX);
      const tolerance = (16 / canvas.getBoundingClientRect().width) * duration;
      if (Math.abs(time - this.keep.start) < tolerance) drag = 'start';
      else if (Math.abs(time - this.keep.end) < tolerance) drag = 'end';
      else {
        drag = 'sel';
        selection = { start: time, end: time };
      }
      draw();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const time = timeOf(event.clientX);
      if (drag === 'start') this.keep.start = Math.min(time, this.keep.end - 0.2);
      else if (drag === 'end') this.keep.end = Math.max(time, this.keep.start + 0.2);
      else if (selection) selection.end = time;
      draw();
    });
    canvas.addEventListener('pointerup', () => {
      if (drag === 'sel' && selection && Math.abs(selection.end - selection.start) < 0.05) selection = null;
      drag = null;
      draw();
    });
    this.body.append(
      canvas,
      info,
      el('p', { class: 'muted small', text: 'Drag the amber handles to trim the start and end. Drag across the middle to select a part, then cut it.' }),
      el('div', { class: 'row wrap' }, playButton, cutButton, undoButton),
      el('div', { class: 'row end wrap' },
        el('button', { class: 'btn ghost', type: 'button', onclick: () => { this.stopPreview(); wipe(this.audio); this.audio = null; if (this.options.presetAudio) this.close(); else void this.record(); } }, this.options.presetAudio ? 'Discard' : 'Re-record'),
        el('button', { class: 'btn primary', type: 'button', onclick: () => { this.stopPreview(); void this.transcribe(); } }, 'Transcribe')),
    );
    requestAnimationFrame(draw);
  }

  private preview(button: HTMLButtonElement) {
    if (!this.audio) return;
    const pcm = applyEdits(this.audio, this.keep, this.cuts);
    if (!pcm.length) {
      wipe(pcm);
      return;
    }
    const ctx = new AudioContext();
    const buffer = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    buffer.copyToChannel(pcm, 0);
    wipe(pcm);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    source.onended = () => this.stopPreview(button);
    this.player = { ctx, buf: buffer, src: source };
    button.textContent = 'Stop';
  }

  private stopPreview(button?: HTMLButtonElement) {
    const player = this.player;
    if (!player) return;
    this.player = null;
    try {
      player.src.onended = null;
      player.src.stop();
    } catch { /* already ended */ }
    player.buf.getChannelData(0).fill(0);
    void player.ctx.close().catch(() => undefined);
    if (button) button.textContent = 'Play';
  }

  private async transcribe() {
    if (!this.audio) return;
    this.body.replaceChildren();
    const label = el('p', { text: 'Loading the voice model…' });
    const bar = el('div', { class: 'progress' }, el('span'));
    const sub = el('p', { class: 'muted small', text: 'The first use downloads the model from this app, then it works offline.' });
    this.body.append(
      label,
      bar,
      sub,
      el('div', { class: 'row end' }, el('button', { class: 'btn ghost', type: 'button', onclick: () => { killWorker(); this.trim(); } }, 'Cancel')),
    );
    const clip = applyEdits(this.audio, this.keep, this.cuts);
    if (!clip.length) {
      wipe(clip);
      this.trim();
      return;
    }
    const fill = bar.firstChild as HTMLElement;
    listener = (message) => {
      if (this.dead) return;
      if (message.type === 'progress') {
        const fraction = message.total ? message.loaded / message.total : 0;
        fill.style.width = `${Math.round(fraction * 100)}%`;
        label.textContent = `Downloading voice model… ${Math.round(fraction * 100)}%`;
      } else if (message.type === 'transcribing') {
        label.textContent = 'Transcribing on this device…';
        bar.classList.add('indeterminate');
        fill.style.width = '35%';
        sub.textContent = `${(clip.length / SAMPLE_RATE).toFixed(1)} s of audio`;
      } else if (message.type === 'result') {
        listener = null;
        this.review(message.text, message.ms, message.seconds);
      } else if (message.type === 'error') {
        listener = null;
        toast(`Transcription failed: ${message.message}`);
        this.trim();
      }
    };
    getWorker().postMessage({ type: 'run', base: appBase(), audio: clip }, [clip.buffer]);
  }

  private review(raw: string, ms: number, seconds: number) {
    this.body.replaceChildren();
    const text = postProcess(raw, this.options.rules, this.options.commands);
    const area = el('textarea', { class: 'review', 'aria-label': 'Transcript' }) as HTMLTextAreaElement;
    area.value = text;
    const rawWrap = el('details', { class: 'muted small' }, el('summary', { text: 'Original transcript' }), el('p', { text: raw.trim() || '(nothing recognised)' }));
    this.body.append(
      el('p', { class: 'muted small', text: `Transcribed ${seconds.toFixed(1)} s in ${(ms / 1000).toFixed(1)} s. Edit before inserting.` }),
      area,
      rawWrap,
      el('div', { class: 'row end wrap' },
        el('button', { class: 'btn ghost', type: 'button', onclick: () => this.trim() }, 'Back to trim'),
        el('button', { class: 'btn ghost', type: 'button', onclick: () => this.close() }, 'Discard'),
        el('button', { class: 'btn primary', type: 'button', onclick: () => { const next = area.value.trim(); this.close(); if (next) this.options.onInsert(next); } }, 'Insert')),
    );
    area.focus();
  }
}
