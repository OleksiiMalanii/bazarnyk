// The extension talks to the bot only through the user's Worker, authenticated by the key from
// "🧩 Підключити браузер". The code the bot gives is "<worker url>#<key>".
// shortcut: host_permissions cover *.workers.dev only; a Worker on a custom domain needs that domain added to the manifest.

export function parseCode(code) {
  const m = code.trim().match(/^(https:\/\/[^\s#]+?)\/?#([a-f0-9]{16,})$/i);
  return m && { url: m[1], key: m[2] };
}

export async function workerApi(connection) {
  connection ??= (await chrome.storage.local.get('connection')).connection;
  if (!connection) throw new Error('Розширення ще не підключене до бота');
  const call = async (path, init = {}) => {
    const res = await fetch(`${connection.url}${path}`, { ...init, headers: { 'x-ext-key': connection.key, 'content-type': 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Бот не відповідає (${res.status})`);
    return body;
  };
  return { state: () => call('/ext/state'), send: (text) => call('/ext/send', { method: 'POST', body: JSON.stringify({ text }) }) };
}
