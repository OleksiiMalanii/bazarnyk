import { telegram, formatList } from './lib/telegram.js';
import { loadState } from './lib/state.js';
import { pick, siteQuery } from './lib/match.js';
import { olx } from './lib/olx.js';

const ensureAlarm = () => chrome.alarms.create('check', { delayInMinutes: 1, periodInMinutes: 60 });
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((a) => a.name === 'check' && check().catch(report));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg !== 'check-now') return;
  check().then(reply, (e) => reply(report(e)));
  return true; // reply asynchronously
});

function report(e) {
  const status = `Помилка: ${e.message}`;
  chrome.storage.local.set({ status });
  return status;
}

async function check() {
  const { token, chatId, seen = {} } = await chrome.storage.local.get(['token', 'chatId', 'seen']);
  if (!token || !chatId) throw new Error('вкажи токен бота і chat id');
  const tg = telegram(token);
  const { data } = await loadState(tg, chatId);
  let sent = 0;

  for (const s of data.searches) {
    const first = !seen[s.id];
    // First run: the cheapest offers; afterwards: the newest, to catch fresh listings.
    const items = pick(await olx(siteQuery(s.q), s.max, first ? 'filter_float_price:asc' : 'created_at:desc'), s);
    const known = new Set(seen[s.id] ?? []);
    const fresh = first ? items.slice(0, 3) : items.filter((i) => !known.has(i.id)).slice(0, 5);
    seen[s.id] = [...new Set([...items.map((i) => i.id), ...known])].slice(0, 500);
    if (!fresh.length) continue;

    const title = first ? `🔎 OLX б/в: найдешевше зараз — «${s.q}»` : `🆕 OLX б/в: нові оголошення — «${s.q}»`;
    const shops = s.best ? `\n🏪 У магазинах найдешевше: ${s.best.price} грн (${s.best.site})` : '';
    await tg('sendMessage', { chat_id: chatId, text: formatList(title, fresh) + shops, parse_mode: 'HTML', disable_web_page_preview: true });
    sent++;
  }

  const status = `${new Date().toLocaleString('uk-UA')}: перевірено пошуків — ${data.searches.length}, повідомлень — ${sent}`;
  // Keep "seen" only for searches that still exist.
  await chrome.storage.local.set({ seen: Object.fromEntries(data.searches.map((s) => [s.id, seen[s.id]])), status });
  return status;
}
