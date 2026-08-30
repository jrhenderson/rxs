# SJRU Venue Scoreboard

A non-interactive kiosk scoreboard for one rugby venue. Shows the current
match being played there, sourced live from the public GraphQL feed behind
[xplorer.rugby](https://xplorer.rugby/sjru/fixtures-results). Static HTML/CSS/JS,
no framework, no runtime dependencies — deploys as-is to GitHub Pages.

See [specs/001-rugby-scoreboard/spec.md](specs/001-rugby-scoreboard/spec.md)
for the full requirements and [plan.md](specs/001-rugby-scoreboard/plan.md)
for the design.

## How it picks a match

Every poll, it fetches recent results and upcoming fixtures for the
configured SJRU competition, filters both to the configured `VENUE`, and
shows whichever of these applies first: a live match, a match within its
kickoff display window (pre/post configurable), the next upcoming fixture at
that venue, the last finished result at that venue, or an idle screen if the
venue has no matches this season.

## Local development

```
cp .env.example .env
# edit .env — at minimum set VENUE to a real venue name, e.g. "Nagle Park Field 2"
npm run dev
```

Opens a static file server at http://localhost:8080. `npm run dev` (re)writes
`config.js` from `.env` each time you run it — re-run it after editing `.env`.

To find valid venue names, check a live response from the API or the
[xplorer.rugby/sjru fixtures page](https://xplorer.rugby/sjru/fixtures-results?comp=All&team=All&season=2026&tab=Results).

You can also override the venue at runtime without editing `.env`, e.g.
`http://localhost:8080/?venue=Rawson%20Oval`.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. Repo Settings → Pages → **Source: GitHub Actions**.
3. Repo Settings → Secrets and variables → **Actions → Variables**: add a
   `VENUE` repository variable (required) and any of the other keys from
   `.env.example` you want to override (all have defaults — see
   `scripts/generate-config.cjs`).
4. Push to `main` (or run the "Deploy scoreboard to GitHub Pages" workflow
   manually) — `.github/workflows/deploy.yml` builds `config.js` from those
   variables and publishes the site.

Multiple physical kiosks can share one deployed URL with different
`?venue=` query parameters if you'd rather not maintain separate variable
sets/deployments per venue.

## Running the kiosk

Point a full-screen/kiosk-mode browser at the published Pages URL, e.g.:

```
chrome --kiosk --incognito "https://<user>.github.io/<repo>/?venue=Nagle%20Park%20Field%202"
```

The page auto-refreshes its data (`REFRESH_INTERVAL_SECONDS`, default 60s)
and does a full hard reload periodically (`PAGE_RELOAD_HOURS`, default 6h) as
a long-running-kiosk safety net. It never requires interaction.

## Repo layout

- `index.html`, `styles.css`, `app.js` — the SPA.
- `lib/selectMatch.js` — pure venue/time match-selection logic (no DOM),
  importable standalone (`npm run verify`) or from `app.js`.
- `scripts/generate-config.cjs` — turns `.env` (or CI variables) into
  `config.js` (gitignored, generated).
- `scripts/serve.cjs` — zero-dependency static server for local dev.
- `scripts/verify-selection.js` — manual check of `lib/selectMatch.js`
  against live API data (`npm run verify`).
- `.github/workflows/deploy.yml` — GitHub Pages deploy.
- `specs/001-rugby-scoreboard/` — spec, plan, and task breakdown (SDD docs).
- `schema.graphql`, `test/` — reverse-engineering notes on the GraphQL API
  captured while researching the data source; kept for reference.
