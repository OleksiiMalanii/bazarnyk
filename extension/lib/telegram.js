import { escape, money } from './html.js';

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

const MEDALS = ['🥇', '🥈', '🥉'];
const short = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// One find: price and where on the first line, the clickable title on the second.
export const formatItem = (i, n = 0) =>
  `${MEDALS[n] ?? '▫️'} <b>${money(i.price)}</b> · ${escape(i.site)}${i.city ? `, ${escape(i.city)}` : ''}\n<a href="${escape(i.url)}">${escape(short(i.title))}</a>`;

// heading: plain text like "🏪 Найдешевше в магазинах"; q: what was searched; note: an extra HTML line at the end.
export const formatList = (heading, q, items, note = '') =>
  [`<b>${escape(heading)}</b>`, `🔎 ${escape(q)}`, '', items.map(formatItem).join('\n\n'), ...(note ? ['', note] : [])].join('\n');
