export type QueueTab = 'form' | 'raw' | 'staged' | 'history';

export type Route =
  | { page: 'home' }
  | { page: 'notes'; noteId?: string; panel?: 'keyword' }
  | { page: 'queue'; tab: QueueTab }
  | { page: 'bots'; botId?: string }
  | { page: 'settings' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const [a, b] = parts;
  if (!a) return { page: 'home' };
  if (a === 'notes' && b === 'keyword') return { page: 'notes', panel: 'keyword' };
  if (a === 'notes') return { page: 'notes' };
  if (a === 'note' && b) return { page: 'notes', noteId: b };
  if (a === 'queue') {
    const tab: QueueTab = b === 'raw' || b === 'staged' || b === 'history' ? b : 'form';
    return { page: 'queue', tab };
  }
  if (a === 'bots') return { page: 'bots' };
  if (a === 'bot' && b) return { page: 'bots', botId: b };
  if (a === 'settings') return { page: 'settings' };
  return { page: 'home' };
}

export function routeHash(route: Route): string {
  switch (route.page) {
    case 'home':
      return '#/';
    case 'notes':
      if (route.noteId) return `#/note/${encodeURIComponent(route.noteId)}`;
      if (route.panel === 'keyword') return '#/notes/keyword';
      return '#/notes';
    case 'queue':
      return route.tab === 'form' ? '#/queue' : `#/queue/${route.tab}`;
    case 'bots':
      return route.botId ? `#/bot/${encodeURIComponent(route.botId)}` : '#/bots';
    case 'settings':
      return '#/settings';
    default:
      return '#/';
  }
}
