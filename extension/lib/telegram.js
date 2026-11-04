import { escape } from './html.js';

export function telegram(token) {
  return async (method, body = {}) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    // Never put the URL in the error: it contains the bot token.
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
    return json.result;
  };
}

export const formatItem = (i) =>
  `<b>${i.price} грн</b> · <a href="${escape(i.url)}">${escape(i.title)}</a> (${i.site}${i.city ? `, ${escape(i.city)}` : ''})`;

export const formatList = (title, items) => [title, ...items.map(formatItem)].join('\n');
