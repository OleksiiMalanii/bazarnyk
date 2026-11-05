// Every site Bazarnyk can search. where: 'cloud' — the GitHub job; 'browser' — the extension
// (the site blocks servers, so it is searched from the user's own browser).
import { prom } from './prom.js';
import { allo } from './allo.js';
import { foxtrot, moyo, epicentr, eldorado, hotline } from './shops.js';

export const SITES = [
  { id: 'olx', name: 'OLX (б/в)', where: 'browser' }, // special: new listings, not lowest price
  { id: 'prom', name: 'Prom', where: 'cloud', search: prom },
  { id: 'hotline', name: 'Hotline', where: 'cloud', search: hotline },
  { id: 'epicentr', name: 'Епіцентр', where: 'cloud', search: epicentr },
  { id: 'foxtrot', name: 'Фокстрот', where: 'cloud', search: foxtrot },
  { id: 'moyo', name: 'MOYO', where: 'cloud', search: moyo },
  { id: 'eldorado', name: 'Ельдорадо', where: 'cloud', search: eldorado },
  { id: 'allo', name: 'Алло', where: 'browser', search: allo },
];

export const EVERY_OPTIONS = [30, 60, 120, 300]; // minutes

export const defaultSettings = () => ({ sites: SITES.map((s) => s.id), every: 60 });

export const settingsOf = (data) => ({ ...defaultSettings(), ...data.settings });

// Shop sites to search from `where`, limited to the ones the user turned on.
export const shopsFor = (data, where) => {
  const on = settingsOf(data).sites;
  return SITES.filter((s) => s.search && s.where === where && on.includes(s.id));
};

// A search is due when it was never checked or the chosen interval has passed (5 min slack for job timing).
export const isDue = (checkedAt, data, now = Date.now()) => !checkedAt || now - checkedAt >= (settingsOf(data).every - 5) * 60_000;
