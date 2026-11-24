/** Voice model and ORT files stay out of the app-shell precache. They fill `relay-voice-v1` on first use. */
export function isVoicePath(file: string): boolean {
  const path = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return path.startsWith('models/') || path.startsWith('ort/') || path.includes('/models/') || path.includes('/ort/');
}

export function shouldPrecache(file: string): boolean {
  const path = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path === 'sw.js') return false;
  if (path.endsWith('.map')) return false;
  if (path.endsWith('.wasm')) return false;
  if (isVoicePath(path)) return false;
  return true;
}

export const VOICE_CACHE = 'relay-voice-v1';
