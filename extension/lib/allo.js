import { decode } from './html.js';
import { USER_AGENT } from './prom.js';

export async function allo(query) {
  const res = await fetch(`https://allo.ua/ua/catalogsearch/result/?q=${encodeURIComponent(query)}`, {
    headers: { 'user-agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Allo ${res.status}`);
  return parseAllo(await res.text());
}

export function parseAllo(html) {
  return html
    .split('<div class="product-card">')
    .slice(1)
    .map((card) => {
      const link = card.match(/<a href="([^"]+)" title="([^"]*)" class="product-card__title"/);
      const sum = card.match(/class="v-pb__cur[^"]*"><span class="sum">([^<]+)</);
      // "Немає в наявності" cards still show a price; skip them.
      return link && sum && !card.includes('out-stock') && {
        site: 'Allo',
        id: `allo:${link[1]}`,
        title: decode(link[2]),
        price: Number(sum[1].replace(/\D/g, '')),
        url: link[1],
        photo: card.match(/<img src="([^"]+)"/)?.[1],
      };
    })
    .filter(Boolean);
}
