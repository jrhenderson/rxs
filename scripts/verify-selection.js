#!/usr/bin/env node
// Manual verification for lib/selectMatch.js against real live API data.
// Not a CI test (no framework/dependency is added per the project's
// zero-dependency constraint) — run by hand: `node scripts/verify-selection.js`.

import { findVenueMatch } from '../lib/selectMatch.js';

const ENDPOINT = 'https://rugby-au-cms.graphcdn.app/';
const QUERY = `
  query EntityFixturesAndResults($entityId: Int, $entityType: String, $season: String, $comps: [CompInput], $type: String, $limit: Int, $skip: Int) {
    getEntityFixturesAndResults(entityId: $entityId, entityType: $entityType, season: $season, comps: $comps, type: $type, limit: $limit, skip: $skip) {
      id compId compName dateTime round roundLabel status isLive venue
      homeTeam { name score crest }
      awayTeam { name score crest }
    }
  }
`;

async function fetchList(type, comps) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: QUERY,
      variables: { entityId: 30895, entityType: 'association', season: '2026', comps: comps || [], type, limit: comps ? 60 : 40, skip: 0 },
    }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data.getEntityFixturesAndResults;
}

// Mirrors app.js's hydrateCrests: the association-wide query only ever
// returns one generic shared crest for every team; scoping to the match's
// specific competition returns real per-team crests.
async function hydrateCrests(fixture, state) {
  if (!fixture) return fixture;
  const type = state === 'upcoming' ? 'fixtures' : 'results';
  const compScoped = await fetchList(type, [{ id: fixture.compId }]);
  return compScoped.find((f) => f.id === fixture.id) || fixture;
}

const windows = { preMs: 30 * 60 * 1000, postMs: 90 * 60 * 1000 };

async function main() {
  const [results, fixtures] = await Promise.all([fetchList('results'), fetchList('fixtures')]);
  console.log(`Fetched ${results.length} results, ${fixtures.length} fixtures for season 2026.\n`);

  const venuesToTry = [
    results[0]?.venue,       // should resolve to 'recent' or 'current'/'live' depending on wall-clock time
    fixtures[0]?.venue,      // should resolve to 'upcoming'
    'Nonexistent Ground XYZ', // should resolve to 'idle'
  ].filter(Boolean);

  for (const venue of venuesToTry) {
    const selection = findVenueMatch(results, fixtures, venue, Date.now(), windows);
    if (selection.fixture) {
      const before = selection.fixture.homeTeam?.crest;
      const hydrated = await hydrateCrests(selection.fixture, selection.state);
      const after = hydrated.homeTeam?.crest;
      console.log(`VENUE="${venue}" ->`, selection.state,
        `| ${hydrated.homeTeam?.name} vs ${hydrated.awayTeam?.name} (${hydrated.dateTime})`);
      console.log(`  crest before hydration: ${before}`);
      console.log(`  crest after hydration:  ${after} ${after !== before ? '(changed — real crest found)' : '(unchanged)'}`);
    } else {
      console.log(`VENUE="${venue}" ->`, selection.state);
    }
  }

  // idle: no venue configured at all
  console.log('\nVENUE="" ->', findVenueMatch(results, fixtures, '', Date.now(), windows).state);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
