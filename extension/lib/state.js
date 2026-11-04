// The search list lives in a pinned bot message, so the cloud job and the extension
// share it without any server or database.
// shortcut: one Telegram message holds at most 4096 chars (~30 searches); move to a gist or KV store if that is not enough.
export const HEADER = '⚙️ Bazarnyk: список пошуків (не видаляй і не відкріплюй)\n';

export const emptyState = () => ({ searches: [], nextId: 1 });

export async function loadState(tg, chatId) {
  const chat = await tg('getChat', { chat_id: chatId });
  const text = chat.pinned_message?.text;
  if (!text?.startsWith(HEADER)) return { messageId: null, data: emptyState() };
  return { messageId: chat.pinned_message.message_id, data: JSON.parse(text.slice(HEADER.length)) };
}

// Webhook mode: the Worker may add or delete searches while the cloud job runs. Re-read the list and apply
// only the job's per-search updates, so those changes are not overwritten.
// shortcut: a Worker write landing between this read and the save is still lost; fine at a few writes per hour.
export async function saveMerged(tg, chatId, state) {
  const fresh = await loadState(tg, chatId);
  const mine = new Map(state.data.searches.map((s) => [s.id, s]));
  fresh.data.searches = fresh.data.searches.map((s) => mine.get(s.id) ?? s);
  Object.assign(state, fresh);
  await saveState(tg, chatId, state);
}

export async function saveState(tg, chatId, state) {
  const text = HEADER + JSON.stringify(state.data);
  if (text.length > 4096) throw new Error('Забагато пошуків: видаліть кілька через /del');
  if (state.messageId) {
    try {
      await tg('editMessageText', { chat_id: chatId, message_id: state.messageId, text });
    } catch (e) {
      if (!e.message.includes('not modified')) throw e;
    }
    return;
  }
  const msg = await tg('sendMessage', { chat_id: chatId, text, disable_notification: true });
  await tg('pinChatMessage', { chat_id: chatId, message_id: msg.message_id, disable_notification: true });
  state.messageId = msg.message_id;
}
