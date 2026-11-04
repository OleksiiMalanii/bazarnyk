import { escape } from './html.js';

export const BUTTONS = { add: '➕ Додати пошук', list: '📋 Мої пошуки', help: '❓ Допомога' };

// Persistent keyboard under the input field, so nobody has to type commands.
export const KEYBOARD = {
  keyboard: [[{ text: BUTTONS.add }, { text: BUTTONS.list }], [{ text: BUTTONS.help }]],
  resize_keyboard: true,
  is_persistent: true,
};

// Telegram's "Menu" button next to the input field.
export const MENU = [
  { command: 'add', description: 'Додати пошук' },
  { command: 'list', description: 'Мої пошуки' },
  { command: 'help', description: 'Як користуватися' },
];

export const HELP = [
  'Просто напиши, що шукаєш, наприклад:',
  '«драбина Hailo до 3000» або «пошукай мені велосипед гірський до 5 тис»',
  '',
  'Я раз на годину перевірятиму OLX (б/в), Prom і Allo й напишу, коли знайду дешевше або нове.',
  'Кнопка «📋 Мої пошуки» — список і видалення.',
  '',
  'Слово з мінусом відкидає оголошення з ним: «драбина -книга».',
].join('\n');

const EXAMPLE = 'Напиши, що шукаєш, наприклад: драбина Hailo до 3000';

// "драбина Hailo до 3 000 грн", "велосипед до 5 тис"
export function parseAdd(args) {
  const m = args.trim().match(/^(.*?)(?:\s+(?:до|max)\s+(\d[\d\s]*?)\s*(тис\.?|тисяч|k|к)?\s*(?:грн\.?|гривень|₴)?)?$/i);
  const q = m[1].trim();
  if (!q) return null;
  const max = m[2] ? Number(m[2].replace(/\s/g, '')) * (m[3] ? 1000 : 1) : null;
  return { q, max };
}

// Free text without AI: drop "пошукай мені" and the like, keep the rest.
export const parseFree = (text) =>
  parseAdd(text.replace(/^(будь\s+ласка,?\s+)?(пошукай|знайди|шукай|шукаю|хочу|потрібен|потрібн[аеоі]|треба)\s+(мені\s+)?/i, ''));

export function addSearch(data, s) {
  data.searches.push({ id: data.nextId++, ...s, best: null });
  return `✅ Шукаю: <b>${escape(s.q)}</b>${s.max ? ` до ${s.max} грн` : ''}\nНапишу, щойно знайду щось підходяще (зазвичай протягом години).`;
}

// Inline "delete" buttons under the search list.
export const listButtons = (data) => ({
  inline_keyboard: data.searches.map((s, i) => [{ text: `🗑 ${i + 1}. ${s.q}`.slice(0, 60), callback_data: `del:${s.id}` }]),
});

// Mutates `data` and returns the reply text (HTML), or null if `text` is not a command.
export function handleCommand(text, data) {
  const button = Object.entries(BUTTONS).find(([, label]) => label === text.trim());
  if (button) text = `/${button[0]}`;
  const [, cmd, args = ''] = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/) ?? [];
  switch (cmd) {
    case 'start':
    case 'help':
      return escape(HELP);
    case 'add': {
      const s = parseAdd(args);
      return s ? addSearch(data, s) : EXAMPLE;
    }
    case 'list':
      return data.searches.length
        ? ['Твої пошуки (натисни, щоб видалити):', ...data.searches.map((s, i) => `${i + 1}. ${escape(s.q)}${s.max ? ` (до ${s.max} грн)` : ''}`)].join('\n')
        : `Пошуків поки немає. ${EXAMPLE}`;
    case 'del': {
      const n = Number(args);
      if (!data.searches[n - 1]) return 'Такого пошуку вже немає.';
      const [removed] = data.searches.splice(n - 1, 1);
      return `🗑 Видалено: ${escape(removed.q)}`;
    }
    default:
      return null;
  }
}
