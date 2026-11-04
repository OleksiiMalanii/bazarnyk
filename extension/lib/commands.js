import { escape } from './html.js';

export const HELP = [
  'Команди:',
  '/add драбина Hailo до 3000 — додати пошук (ціна "до" не обов\'язкова)',
  '/add драбина -книга — слово з мінусом виключає оголошення з ним',
  '/list — список пошуків',
  '/del 2 — видалити пошук №2',
  '',
  'OLX (б/в) і Allo перевіряє розширення Chrome, Prom — хмара раз на годину.',
].join('\n');

export function parseAdd(args) {
  const m = args.trim().match(/^(.*?)(?:\s+до\s+([\d\s]+))?$/i);
  const q = m[1].trim();
  return q ? { q, max: m[2] ? Number(m[2].replace(/\s/g, '')) : null } : null;
}

// Mutates `data` and returns the reply text (HTML).
export function handleCommand(text, data) {
  const [, cmd, args = ''] = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/) ?? [];
  switch (cmd) {
    case 'start':
    case 'help':
      return escape(HELP);
    case 'add': {
      const s = parseAdd(args);
      if (!s) return 'Напиши, що шукати: /add драбина Hailo до 3000';
      data.searches.push({ id: data.nextId++, ...s, best: null });
      return `✅ Додано №${data.searches.length}: ${escape(s.q)}${s.max ? ` до ${s.max} грн` : ''}\nПерші результати прийдуть після найближчої перевірки.`;
    }
    case 'list':
      return data.searches.length
        ? data.searches.map((s, i) => `${i + 1}. ${escape(s.q)}${s.max ? ` (до ${s.max} грн)` : ''}`).join('\n')
        : 'Пошуків немає. Додай: /add драбина Hailo до 3000';
    case 'del': {
      const n = Number(args);
      if (!data.searches[n - 1]) return 'Немає пошуку з таким номером. Подивись /list';
      const [removed] = data.searches.splice(n - 1, 1);
      return `🗑 Видалено: ${escape(removed.q)}`;
    }
    default:
      return null;
  }
}
