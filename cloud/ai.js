import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stem } from '../extension/lib/match.js';

// One AI call per /add (not per check), so a Claude subscription or a free API tier is plenty.
const PROMPT =
  'Користувач шукає товар на OLX і в інтернет-магазинах. Напиши 10–20 коротких слів через кому, ' +
  'які часто бувають у НАЗВАХ нерелевантних оголошень за цим запитом (іграшки, книги, запчастини, ' +
  'сировина, інші товари з тим самим словом), але НЕ бувають у назвах потрібного товару. ' +
  'Лише іменники та прикметники, без службових слів (для, з, на). ' +
  'НЕ пиши слів, які можуть описувати сам потрібний товар: матеріали (сталева, алюмінієва, пластикова, дерев\'яна), ' +
  'розміри, кольори, стан, а також бренд і назву товару в інших мовах чи написаннях (для «iPhone» не пиши apple чи айфон). ' +
  'Кожне слово давай українською і російською (чохол, чехол). ' +
  'Приклад для «драбина»: книга, кузнєцова, іграшка, іграшкова, конструктор, lego, пожежна, машинка, швелер, арматура, ' +
  'шведська, гімнастична, турнік, книга, игрушка, конструктор. ' +
  'Почни відповідь одразу з першого слова: лише слова через кому, без вступу й пояснень.';

// Bump when the prompt or parsing changes: searches get their exclusions regenerated.
export const AI_VERSION = 4;

const PRICE_PROMPT =
  'Яка типова ціна вживаного товару за цим запитом на OLX в Україні, у гривнях? Відповідай лише одним числом.';

// Accessories and scrap are far cheaper than the real thing, so ignore anything under 30% of a typical used price.
export async function suggestMinPrice(query, max, ai) {
  return parseMinPrice(await ask(query, PRICE_PROMPT, ai), max);
}

export function parseMinPrice(reply, max) {
  const typical = Number(reply.replace(/(\d)[\s ](?=\d{3})/g, '$1').match(/\d+/)?.[0]);
  if (!(typical > 0)) return null;
  const min = Math.round((typical * 0.3) / 10) * 10;
  // Never let the floor eat the user's own budget.
  return max ? Math.min(min, Math.round(max / 2)) : min;
}

// Claude subscription: Claude Code in print mode, authenticated by CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`.
async function askClaude(query, system) {
  const args = ['-y', '@anthropic-ai/claude-code@2.1.302', '-p', query, '--system-prompt', system, '--model', 'haiku', '--tools', '', '--output-format', 'text'];
  const { stdout } = await promisify(execFile)('npx', args, { timeout: 180_000 });
  return stdout;
}

// OpenRouter keys start with "sk-or-"; "openrouter/free" routes to whichever free model is available.
const defaults = (apiKey) =>
  apiKey.startsWith('sk-or-')
    ? { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' }
    : { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' };

// Any OpenAI-compatible API: DeepSeek, OpenRouter, Groq, Gemini.
async function askApi(query, system, { apiKey, baseUrl = defaults(apiKey).baseUrl, model = defaults(apiKey).model }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: query },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).choices[0].message.content;
}

const ask = (text, system, ai) => (ai.claude ? askClaude(text, system) : askApi(text, system, ai));

export async function suggestExcludes(query, ai) {
  return parseWords(await ask(query, PROMPT, ai), query);
}

const REQUEST_PROMPT =
  'Користувач пише боту, який шукає товари на OLX і в інтернет-магазинах. Витягни з повідомлення, що шукати, ' +
  'і максимальну ціну в гривнях. Відповідай лише одним рядком JSON без пояснень: ' +
  '{"q": "коротка назва товару для пошуку, з брендом і моделлю, якщо вони є", "max": число або null}. ' +
  'Пиши назву так, як її пишуть в оголошеннях (бренди й моделі латиницею: iPhone, Bosch, Hailo), ' +
  'без слів про стан (б/у, новий, вживаний), бо б/в оголошення бот і так знаходить. ' +
  'Приклади: «пошукай мені драбину хайло до трьох тисяч» -> {"q": "драбина Hailo", "max": 3000}; ' +
  '«потрібен б/у перфоратор бош» -> {"q": "перфоратор Bosch", "max": null}; ' +
  '«айфон 13 до 12к» -> {"q": "iPhone 13", "max": 12000}. ' +
  'Якщо в повідомленні немає товару для пошуку, відповідай {"q": null}.';

// "пошукай мені драбину хайло до трьох тисяч" -> { q: 'драбина Hailo', max: 3000 }, or null if it is not a search.
export async function parseRequest(text, ai) {
  return parseRequestReply(await ask(text, REQUEST_PROMPT, ai));
}

export function parseRequestReply(reply) {
  const json = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
  const q = typeof json.q === 'string' ? json.q.trim() : '';
  return q ? { q, max: Number(json.max) > 0 ? Math.round(Number(json.max)) : null } : null;
}

// Never exclude a form of a word the user is searching for ("драбинка" would hide every "драбина").
export function parseWords(text, query) {
  const wanted = query.toLowerCase().split(/\s+/).filter((w) => w && !w.startsWith('-'));
  // Skip a preamble like "Ось слова…:" and any list item longer than two words (a sentence, not a keyword).
  const items = text.toLowerCase().split(':').pop().split(/[,\n]/).map((i) => i.trim().split(/\s+/)).filter((i) => i.length <= 2);
  // 4+ letters drops prepositions like "для", which would hide most real listings.
  const words = items.flat().map((w) => w.replace(/[^\p{L}\d'ʼ-]/gu, '')).filter((w) => w.length >= 4);
  return [...new Set(words)]
    .filter((w) => !wanted.some((q) => q.includes(stem(w)) || w.includes(stem(q))))
    .slice(0, 25);
}
