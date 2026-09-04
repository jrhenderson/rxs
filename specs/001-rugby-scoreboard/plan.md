# Plan 001: Venue Rugby Scoreboard Kiosk

Implements `spec.md`. No framework, no bundler, no runtime dependencies —
plain HTML/CSS/ES module JS, so the kiosk browser has as little to go wrong
as possible and the whole thing is auditable at a glance.

## Architecture

```
index.html          entry point, loads config.js then app.js as a module
config.js            GENERATED at build/deploy time from .env, gitignored
                      (.env.example documents every key; no separate template needed)
styles.css           full-screen scoreboard layout, light/dark-safe
app.js               fetch, rendering, scheduling (imports selection logic)
lib/selectMatch.js  pure venue/time selection logic, no DOM — importable
                      standalone for verification (scripts/verify-selection.js)
scripts/generate-config.cjs  tiny zero-dependency .env -> config.js writer
scripts/serve.cjs            zero-dependency static file server for local dev
scripts/verify-selection.js  manual check of lib/selectMatch.js vs live data
.github/workflows/deploy.yml GitHub Actions: generate config, publish Pages
assets/              static fallback logo / favicon
specs/001-rugby-scoreboard/  this spec/plan/tasks
schema.graphql, test/        prior reverse-engineering notes, kept for reference
```

No build tool is needed to *bundle* JS (one small ES module is plenty), but a
build **step** is still required to turn `.env` into `config.js` before the
static files are usable — this runs both in local dev (`npm run dev`) and in
CI (`npm run build`, using GitHub Actions repository variables instead of a
committed `.env`).

## Configuration pipeline

1. `.env.example` documents all keys (mirrors the table in spec.md).
2. Local dev: copy to `.env`, run `npm run dev`, which runs
   `scripts/generate-config.cjs` (parses `.env` with a small manual parser —
   no `dotenv` dependency needed for `KEY=value` lines) to emit `config.js`
   as `window.__CONFIG__ = {...}`, then serves the directory with Node's
   built-in `http` server (`node scripts/serve.cjs`) on `localhost:8080`.
3. CI/deploy: the GitHub Actions workflow passes GitHub Actions **repository
   variables** (`vars.VENUE`, `vars.SEASON`, etc.) as environment variables
   to the same `generate-config.cjs` (which reads `process.env` before
   falling back to `.env`/defaults) — so the venue can be changed
   per-deployment without committing anything, and no `.env` file is needed
   in CI at all. Only `VENUE` needs a repo variable set; the rest fall back
   to their defaults. This relies on `generate-config.cjs` treating an empty
   string as "not set" (not just `null`/`undefined`): the workflow always
   passes every key as an env var, and GitHub Actions resolves an unset
   `vars.X` to `''` rather than omitting it — plain `??` would have baked
   that empty string in over the default (and silently turned numeric
   defaults into `0` via `Number('')`).
4. `config.js` is gitignored (never committed) so different environments
   (a dev machine vs. a specific kiosk's CI build) can carry different
   venues without merge conflicts.
5. Runtime override: `app.js` reads `?venue=` from `location.search` and, if
   present, overrides `CONFIG.VENUE` for that page load only — lets several
   physical kiosks point at one deployed URL with different `?venue=` values
   if that's more convenient than separate builds. `.env`/`config.js` stays
   the source of truth per spec's requirement.

## Data layer (`app.js`)

- `fetchGraphQL(query, variables)`: single `fetch()` POST helper, JSON body,
  `Content-Type: application/json`, no auth needed (confirmed against the
  live endpoint).
- Two queries per poll, matching confirmed API sort behavior (see spec.md
  Background): `type: "results"` (limit 40, already newest-first) and
  `type: "fixtures"` (limit 40, already soonest-first). Two queries avoid the
  observed pitfall where an unfiltered/empty `type` mixes in far-future
  outlier fixtures ahead of "today" in the sort order.
- `findVenueMatch(results, fixtures, venue, now, windows)` (`lib/selectMatch.js`):
  1. Filter both lists to `venue` (case-insensitive, trimmed, exact match).
  2. `latestResult = results[0]` after filtering (already newest-first).
  3. `nextFixture` = the first entry (soonest-first) whose post-match window
     hasn't fully elapsed yet AND whose kickoff is within a 14-day horizon.
     Not simply `fixtures[0]`: verified live that (a) some very young grades
     (Minis Tri Time) never get a result recorded, leaving an unplayed
     fixture from days ago at the front of the list indefinitely, and (b)
     the feed can carry a single far-future outlier (observed: a finals
     placeholder dated ~11 months out) that would otherwise become "Next
     Match" for the rest of the year once the real season is finished.
  4. Compute eligibility windows from `PRE_MATCH_WINDOW_MINUTES` /
     `POST_MATCH_WINDOW_MINUTES` around each candidate's `dateTime`.
  5. Selection priority: any candidate with `isLive === true` > whichever
     in-window candidate kicked off most recently > nearest upcoming
     fixture ("Next Match" state) > latest past result ("Last Result"
     state) > idle (no data for venue at all in season). A fixture-sourced
     candidate within its window is `live` once `now` has passed its
     kickoff, `upcoming` before it — **not** gated on `isLive`. Verified
     live: `isLive` can still read `false`, with `status` still `"Fixture"`,
     on a match that has visibly kicked off and already has a real score on
     `homeTeam`/`awayTeam.score` (observed: 5–0 seven minutes after
     kickoff). Trusting only `isLive` left the scoreboard blanking a live
     score under the `upcoming` render branch — wall-clock time is the more
     reliable signal here.
     **Bug fixed**: back-to-back matches at the same venue routinely
     overlap — the previous result's post-match window and the next
     fixture's pre-match window both contain `now` at once (verified live:
     a finished match's 90-min window was still open when the next game at
     the same venue kicked off). Originally picked whichever candidate came
     first in array order, which was always the previous *result* (built as
     `[latestResult, nextFixture]`) — so the display froze on an old
     finished score and never advanced to the new live match. Reported by
     user ("page has not automatically transitioned to the next live
     game"), reproduced against the exact overlap, fixed by preferring the
     in-window candidate with the later kickoff.
  6. Returns `{ state: 'live'|'current'|'upcoming'|'recent'|'idle', fixture,
     source: 'result'|'fixture'|null }` — `source` says which raw list the
     fixture actually came from, independent of `state`. Needed because a
     `live` match (see step 5) can still only exist in the fixtures list,
     not yet in results.
- `hydrateCrests(fixture, source)`: the association-wide query above
  (`comps: []`) only ever returns one generic shared placeholder crest for
  every team — verified live across a full season, no exceptions. Scoping
  the *same* query to the selected match's specific competition (`comps:
  [{ id: fixture.compId }]`) returns each team's real linked crest. So once
  `findVenueMatch` picks a fixture, `app.js` re-queries once more scoped to
  that one competition (`type` = `'fixtures'` when `source === 'fixture'`,
  else `'results'`; limit 60, comfortably covers one grade's whole season)
  and looks up the same `id` in that richer result to use for rendering.
  Falls back to the original (generic-crest) fixture if the lookup fails or
  doesn't find the id, so a hydration hiccup never blanks the display.
  **Bug fixed**: this was originally keyed off display `state`
  (`'upcoming' -> 'fixtures'`, else `'results'`), which broke the moment
  `state: 'live'` could come from a fixture-sourced match (see step 5) —
  the hydration query went to `results`, didn't find the id (the match
  wasn't there yet), and silently fell back to the generic crest on an
  actively live match. Reported by user, reproduced against the live match
  that triggered it, fixed by keying off `source` instead of `state`.
- Polling: `setInterval` at `REFRESH_INTERVAL_SECONDS`, plus an immediate
  fetch on load. Each poll is wrapped in try/catch; failures increment a
  `consecutiveFailures` counter driving a stale-data indicator (spec AC3)
  and simple exponential backoff capped at 5x the base interval, resetting
  on success.
- Kiosk stability: `setTimeout` scheduled hard `location.reload()` every
  `PAGE_RELOAD_HOURS`, and a top-level `window.onerror` /
  `unhandledrejection` handler that logs to console and lets polling
  continue rather than letting one bad frame wedge the display.

## Rendering

- Pure DOM updates (`textContent`/`src` assignment) into a fixed template
  already in `index.html` — no re-render/diffing framework needed for a
  screen this simple, and it avoids layout flicker on each poll.
- States rendered:
  - `live`/`current`: team crests + names, score, competition/grade, round,
    venue, badge (`LIVE` pulsing if `isLive`, else `FULL TIME` / status text
    uppercased for non-Result statuses like `FORFEIT`).
  - `upcoming`: team names + crests (no score yet), kickoff time in
    `TIMEZONE`, live-updating countdown.
  - `recent`: same as current but explicitly labeled "Last Result" plus
    kickoff date (season likely over for that venue).
  - `idle`: venue name, "No matches scheduled this season", club branding.
- A small corner indicator shows last-successful-update time and turns
  amber/red once `consecutiveFailures > 0` (never removes the last good
  match data).
- A large clock in `CONFIG.TIMEZONE` (`renderClock()`) sits centered above
  the match/idle content, ticked every second by the same interval that
  drives the upcoming-match countdown — independent of the data poll, so it
  stays accurate even while stale/erroring, and is visible in every state
  (including idle).
- Crest `<img>` has `onerror` fallback to a local placeholder in `assets/`
  (API crests are hotlinked third-party URLs and can 404/change).
- Target hardware (per user, confirmed 2026-09-04): a full 1080p LED
  scoreboard panel driven by direct HDMI (kiosk PC's output = the panel,
  no separate video processor pinning a different fixed resolution) — so
  crests render at full photographic fidelity, not just as flat shapes,
  and the existing `vh`/`vw`-relative CSS needs no aspect-ratio rework.
  Crest size (`.crest` in `styles.css`) was bumped from 18vh to 28vh, and
  the competition/round line (`.comp-line`) from 3vh to 4.4vh (plus
  semi-bold weight), for legibility at oval-side viewing distance on this
  panel.

## Deployment (GitHub Pages)

- `.github/workflows/deploy.yml`: on push to `main`, checkout, run
  `scripts/generate-config.cjs` using repo variables as env, assemble only
  the static files actually needed (`index.html`, `styles.css`, `app.js`,
  `config.js`, `assets/`, `lib/` — `specs/`, `test/`, `schema.graphql`
  excluded) into a `site/` directory, upload it via
  `actions/upload-pages-artifact`, deploy via `actions/deploy-pages`.
- Repo Settings → Pages → Source: GitHub Actions (documented in README).
- Kiosk device: full-screen browser (e.g. Chromium `--kiosk`) pointed at the
  published Pages URL (optionally with `?venue=...`).

## Testing approach

- No test framework/dependency added (kept zero-dependency per the "as
  little as possible to break in a kiosk" goal).
- `scripts/generate-config.cjs` is exercised manually against `.env.example`
  as part of `npm run dev`.
- `findVenueMatch` (`lib/selectMatch.js`) is the one piece of real business
  logic; it's a pure function of `(results, fixtures, venue, now, windows)`
  with no DOM/fetch dependency, so `scripts/verify-selection.js` can `import`
  it directly under plain Node and run it against real data fetched live
  from the API for a handful of scenarios (live/current/upcoming/recent/idle).
  No unit test framework is introduced given the project's zero-dependency
  constraint, but the function boundary is real, not just conceptual, so a
  framework could be added later without refactoring `app.js`.

## Explicit decisions / assumptions (flagged for user review)

- Default `PRE_MATCH_WINDOW_MINUTES=30` / `POST_MATCH_WINDOW_MINUTES=90`:
  not specified by the user; chosen to comfortably cover a youth rugby
  match (typically well under 90 minutes total) plus a warm-up and a
  post-match lingering-scoreboard period. Configurable.
- `REFRESH_INTERVAL_SECONDS=5` (explicit user request, overriding the
  original default of 60): the API rate-limits on two axes per response
  headers — a request-count budget (`budget=500`, refill ~4-5/sec, easily
  sustained at this rate) and a query-complexity budget (`budget=1000000`,
  ~880 points per real fixtures/results query, refill only ~9-10/sec). At
  5s with up to 3 requests/cycle (results + fixtures + crest hydration),
  complexity drains faster than it refills — sustained over many hours this
  can trip the limit. This isn't fatal: a rejected poll is just a caught
  error, so the existing backoff (`app.js` `poll()`) and stale-data
  indicator (spec AC3) take over automatically rather than blanking the
  display, and demand eases as soon as the budget recovers. Flagged here
  rather than silently using a more conservative default, since it was an
  explicit instruction. **Confirmed, not just theoretical**: this session's
  local dev server alone, left polling at 5s in the background for an
  extended stretch while other verification also hit the same API, fully
  exhausted the request-count budget (`remainingBudget: 0`) and started
  getting rejected — recovered within ~20s once that one instance stopped
  polling. A single kiosk is a much lighter, steadier load than that
  combination, but this is a real, observed ceiling, not just a header
  reading.
- Venue matching is exact-string (case-insensitive/trimmed) against the
  `venue` field as returned by the API, not fuzzy — venue names observed in
  live data are specific enough (e.g. `Nagle Park Field 2` vs `Field 1`)
  that fuzzy matching risks picking the wrong field at a shared ground.
