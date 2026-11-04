import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, pick, siteQuery } from '../extension/lib/match.js';
import { parseAdd, handleCommand } from '../extension/lib/commands.js';
import { parseOlx } from '../extension/lib/olx.js';
import { parseProm } from '../extension/lib/prom.js';
import { parseAllo } from '../extension/lib/allo.js';
import { loadState, saveState, HEADER } from '../extension/lib/state.js';

test('matchesQuery: inflection, case, excluded words', () => {
  assert.ok(matchesQuery('Продам драбину Hailo 3x6', 'драбина hailo'));
  assert.ok(!matchesQuery('Драбина Tolsen', 'драбина hailo'));
  assert.ok(!matchesQuery('Книга Драбина', 'драбина -книга'));
  assert.equal(siteQuery('драбина -книга hailo'), 'драбина hailo');
});

test('pick filters by max price and sorts cheapest first', () => {
  const items = [
    { title: 'Драбина', price: 900 },
    { title: 'Драбина', price: 300 },
    { title: 'Драбина', price: 5000 },
    { title: 'Стілець', price: 10 },
  ];
  assert.deepEqual(pick(items, { q: 'драбина', max: 1000 }).map((i) => i.price), [300, 900]);
});

test('parseAdd reads query and optional max price', () => {
  assert.deepEqual(parseAdd('драбина Hailo до 3 000'), { q: 'драбина Hailo', max: 3000 });
  assert.deepEqual(parseAdd('драбина'), { q: 'драбина', max: null });
  assert.equal(parseAdd('  '), null);
});

test('handleCommand add/list/del', () => {
  const data = { searches: [], nextId: 1 };
  assert.match(handleCommand('/add@bazarnyk_bot драбина до 2000', data), /Додано №1/);
  assert.deepEqual(data.searches[0], { id: 1, q: 'драбина', max: 2000, best: null });
  assert.match(handleCommand('/list', data), /1\. драбина \(до 2000 грн\)/);
  assert.match(handleCommand('/del 5', data), /Немає пошуку/);
  assert.match(handleCommand('/del 1', data), /Видалено/);
  assert.equal(data.searches.length, 0);
  assert.equal(handleCommand('привіт', data), null);
});

test('parseOlx takes price, photo size and city', () => {
  const json = {
    data: [
      {
        id: 7, title: 'Драбина', url: 'https://olx/7', location: { city: { name: 'Київ' } },
        photos: [{ link: 'https://img/x;s={width}x{height}' }],
        params: [{ key: 'price', value: { value: 2000 } }, { key: 'state', value: { key: 'used' } }],
      },
      { id: 8, title: 'Без ціни', url: 'https://olx/8', photos: [], params: [] },
    ],
  };
  assert.deepEqual(parseOlx(json), [
    { site: 'OLX', id: 'olx:7', title: 'Драбина', price: 2000, url: 'https://olx/7', photo: 'https://img/x;s=400x300', city: 'Київ' },
  ]);
});

test('parseProm reads Product JSON-LD, single and array offers', () => {
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const html =
    ld({ '@type': 'BreadcrumbList' }) +
    ld({ '@type': 'Product', name: 'Стрем&#39;янка', url: 'https://prom/1', image: ['https://img/1'], offers: { price: '398' } }) +
    ld({ '@type': 'Product', name: 'Драбина', url: 'https://prom/2', offers: [{ price: '1890' }] }) +
    '<script type="application/ld+json">{broken</script>';
  assert.deepEqual(parseProm(html).map((i) => [i.title, i.price, i.photo]), [
    ["Стрем'янка", 398, 'https://img/1'],
    ['Драбина', 1890, undefined],
  ]);
});

test('parseAllo reads product cards', () => {
  const card = (title, sum) =>
    `<div class="product-card"><img src="https://img/a.webp"><a href="https://allo/${sum}" title="${title}" class="product-card__title">${title}</a>` +
    `<div class="v-pb__price-row"><div class="v-pb__old"><span class="sum">2 000</span></div><div class="v-pb__cur"><span class="sum">${sum}</span></div></div></div>`;
  const items = parseAllo(`<html>${card('Драбина Tolsen', '1 793')}${card('Без ціни', '')}</html>`);
  assert.deepEqual(items, [
    { site: 'Allo', id: 'allo:https://allo/1 793', title: 'Драбина Tolsen', price: 1793, url: 'https://allo/1 793', photo: 'https://img/a.webp' },
  ]);
});

test('state round-trips through a pinned message', async () => {
  const calls = [];
  let pinned = null;
  const tg = async (method, body) => {
    calls.push(method);
    if (method === 'getChat') return { pinned_message: pinned };
    if (method === 'sendMessage') return { message_id: 42 };
    if (method === 'pinChatMessage') pinned = { message_id: 42, text: lastText };
    if (method === 'editMessageText') pinned.text = body.text;
    return true;
  };
  let lastText;
  const wrapped = (m, b) => ((lastText = b?.text ?? lastText), tg(m, b));

  const s = await loadState(wrapped, 1);
  assert.deepEqual(s.data, { searches: [], nextId: 1 });
  s.data.searches.push({ id: 1, q: 'драбина' });
  await saveState(wrapped, 1, s);
  assert.ok(pinned.text.startsWith(HEADER));

  const again = await loadState(wrapped, 1);
  assert.equal(again.messageId, 42);
  again.data.nextId = 2;
  await saveState(wrapped, 1, again);
  assert.deepEqual(calls, ['getChat', 'sendMessage', 'pinChatMessage', 'getChat', 'editMessageText']);
  assert.equal(JSON.parse(pinned.text.slice(HEADER.length)).nextId, 2);
});
