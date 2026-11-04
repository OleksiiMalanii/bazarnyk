// Live check that shop parsers still work: npm run smoke -- "драбина"
import { prom } from '../extension/lib/prom.js';
import { allo } from '../extension/lib/allo.js';
import { pick } from '../extension/lib/match.js';

const q = process.argv[2] ?? 'драбина';
for (const [name, f] of Object.entries({ prom, allo })) {
  const items = await f(q);
  const matched = pick(items, { q });
  console.log(`${name}: ${items.length} parsed, ${matched.length} match "${q}"`, matched[0] ?? '');
  if (!items.length || items.some((i) => !i.title || !(i.price > 0) || !i.url)) process.exitCode = 1;
}
