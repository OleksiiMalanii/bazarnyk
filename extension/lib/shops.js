// Ukrainian shops whose search pages carry results in plain HTML. Each parser skips out-of-stock items.
import { decode } from './html.js';
import { USER_AGENT } from './prom.js';

const num = (s) => Number(String(s ?? '').replace(/[^\d.]/g, '')) || 0;

async function get(name, url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  return res.text();
}

export const foxtrot = async (q) => parseFoxtrot(await get('Foxtrot', `https://www.foxtrot.com.ua/uk/search?query=${encodeURIComponent(q)}`));
export function parseFoxtrot(html) {
  return html.split('<div class="product-card"').slice(1).map((c) => {
    const url = c.match(/href="(\/uk\/shop\/[^"]+)"/)?.[1];
    return url && c.includes('data-variant="InStock"') && {
      site: 'Foxtrot',
      id: `foxtrot:${url}`,
      title: decode(c.match(/data-title="([^"]+)"/)?.[1] ?? ''),
      price: num(c.match(/data-price="([\d.]+)"/)?.[1]),
      url: `https://www.foxtrot.com.ua${url}`,
    };
  }).filter(Boolean);
}

export const moyo = async (q) => parseMoyo(await get('Moyo', `https://www.moyo.ua/ua/search/new/?q=${encodeURIComponent(q)}`));
export function parseMoyo(html) {
  return html.split(/class="product-card\s+goods-item/).slice(1).map((c) => {
    const status = c.match(/data-status-product="([^"]*)"/)?.[1];
    const url = atob(c.match(/data-async="([^"]+)"/)?.[1] ?? '');
    return url.startsWith('https://') && ['В наличии', 'Заканчивается'].includes(status) && {
      site: 'Moyo',
      id: `moyo:${url}`,
      title: decode(c.match(/data-name="([^"]+)"/)?.[1] ?? ''),
      price: num(c.match(/data-price="([\d.]+)"/)?.[1]),
      url,
    };
  }).filter(Boolean);
}

export const epicentr = async (q) => parseEpicentr(await get('Epicentr', `https://epicentrk.ua/ua/search/?q=${encodeURIComponent(q)}`));
export function parseEpicentr(html) {
  return html.split('itemtype="https://schema.org/Product"').slice(1).map((c) => {
    const url = c.match(/href="(\/ua\/shop\/[^"]+)"/)?.[1];
    // The old (crossed-out) price is also tagged itemprop="price"; the current one is the lowest.
    const prices = [...c.matchAll(/value="([\d.]+)" itemprop="price"/g)].map((m) => num(m[1]));
    return url && c.includes('schema.org/InStock') && prices.length && {
      site: 'Epicentr',
      id: `epicentr:${url}`,
      title: decode(c.match(/aria-label="Додати у список бажань товар: ([^"]+)"/)?.[1] ?? ''),
      price: Math.min(...prices),
      url: `https://epicentrk.ua${url}`,
    };
  }).filter(Boolean);
}

export const eldorado = async (q) => parseEldorado(await get('Eldorado', `https://eldorado.ua/uk/search/?q=${encodeURIComponent(q)}`));
export function parseEldorado(html) {
  return html.slice(html.indexOf('<body')).split(/<div[^>]+class="TileBlockstyled__StyledTileBlock-/).slice(1).map((c) => {
    const url = c.match(/href="(\/uk\/[^"]+\/p\d+\/)"/)?.[1];
    const price = c.match(/StyledCurrentPrice[^>]*><span[^>]*>([\d\s ]+)</)?.[1];
    return url && price && !/Немає в наявності|Закінчився|Очікується/i.test(c) && {
      site: 'Eldorado',
      id: `eldorado:${url}`,
      title: decode(c.match(/title="([^"]+)"/)?.[1] ?? ''),
      price: num(price),
      url: `https://eldorado.ua${url}`,
    };
  }).filter(Boolean);
}

// Hotline compares prices across hundreds of shops; the card shows the lowest offer ("1 938 – 4 383 ₴").
export const hotline = async (q) => parseHotline(await get('Hotline', `https://hotline.ua/ua/sr/?q=${encodeURIComponent(q)}`));
export function parseHotline(html) {
  return html.split('<div class="list-item list-item--column').slice(1).map((c) => {
    const link = c.match(/<a href="(\/ua\/[^"]+)"[^>]*class="item-title[^"]*"[^>]*>([^<]+)</);
    const price = c.match(/text-orange[^>]*>\s*([\d\s ]+)/)?.[1];
    return link && price && {
      site: 'Hotline',
      id: `hotline:${link[1]}`,
      title: decode(link[2].trim()),
      price: num(price),
      url: `https://hotline.ua${link[1]}`,
    };
  }).filter(Boolean);
}
