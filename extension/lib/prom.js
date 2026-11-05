import { decode } from './html.js';

export const USER_AGENT = 'bazarnyk/0.1 (+https://github.com/)';

export async function prom(query) {
  const res = await fetch(`https://prom.ua/ua/search?search_term=${encodeURIComponent(query)}`, {
    headers: { 'user-agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Prom ${res.status}`);
  return parseProm(await res.text());
}

// Prom's search page marks everything InStock; only the product page tells the truth.
export async function promInStock(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) return true; // unknown: better to show than to hide
  return isInStock(await res.text());
}

export const isInStock = (html) => !/schema\.org\/(OutOfStock|Discontinued|SoldOut)/.test(html);

// Prom embeds search results as schema.org Product JSON-LD blocks.
export function parseProm(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => {
      try {
        return JSON.parse(m[1]);
      } catch {
        return null;
      }
    })
    .filter((p) => p?.['@type'] === 'Product')
    .map((p) => ({
      site: 'Prom',
      id: `prom:${p.url}`,
      title: decode(p.name),
      price: Number([p.offers].flat()[0]?.price),
      url: p.url,
      photo: [p.image].flat()[0],
    }));
}
