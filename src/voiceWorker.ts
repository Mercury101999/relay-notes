/// <reference lib="webworker" />
// On-device speech recognition (Whisper tiny.en via transformers.js + ONNX Runtime WASM).
// Model and runtime files are served from this app's own origin; remote model loading is disabled.
import { env, pipeline } from '@huggingface/transformers';

export const MODEL_ID = 'whisper-tiny.en';
type Asr = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
let asr: Promise<Asr> | null = null;
const post = (message: unknown) => (self as unknown as Worker).postMessage(message);

interface WasmBackend {
  numThreads: number;
  proxy: boolean;
  wasmPaths: { mjs: string; wasm: string };
}

function load(base: string): Promise<Asr> {
  if (asr) return asr;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // Must be a path (not a full URL) or transformers.js skips its local-file lookup.
  env.localModelPath = `${new URL(base).pathname}models/`;
  env.useBrowserCache = false;
  env.useWasmCache = false;
  const backends = env.backends as unknown as { onnx: { wasm: WasmBackend } };
  const wasm = backends.onnx.wasm;
  wasm.numThreads = 1;
  wasm.proxy = false;
  wasm.wasmPaths = {
    mjs: `${base}ort/ort-wasm-simd-threaded.mjs`,
    wasm: `${base}ort/ort-wasm-simd-threaded.wasm`,
  };
  const files = new Map<string, { loaded: number; total: number }>();
  asr = pipeline('automatic-speech-recognition', MODEL_ID, {
    device: 'wasm',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback: (progress: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (progress.status === 'progress' && progress.file && progress.total) {
        files.set(progress.file, { loaded: progress.loaded ?? 0, total: progress.total });
        let loaded = 0;
        let total = 0;
        for (const file of files.values()) {
          loaded += file.loaded;
          total += file.total;
        }
        post({ type: 'progress', loaded, total });
      }
    },
  }) as unknown as Promise<Asr>;
  asr.catch(() => { asr = null; });
  return asr;
}

self.onmessage = async (event: MessageEvent) => {
  const { type, base, audio } = event.data as { type: 'load' | 'run'; base: string; audio?: Float32Array };
  try {
    const started = performance.now();
    const fn = await load(base);
    if (type === 'load') {
      post({ type: 'ready', ms: performance.now() - started });
      return;
    }
    post({ type: 'transcribing' });
    const transcribeStarted = performance.now();
    const out = await fn(audio!, { chunk_length_s: 30, stride_length_s: 5 });
    const text = Array.isArray(out) ? out.map((item) => item.text).join(' ') : out.text;
    post({ type: 'result', text, ms: performance.now() - transcribeStarted, seconds: (audio?.length ?? 0) / 16000 });
  } catch (error) {
    post({ type: 'error', message: (error as Error).message || String(error) });
  } finally {
    audio?.fill(0);
  }
};
