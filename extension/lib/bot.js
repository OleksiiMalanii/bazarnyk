import { handleCommand, addSearch, listButtons, listView, togglePause, settingsView, applySetting, KEYBOARD } from './commands.js';
import { escape } from './html.js';

const NOT_UNDERSTOOD = 'Не зрозумів, що шукати 🙂 Напиши, наприклад: драбина Hailo до 3000';

// Handles one Telegram update (a message or a button press); shared by the cloud job (polling) and the Worker (webhook).
// parse(text) turns free text like "пошукай мені драбину до 3000" into { q, max } or null.
// workerUrl: the Worker's address, needed to connect the browser extension (absent in polling mode).
// Mutates `data`; returns true when it did something worth saving.
export async function handleUpdate(update, { tg, chatId, data, parse, workerUrl }) {
  const reply = (text, markup = KEYBOARD) =>
    tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });

  const cb = update.callback_query;
  if (cb) {
    if (String(cb.message?.chat.id) !== String(chatId)) return false;
    const answer = (text) => tg('answerCallbackQuery', { callback_query_id: cb.id, text }).catch(() => {}); // fails if older than ~15 min; harmless

    if (cb.data.startsWith('del:')) {
      // "🗑" button under the search list
      const n = data.searches.findIndex((s) => `del:${s.id}` === cb.data) + 1;
      await answer();
      await reply(handleCommand(`/del ${n}`, data));
      return true;
    }
    if (togglePause(data, cb.data)) {
      // Redraw the list in place, so ⏸/▶️ flips where the user tapped.
      const view = listView(data);
      await tg('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: view.text, parse_mode: 'HTML', reply_markup: view.markup })
        .catch((e) => { if (!e.message.includes('not modified')) throw e; });
      await answer(data.searches.find((s) => `pause:${s.id}` === cb.data).paused ? '⏸ Пошук на паузі' : '▶️ Пошук відновлено');
      return true;
    }
    if (cb.data === 'connect') {
      await answer();
      await reply(connectText(data, workerUrl));
      return Boolean(workerUrl);
    }
    if (applySetting(data, cb.data)) {
      // Redraw the same settings message, so the checkmarks move in place.
      const view = settingsView(data);
      await tg('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: view.text, parse_mode: 'HTML', reply_markup: view.markup })
        .catch((e) => { if (!e.message.includes('not modified')) throw e; });
      await answer('✅ Збережено');
      return true;
    }
    await answer();
    return false;
  }

  const m = update.message;
  if (!m?.text || String(m.chat.id) !== String(chatId)) return false; // ignore strangers
  if (/^(\/settings|⚙️)/.test(m.text.trim())) {
    const view = settingsView(data);
    await reply(view.text, view.markup);
    return false;
  }
  let text = handleCommand(m.text, data);
  if (text === null) {
    const s = await parse(m.text);
    text = s ? addSearch(data, s) : NOT_UNDERSTOOD;
  }
  const isList = data.searches.length && /^(\/list|📋)/.test(m.text.trim());
  await reply(text, isList ? listButtons(data) : KEYBOARD);
  return true;
}

// A fresh key each time, so pressing the button again disconnects any old browser.
function connectText(data, workerUrl) {
  if (!workerUrl) return 'Щоб підключити браузер, спершу налаштуй Worker (розділ «Миттєві відповіді» в README).';
  data.extKey = crypto.randomUUID().replaceAll('-', '');
  return [
    '🧩 <b>Підключення браузера</b>',
    '',
    '1. Встанови розширення Bazarnyk (інструкція в README).',
    '2. Натисни на його значок і встав цей код (натисни на код, щоб скопіювати):',
    '',
    `<code>${escape(`${workerUrl}#${data.extKey}`)}</code>`,
    '',
    'Код підключає лише твій браузер. Якщо натиснути «Підключити браузер» ще раз, старий код перестане працювати.',
  ].join('\n');
}
