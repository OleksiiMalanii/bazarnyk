// OLX blocks non-browser clients, so this runs only inside the Chrome extension.
export async function olx(query, max, sort = 'created_at:desc') {
  const params = new URLSearchParams({ query, limit: '50', sort_by: sort, 'filter_enum_state[0]': 'used' });
  if (max) params.set('filter_float_price:to', String(max));
  const res = await fetch(`https://www.olx.ua/api/v1/offers/?${params}`);
  if (!res.ok) throw new Error(`OLX ${res.status}`);
  return parseOlx(await res.json());
}

export function parseOlx(json) {
  return json.data
    .map((o) => {
      const price = o.params.find((p) => p.key === 'price')?.value?.value;
      return price && {
        site: 'OLX',
        id: `olx:${o.id}`,
        title: o.title,
        price,
        url: o.url,
        photo: o.photos?.[0]?.link.replace('{width}x{height}', '400x300'),
        city: o.location?.city?.name,
      };
    })
    .filter(Boolean);
}
