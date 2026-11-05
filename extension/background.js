import { formatList } from './lib/telegram.js';
import { pick, siteQuery } from './lib/match.js';
import { olx } from './lib/olx.js';
import { shopsFor, settingsOf, isDue } from './lib/sites.js';
import { workerApi } from './lib/connection.js';

// Wake every 10 min so new searches get results quickly; each search is checked as often as set in the bot.
const ensureAlarm = () => chrome.alarms.create('check', { delayInMinutes: 1, periodInMinutes: 10 });
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((a) => a.name === 'check' && check(false).catch(report));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg !== 'check-now') return;
  check(true).then(reply, (e) => reply(report(e)));
  return true; // reply asynchronously
});

// Number on the toolbar icon: finds sent to Telegram since the popup was last opened.
const showUnread = (n) => chrome.action.setBadgeText({ text: n ? String(n) : '' });
chrome.action.setBadgeBackgroundColor({ color: '#1a7f37' });

function report(e) {
  const status = `⚠️ ${e.message}`;
  chrome.storage.local.set({ status });
  return status;
}

async function check(force) {
  const api = await workerApi();
  const data = await api.state();
  const { seen = {}, shopBest = {}, olxBest = {}, checkedAt = {} } = await chrome.storage.local.get(['seen', 'shopBest', 'olxBest', 'checkedAt']);
  const olxOn = settingsOf(data).sites.includes('olx');
  const shops = shopsFor(data, 'browser');
  const errors = [];
  let sent = 0;

  // s.raw: free text the cloud job has not turned into a proper query yet
  const searches = data.searches.filter((s) => !s.raw && !s.paused && (force || isDue(checkedAt[s.id], data)));
  for (const s of searches) {
    checkedAt[s.id] = Date.now();

    // Shops that block servers (Allo): notify only on a new lowest price, like the cloud does.
    const results = await Promise.allSettled(shops.map((site) => site.search(siteQuery(s.q))));
    results.forEach((r, i) => r.status === 'rejected' && errors.push(`${shops[i].name}: ${r.reason.message}`));
    const items = pick(results.flatMap((r) => r.value ?? []), s);
    const prev = shopBest[s.id];
    if (items[0] && (!prev || items[0].price < prev.price)) {
      await api.send(formatList(prev ? `📉 Нова найнижча ціна — «${s.q}»` : `🏪 Найдешевше зараз — «${s.q}»`, items.slice(0, 3)));
      sent++;
    }
    if (items[0]) shopBest[s.id] = { price: items[0].price, site: items[0].site, url: items[0].url };

    if (!olxOn) continue;
    try {
      const first = !seen[s.id];
      // First run: the cheapest offers; afterwards: the newest, to catch fresh listings.
      const listings = pick(await olx(siteQuery(s.q), s.max, first ? 'filter_float_price:asc' : 'created_at:desc'), s);
      // Also mark the newest listings seen on the first run, or the next run reports them all as new.
      const newest = first ? pick(await olx(siteQuery(s.q), s.max, 'created_at:desc'), s) : [];
      const known = new Set(seen[s.id] ?? []);
      const fresh = first ? listings.slice(0, 3) : listings.filter((i) => !known.has(i.id)).slice(0, 5);
      seen[s.id] = [...new Set([...listings, ...newest].map((i) => i.id).concat([...known]))].slice(0, 500);
      if (!fresh.length) continue;
      // shortcut: the cheapest OLX listing we have sent; it may be sold since. Fine for a hint in the popup.
      const cheap = fresh.reduce((a, b) => (b.price < a.price ? b : a));
      if (!olxBest[s.id] || cheap.price < olxBest[s.id].price) olxBest[s.id] = { price: cheap.price, site: 'OLX', url: cheap.url };

      const title = first ? `🔎 OLX б/в: найдешевше зараз — «${s.q}»` : `🆕 OLX б/в: нові оголошення — «${s.q}»`;
      const shop = [s.best, shopBest[s.id]].filter(Boolean).sort((a, b) => a.price - b.price)[0];
      const shopLine = shop ? `\n🏪 У магазинах найдешевше: ${shop.price} грн (${shop.site})` : '';
      await api.send(formatList(title, fresh) + shopLine);
      sent++;
    } catch (e) {
      errors.push(`OLX: ${e.message}`);
    }
  }

  // Keep per-search data only for searches that still exist.
  const keep = (obj) => Object.fromEntries(data.searches.filter((s) => obj[s.id]).map((s) => [s.id, obj[s.id]]));
  const status = searches.length
    ? `✅ ${new Date().toLocaleString('uk-UA')}: перевірено ${searches.length}, надіслано ${sent}` + (errors.length ? `\n⚠️ ${[...new Set(errors)].join('; ')}` : '')
    : (await chrome.storage.local.get('status')).status ?? '';
  const unread = ((await chrome.storage.local.get('unread')).unread ?? 0) + sent; // re-read: the popup may have reset it meanwhile
  await chrome.storage.local.set({ seen: keep(seen), shopBest: keep(shopBest), olxBest: keep(olxBest), checkedAt: keep(checkedAt), status, lastRun: Date.now(), unread });
  showUnread(unread);
  return status || 'Усі пошуки вже перевірені, наступна перевірка за розкладом';
}
