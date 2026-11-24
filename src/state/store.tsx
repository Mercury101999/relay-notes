import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { exampleWorkspace } from '../core/example';
import { exportWorkspace, importWorkspace } from '../core/export';
import { deleteFolder, moveFolder as reorderFolder, wouldCycle } from '../core/folders';
import { emptySettings, emptyWorkspace, withBody } from '../core/factory';
import { idbGet, idbSet } from '../core/idb';
import { executeSync } from '../core/sync';
import { asSyncClient, createRelayClient } from '../core/supabase';
import { nowIso } from '../core/time';
import type { Bot, Folder, Note, QueueItem, Settings, Theme, Tombstone, Workspace } from '../core/types';
import { PAGES_ORIGIN } from '../core/defaults';
import { toast } from '../ui/toast';

export type SyncPill = 'local' | 'syncing' | 'synced' | 'offline' | 'error';

interface SessionUser {
  id: string;
  email: string | null;
}

interface StoreValue {
  ws: Workspace;
  ready: boolean;
  user: SessionUser | null;
  sync: { status: SyncPill; error: string | null; at: string | null };
  pagesOrigin: string;
  syncNow: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string>;
  signUp: (email: string, password: string) => Promise<string>;
  sendMagicLink: (email: string) => Promise<string>;
  signOut: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  saveFolder: (folder: Folder) => string | null;
  removeFolder: (id: string) => void;
  moveFolder: (id: string, dir: -1 | 1) => void;
  saveBot: (bot: Bot) => string | null;
  removeBot: (id: string) => void;
  saveNote: (note: Note) => void;
  updateNoteBody: (id: string, body: string) => void;
  removeNote: (id: string) => void;
  saveQueueItem: (item: QueueItem) => void;
  removeQueueItem: (id: string) => void;
  loadExample: () => void;
  importJson: (text: string) => void;
  exportJson: () => string;
  clearWorkspace: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function normalize(raw: Partial<Workspace> | undefined): Workspace {
  const base = emptyWorkspace();
  if (!raw) return base;
  const settings = { ...emptySettings(raw.settings?.updated_at ?? base.settings.updated_at), ...raw.settings };
  if (settings.theme !== 'light' && settings.theme !== 'dark') settings.theme = 'dark';
  return {
    folders: raw.folders ?? [],
    bots: raw.bots ?? [],
    notes: (raw.notes ?? []).map((note) => withBody(note, note.body ?? '', note.updated_at)),
    queue: raw.queue ?? [],
    tombstones: raw.tombstones ?? [],
    settings,
  };
}

function upsert<T extends { id: string }>(list: T[], row: T): T[] {
  return list.some((item) => item.id === row.id) ? list.map((item) => (item.id === row.id ? row : item)) : [...list, row];
}

function addTombstones(current: Tombstone[], table: Tombstone['table'], ids: string[], now: string): Tombstone[] {
  const next = current.filter((item) => !(item.table === table && ids.includes(item.id)));
  return [...next, ...ids.map((id) => ({ table, id, deleted_at: now }))];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ws, setWs] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sync, setSync] = useState<StoreValue['sync']>({ status: 'local', error: null, at: null });
  const wsRef = useRef(ws);
  const userRef = useRef(user);
  const syncing = useRef(false);
  const clientRef = useRef<{ key: string; client: SupabaseClient } | null>(null);
  wsRef.current = ws;
  userRef.current = user;

  const client = useCallback(() => {
    const settings = wsRef.current.settings;
    const key = `${settings.supabase_url}::${settings.supabase_publishable_key}`;
    if (!clientRef.current || clientRef.current.key !== key) {
      clientRef.current = { key, client: createRelayClient(settings.supabase_url, settings.supabase_publishable_key) };
    }
    return clientRef.current.client;
  }, []);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const saved = await idbGet<Workspace>('workspace');
        if (!cancel && saved) setWs(normalize(saved));
      } catch {
        toast('Saved workspace could not be read. Starting empty.');
      } finally {
        if (!cancel) setReady(true);
      }
    })();
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const handle = window.setTimeout(() => { void idbSet('workspace', wsRef.current); }, 120);
    return () => window.clearTimeout(handle);
  }, [ws, ready]);

  useEffect(() => {
    document.documentElement.dataset.theme = ws.settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ws.settings.theme === 'light' ? '#f3f6f7' : '#0c1214');
  }, [ws.settings.theme]);

  const syncNow = useCallback(async () => {
    const currentUser = userRef.current;
    if (!currentUser) {
      setSync({ status: 'local', error: null, at: null });
      return;
    }
    if (!navigator.onLine) {
      setSync((prev) => ({ ...prev, status: 'offline', error: null }));
      return;
    }
    if (syncing.current) return;
    syncing.current = true;
    setSync((prev) => ({ ...prev, status: 'syncing', error: null }));
    try {
      const outcome = await executeSync(asSyncClient(client()), currentUser.id, wsRef.current);
      setWs(outcome.workspace);
      setSync({ status: 'synced', error: null, at: nowIso() });
    } catch (error) {
      setSync({ status: 'error', error: (error as Error).message, at: null });
    } finally {
      syncing.current = false;
    }
  }, [client]);

  useEffect(() => {
    let unsubscribe = () => {};
    try {
      const sb = client();
      void sb.auth.getSession().then(({ data }) => setUser(mapUser(data.session)));
      const { data } = sb.auth.onAuthStateChange((_event, session) => setUser(mapUser(session)));
      unsubscribe = () => data.subscription.unsubscribe();
    } catch (error) {
      setSync({ status: 'error', error: (error as Error).message, at: null });
    }
    return unsubscribe;
  }, [client, ws.settings.supabase_url, ws.settings.supabase_publishable_key]);

  useEffect(() => {
    if (ready && user) void syncNow();
  }, [ready, user?.id, syncNow]);

  useEffect(() => {
    const onFocus = () => { if (userRef.current) void syncNow(); };
    const onOnline = () => { if (userRef.current) void syncNow(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [syncNow]);

  const value = useMemo<StoreValue>(() => ({
    ws,
    ready,
    user,
    sync,
    pagesOrigin: PAGES_ORIGIN,
    syncNow,
    async signIn(email, password) {
      const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(error.message);
      return 'Signed in. Local notes stay on this device until you opt a note into Ari sync.';
    },
    async signUp(email, password) {
      const redirect = window.location.href.split('#')[0];
      const { error, data } = await client().auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: redirect },
      });
      if (error) throw new Error(error.message);
      return data.session
        ? 'Account ready.'
        : `Check your email to confirm. Add ${PAGES_ORIGIN} under Supabase Authentication → URL Configuration if the link does not return here.`;
    },
    async sendMagicLink(email) {
      const redirect = window.location.href.split('#')[0];
      const { error } = await client().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirect },
      });
      if (error) throw new Error(error.message);
      return `Magic link sent. Add ${PAGES_ORIGIN} to Supabase Authentication → URL Configuration if the link opens the wrong site.`;
    },
    async signOut() {
      const { error } = await client().auth.signOut();
      if (error) throw new Error(error.message);
      setUser(null);
      setSync({ status: 'local', error: null, at: null });
    },
    setTheme(theme) {
      setWs((current) => ({ ...current, settings: { ...current.settings, theme, updated_at: nowIso() } }));
    },
    updateSettings(patch) {
      setWs((current) => ({ ...current, settings: { ...current.settings, ...patch, updated_at: nowIso() } }));
    },
    saveFolder(folder) {
      if (!folder.name.trim()) return 'Folder name is required';
      if (wouldCycle(ws.folders, folder.id, folder.parent_id)) return 'A folder cannot sit inside itself';
      setWs((current) => ({ ...current, folders: upsert(current.folders, { ...folder, name: folder.name.trim(), updated_at: nowIso() }) }));
      return null;
    },
    removeFolder(id) {
      const now = nowIso();
      setWs((current) => {
        const result = deleteFolder(current.folders, current.notes, id, now);
        return {
          ...current,
          folders: result.folders,
          notes: result.notes,
          tombstones: addTombstones(current.tombstones, 'folders', result.removed, now),
        };
      });
    },
    moveFolder(id, dir) {
      const now = nowIso();
      setWs((current) => ({ ...current, folders: reorderFolder(current.folders, id, dir, now) }));
    },
    saveBot(bot) {
      const name = bot.name.trim();
      if (!name) return 'Bot name is required';
      if (ws.bots.some((item) => item.id !== bot.id && item.name.toLowerCase() === name.toLowerCase())) return 'A bot with that name already exists';
      setWs((current) => ({ ...current, bots: upsert(current.bots, { ...bot, name, updated_at: nowIso() }) }));
      return null;
    },
    removeBot(id) {
      const now = nowIso();
      setWs((current) => ({
        ...current,
        bots: current.bots.filter((bot) => bot.id !== id),
        tombstones: addTombstones(current.tombstones, 'bots', [id], now),
      }));
    },
    saveNote(note) {
      setWs((current) => ({ ...current, notes: upsert(current.notes, note) }));
    },
    updateNoteBody(id, body) {
      const now = nowIso();
      setWs((current) => ({
        ...current,
        notes: current.notes.map((note) => (note.id === id ? withBody(note, body, now) : note)),
      }));
    },
    removeNote(id) {
      const now = nowIso();
      setWs((current) => ({
        ...current,
        notes: current.notes.filter((note) => note.id !== id),
        queue: current.queue.map((item) => (item.source_note_id === id ? { ...item, source_note_id: null, updated_at: now } : item)),
        tombstones: addTombstones(current.tombstones, 'notes', [id], now),
      }));
    },
    saveQueueItem(item) {
      setWs((current) => ({ ...current, queue: upsert(current.queue, item) }));
    },
    removeQueueItem(id) {
      const now = nowIso();
      setWs((current) => ({
        ...current,
        queue: current.queue.filter((item) => item.id !== id),
        tombstones: addTombstones(current.tombstones, 'queue_items', [id], now),
      }));
    },
    loadExample() {
      const settings = wsRef.current.settings;
      const next = exampleWorkspace();
      next.settings = { ...next.settings, supabase_url: settings.supabase_url, supabase_publishable_key: settings.supabase_publishable_key, theme: settings.theme };
      setWs(next);
      toast('Example workspace loaded. Every note in it is fictional.');
    },
    importJson(text) {
      const next = importWorkspace(text, wsRef.current);
      setWs(next);
      toast('Workspace imported onto this device.');
    },
    exportJson() {
      return exportWorkspace(wsRef.current, nowIso());
    },
    clearWorkspace() {
      const settings = wsRef.current.settings;
      const now = nowIso();
      const tombstones: Tombstone[] = [
        ...wsRef.current.folders.map((folder) => ({ table: 'folders' as const, id: folder.id, deleted_at: now })),
        ...wsRef.current.bots.map((bot) => ({ table: 'bots' as const, id: bot.id, deleted_at: now })),
        ...wsRef.current.notes.map((note) => ({ table: 'notes' as const, id: note.id, deleted_at: now })),
        ...wsRef.current.queue.map((item) => ({ table: 'queue_items' as const, id: item.id, deleted_at: now })),
      ];
      setWs({ ...emptyWorkspace(), settings: { ...settings, updated_at: now }, tombstones });
    },
  }), [ws, ready, user, sync, syncNow, client]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function mapUser(session: Session | null): SessionUser | null {
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email ?? null };
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('Store missing');
  return value;
}
