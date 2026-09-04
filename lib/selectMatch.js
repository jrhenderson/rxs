// Pure venue/time selection logic — no DOM, no fetch. Isolated so it can be
// exercised directly (see scripts/verify-selection.js) without a browser.
// See specs/001-rugby-scoreboard/plan.md "Data layer".

// Verified live: the CMS occasionally carries a single far-future "Fixture"
// entry (observed: a finals placeholder dated ~11 months out) alongside an
// otherwise-finished season. Without a horizon, that outlier becomes "Next
// Match" for the rest of the year. Matches spec.md's out-of-season -> idle
// intent rather than a new .env knob, since it's a data-quality guard, not a
// deployment setting.
const FUTURE_FIXTURE_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;

function byVenue(list, venue) {
  const target = venue.trim().toLowerCase();
  return list.filter((f) => (f.venue || '').trim().toLowerCase() === target);
}

// `source` tells the caller which raw list (results vs fixtures) a returned
// fixture actually came from — independent of the display `state` label.
// Needed because a match can be `state: 'live'` while still only present in
// the fixtures list (see the live-detection note below), so callers that
// need to re-query the API for this same match (e.g. app.js's crest
// hydration) must query the list it's actually found in, not infer the
// list from the display state.
export function findVenueMatch(results, fixtures, venue, now, windows) {
  const { preMs, postMs } = windows;

  if (!venue) {
    return { state: 'idle', fixture: null, source: null };
  }

  const resultCandidates = byVenue(results, venue);
  const fixtureCandidates = byVenue(fixtures, venue);

  const latestResult = resultCandidates[0] || null;
  // fixtureCandidates is soonest-first, but some grades (e.g. very young
  // Minis grades) never get a result recorded against a fixture — that
  // entry then sits at the front of the list indefinitely. Skip any
  // fixture whose display window has already fully elapsed, and any that's
  // implausibly far out, so a stale or outlier fixture doesn't get treated
  // as "next" forever.
  const nextFixture =
    fixtureCandidates.find((f) => {
      const kickoff = new Date(f.dateTime).getTime();
      return (
        kickoff + postMs >= now && kickoff <= now + FUTURE_FIXTURE_HORIZON_MS
      );
    }) || null;

  const withWindow = (item) => {
    const kickoff = new Date(item.dateTime).getTime();
    return {
      item,
      kickoff,
      inWindow: now >= kickoff - preMs && now <= kickoff + postMs,
    };
  };

  const candidates = [latestResult, nextFixture]
    .filter(Boolean)
    .map(withWindow);

  const live = candidates.find((c) => c.item.isLive);
  if (live) {
    const source = live.item === latestResult ? 'result' : 'fixture';
    return { state: 'live', fixture: live.item, source };
  }

  // Back-to-back matches at the same venue routinely overlap: the previous
  // result's post-match window and the next fixture's pre-match window both
  // contain `now` at once (verified live — a finished match's 90-min
  // window was still open when the next game at the same venue kicked off).
  // `latestResult` is always candidates[0], so a plain `.find()` would
  // freeze on the old finished match forever once a newer one starts.
  // Prefer whichever in-window candidate kicked off more recently.
  const inWindowCandidates = candidates.filter((c) => c.inWindow);
  const current = inWindowCandidates.reduce(
    (latest, c) => (!latest || c.kickoff > latest.kickoff ? c : latest),
    null
  );
  if (current) {
    if (current.item === latestResult) {
      return { state: 'current', fixture: current.item, source: 'result' };
    }
    // A fixture-sourced candidate within its window: verified live that the
    // API's own `isLive` flag can lag well behind reality — a match can be
    // underway with real score data already on homeTeam/awayTeam.score
    // while `isLive` still reads false and `status` is still "Fixture".
    // Once kickoff has passed, trust wall-clock time over that flag so the
    // scoreboard doesn't sit blanking a live score. Before kickoff it's
    // genuinely just upcoming.
    const state = now >= current.kickoff ? 'live' : 'upcoming';
    return { state, fixture: current.item, source: 'fixture' };
  }

  if (nextFixture) {
    return { state: 'upcoming', fixture: nextFixture, source: 'fixture' };
  }
  if (latestResult) {
    return { state: 'recent', fixture: latestResult, source: 'result' };
  }
  return { state: 'idle', fixture: null, source: null };
}
