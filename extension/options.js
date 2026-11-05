import { parseCode, workerApi } from './lib/connection.js';
import { SITES, settingsOf, everyLabel } from './lib/sites.js';

const $ = (id) => document.getElementById(id);

async function show() {
  const { connection, status = '' } = await chrome.storage.local.get(['connection', 'status']);
  $('setup').hidden = Boolean(connection);
  $('main').hidden = !connection;
  $('connected').hidden = !connection;
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
      ? `🖥 Цей браузер шукає на: ${here.join(', ')} · ${every ? `кожні ${everyLabel(every)}` : 'без повторів'}`
      : 'У боті вимкнені всі сайти, які шукає браузер (OLX, Алло). Увімкни їх у ⚙️ Налаштування.';
    await renderSearches(connection, data.searches);
  } catch (e) {
    $('sites').textContent = '';
    $('status').textContent = `⚠️ ${e.message}`;
  }
}

const statusOf = (s) => (s.raw || !s.ready ? ['setup', 'Налаштовую фільтри…'] : s.paused ? ['paused', 'На паузі'] : ['ready', 'Шукаю']);
const money = (n) => `${n.toLocaleString('uk-UA')} грн`;

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

// Cheapest known price: shops checked in the cloud (s.best), Allo and OLX checked here.
async function bestPrices(searches) {
  const { shopBest = {}, olxBest = {} } = await chrome.storage.local.get(['shopBest', 'olxBest']);
  return Object.fromEntries(searches.map((s) => [s.id, [s.best, shopBest[s.id], olxBest[s.id]].filter(Boolean).sort((a, b) => a.price - b.price)[0]]));
}

const button = (text, label, onclick) => {
  const b = el('button', 'icon', text);
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
  $('count').textContent = searches.length;
  $('noSearches').hidden = searches.length > 0;
  $('searches').replaceChildren(...searches.map((s) => {
    const li = el('li', s.paused ? 'paused' : '');
    const info = el('div', 'info');
    const [kind, label] = statusOf(s);
    const meta = el('div', 'meta');
    meta.append(el('span', `chip ${kind}`, label));
    if (s.max) meta.append(el('span', 'limit', `до ${money(s.max)}`));
    info.append(el('div', 'q', s.q), meta);
    const b = best[s.id];
    if (b) {
      const a = el('a', 'best');
      a.href = b.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = 'Відкрити найдешевшу знахідку';
      a.append(el('b', '', money(b.price)), el('span', '', `· ${b.site} ↗`));
      info.append(a);
    }
    const pause = button(s.paused ? '▶️' : '⏸', `${s.paused ? 'Відновити' : 'Поставити на паузу'} «${s.q}»`, () => edit(connection, (api) => api.pause(s.id), pause));
    const del = button('🗑', `Видалити «${s.q}»`, () => {
      // Two taps instead of confirm(): dialogs can close an extension popup.
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm');
        del.textContent = 'Видалити?';
      } else edit(connection, (api) => api.remove(s.id), del);
    });
    const actions = el('div', 'actions');
    actions.append(pause, del);
    li.append(info, actions);
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
    $('status').textContent = '✅ Додав. Коли фільтри будуть готові, бот напише в Telegram (за кілька хвилин).';
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
