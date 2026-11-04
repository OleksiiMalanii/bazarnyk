import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stem } from '../extension/lib/match.js';

// One AI call per /add (not per check), so a Claude subscription or a free API tier is plenty.
const PROMPT =
  'Користувач шукає товар на OLX і в інтернет-магазинах. Напиши 10–20 коротких слів через кому, ' +
  'які часто бувають у НАЗВАХ нерелевантних оголошень за цим запитом (іграшки, книги, запчастини, ' +
  'сировина, інші товари з тим самим словом), але НЕ бувають у назвах потрібного товару. ' +
  'Пиши українською, і якщо буває, ще російською. Лише слова через кому, без пояснень.';

// Claude subscription: Claude Code in print mode, authenticated by CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`.
async function askClaude(query) {
  const args = ['-y', '@anthropic-ai/claude-code@2.1.302', '-p', query, '--system-prompt', PROMPT, '--model', 'haiku', '--tools', '', '--output-format', 'text'];
  const { stdout } = await promisify(execFile)('npx', args, { timeout: 180_000 });
  return stdout;
}

// OpenRouter keys start with "sk-or-"; "openrouter/free" routes to whichever free model is available.
const defaults = (apiKey) =>
  apiKey.startsWith('sk-or-')
    ? { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' }
    : { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' };

// Any OpenAI-compatible API: DeepSeek, OpenRouter, Groq, Gemini.
async function askApi(query, { apiKey, baseUrl = defaults(apiKey).baseUrl, model = defaults(apiKey).model }) {
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
  return (await res.json()).choices[0].message.content;
}

export async function suggestExcludes(query, ai) {
  return parseWords(ai.claude ? await askClaude(query) : await askApi(query, ai), query);
}

// Never exclude a form of a word the user is searching for ("драбинка" would hide every "драбина").
export function parseWords(text, query) {
  const wanted = query.toLowerCase().split(/\s+/).filter((w) => w && !w.startsWith('-'));
  const words = text.toLowerCase().match(/[\p{L}\d'ʼ-]{3,}/gu) ?? [];
  return [...new Set(words)]
    .filter((w) => !wanted.some((q) => q.includes(stem(w)) || w.includes(stem(q))))
    .slice(0, 25);
}
