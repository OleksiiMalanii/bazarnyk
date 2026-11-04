import { stem } from '../extension/lib/match.js';

// One AI call per /add (not per check), so even free tiers or DeepSeek's cents-per-million pricing are enough.
// Any OpenAI-compatible API works: DeepSeek (default), OpenRouter, Groq, Gemini.
const PROMPT =
  'Користувач шукає товар на OLX і в інтернет-магазинах. Напиши 10–20 коротких слів через кому, ' +
  'які часто бувають у НАЗВАХ нерелевантних оголошень за цим запитом (іграшки, книги, запчастини, ' +
  'сировина, інші товари з тим самим словом), але НЕ бувають у назвах потрібного товару. ' +
  'Пиши українською, і якщо буває, ще російською. Лише слова через кому, без пояснень.';

// OpenRouter keys start with "sk-or-"; "openrouter/free" routes to whichever free model is available.
const defaults = (apiKey) =>
  apiKey.startsWith('sk-or-')
    ? { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' }
    : { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' };

export async function suggestExcludes(query, { apiKey, baseUrl = defaults(apiKey).baseUrl, model = defaults(apiKey).model }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: query },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseWords((await res.json()).choices[0].message.content, query);
}

// Never exclude a form of a word the user is searching for ("драбинка" would hide every "драбина").
export function parseWords(text, query) {
  const wanted = query.toLowerCase().split(/\s+/).filter((w) => w && !w.startsWith('-'));
  const words = text.toLowerCase().match(/[\p{L}\d'ʼ-]{3,}/gu) ?? [];
  return [...new Set(words)]
    .filter((w) => !wanted.some((q) => q.includes(stem(w)) || w.includes(stem(q))))
    .slice(0, 25);
}
