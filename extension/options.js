import { parseCode, workerApi } from './lib/connection.js';
import { SITES, settingsOf, everyLabel } from './lib/sites.js';

const $ = (id) => document.getElementById(id);

async function show() {
  const { connection, status = '' } = await chrome.storage.local.get(['connection', 'status']);
  $('setup').hidden = Boolean(connection);
  $('main').hidden = !connection;
  if (!connection) return;

  $('status').textContent = status;
  // Opening the popup counts as seeing the new finds: clear the number on the icon.
  chrome.storage.local.set({ unread: 0 });
  chrome.action.setBadgeText({ text: '' });
  try {
    const data = await (await workerApi(connection)).state();
    const { sites, every } = settingsOf(data);
    const here = SITES.filter((s) => s.where === 'browser' && sites.includes(s.id)).map((s) => s.name);
    $('sites').textContent = here.length
      ? `Тут шукаю: ${here.join(', ')} · ${every ? `кожні ${everyLabel(every)}` : 'без повторів'}`
      : 'У боті вимкнені всі сайти, які шукає браузер (OLX, Алло). Увімкни їх у ⚙️ Налаштування.';
    await renderSearches(connection, data.searches);
  } catch (e) {
    $('sites').textContent = '';
    $('status').textContent = `⚠️ ${e.message}`;
  }
}

const statusOf = (s) => (s.raw || !s.ready ? '⏳ налаштовую фільтри…' : s.paused ? '⏸ на паузі' : '✅ готовий до пошуку');

// Cheapest known price: shops checked in the cloud (s.best), Allo and OLX checked here.
async function bestPrices(searches) {
  const { shopBest = {}, olxBest = {} } = await chrome.storage.local.get(['shopBest', 'olxBest']);
  return Object.fromEntries(searches.map((s) => [s.id, [s.best, shopBest[s.id], olxBest[s.id]].filter(Boolean).sort((a, b) => a.price - b.price)[0]]));
}

const button = (text, label, onclick) => {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = b.ariaLabel = label;
  b.onclick = onclick;
  return b;
};

// Runs a list edit through the Worker and redraws the list; errors go to the status line.
async function edit(connection, action, btn) {
  btn.disabled = true;
  try {
    await renderSearches(connection, (await action(await workerApi(connection))).searches);
    return true;
  } catch (e) {
    $('status').textContent = `⚠️ ${e.message}`;
    btn.disabled = false;
    return false;
  }
}

// One row per search: name, price limit, status, cheapest price found, pause and delete buttons.
async function renderSearches(connection, searches) {
  const best = await bestPrices(searches);
  $('searchesTitle').textContent = `Що шукаю (${searches.length})`;
  $('noSearches').hidden = searches.length > 0;
  $('searches').replaceChildren(...searches.map((s) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${s.q}${s.max ? ` — до ${s.max} грн` : ''}`;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = statusOf(s);
    name.append(tag);
    const b = best[s.id];
    if (b) {
      const line = document.createElement('span');
      line.className = 'best';
      const a = document.createElement('a');
      a.href = b.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = `💰 ${b.price.toLocaleString('uk-UA')} грн · ${b.site} ↗`;
      line.append(a);
      name.append(line);
    }
    const pause = button(s.paused ? '▶️' : '⏸', `${s.paused ? 'Відновити' : 'Поставити на паузу'} «${s.q}»`, () => edit(connection, (api) => api.pause(s.id), pause));
    const del = button('🗑', `Видалити «${s.q}»`, () => {
      // Two taps instead of confirm(): dialogs can close an extension popup.
      if (del.textContent === '🗑') del.textContent = 'Видалити?';
      else edit(connection, (api) => api.remove(s.id), del);
    });
    li.append(name, pause, del);
    return li;
  }));
}

$('addForm').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('addText').value.trim();
  if (!text) return;
  const { connection } = await chrome.storage.local.get('connection');
  if (await edit(connection, (api) => api.add(text), $('addBtn'))) {
    $('addText').value = '';
    $('addBtn').disabled = false;
    $('status').textContent = '✅ Додав. Бот напише в Telegram, коли налаштує фільтри (за кілька хвилин).';
  }
};

$('connect').onclick = async () => {
  const connection = parseCode($('code').value);
  if (!connection) {
    $('setupError').textContent = 'Це не схоже на код. Скопіюй увесь код з повідомлення бота — він починається з https://';
    return;
  }
  $('connect').disabled = true;
  $('setupError').textContent = 'Перевіряю…';
  try {
    await (await workerApi(connection)).state(); // proves the code works before saving it
    await chrome.storage.local.set({ connection, status: 'Підключено. Перша перевірка — протягом хвилини.' });
    $('setupError').textContent = '';
    chrome.runtime.sendMessage('check-now');
    await show();
  } catch (e) {
    $('setupError').textContent = e.message;
  } finally {
    $('connect').disabled = false;
  }
};

$('check').onclick = async () => {
  $('check').disabled = true;
  $('status').textContent = 'Шукаю…';
  $('status').textContent = await chrome.runtime.sendMessage('check-now');
  $('check').disabled = false;
};

$('disconnect').onclick = async () => {
  await chrome.storage.local.remove(['connection', 'status']);
  await show();
};

show();
