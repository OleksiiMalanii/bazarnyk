import { parseCode, workerApi } from './lib/connection.js';
import { SITES, settingsOf, everyLabel } from './lib/sites.js';

const $ = (id) => document.getElementById(id);

async function show() {
  const { connection, status = '' } = await chrome.storage.local.get(['connection', 'status']);
  $('setup').hidden = Boolean(connection);
  $('main').hidden = !connection;
  if (!connection) return;

  $('status').textContent = status;
  try {
    const data = await (await workerApi(connection)).state();
    const { sites, every } = settingsOf(data);
    const here = SITES.filter((s) => s.where === 'browser' && sites.includes(s.id)).map((s) => s.name);
    $('sites').textContent = here.length
      ? `Тут шукаю: ${here.join(', ')} · ${every ? `кожні ${everyLabel(every)}` : 'без повторів'}`
      : 'У боті вимкнені всі сайти, які шукає браузер (OLX, Алло). Увімкни їх у ⚙️ Налаштування.';
    renderSearches(connection, data.searches);
  } catch (e) {
    $('sites').textContent = '';
    $('status').textContent = `⚠️ ${e.message}`;
  }
}

const statusOf = (s) => (s.raw || !s.ready ? '⏳ налаштовую фільтри…' : s.paused ? '⏸ на паузі' : '✅ готовий до пошуку');

// One row per search: name, price limit, status and a delete button.
function renderSearches(connection, searches) {
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
    const del = document.createElement('button');
    del.textContent = '🗑';
    del.title = del.ariaLabel = `Видалити «${s.q}»`;
    del.onclick = async () => {
      // Two taps instead of confirm(): dialogs can close an extension popup.
      if (del.textContent === '🗑') {
        del.textContent = 'Видалити?';
        return;
      }
      del.disabled = true;
      try {
        renderSearches(connection, (await (await workerApi(connection)).remove(s.id)).searches);
      } catch (e) {
        $('status').textContent = `⚠️ ${e.message}`;
        del.disabled = false;
      }
    };
    li.append(name, del);
    return li;
  }));
}

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
