import { telegram, formatList } from './lib/telegram.js';
import { loadState } from './lib/state.js';
import { pick, siteQuery } from './lib/match.js';
import { olx } from './lib/olx.js';
import { allo } from './lib/allo.js';

// Wake every 10 min so new searches get OLX results quickly; each search is still checked once an hour.
const CHECK_EVERY_MS = 55 * 60 * 1000;
const ensureAlarm = () => chrome.alarms.create('check', { delayInMinutes: 1, periodInMinutes: 10 });
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((a) => a.name === 'check' && check(false).catch(report));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg !== 'check-now') return;
  check(true).then(reply, (e) => reply(report(e)));
  return true; // reply asynchronously
});

function report(e) {
  const status = `Помилка: ${e.message}`;
  chrome.storage.local.set({ status });
  return status;
}

const send = (tg, chatId, text) => tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });

async function check(force) {
  const { token, chatId, seen = {}, alloBest = {}, checkedAt = {} } = await chrome.storage.local.get(['token', 'chatId', 'seen', 'alloBest', 'checkedAt']);
  if (!token || !chatId) throw new Error('вкажи токен бота і chat id');
  const tg = telegram(token);
  const { data } = await loadState(tg, chatId);
  const errors = [];
  let sent = 0;

  // s.raw: free text the cloud job has not turned into a proper query yet
  const due = (s) => force || !checkedAt[s.id] || Date.now() - checkedAt[s.id] >= CHECK_EVERY_MS;
  const searches = data.searches.filter((s) => !s.raw && due(s));
  for (const s of searches) {
    checkedAt[s.id] = Date.now();
    // Allo blocks GitHub servers, so it is checked here like a shop: notify only on a new lowest price.
    try {
      const items = pick(await allo(siteQuery(s.q)), s);
      const prev = alloBest[s.id];
      if (items[0] && (!prev || items[0].price < prev.price)) {
        await send(tg, chatId, formatList(prev ? `📉 Allo: нова найнижча ціна — «${s.q}»` : `🏪 Allo: найдешевше зараз — «${s.q}»`, items.slice(0, 3)));
        sent++;
      }
      if (items[0]) alloBest[s.id] = { price: items[0].price, site: 'Allo', url: items[0].url };
    } catch (e) {
      errors.push(e.message);
    }

    const first = !seen[s.id];
    // First run: the cheapest offers; afterwards: the newest, to catch fresh listings.
    const items = pick(await olx(siteQuery(s.q), s.max, first ? 'filter_float_price:asc' : 'created_at:desc'), s);
    // Also mark the newest listings seen on the first run, or the next run reports them all as new.
    const newest = first ? pick(await olx(siteQuery(s.q), s.max, 'created_at:desc'), s) : [];
    const known = new Set(seen[s.id] ?? []);
    const fresh = first ? items.slice(0, 3) : items.filter((i) => !known.has(i.id)).slice(0, 5);
    seen[s.id] = [...new Set([...items, ...newest].map((i) => i.id).concat([...known]))].slice(0, 500);
    if (!fresh.length) continue;

    const title = first ? `🔎 OLX б/в: найдешевше зараз — «${s.q}»` : `🆕 OLX б/в: нові оголошення — «${s.q}»`;
    const shop = [s.best, alloBest[s.id]].filter(Boolean).sort((a, b) => a.price - b.price)[0];
    const shops = shop ? `\n🏪 У магазинах найдешевше: ${shop.price} грн (${shop.site})` : '';
    await send(tg, chatId, formatList(title, fresh) + shops);
    sent++;
  }

  // Keep per-search data only for searches that still exist.
  const keep = (obj) => Object.fromEntries(data.searches.filter((s) => obj[s.id]).map((s) => [s.id, obj[s.id]]));
  if (!searches.length) {
    await chrome.storage.local.set({ checkedAt: keep(checkedAt) });
    return 'Усі пошуки вже перевірені протягом години';
  }
  const status = `${new Date().toLocaleString('uk-UA')}: перевірено пошуків — ${searches.length}, повідомлень — ${sent}` +
    (errors.length ? `\nПомилки: ${[...new Set(errors)].join('; ')}` : '');
  await chrome.storage.local.set({ seen: keep(seen), alloBest: keep(alloBest), checkedAt: keep(checkedAt), status });
  return status;
}
