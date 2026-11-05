// Cloudflare Worker: Telegram webhook, so the bot answers instantly instead of on the next cloud run.
// It only edits the search list; the cloud job (started right away via GitHub) runs AI and searches.
import { telegram } from '../extension/lib/telegram.js';
import { loadState, saveState } from '../extension/lib/state.js';
import { parseFree, MENU } from '../extension/lib/commands.js';
import { handleUpdate } from '../extension/lib/bot.js';

export default {
  async fetch(request, rawEnv, ctx) {
    // Secrets piped into `wrangler secret put` can carry a trailing newline.
    const env = Object.fromEntries(Object.entries(rawEnv).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
    const url = new URL(request.url);
    if (url.pathname.startsWith('/ext/')) return extension(request, url, env);
    // Telegram signs every webhook call with the secret given in setWebhook; ignore anything else.
    const authorized = request.headers.get('x-telegram-bot-api-secret-token') === env.WEBHOOK_SECRET
      || request.headers.get('x-setup-key') === env.WEBHOOK_SECRET;
    if (request.method !== 'POST' || !env.WEBHOOK_SECRET || !authorized) return new Response('ok');

    const tg = telegram(env.TELEGRAM_BOT_TOKEN);
    if (url.pathname === '/setup') return new Response(JSON.stringify(await setup(tg, url, env)));

    try {
      await onUpdate(await request.json(), tg, { ...env, WORKER_URL: url.origin }, ctx);
    } catch (e) {
      console.error(e.message); // answer 200 anyway, or Telegram keeps redelivering the same update
    }
    return new Response('ok');
  },
};

async function onUpdate(update, tg, env, ctx) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    const m = update.message;
    if (m) await tg('sendMessage', { chat_id: m.chat.id, text: `Твій chat id: ${m.chat.id}` });
    return;
  }
  const state = await loadState(tg, chatId);
  const nextId = state.data.nextId;
  // No AI here: keep the raw text and let the cloud job refine it.
  const parse = (text) => {
    const s = parseFree(text);
    return s && { ...s, raw: text };
  };
  const workerUrl = env.WORKER_URL;
  if (!(await handleUpdate(update, { tg, chatId, data: state.data, parse, workerUrl }))) return;
  await saveState(tg, chatId, state);
  // New search: start the cloud job now instead of waiting up to 30 minutes.
  if (state.data.nextId > nextId && env.GITHUB_TOKEN && env.GITHUB_REPO) ctx.waitUntil(dispatch(env));
}

const dispatch = (env) =>
  fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/check.yml/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'bazarnyk-worker' },
    body: JSON.stringify({ ref: env.GITHUB_BRANCH || 'master' }),
  }).then((r) => r.ok || console.error(`GitHub dispatch ${r.status}`));

// One-time: point the bot's webhook at this Worker and set the command menu.
async function setup(tg, url, env) {
  await tg('setWebhook', {
    url: `${url.origin}/`,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });
  await tg('setMyCommands', { commands: MENU });
  return tg('getWebhookInfo');
}

// The browser extension talks to the bot only through here, so it never needs the bot token.
// It authenticates with the key from "🧩 Підключити браузер" (stored in the pinned list).
async function extension(request, url, env) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const tg = telegram(env.TELEGRAM_BOT_TOKEN);
  const { data } = await loadState(tg, env.TELEGRAM_CHAT_ID);
  if (!data.extKey || request.headers.get('x-ext-key') !== data.extKey) return json({ error: 'Код не підходить. Натисни в боті «🧩 Підключити браузер» і встав новий код.' }, 403);

  if (url.pathname === '/ext/state' && request.method === 'GET') return json({ searches: data.searches, settings: data.settings ?? null });
  if (url.pathname === '/ext/send' && request.method === 'POST') {
    const { text } = await request.json();
    await tg('sendMessage', { chat_id: env.TELEGRAM_CHAT_ID, text: String(text).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true });
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}
