import { escape } from './html.js';
import { SITES, EVERY_OPTIONS, settingsOf } from './sites.js';

export const BUTTONS = { add: '➕ Додати пошук', list: '📋 Мої пошуки', settings: '⚙️ Налаштування', help: '❓ Допомога' };

// Persistent keyboard under the input field, so nobody has to type commands.
export const KEYBOARD = {
  keyboard: [[{ text: BUTTONS.add }, { text: BUTTONS.list }], [{ text: BUTTONS.settings }, { text: BUTTONS.help }]],
  resize_keyboard: true,
  is_persistent: true,
};

// Telegram's "Menu" button next to the input field.
export const MENU = [
  { command: 'add', description: 'Додати пошук' },
  { command: 'list', description: 'Мої пошуки' },
  { command: 'settings', description: 'Сайти, частота, браузер' },
  { command: 'help', description: 'Як користуватися' },
];

export const HELP = [
  'Просто напиши, що шукаєш, наприклад:',
  '«драбина Hailo до 3000» або «пошукай мені велосипед гірський до 5 тис»',
  '',
  'Я регулярно перевірятиму OLX (б/в) і магазини й напишу, коли знайду дешевше або нове.',
  '«📋 Мої пошуки» — список і видалення.',
  '«⚙️ Налаштування» — на яких сайтах шукати, як часто, і підключення браузера для OLX.',
  '',
  'Слово з мінусом відкидає оголошення з ним: «драбина -книга».',
].join('\n');

const everyLabel = (m) => (m < 60 ? `${m} хв` : `${m / 60} год`);
const chunk = (arr, n) => arr.reduce((rows, x, i) => (i % n ? rows.at(-1).push(x) : rows.push([x]), rows), []);

// Settings screen: tap a site to turn it on/off, tap an interval to pick it.
export function settingsView(data) {
  const { sites, every } = settingsOf(data);
  const text = [
    '⚙️ <b>Налаштування</b>',
    '',
    'Де шукати — натисни на сайт, щоб увімкнути ✅ чи вимкнути ⬜.',
    '🖥 — цей сайт шукає розширення в браузері (поки браузер відкритий).',
    '',
    `Як часто перевіряти: зараз кожні <b>${everyLabel(every)}</b>.`,
  ].join('\n');
  const siteButtons = SITES.map((s) => ({ text: `${sites.includes(s.id) ? '✅' : '⬜'} ${s.name}${s.where === 'browser' ? ' 🖥' : ''}`, callback_data: `site:${s.id}` }));
  const everyButtons = EVERY_OPTIONS.map((m) => ({ text: `${m === every ? '✅ ' : ''}${everyLabel(m)}`, callback_data: `every:${m}` }));
  return {
    text,
    markup: { inline_keyboard: [...chunk(siteButtons, 2), everyButtons, [{ text: '🧩 Підключити браузер (для OLX)', callback_data: 'connect' }]] },
  };
}

// Applies a settings button press ("site:olx", "every:120"); returns false if it was not a settings button.
export function applySetting(data, cbData) {
  const [kind, value] = cbData.split(':');
  const s = settingsOf(data);
  if (kind === 'site' && SITES.some((x) => x.id === value)) {
    s.sites = s.sites.includes(value) ? s.sites.filter((id) => id !== value) : [...s.sites, value];
  } else if (kind === 'every' && EVERY_OPTIONS.includes(Number(value))) {
    s.every = Number(value);
  } else return false;
  data.settings = s;
  return true;
}

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
  // s.raw: free text the Worker could not parse with AI; the cloud job refines it shortly.
  if (s.raw) return `✅ Прийняв: «${escape(s.raw)}»\nЗараз уточню, що саме шукати, і почну пошук.`;
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
