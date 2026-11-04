// Cloud job (GitHub Actions, every 30 min): answers bot commands and checks shops hourly.
import { telegram, formatList } from '../extension/lib/telegram.js';
import { loadState, saveState } from '../extension/lib/state.js';
import { handleCommand, addSearch, parseFree, listButtons, KEYBOARD, MENU } from '../extension/lib/commands.js';
import { pick, siteQuery } from '../extension/lib/match.js';
import { prom } from '../extension/lib/prom.js';
import { escape } from '../extension/lib/html.js';
import { suggestExcludes, suggestMinPrice, parseRequest, AI_VERSION } from './ai.js';

// Allo blocks GitHub servers (403), so the extension checks it instead.
const SHOPS = { Prom: prom };
const CHECK_EVERY_MS = 55 * 60 * 1000;

const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
const tg = telegram(token);

const updates = await tg('getUpdates', { timeout: 0, allowed_updates: ['message', 'callback_query'] });
const confirm = () => updates.length && tg('getUpdates', { offset: updates.at(-1).update_id + 1, timeout: 0 });

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
const reply = (text, markup = KEYBOARD) =>
  tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });

if (updates.length) await tg('setMyCommands', { commands: MENU });

for (const { message: m, callback_query: cb } of updates) {
  // "🗑" button under the search list
  if (cb) {
    if (String(cb.message?.chat.id) !== String(chatId)) continue;
    const n = state.data.searches.findIndex((s) => `del:${s.id}` === cb.data) + 1;
    const text = handleCommand(`/del ${n}`, state.data);
    await tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {}); // fails if older than ~15 min; harmless
    await reply(text);
    changed = true;
    continue;
  }
  if (!m?.text || String(m.chat.id) !== String(chatId)) continue; // ignore strangers
  let text = handleCommand(m.text, state.data);
  if (text === null) {
    // Free text: "пошукай мені драбину до 3000". AI understands it; without AI, a simple parser does.
    let s = null;
    try {
      s = hasAi ? await parseRequest(m.text, ai) : parseFree(m.text);
    } catch (e) {
      console.error(`AI request parsing failed: ${e.message}`);
      s = parseFree(m.text);
    }
    text = s ? addSearch(state.data, s) : 'Не зрозумів, що шукати 🙂 Напиши, наприклад: драбина Hailo до 3000';
  }
  const isList = state.data.searches.length && /^(\/list|📋)/.test(m.text.trim());
  await reply(text, isList ? listButtons(state.data) : KEYBOARD);
  changed = true;
}

// AI filter: once per search, ask for words that mark irrelevant listings (toys, books, scrap...).
for (const s of hasAi ? state.data.searches.filter((s) => s.aiV !== AI_VERSION) : []) {
  try {
    s.not = await suggestExcludes(s.q, ai);
    s.min = await suggestMinPrice(s.q, s.max, ai);
    s.aiV = AI_VERSION;
  } catch (e) {
    console.error(`AI failed for "${s.q}": ${e.message}`); // retried on the next run
    continue;
  }
  s.best = null; // shop best may have been junk; re-evaluate with the new filter
  const floor = s.min ? `\nІгнорую дешевше за ${s.min} грн: зазвичай це аксесуари чи брухт.` : '';
  await tg('sendMessage', { chat_id: chatId, text: `🤖 «${escape(s.q)}»: відкидатиму оголошення зі словами: ${escape(s.not.join(', '))}${floor}`, parse_mode: 'HTML' });
  changed = true;
}
// Save before confirming, so a crash re-processes commands instead of losing them.
if (changed) await saveState(tg, chatId, state);
await confirm();

const force = process.argv.includes('--now');
let failures = 0;
let attempts = 0;
for (const s of state.data.searches) {
  if (!force && s.checkedAt && Date.now() - s.checkedAt < CHECK_EVERY_MS) continue;
  const results = await Promise.allSettled(Object.values(SHOPS).map((f) => f(siteQuery(s.q))));
  results.forEach((r, i) => {
    attempts++;
    if (r.status === 'rejected') {
      failures++;
      console.error(`${Object.keys(SHOPS)[i]} failed for "${s.q}": ${r.reason.message}`);
    }
  });
  const items = pick(results.flatMap((r) => r.value ?? []), s);
  console.log(`"${s.q}": ${items.length} matching shop items`);
  const top = items[0];
  if (top && (!s.best || top.price < s.best.price)) {
    const title = s.best ? `📉 Магазини: нова найнижча ціна — «${s.q}»` : `🏪 Магазини: найдешевше зараз — «${s.q}»`;
    await tg('sendMessage', { chat_id: chatId, text: formatList(title, items.slice(0, 3)), parse_mode: 'HTML', disable_web_page_preview: true });
  }
  if (top) s.best = { price: top.price, site: top.site, url: top.url };
  s.checkedAt = Date.now();
  changed = true;
}
if (changed) await saveState(tg, chatId, state);

// Every shop request failed: fail the workflow so GitHub emails the owner.
if (attempts && failures === attempts) process.exitCode = 1;
