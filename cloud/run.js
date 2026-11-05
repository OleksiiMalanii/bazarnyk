// Cloud job (GitHub Actions, every 30 min): answers bot commands (unless the Worker does), runs the AI steps
// and checks the shops turned on in ⚙️ Налаштування, as often as chosen there.
import { telegram, formatList } from '../extension/lib/telegram.js';
import { loadState, saveState, saveMerged } from '../extension/lib/state.js';
import { parseFree, MENU } from '../extension/lib/commands.js';
import { handleUpdate } from '../extension/lib/bot.js';
import { pick, siteQuery } from '../extension/lib/match.js';
import { promInStock } from '../extension/lib/prom.js';
import { shopsFor, isDue, settingsOf } from '../extension/lib/sites.js';
import { escape, money } from '../extension/lib/html.js';
import { suggestExcludes, suggestMinPrice, analyzeListings, parseRequest, AI_VERSION } from './ai.js';


const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
const tg = telegram(token);

// With the Worker's webhook set, Telegram refuses getUpdates: the Worker answers messages instantly instead.
let updates = [];
let webhook = false;
try {
  updates = await tg('getUpdates', { timeout: 0, allowed_updates: ['message', 'callback_query'] });
} catch (e) {
  if (!e.message.includes('webhook')) throw e;
  webhook = true;
}
const confirm = () => updates.length && tg('getUpdates', { offset: updates.at(-1).update_id + 1, timeout: 0 });
const save = (state) => (webhook ? saveMerged : saveState)(tg, chatId, state);

// Setup mode: tell whoever writes to the bot their chat id, so it can be saved as a secret.
if (!chatId) {
  for (const { message: m } of updates) {
    if (m) await tg('sendMessage', { chat_id: m.chat.id, text: `Твій chat id: ${m.chat.id}\nДодай його в GitHub як секрет TELEGRAM_CHAT_ID.` });
  }
  await confirm();
  process.exit(0);
}

const state = await loadState(tg, chatId);
let changed = false;

const ai = { claude: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN), apiKey: process.env.AI_API_KEY, baseUrl: process.env.AI_BASE_URL || undefined, model: process.env.AI_MODEL || undefined };
const hasAi = ai.claude || Boolean(ai.apiKey);

// Free text: "пошукай мені драбину до 3000". AI understands it; without AI, a simple parser does.
async function parse(text) {
  if (!hasAi) return parseFree(text);
  try {
    return await parseRequest(text, ai);
  } catch (e) {
    console.error(`AI request parsing failed: ${e.message}`);
    return parseFree(text);
  }
}

if (updates.length) await tg('setMyCommands', { commands: MENU });
for (const u of updates) {
  if (await handleUpdate(u, { tg, chatId, data: state.data, parse })) changed = true;
}

// Searches the Worker added from free text: let AI work out what is actually wanted.
for (const s of state.data.searches.filter((s) => s.raw)) {
  if (hasAi) {
    try {
      const r = await parseRequest(s.raw, ai);
      if (r) {
        Object.assign(s, r, { aiV: null, best: null });
        await tg('sendMessage', { chat_id: chatId, text: `🤖 <b>Зрозумів так</b>\n🔎 ${escape(s.q)}${s.max ? `\n💰 до ${money(s.max)}` : ''}`, parse_mode: 'HTML' });
      }
    } catch (e) {
      console.error(`AI request parsing failed: ${e.message}`); // retried on the next run
      continue;
    }
  }
  delete s.raw;
  changed = true;
}

// Search the cloud shops; failures are logged and skipped.
async function searchShops(s, shops) {
  const results = await Promise.allSettled(shops.map((site) => site.search(siteQuery(s.q))));
  results.forEach((r, i) => r.status === 'rejected' && console.error(`${shops[i].id} failed for "${s.q}": ${r.reason.message}`));
  return results;
}

// AI filter, once per search: generic junk words (toys, books, scrap) plus what AI learns from real shop results —
// which items are the product itself, which words mark accessories, and a price floor from the real median.
for (const s of hasAi ? state.data.searches.filter((s) => s.aiV !== AI_VERSION) : []) {
  try {
    const generic = await suggestExcludes(s.q, ai);
    const found = pick((await searchShops(s, shopsFor(state.data, 'cloud'))).flatMap((r) => r.value ?? []), { q: s.q, max: s.max });
    const learned = await analyzeListings(s.q, s.max, found, ai, generic);
    s.not = learned.not;
    s.min = learned.min ?? (await suggestMinPrice(s.q, s.max, ai));
    s.aiV = AI_VERSION;
  } catch (e) {
    console.error(`AI failed for "${s.q}": ${e.message}`); // retried on the next run
    continue;
  }
  s.best = null; // shop best may have been junk; re-evaluate with the new filter
  const text = [
    `🧹 <b>Фільтр готовий</b>\n🔎 ${escape(s.q)}`,
    s.not.length && `Пропускатиму оголошення зі словами:\n<i>${escape(s.not.join(', '))}</i>`,
    s.min && `Дешевше за <b>${money(s.min)}</b> — пропускаю: зазвичай це аксесуари чи брухт.`,
  ].filter(Boolean).join('\n\n');
  await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
  changed = true;
}

// Tell the user once per search that everything is set up, so they know the browser check is worth pressing now.
const browserOn = shopsFor(state.data, 'browser').length > 0 || settingsOf(state.data).sites.includes('olx');
for (const s of state.data.searches.filter((s) => !s.ready && !s.raw && (!hasAi || s.aiV === AI_VERSION))) {
  s.ready = true;
  changed = true;
  if (s.checkedAt) continue; // already searched before this message existed: nothing new to announce
  const browserLine = browserOn ? '\n🖥 OLX і Алло шукає браузер. Щоб не чекати, натисни «🔄 Перевірити зараз» у розширенні.' : '';
  await tg('sendMessage', {
    chat_id: chatId,
    text: `✅ <b>Усе налаштовано — шукаю!</b>\n🔎 ${escape(s.q)}\n\n🏪 Магазини перевіряю сам — знахідки прийдуть сюди.${browserLine}`,
    parse_mode: 'HTML',
  });
  changed = true;
}
// Save before confirming, so a crash re-processes commands instead of losing them.
if (changed) await save(state);
await confirm();

const force = process.argv.includes('--now');
let failures = 0;
let attempts = 0;
for (const s of state.data.searches.filter((s) => !s.raw && !s.paused)) {
  const shops = shopsFor(state.data, 'cloud');
  if (!shops.length || (!force && !isDue(s.checkedAt, state.data))) continue;
  const results = await searchShops(s, shops);
  attempts += results.length;
  failures += results.filter((r) => r.status === 'rejected').length;
  // Keep the 3 cheapest that are really in stock. Prom's search page lies about stock, so check its product pages.
  const items = [];
  for (const i of pick(results.flatMap((r) => r.value ?? []), s).slice(0, 10)) {
    if (items.length === 3) break;
    if (i.site !== 'Prom' || (await promInStock(i.url).catch(() => true))) items.push(i);
  }
  console.log(`"${s.q}": ${items.length} matching shop items in stock`);
  const top = items[0];
  if (top && (!s.best || top.price < s.best.price)) {
    const heading = s.best ? `📉 Ціна впала (було ${money(s.best.price)})` : '🏪 Найдешевше в магазинах';
    await tg('sendMessage', { chat_id: chatId, text: formatList(heading, s.q, items.slice(0, 3)), parse_mode: 'HTML', disable_web_page_preview: true });
  }
  if (top) s.best = { price: top.price, site: top.site, url: top.url };
  s.checkedAt = Date.now();
  changed = true;
}
if (changed) await save(state);

// Every shop request failed: fail the workflow so GitHub emails the owner.
if (attempts && failures === attempts) process.exitCode = 1;
