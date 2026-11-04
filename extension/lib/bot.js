import { handleCommand, addSearch, listButtons, KEYBOARD } from './commands.js';

const NOT_UNDERSTOOD = 'Не зрозумів, що шукати 🙂 Напиши, наприклад: драбина Hailo до 3000';

// Handles one Telegram update (a message or a button press); shared by the cloud job (polling) and the Worker (webhook).
// parse(text) turns free text like "пошукай мені драбину до 3000" into { q, max } or null.
// Mutates `data`; returns true when it did something worth saving.
export async function handleUpdate(update, { tg, chatId, data, parse }) {
  const reply = (text, markup = KEYBOARD) =>
    tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });

  const cb = update.callback_query;
  if (cb) {
    // "🗑" button under the search list
    if (String(cb.message?.chat.id) !== String(chatId)) return false;
    const n = data.searches.findIndex((s) => `del:${s.id}` === cb.data) + 1;
    await tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {}); // fails if older than ~15 min; harmless
    await reply(handleCommand(`/del ${n}`, data));
    return true;
  }

  const m = update.message;
  if (!m?.text || String(m.chat.id) !== String(chatId)) return false; // ignore strangers
  let text = handleCommand(m.text, data);
  if (text === null) {
    const s = await parse(m.text);
    text = s ? addSearch(data, s) : NOT_UNDERSTOOD;
  }
  const isList = data.searches.length && /^(\/list|📋)/.test(m.text.trim());
  await reply(text, isList ? listButtons(data) : KEYBOARD);
  return true;
}
