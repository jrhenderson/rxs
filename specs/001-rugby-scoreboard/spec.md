# Spec 001: Venue Rugby Scoreboard Kiosk

## Purpose

A non-interactive, single-page display for a wall-mounted or pitch-side monitor
running in kiosk mode. It shows the current or most relevant rugby match being
played **at one specific venue**, sourced live from the SJRU (Sydney Junior
Rugby Union) public data feed used by https://xplorer.rugby.

There is no user input at runtime. The venue is fixed per deployment via
configuration. The page is left open indefinitely and refreshes its own data.

## Background / Data Source

- Site scraped: `https://xplorer.rugby/sjru/fixtures-results?comp=All&team=All&season=2026&tab=Results`
- That page is a Next.js app whose data actually comes from a public GraphQL
  endpoint: `https://rugby-au-cms.graphcdn.app/` (Keystone.js CMS + Opta data
  resolvers, fronted by Stellate/GraphCDN).
- Confirmed live (2026-08-30) that this endpoint has permissive CORS
  (`access-control-allow-origin` echoes the request `Origin`, `allow-methods`
  includes `POST`), so it can be called directly from a static site hosted on
  GitHub Pages — no proxy/backend required.
- Relevant query: `getEntityFixturesAndResults(entityId, entityType, season,
  comps, teams, type, limit, skip): [FixtureItem]`.
  - SJRU's association-wide feed is `entityId: 30895, entityType: "association"`,
    matching the scraped page (`comp=All&team=All`).
  - `type` is `"fixtures"` (upcoming only, ascending by `dateTime`) or
    `"results"` (played only, descending by `dateTime`). There is no
    server-side venue or date-range filter — filtering by venue and "now" is
    a client concern.
- `FixtureItem` fields available (see `schema.graphql` and
  `test/responses/response.json` for confirmed live samples): `id, compName,
  dateTime (ISO 8601, UTC), venue, status ("Fixture" | "Result" | "Forfeit" |
  other), isLive, round, roundLabel, matchLabel, homeTeam { name, score,
  crest }, awayTeam { name, score, crest }`.
- Team `crest` is a hosted image URL, but only resolves to each team's real
  logo when the query is scoped to a specific competition via the `comps:
  [CompInput]` argument. Verified live: querying association-wide with
  `comps: []` (as the fixtures/results list queries do) returns the *same*
  generic placeholder shield for every team, across the entire 2026 season
  (300 results, every grade) with no exceptions — but re-querying with
  `comps: [{ id: <fixture.compId> }]` for the same matches returns each
  team's real distinct crest. The app therefore does a second, comp-scoped
  lookup once a match is selected, purely to fetch its real crests (see
  `hydrateCrests` in plan.md) — not a data-source limitation after all.

## In Scope

1. Fetch fixtures/results for the configured SJRU entity and season directly
   from the GraphQL endpoint, client-side, on a poll interval.
2. Determine the single "current match" for a configured venue:
   - A match becomes eligible once its kickoff time enters the configured
     pre-match window (default 30 min before).
   - It remains the current match through kickoff, while `isLive` or while
     "now" is inside its post-match display window (default 90 min after
     kickoff), regardless of `status`.
   - If no match at the venue is currently eligible, show the nearest
     upcoming fixture at that venue as "Next Match" (with a countdown), or,
     if none remains in the season, the most recent finished result at that
     venue as "Last Result".
   - If the venue has no matches at all in the configured season, show an
     idle/branding state.
3. Display, non-interactively: home/away team names + crests, score (when
   played), competition/grade name, round, venue, kickoff time (local),
   and a status badge (UPCOMING / LIVE / FULL TIME / FORFEIT / etc.).
4. Auto-refresh data on a configurable interval without any user action.
5. Recover from transient network/API failures by retrying with backoff and
   continuing to show the last good data (with a small "last updated" /
   stale indicator) rather than going blank.
6. Run reliably unattended for many hours in a kiosk browser: bounded memory
   growth, periodic full reload as a safety net, resilience to a single
   uncaught error not killing the display loop.
7. Configuration of venue (and other deployment knobs) via a `.env` file at
   build/deploy time, per spec's explicit request. A `?venue=` URL query
   override is additionally supported so one deployed build can serve
   multiple kiosks/venues without a rebuild (documented convenience, not a
   replacement for `.env`).
8. Deployable as a static site to GitHub Pages via GitHub Actions.

## Out of Scope

- Any user interaction (buttons, scrolling, settings UI, touch).
- Historical stats, ladders, player data, commentary, video/streaming.
- Any competition other than the one selected via `.env` (single
  entity/association feed per deployment).
- Server-side rendering or a backend of any kind — pure static SPA.
- Authentication.

## Configuration (`.env`)

| Key | Required | Default | Meaning |
|---|---|---|---|
| `VENUE` | yes | — | Exact venue name as returned by the API (e.g. `Nagle Park Field 2`). Matched case-insensitively, trimmed. |
| `SEASON` | no | `2026` | Season string passed to the API. |
| `ENTITY_ID` | no | `30895` | SJRU association entity id. |
| `ENTITY_TYPE` | no | `association` | Entity type for the query. |
| `GRAPHQL_ENDPOINT` | no | `https://rugby-au-cms.graphcdn.app/` | API base URL. |
| `REFRESH_INTERVAL_SECONDS` | no | `60` | Poll interval for data. |
| `PRE_MATCH_WINDOW_MINUTES` | no | `30` | Minutes before kickoff a match becomes "current". |
| `POST_MATCH_WINDOW_MINUTES` | no | `90` | Minutes after kickoff a finished match stays "current". |
| `PAGE_RELOAD_HOURS` | no | `6` | Full hard page reload interval (kiosk stability). |
| `TIMEZONE` | no | `Australia/Sydney` | IANA timezone for displaying kickoff times. |

Values are read from `.env` at build/deploy time (there is no server to read
`.env` at request time in a static SPA) and baked into a generated
`config.js` — see `plan.md`.

## Acceptance Criteria

- AC1: With a valid `VENUE` set and a match at that venue in progress or
  within its display window, the kiosk shows that match's teams, crests,
  score, and a LIVE or FULL TIME badge within one poll interval of load.
- AC2: With no eligible current match, the kiosk shows the next upcoming
  fixture at that venue with a countdown, or the last result if the season
  has no more fixtures at that venue, or an idle branding screen if the
  venue has no matches in the season at all — never a blank/broken page.
- AC3: A simulated network failure (endpoint unreachable) leaves the last
  successfully rendered state on screen, with a small stale/error indicator,
  and recovers automatically once the endpoint is reachable again.
- AC4: The page requires zero interaction from load onward.
- AC5: `npm run build` (or equivalent) produces a static `dist/` (or
  document root) deployable as-is to GitHub Pages, and a GitHub Actions
  workflow deploys it on push to the default branch.
- AC6: Changing `VENUE` in `.env` and rebuilding changes which match the
  kiosk displays, without any code change.
