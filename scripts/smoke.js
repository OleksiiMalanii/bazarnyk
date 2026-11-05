// Live check that shop parsers still work and which sites answer from here:
// npm run smoke -- "навушники jbl"   (GitHub: Actions → smoke → Run workflow)
import { SITES } from '../extension/lib/sites.js';

const q = process.argv[2] ?? 'навушники jbl';
for (const site of SITES.filter((s) => s.search)) {
  try {
    const items = await site.search(q);
    const ok = items.length && items.every((i) => i.title && i.price > 0 && i.url.startsWith('https://'));
    console.log(`${ok ? 'OK  ' : 'BAD '} ${site.id}: ${items.length} items`, items[0] ? `${items[0].price} ${items[0].title}` : '');
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.log(`FAIL ${site.id}: ${e.message}`);
    process.exitCode = 1;
  }
}
