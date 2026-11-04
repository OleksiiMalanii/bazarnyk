// Item shape shared by all sources: { site, id, title, price, url, photo? }

// shortcut: crude stemming (drop 2 last letters) so "драбина" matches "драбину"; replace with an AI filter if too loose
const stem = (w) => (w.length > 4 ? w.slice(0, -2) : w);

export function matchesQuery(title, query) {
  const t = title.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.replace(/^-/, '').length >= 3);
  return words.every((w) => (w.startsWith('-') ? !t.includes(stem(w.slice(1))) : t.includes(stem(w))));
}

// Words without the "-exclude" ones, for sending to the site's own search.
export const siteQuery = (query) => query.split(/\s+/).filter((w) => !w.startsWith('-')).join(' ');

export function pick(items, search) {
  return items
    .filter((i) => i.price > 0 && (!search.max || i.price <= search.max) && matchesQuery(i.title, search.q))
    .sort((a, b) => a.price - b.price);
}
