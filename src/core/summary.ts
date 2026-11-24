import { isRawInbox } from './queue';
import type { Bot, Note, QueueItem, Workspace } from './types';

export interface Summary {
  bots: number;
  activeBots: number;
  raw: number;
  staged: number;
  approved: number;
}

export function summarize(ws: Pick<Workspace, 'bots' | 'notes' | 'queue'>): Summary {
  return {
    bots: ws.bots.length,
    activeBots: ws.bots.filter((bot) => bot.status === 'active').length,
    raw: ws.notes.filter(isRawInbox).length,
    staged: ws.queue.filter((item) => item.status === 'staged').length,
    approved: ws.queue.filter((item) => item.status === 'approved').length,
  };
}

export function openTodos(bots: Bot[]): { botId: string; botName: string; todoId: string; text: string }[] {
  const out: { botId: string; botName: string; todoId: string; text: string }[] = [];
  for (const bot of bots) {
    if (bot.status === 'retired') continue;
    for (const todo of bot.todos) {
      if (!todo.done) out.push({ botId: bot.id, botName: bot.name, todoId: todo.id, text: todo.text });
    }
  }
  return out;
}

export function recentNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
}

export function stagedPreview(items: QueueItem[]): QueueItem[] {
  return items.filter((item) => item.status === 'staged').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
}
