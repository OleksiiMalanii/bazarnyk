import { escape, money } from './html.js';
import { SITES, EVERY_OPTIONS, settingsOf, everyLabel } from './sites.js';

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

// HTML.
export const HELP = [
  '👋 <b>Я Bazarnyk — шукаю найдешевше б/в і в магазинах.</b>',
  '',
  '✍️ <b>Просто напиши, що шукаєш:</b>',
  '• <i>драбина Hailo до 3000</i>',
  '• <i>пошукай мені велосипед гірський до 5 тис</i>',
  '',
  '🔔 Регулярно перевіряю OLX і магазини та пишу, коли знайду дешевше або нове.',
  '',
  '📋 <b>Мої пошуки</b> — список, пауза, видалення',
  '⚙️ <b>Налаштування</b> — сайти, як часто шукати, браузер для OLX',
  '',
  '💡 Слово з мінусом відкидає зайве: <i>драбина -книга</i>',
].join('\n');

const chunk = (arr, n) => arr.reduce((rows, x, i) => (i % n ? rows.at(-1).push(x) : rows.push([x]), rows), []);

// Settings screen: tap a site to turn it on/off, tap an interval to pick it.
export function settingsView(data) {
  const { sites, every } = settingsOf(data);
  const text = [
    '⚙️ <b>Налаштування</b>',
    '',
    '🛍 <b>Де шукати</b> — натисни на сайт, щоб увімкнути ✅ чи вимкнути ⬜.',
    '<i>🖥 — цей сайт шукає розширення в браузері.</i>',
    '',
    every ? `⏱ <b>Як часто</b> — зараз кожні <b>${everyLabel(every)}</b>.` : '⏱ <b>Як часто</b> — зараз <b>не повторювати</b>: кожен пошук перевіряю один раз.',
  ].join('\n');
  const siteButtons = SITES.map((s) => ({ text: `${sites.includes(s.id) ? '✅' : '⬜'} ${s.name}${s.where === 'browser' ? ' 🖥' : ''}`, callback_data: `site:${s.id}` }));
  const everyButtons = EVERY_OPTIONS.map((m) => ({ text: `${m === every ? '✅ ' : ''}${m ? everyLabel(m) : '⏸ Не повторювати'}`, callback_data: `every:${m}` }));
  return {
    text,
    markup: { inline_keyboard: [...chunk(siteButtons, 2), everyButtons.slice(0, 4), everyButtons.slice(4), [{ text: '🧩 Підключити браузер (для OLX)', callback_data: 'connect' }]] },
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
  if (s.raw) return `👌 <b>Прийняв:</b> «${escape(s.raw)}»\n⏳ Уточню, що саме шукати, налаштую фільтр і почну пошук.`;
  return `✅ <b>Шукаю</b>\n🔎 ${escape(s.q)}${s.max ? `\n💰 до ${money(s.max)}` : ''}\n\nНапишу, щойно знайду щось підходяще (зазвичай протягом години).`;
}

const listText = (data) =>
  [`📋 <b>Мої пошуки</b> · ${data.searches.length}`, ...data.searches.map((s, i) => [
    `\n<b>${i + 1}. ${escape(s.q)}</b>${s.paused ? ' — ⏸ на паузі' : ''}`,
    [s.max && `до ${money(s.max)}`, s.best && `💰 зараз від ${money(s.best.price)} (${escape(s.best.site)})`].filter(Boolean).join(' · '),
  ].filter(Boolean).join('\n')), '\n<i>Кнопки нижче: ⏸ пауза · ▶️ відновити · 🗑 видалити</i>'].join('\n');

// Buttons under the search list: pause/resume and delete for each search.
export const listButtons = (data) => ({
  inline_keyboard: data.searches.map((s, i) => [
    { text: `${s.paused ? '▶️' : '⏸'} ${i + 1}. ${s.q}`.slice(0, 60), callback_data: `pause:${s.id}` },
    { text: '🗑', callback_data: `del:${s.id}` },
  ]),
});

export const listView = (data) => ({ text: listText(data), markup: listButtons(data) });

// "pause:<id>": stops or resumes the repeated checks of one search; returns false if no such search.
export function togglePause(data, cbData) {
  const s = data.searches.find((x) => `pause:${x.id}` === cbData);
  if (!s) return false;
  s.paused = !s.paused;
  return true;
}

// Mutates `data` and returns the reply text (HTML), or null if `text` is not a command.
export function handleCommand(text, data) {
  const button = Object.entries(BUTTONS).find(([, label]) => label === text.trim());
  if (button) text = `/${button[0]}`;
  const [, cmd, args = ''] = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/) ?? [];
  switch (cmd) {
    case 'start':
    case 'help':
      return HELP;
    case 'add': {
      const s = parseAdd(args);
      return s ? addSearch(data, s) : EXAMPLE;
    }
    case 'list':
      return data.searches.length
        ? listText(data)
        : `📭 Пошуків поки немає.\n${EXAMPLE}`;
    case 'del': {
      const n = Number(args);
      if (!data.searches[n - 1]) return 'Такого пошуку вже немає.';
      const [removed] = data.searches.splice(n - 1, 1);
      return `🗑 Видалено: <b>${escape(removed.q)}</b>`;
    }
    default:
      return null;
  }
}
