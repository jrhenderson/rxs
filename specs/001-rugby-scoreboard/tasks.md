# Tasks 001: Venue Rugby Scoreboard Kiosk

Derived from `plan.md`. Roughly sequential; each task should leave the repo
in a working state.

- [x] T1. Confirm live API shape, CORS, and sort-order behavior for
      `getEntityFixturesAndResults` against the real endpoint (done during
      planning; see curl transcripts referenced in `plan.md`/`spec.md`).
- [x] T2. `.env.example` with every key from spec.md's config table and
      inline comments.
- [x] T3. `.gitignore` (`.env`, `config.js`, editor/OS cruft).
- [x] T4. `scripts/generate-config.cjs` — zero-dependency `.env` parser ->
      writes `config.js` as `window.__CONFIG__` (CommonJS; `.cjs` because
      `package.json` sets `"type": "module"` for the browser-facing ES
      modules).
- [x] T5. `scripts/serve.cjs` — tiny static file server for local dev
      (Node `http`/`fs`, no dependency).
- [x] T6. `package.json` with `dev`/`build`/`verify` scripts (`build` just
      runs `generate-config.cjs`, since there's nothing to bundle).
- [x] T7. `index.html` — semantic full-screen template with placeholders
      for both teams, score, comp/round/venue, kickoff/countdown, status
      badge, last-updated indicator.
- [x] T8. `styles.css` — kiosk-friendly full-viewport layout, large
      legible type for distance viewing, dark background, no scrollbars,
      responsive via viewport units.
- [x] T9. `app.js` + `lib/selectMatch.js`:
  - [x] T9.1 `fetchGraphQL`/`fetchEntityList` helpers (`app.js`).
  - [x] T9.2 `findVenueMatch` pure selection function, split into its own
        DOM-free module (`lib/selectMatch.js`) so it's independently
        verifiable (see T13).
  - [x] T9.3 render functions per state (live/current/upcoming/recent/idle).
  - [x] T9.4 polling loop with backoff + stale indicator.
  - [x] T9.5 kiosk-stability safety net (periodic reload, error handlers).
  - [x] T9.6 `?venue=` override.
- [x] T10. `assets/` fallback crest/favicon placeholder (inline SVG, no
      external asset dependency).
- [x] T11. `.github/workflows/deploy.yml` GitHub Pages deploy on push to
      `main`, config generated from repo variables, only the static files
      actually needed (incl. `lib/`) copied into the deploy artifact.
- [x] T12. `README.md` — what this is, local dev, configuring a venue,
      first-time GitHub Pages setup (Settings → Pages → Source: GitHub
      Actions, and where to set repo variables), kiosk browser launch flags.
- [x] T13. Manual verification: `npm run verify` runs
      `scripts/verify-selection.js` against the live API with real season
      2026 data — confirmed it correctly resolves `recent`/`current`,
      `upcoming`, and `idle` states for real venues vs. a nonexistent one.
      `npm run dev` manually confirmed to render real fixture data for
      `VENUE=Nagle Park Field 2` end-to-end in a browser (headless Chrome
      screenshots).
- [x] T14. Bug: crests weren't rendering distinct team logos — every team
      resolved to the same generic placeholder shield. Root-caused live
      (see spec.md Background): `getEntityFixturesAndResults` only returns
      real per-team crests when `comps` is scoped to the specific
      competition; the association-wide query used for match selection
      always gets the generic placeholder. Fixed by adding
      `hydrateCrests()` (`app.js`) — a second, comp-scoped lookup for just
      the selected match, used only to source real crest URLs. Verified via
      `npm run verify` (crest URL changes after hydration) and a real
      browser screenshot (Randwick Warriors / Newport Junior Rugby Club
      logos rendering correctly).
