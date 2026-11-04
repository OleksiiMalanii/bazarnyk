const $ = (id) => document.getElementById(id);

const { token = '', chatId = '', status = '' } = await chrome.storage.local.get(['token', 'chatId', 'status']);
$('token').value = token;
$('chatId').value = chatId;
$('status').textContent = status;

$('save').onclick = async () => {
  await chrome.storage.local.set({ token: $('token').value.trim(), chatId: $('chatId').value.trim() });
  $('status').textContent = 'Збережено';
};

$('check').onclick = async () => {
  $('status').textContent = 'Перевіряю…';
  $('status').textContent = await chrome.runtime.sendMessage('check-now');
};
