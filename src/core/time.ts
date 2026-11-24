export const nowIso = () => new Date().toISOString();

export const uid = () => crypto.randomUUID();

export function hoursAgo(hours: number, now = Date.now()): string {
  return new Date(now - hours * 3_600_000).toISOString();
}

export function formatWhen(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} d ago`;
  return new Date(iso).toLocaleDateString();
}
