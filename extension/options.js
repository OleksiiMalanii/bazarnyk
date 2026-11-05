import { parseCode, workerApi } from './lib/connection.js';
import { SITES, settingsOf } from './lib/sites.js';

const $ = (id) => document.getElementById(id);
const everyLabel = (m) => (m < 60 ? `${m} хв` : `${m / 60} год`);

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
      ? `Тут шукаю: ${here.join(', ')} · кожні ${everyLabel(every)}`
      : 'У боті вимкнені всі сайти, які шукає браузер (OLX, Алло). Увімкни їх у ⚙️ Налаштування.';
    $('searches').replaceChildren(...data.searches.map((s) => {
      const li = document.createElement('li');
      li.textContent = `${s.q}${s.max ? ` — до ${s.max} грн` : ''}${s.raw ? ' (уточнюю…)' : ''}`;
      return li;
    }));
    $('noSearches').hidden = data.searches.length > 0;
  } catch (e) {
    $('sites').textContent = '';
    $('status').textContent = `⚠️ ${e.message}`;
  }
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
