import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, pick, siteQuery } from '../extension/lib/match.js';
import { parseAdd, parseFree, handleCommand, listButtons, BUTTONS } from '../extension/lib/commands.js';
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
  assert.deepEqual(parseAdd('велосипед до 5 тис грн'), { q: 'велосипед', max: 5000 });
});

test('handleCommand add/list/del', () => {
  const data = { searches: [], nextId: 1 };
  assert.match(handleCommand('/add@bazarnyk_bot драбина до 2000', data), /Шукаю: <b>драбина<\/b> до 2000 грн/);
  assert.deepEqual(data.searches[0], { id: 1, q: 'драбина', max: 2000, best: null });
  assert.match(handleCommand('/list', data), /1\. драбина \(до 2000 грн\)/);
  assert.match(handleCommand('/del 5', data), /вже немає/);
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

test('pick drops titles with AI-excluded words', () => {
  const items = [
    { title: 'Драбина алюмінієва', price: 900 },
    { title: 'Книга «Драбина»', price: 200 },
    { title: 'LEGO пожежна машина з драбиною', price: 700 },
  ];
  assert.deepEqual(pick(items, { q: 'драбина', not: ['книга', 'lego'] }).map((i) => i.price), [900]);
});

test('parseWords never excludes forms of the searched words', async () => {
  const { parseWords } = await import('../cloud/ai.js');
  assert.deepEqual(parseWords('Книга, драбинка, LEGO, іграшка, ok', 'драбина Hailo'), ['книга', 'lego', 'іграшка']);
  // Real Haiku answer with a preamble: no sentence words, no "для".
  const real = 'Ось слова, які зустрічаються в назвах нерелевантних оголошень за запитом: іграшкова, для ляльок, шведська стінка, брелок';
  assert.deepEqual(parseWords(real, 'драбина'), ['іграшкова', 'ляльок', 'шведська', 'стінка', 'брелок']);
});

test('buttons map to commands, list has delete buttons', () => {
  const data = { searches: [], nextId: 1 };
  assert.match(handleCommand(BUTTONS.add, data), /Напиши, що шукаєш/);
  handleCommand('/add драбина', data);
  assert.match(handleCommand(BUTTONS.list, data), /1\. драбина/);
  assert.deepEqual(listButtons(data).inline_keyboard, [[{ text: '🗑 1. драбина', callback_data: 'del:1' }]]);
  assert.equal(handleCommand('пошукай драбину', data), null); // free text is handled by the caller
});

test('parseFree strips request words without AI', () => {
  assert.deepEqual(parseFree('Пошукай мені драбину Hailo до 3000 грн'), { q: 'драбину Hailo', max: 3000 });
  assert.deepEqual(parseFree('потрібен перфоратор'), { q: 'перфоратор', max: null });
});

test('parseRequestReply reads the AI JSON answer', async () => {
  const { parseRequestReply } = await import('../cloud/ai.js');
  assert.deepEqual(parseRequestReply('{"q": "драбина Hailo", "max": 3000}'), { q: 'драбина Hailo', max: 3000 });
  assert.deepEqual(parseRequestReply('Ось: {"q": "перфоратор Bosch", "max": null}'), { q: 'перфоратор Bosch', max: null });
  assert.equal(parseRequestReply('{"q": null}'), null);
});

test('min price floor drops accessories and never exceeds half the budget', async () => {
  const { parseMinPrice } = await import('../cloud/ai.js');
  assert.equal(parseMinPrice('12 000', null), 3600);
  assert.equal(parseMinPrice('Приблизно 2500 грн', 3000), 750);
  assert.equal(parseMinPrice('12000', 4000), 2000);
  assert.equal(parseMinPrice('не знаю', null), null);
  const items = [{ title: 'Чохол iPhone 13', price: 25 }, { title: 'iPhone 13 128GB', price: 11000 }];
  assert.deepEqual(pick(items, { q: 'iPhone 13', min: 3600 }).map((i) => i.price), [11000]);
});

test('handleUpdate: free text, delete button, strangers', async () => {
  const { handleUpdate } = await import('../extension/lib/bot.js');
  const sent = [];
  const tg = async (method, body) => (method === 'sendMessage' && sent.push(body.text), true);
  const data = { searches: [], nextId: 1 };
  const ctx = { tg, chatId: 7, data, parse: async (t) => ({ q: t.replace('пошукай ', ''), max: null, raw: t }) };

  assert.equal(await handleUpdate({ message: { chat: { id: 9 }, text: 'пошукай драбину' } }, ctx), false);
  assert.equal(await handleUpdate({ message: { chat: { id: 7 }, text: 'пошукай драбину' } }, ctx), true);
  assert.equal(data.searches[0].q, 'драбину');
  assert.match(sent.at(-1), /Прийняв: «пошукай драбину»/);

  await handleUpdate({ callback_query: { id: 'x', data: 'del:1', message: { chat: { id: 7 } } } }, ctx);
  assert.equal(data.searches.length, 0);
  assert.match(sent.at(-1), /Видалено/);
});

test('saveMerged keeps searches the Worker added or deleted meanwhile', async () => {
  const { saveMerged, HEADER } = await import('../extension/lib/state.js');
  // Pinned list now: search 1 deleted by the Worker, search 3 added by it.
  let pinned = { message_id: 5, text: HEADER + JSON.stringify({ searches: [{ id: 2, q: 'b' }, { id: 3, q: 'c' }], nextId: 4 }) };
  const tg = async (method, body) => {
    if (method === 'getChat') return { pinned_message: pinned };
    if (method === 'editMessageText') pinned = { ...pinned, text: body.text };
    return true;
  };
  // The job's view: started with 1 and 2, updated both.
  const state = { messageId: 5, data: { searches: [{ id: 1, q: 'a', best: 1 }, { id: 2, q: 'b', best: 2 }], nextId: 3 } };
  await saveMerged(tg, 7, state);
  assert.deepEqual(JSON.parse(pinned.text.slice(HEADER.length)), { searches: [{ id: 2, q: 'b', best: 2 }, { id: 3, q: 'c' }], nextId: 4 });
});
