// SJRU venue scoreboard — all app logic. No dependencies, no bundler.
// See specs/001-rugby-scoreboard/plan.md for the design this implements.

import { findVenueMatch } from './lib/selectMatch.js';

const CONFIG = { ...window.__CONFIG__ };
const params = new URLSearchParams(location.search);
if (params.get('venue')) {
  CONFIG.VENUE = params.get('venue');
}

const REFRESH_MS = CONFIG.REFRESH_INTERVAL_SECONDS * 1000;
const PRE_MS = CONFIG.PRE_MATCH_WINDOW_MINUTES * 60 * 1000;
const POST_MS = CONFIG.POST_MATCH_WINDOW_MINUTES * 60 * 1000;
const MAX_BACKOFF_MULTIPLIER = 5;

const FIXTURE_FIELDS = `
  id
  compId
  compName
  dateTime
  round
  roundLabel
  matchLabel
  status
  isLive
  venue
  homeTeam { name score crest }
  awayTeam { name score crest }
`;

const QUERY = `
  query EntityFixturesAndResults(
    $entityId: Int
    $entityType: String
    $season: String
    $comps: [CompInput]
    $type: String
    $limit: Int
    $skip: Int
  ) {
    getEntityFixturesAndResults(
      entityId: $entityId
      entityType: $entityType
      season: $season
      comps: $comps
      type: $type
      limit: $limit
      skip: $skip
    ) {
      ${FIXTURE_FIELDS}
    }
  }
`;

async function fetchGraphQL(query, variables) {
  const res = await fetch(CONFIG.GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}`);
  }
  const body = await res.json();
  if (body.errors && body.errors.length) {
    throw new Error(`GraphQL error: ${body.errors[0].message}`);
  }
  return body.data;
}

async function fetchEntityList(type, limit, comps) {
  const data = await fetchGraphQL(QUERY, {
    entityId: CONFIG.ENTITY_ID,
    entityType: CONFIG.ENTITY_TYPE,
    season: CONFIG.SEASON,
    comps: comps || [],
    type,
    limit,
    skip: 0,
  });
  return data.getEntityFixturesAndResults || [];
}

async function fetchVenueData() {
  const [results, fixtures] = await Promise.all([
    fetchEntityList('results', 40),
    fetchEntityList('fixtures', 40),
  ]);
  return { results, fixtures };
}

// The association-wide query above only ever returns one generic shared
// placeholder crest for every team (verified live across a full season).
// Scoping the same query to the selected match's specific competition
// returns each team's real linked crest — so once a match is chosen, fetch
// it again scoped to its comp and use that richer copy for rendering.
async function hydrateCrests(fixture, state) {
  if (!fixture || !fixture.compId) return fixture;
  try {
    const type = state === 'upcoming' ? 'fixtures' : 'results';
    const compScoped = await fetchEntityList(type, 60, [{ id: fixture.compId }]);
    const hydrated = compScoped.find((f) => f.id === fixture.id);
    return hydrated || fixture;
  } catch (err) {
    console.error('Crest hydration failed, using generic crest:', err);
    return fixture;
  }
}

const el = {
  board: document.getElementById('board'),
  venueName: document.getElementById('venueName'),
  currentTime: document.getElementById('currentTime'),
  updatedIndicator: document.getElementById('updatedIndicator'),
  matchView: document.getElementById('matchView'),
  idleView: document.getElementById('idleView'),
  idleMessage: document.getElementById('idleMessage'),
  compName: document.getElementById('compName'),
  roundLabel: document.getElementById('roundLabel'),
  homeCrest: document.getElementById('homeCrest'),
  homeName: document.getElementById('homeName'),
  homeScore: document.getElementById('homeScore'),
  awayCrest: document.getElementById('awayCrest'),
  awayName: document.getElementById('awayName'),
  awayScore: document.getElementById('awayScore'),
  statusBadge: document.getElementById('statusBadge'),
  kickoffTime: document.getElementById('kickoffTime'),
  countdown: document.getElementById('countdown'),
};

const timeFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: CONFIG.TIMEZONE,
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const clockFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: CONFIG.TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

function renderClock() {
  el.currentTime.textContent = clockFormatter.format(new Date());
}

function formatCountdown(ms) {
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `Kicks off in ${hours}h ${minutes}m`;
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes > 0) return `Kicks off in ${minutes}m ${seconds}s`;
  return `Kicks off in ${seconds}s`;
}

let currentSelection = { state: 'idle', fixture: null };

function render(selection) {
  currentSelection = selection;
  const { state, fixture } = selection;

  el.board.className = `state-${state}`;
  el.venueName.textContent = CONFIG.VENUE || 'No venue configured';

  if (state === 'idle' || !fixture) {
    el.matchView.hidden = true;
    el.idleView.hidden = false;
    el.idleMessage.textContent = CONFIG.VENUE
      ? `No matches scheduled this season at ${CONFIG.VENUE}.`
      : 'Set VENUE in .env (or add ?venue= to the URL) to configure this display.';
    return;
  }

  el.matchView.hidden = false;
  el.idleView.hidden = true;

  el.compName.textContent = fixture.compName || '';
  el.roundLabel.textContent = fixture.roundLabel || fixture.round || '';

  el.homeName.textContent = fixture.homeTeam?.name || 'TBC';
  el.awayName.textContent = fixture.awayTeam?.name || 'TBC';
  el.homeCrest.src = fixture.homeTeam?.crest || 'assets/placeholder-crest.svg';
  el.awayCrest.src = fixture.awayTeam?.crest || 'assets/placeholder-crest.svg';

  const kickoff = new Date(fixture.dateTime);
  el.kickoffTime.textContent = timeFormatter.format(kickoff);

  el.statusBadge.className = 'status-badge';
  el.countdown.textContent = '';

  if (state === 'live') {
    el.statusBadge.classList.add('live');
    el.statusBadge.textContent = 'Live';
    el.homeScore.textContent = fixture.homeTeam?.score ?? '0';
    el.awayScore.textContent = fixture.awayTeam?.score ?? '0';
  } else if (state === 'current' || state === 'recent') {
    el.statusBadge.classList.add('full-time');
    const label = fixture.status && fixture.status !== 'Result'
      ? fixture.status.toUpperCase()
      : 'Full Time';
    el.statusBadge.textContent = label;
    el.homeScore.textContent = fixture.homeTeam?.score ?? '-';
    el.awayScore.textContent = fixture.awayTeam?.score ?? '-';
  } else {
    // upcoming
    el.homeScore.textContent = '';
    el.awayScore.textContent = '';
    const msToKickoff = kickoff.getTime() - Date.now();
    if (msToKickoff <= 0) {
      el.statusBadge.textContent = 'In Progress';
    } else {
      el.statusBadge.classList.add('upcoming');
      el.statusBadge.textContent = 'Upcoming';
      el.countdown.textContent = formatCountdown(msToKickoff) || '';
    }
  }
}

function setUpdatedIndicator(status) {
  el.updatedIndicator.classList.remove('stale', 'error');
  if (status === 'stale') el.updatedIndicator.classList.add('stale');
  if (status === 'error') el.updatedIndicator.classList.add('error');
  const now = new Date();
  el.updatedIndicator.title = `Last updated ${now.toLocaleTimeString()}`;
}

let consecutiveFailures = 0;

async function poll() {
  try {
    const { results, fixtures } = await fetchVenueData();
    consecutiveFailures = 0;
    setUpdatedIndicator('ok');
    const selection = findVenueMatch(results, fixtures, CONFIG.VENUE, Date.now(), {
      preMs: PRE_MS,
      postMs: POST_MS,
    });
    selection.fixture = await hydrateCrests(selection.fixture, selection.state);
    render(selection);
  } catch (err) {
    consecutiveFailures += 1;
    setUpdatedIndicator(consecutiveFailures >= 3 ? 'error' : 'stale');
    console.error('Poll failed:', err);
    // Deliberately keep showing the last good render (spec AC3) rather than
    // clearing the board.
  } finally {
    const multiplier = Math.min(consecutiveFailures + 1, MAX_BACKOFF_MULTIPLIER);
    setTimeout(poll, REFRESH_MS * multiplier);
  }
}

// Every second: tick the clock, and re-render while showing an upcoming
// match so the countdown ticks without waiting for the next data poll.
setInterval(() => {
  renderClock();
  if (currentSelection.state === 'upcoming' && currentSelection.fixture) {
    render(currentSelection);
  }
}, 1000);
renderClock();

// Kiosk stability: hard reload periodically, and never let one bad tick
// (or an unrelated script error) permanently kill the display loop.
setTimeout(() => location.reload(), CONFIG.PAGE_RELOAD_HOURS * 60 * 60 * 1000);

window.addEventListener('error', (e) => console.error('Uncaught error:', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('Unhandled rejection:', e.reason));

poll();
