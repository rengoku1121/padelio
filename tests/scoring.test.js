/* =========================
   tests/scoring.test.js
   Run: node tests/scoring.test.js
   ========================= */
'use strict';

const assert = require('assert');
const {
  isMexicanoFamilyMode,
  gamesNeededToWinMatch,
  gamesOppFromEntered,
  isMexGamesScoreTie,
  isMexMatchComplete,
  normalizeMexGamesScores,
  getTournamentScoringProfile,
  MATCH_COMPENSATION_POINTS_PER_GAP,
  formatLeaderboardDiff,
  applyMatchCompensationToLeaderboardRows,
  sortLeaderboardRows,
  computeLeaderboardSorted,
  MIN_PLAYER_LEVEL,
  MAX_PLAYER_LEVEL,
  DEFAULT_PLAYER_LEVEL,
} = require('../js/scoring.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

/* ---- isMexicanoFamilyMode ---- */
console.log('\nisMexicanoFamilyMode');
test('mexicano is a mexicano-family mode', () => assert.strictEqual(isMexicanoFamilyMode('mexicano'), true));
test('mixmex is a mexicano-family mode', () => assert.strictEqual(isMexicanoFamilyMode('mixmex'), true));
test('fixedmex is a mexicano-family mode', () => assert.strictEqual(isMexicanoFamilyMode('fixedmex'), true));
test('normal is not mexicano-family', () => assert.strictEqual(isMexicanoFamilyMode('normal'), false));
test('mix is not mexicano-family', () => assert.strictEqual(isMexicanoFamilyMode('mix'), false));
test('balanced is not mexicano-family', () => assert.strictEqual(isMexicanoFamilyMode('balanced'), false));

/* ---- gamesNeededToWinMatch ---- */
console.log('\ngamesNeededToWinMatch');
test('best-of-3 needs 2 wins', () => assert.strictEqual(gamesNeededToWinMatch(3), 2));
test('best-of-5 needs 3 wins', () => assert.strictEqual(gamesNeededToWinMatch(5), 3));
test('best-of-7 needs 4 wins', () => assert.strictEqual(gamesNeededToWinMatch(7), 4));
test('best-of-1 needs 1 win', () => assert.strictEqual(gamesNeededToWinMatch(1), 1));
test('default (NaN) gives 2 wins', () => assert.strictEqual(gamesNeededToWinMatch(NaN), 2));

/* ---- isMexGamesScoreTie ---- */
console.log('\nisMexGamesScoreTie');
test('1-1 is a tie', () => assert.strictEqual(isMexGamesScoreTie(1, 1), true));
test('2-2 is a tie', () => assert.strictEqual(isMexGamesScoreTie(2, 2), true));
test('0-0 is NOT a tie', () => assert.strictEqual(isMexGamesScoreTie(0, 0), false));
test('2-1 is not a tie', () => assert.strictEqual(isMexGamesScoreTie(2, 1), false));

/* ---- isMexMatchComplete ---- */
console.log('\nisMexMatchComplete');
const bo3 = { gamesTarget: 2, bestOf: 3 };
const bo4 = { gamesTarget: 2, bestOf: 4 };
const bo5 = { gamesTarget: 3, bestOf: 5 };

// In this scoring system all bestOf games are played (no early stop).
// A match is complete when all 3 games are done (2-1, 3-0 etc.) — 2-0 is mid-match.
test('bo3: 2-1 is complete (all 3 games played, winner has 2)', () => assert.strictEqual(isMexMatchComplete(2, 1, bo3), true));
test('bo3: 1-2 is complete', () => assert.strictEqual(isMexMatchComplete(1, 2, bo3), true));
test('bo3: 3-0 is complete (all 3 games played)', () => assert.strictEqual(isMexMatchComplete(3, 0, bo3), true));
test('bo3: 0-3 is complete', () => assert.strictEqual(isMexMatchComplete(0, 3, bo3), true));
test('bo3: 2-0 is NOT complete (only 2 of 3 games played)', () => assert.strictEqual(isMexMatchComplete(2, 0, bo3), false));
test('bo3: 1-1 tie is NOT complete', () => assert.strictEqual(isMexMatchComplete(1, 1, bo3), false));
test('bo4: 2-2 tie IS complete (all 4 games played)', () => assert.strictEqual(isMexMatchComplete(2, 2, bo4), true));
test('bo4: 1-3 is complete', () => assert.strictEqual(isMexMatchComplete(1, 3, bo4), true));
test('bo3: 1-0 is not complete', () => assert.strictEqual(isMexMatchComplete(1, 0, bo3), false));
test('bo5: 3-2 is complete (all 5 games played)', () => assert.strictEqual(isMexMatchComplete(3, 2, bo5), true));
test('bo5: 5-0 is complete', () => assert.strictEqual(isMexMatchComplete(5, 0, bo5), true));
test('bo5: 2-2 tie is NOT complete', () => assert.strictEqual(isMexMatchComplete(2, 2, bo5), false));
test('bo5: 2-1 is not complete (only 3 of 5 played)', () => assert.strictEqual(isMexMatchComplete(2, 1, bo5), false));

/* ---- normalizeMexGamesScores ---- */
console.log('\nnormalizeMexGamesScores');
test('bo3: 2-0 stays 2-0', () => {
  const r = normalizeMexGamesScores(2, 0, bo3);
  assert.deepStrictEqual(r, { g1: 2, g2: 0 });
});
test('bo3: 1-1 tie is kept as-is', () => {
  const r = normalizeMexGamesScores(1, 1, bo3);
  assert.deepStrictEqual(r, { g1: 1, g2: 1 });
});
test('bo4: 2-2 tie is kept as-is', () => {
  const r = normalizeMexGamesScores(2, 2, { gamesTarget: 2, bestOf: 4 });
  assert.deepStrictEqual(r, { g1: 2, g2: 2 });
});
test('bo3: over-capped 5-5 is normalized to fit within bestOf', () => {
  const r = normalizeMexGamesScores(5, 5, bo3);
  assert.ok(r.g1 + r.g2 <= bo3.bestOf, 'sum must not exceed bestOf');
});

/* ---- gamesOppFromEntered ---- */
console.log('\ngamesOppFromEntered');
test('bo3: complementary (2 → 1)', () => assert.strictEqual(gamesOppFromEntered(2, bo3), 1));
test('bo3: complementary (0 → 3)', () => assert.strictEqual(gamesOppFromEntered(0, bo3), 3));
test('bo3: complementary (3 → 0)', () => assert.strictEqual(gamesOppFromEntered(3, bo3), 0));
test('bo4: complementary (3 → 1)', () => assert.strictEqual(gamesOppFromEntered(3, bo4), 1));
test('bo4: complementary (2 → 2)', () => assert.strictEqual(gamesOppFromEntered(2, bo4), 2));

/* ---- getTournamentScoringProfile ---- */
console.log('\ngetTournamentScoringProfile');
test('normal mode gives rally profile', () => {
  const p = getTournamentScoringProfile({ mode: 'normal', points_to_win: 21 });
  assert.strictEqual(p.style, 'rally');
  assert.strictEqual(p.rallyCap, 21);
  assert.strictEqual(p.mirrorOpp, true);
});
test('mexicano rally mode gives rally profile', () => {
  const p = getTournamentScoringProfile({ mode: 'mexicano', mex_score_kind: 'rally', points_to_win: 24 });
  assert.strictEqual(p.style, 'rally');
  assert.strictEqual(p.rallyCap, 24);
});
test('mexicano games mode gives games profile with bestOf', () => {
  const p = getTournamentScoringProfile({ mode: 'mexicano', mex_score_kind: 'games', mex_best_of_games: 5 });
  assert.strictEqual(p.style, 'games');
  assert.strictEqual(p.bestOf, 5);
  assert.strictEqual(p.gamesTarget, 3);
  assert.strictEqual(p.mirrorOpp, false);
});
test('missing mode defaults to rally', () => {
  const p = getTournamentScoringProfile({});
  assert.strictEqual(p.style, 'rally');
});

/* ---- getTournamentScoringProfile: universal scoring (all modes) ---- */
console.log('\ngetTournamentScoringProfile — universal scoring (all modes)');
test('normal americano with score_kind games returns games profile', () => {
  const p = getTournamentScoringProfile({ mode: 'normal', score_kind: 'games', best_of_games: 5 });
  assert.strictEqual(p.style, 'games');
  assert.strictEqual(p.bestOf, 5);
  assert.strictEqual(p.gamesTarget, 3);
  assert.strictEqual(p.mirrorOpp, false);
});
test('mix americano with score_kind games returns games profile', () => {
  const p = getTournamentScoringProfile({ mode: 'mix', score_kind: 'games', best_of_games: 3 });
  assert.strictEqual(p.style, 'games');
  assert.strictEqual(p.bestOf, 3);
  assert.strictEqual(p.gamesTarget, 2);
});
test('fixed americano with score_kind games returns games profile', () => {
  const p = getTournamentScoringProfile({ mode: 'fixed', score_kind: 'games', best_of_games: 7 });
  assert.strictEqual(p.style, 'games');
  assert.strictEqual(p.bestOf, 7);
  assert.strictEqual(p.gamesTarget, 4);
});
test('balanced americano with score_kind games returns games profile', () => {
  const p = getTournamentScoringProfile({ mode: 'balanced', score_kind: 'games', best_of_games: 4 });
  assert.strictEqual(p.style, 'games');
  assert.strictEqual(p.bestOf, 4);
});
test('normal americano with score_kind rally returns rally profile with points_to_win', () => {
  const p = getTournamentScoringProfile({ mode: 'normal', score_kind: 'rally', points_to_win: 32 });
  assert.strictEqual(p.style, 'rally');
  assert.strictEqual(p.rallyCap, 32);
  assert.strictEqual(p.mirrorOpp, true);
});
test('normal americano without score_kind still defaults to rally (existing tournaments unaffected)', () => {
  const p = getTournamentScoringProfile({ mode: 'normal', points_to_win: 21 });
  assert.strictEqual(p.style, 'rally');
  assert.strictEqual(p.rallyCap, 21);
});
test('mexicano still honors legacy mex_score_kind when generic score_kind is absent', () => {
  const p = getTournamentScoringProfile({ mode: 'mexicano', mex_score_kind: 'games', mex_best_of_games: 5 });
  assert.strictEqual(p.style, 'games');
  assert.strictEqual(p.bestOf, 5);
});
test('generic score_kind takes precedence over legacy mex_score_kind when both present', () => {
  const p = getTournamentScoringProfile({
    mode: 'mexicano',
    score_kind: 'rally',
    points_to_win: 24,
    mex_score_kind: 'games',
    mex_best_of_games: 5,
  });
  assert.strictEqual(p.style, 'rally');
  assert.strictEqual(p.rallyCap, 24);
});
test('legacy mex_score_kind is ignored for non-Mexicano modes (no accidental games mode)', () => {
  const p = getTournamentScoringProfile({ mode: 'normal', mex_score_kind: 'games', mex_best_of_games: 5 });
  assert.strictEqual(p.style, 'rally');
});
test('best_of_games is clamped into the 3–7 range for any mode', () => {
  const low = getTournamentScoringProfile({ mode: 'mix', score_kind: 'games', best_of_games: 1 });
  assert.strictEqual(low.bestOf, 3);
  const high = getTournamentScoringProfile({ mode: 'fixedmex', score_kind: 'games', best_of_games: 99 });
  assert.strictEqual(high.bestOf, 7);
});

/* ---- formatLeaderboardDiff ---- */
console.log('\nformatLeaderboardDiff');
test('positive diff has + prefix', () => assert.strictEqual(formatLeaderboardDiff(5), '+5'));
test('zero diff has no prefix', () => assert.strictEqual(formatLeaderboardDiff(0), '0'));
test('negative diff is plain negative', () => assert.strictEqual(formatLeaderboardDiff(-3), '-3'));

/* ---- sortLeaderboardRows ---- */
console.log('\nsortLeaderboardRows');
const sampleRows = [
  { name: 'Alice', points: 30, diff: 10, wins: 3, winRate: 75, matches: 4 },
  { name: 'Bob',   points: 30, diff: 15, wins: 3, winRate: 75, matches: 4 },
  { name: 'Carol', points: 40, diff: 20, wins: 4, winRate: 100, matches: 4 },
];
test('points mode: highest points first', () => {
  const sorted = sortLeaderboardRows(sampleRows, 'points');
  assert.strictEqual(sorted[0].name, 'Carol');
});
test('points mode: diff breaks tie when points equal', () => {
  const sorted = sortLeaderboardRows(sampleRows, 'points');
  assert.strictEqual(sorted[1].name, 'Bob');
  assert.strictEqual(sorted[2].name, 'Alice');
});
test('winRate mode: highest winRate first', () => {
  const sorted = sortLeaderboardRows(sampleRows, 'winRate');
  assert.strictEqual(sorted[0].name, 'Carol');
});
test('sortLeaderboardRows does not mutate input', () => {
  const copy = [...sampleRows];
  sortLeaderboardRows(sampleRows, 'points');
  assert.deepStrictEqual(sampleRows.map(r => r.name), copy.map(r => r.name));
});

/* ---- match compensation (+M) ---- */
console.log('\n+M match compensation');

test('MATCH_COMPENSATION_POINTS_PER_GAP legacy constant is 0', () =>
  assert.strictEqual(MATCH_COMPENSATION_POINTS_PER_GAP, 0));

test('+M user example: 70/66/55/50 with 5/5/4/4 matches → comp 0/0/12/12', () => {
  const base = { conceded: 0, wins: 0, losses: 0, ties: 0, winRate: 0, diff: 0 };
  const rows = [
    { name: 'Fabio',  matches: 5, points: 70, ...base },
    { name: 'Pingky', matches: 5, points: 66, ...base },
    { name: 'Filia',  matches: 4, points: 55, ...base },
    { name: 'Ridel',  matches: 4, points: 50, ...base },
  ];
  const out = applyMatchCompensationToLeaderboardRows(rows);
  const byName = (n) => out.find((r) => r.name === n);
  // total points = 241, total appearances = 18, average ≈ 13.3888... → +M rounded to 13
  const avg = byName('Fabio').matchCompAverage;
  assert.ok(Math.abs(avg - 241 / 18) < 1e-9, 'average uses real data');
  assert.strictEqual(byName('Fabio').matchComp, 0);
  assert.strictEqual(byName('Pingky').matchComp, 0);
  assert.strictEqual(byName('Filia').matchComp, Math.round(avg));
  assert.strictEqual(byName('Ridel').matchComp, Math.round(avg));
  assert.strictEqual(byName('Fabio').points, 70);
  assert.strictEqual(byName('Filia').points, 55 + Math.round(avg));
});

test('+M spec literal: average pinned to 12 → comp 0/0/12/12', () => {
  // Construct rows so totalPoints / totalAppearances == 12 exactly.
  // Pick raw: A=72, B=72, C=60, D=60. matches 5,5,4,4 → total 264 pts / 18 apps ≈ 14.66 (no).
  // Use 60,60,48,48 over 5,5,4,4 → 216 / 18 = 12 exactly.
  const base = { conceded: 0, wins: 0, losses: 0, ties: 0, winRate: 0, diff: 0 };
  const rows = [
    { name: 'A', matches: 5, points: 60, ...base },
    { name: 'B', matches: 5, points: 60, ...base },
    { name: 'C', matches: 4, points: 48, ...base },
    { name: 'D', matches: 4, points: 48, ...base },
  ];
  const out = applyMatchCompensationToLeaderboardRows(rows);
  assert.strictEqual(out.find((r) => r.name === 'A').matchCompAverage, 12);
  assert.strictEqual(out.find((r) => r.name === 'A').matchComp, 0);
  assert.strictEqual(out.find((r) => r.name === 'B').matchComp, 0);
  assert.strictEqual(out.find((r) => r.name === 'C').matchComp, 12);
  assert.strictEqual(out.find((r) => r.name === 'D').matchComp, 12);
  assert.strictEqual(out.find((r) => r.name === 'C').points, 60);
  assert.strictEqual(out.find((r) => r.name === 'D').points, 60);
});

test('+M is 0 for everyone when all match counts are equal', () => {
  const base = { conceded: 0, wins: 0, losses: 0, ties: 0, winRate: 0, diff: 0 };
  const rows = [
    { name: 'A', matches: 5, points: 70, ...base },
    { name: 'B', matches: 5, points: 60, ...base },
    { name: 'C', matches: 5, points: 50, ...base },
  ];
  const out = applyMatchCompensationToLeaderboardRows(rows);
  out.forEach((r) => assert.strictEqual(r.matchComp, 0));
  out.forEach((r) => assert.strictEqual(r.points, r.pointsRaw));
});

test('+M handles empty / no-completed-match rosters without crashing', () => {
  const base = { conceded: 0, wins: 0, losses: 0, ties: 0, winRate: 0, diff: 0 };
  const rows = [
    { name: 'A', matches: 0, points: 0, ...base },
    { name: 'B', matches: 0, points: 0, ...base },
  ];
  const out = applyMatchCompensationToLeaderboardRows(rows);
  out.forEach((r) => {
    assert.strictEqual(r.matchComp, 0);
    assert.strictEqual(r.matchCompGap, 0);
    assert.strictEqual(r.matchCompAverage, 0);
  });
});

test('+M with fractional average rounds to whole numbers', () => {
  // total 241 pts / 18 apps = 13.388... → +M = 13 per missed match
  const base = { conceded: 0, wins: 0, losses: 0, ties: 0, winRate: 0, diff: 0 };
  const rows = [
    { name: 'A', matches: 5, points: 70, ...base },
    { name: 'B', matches: 5, points: 66, ...base },
    { name: 'C', matches: 4, points: 55, ...base },
    { name: 'D', matches: 4, points: 50, ...base },
  ];
  const out = applyMatchCompensationToLeaderboardRows(rows);
  const c = out.find((r) => r.name === 'C');
  assert.strictEqual(c.matchComp, 13);
  assert.strictEqual(c.points, 68);
  assert.strictEqual(Number.isInteger(c.matchComp), true);
  assert.strictEqual(Number.isInteger(c.points), true);
});

test('+M leaderboard sorts adjusted Filia above Pingky in user example', () => {
  const base = { conceded: 0, wins: 0, losses: 0, ties: 0, winRate: 0, diff: 0 };
  const rows = [
    { name: 'Fabio',  matches: 5, points: 70, ...base },
    { name: 'Pingky', matches: 5, points: 66, ...base },
    { name: 'Filia',  matches: 4, points: 55, ...base },
    { name: 'Ridel',  matches: 4, points: 50, ...base },
  ];
  const enriched = applyMatchCompensationToLeaderboardRows(rows);
  const sorted = sortLeaderboardRows(enriched, 'points');
  // Average ≈ 13.39 → +M rounded to 13; Filia 68 (> Pingky 66), Ridel 63 (< Pingky 66).
  assert.deepStrictEqual(sorted.map((r) => r.name), ['Fabio', 'Filia', 'Pingky', 'Ridel']);
});
/* ---- computeLeaderboardSorted ---- */
console.log('\ncomputeLeaderboardSorted');

const makeTournament = (players, rounds) => ({
  players: JSON.stringify(players),
  rounds: JSON.stringify(rounds),
});

test('empty tournament returns a row per player with zero stats', () => {
  const t = makeTournament(['Alice', 'Bob'], []);
  const rows = computeLeaderboardSorted(t);
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every(r => r.points === 0 && r.matches === 0));
});

test('single match: winner has 1 win and scored points', () => {
  const t = makeTournament(['Alice', 'Bob', 'Carol', 'Dave'], [
    {
      round: 1,
      matches: [{ team1: ['Alice', 'Bob'], team2: ['Carol', 'Dave'], score1: 21, score2: 15 }],
    },
  ]);
  const rows = computeLeaderboardSorted(t);
  const alice = rows.find(r => r.name === 'Alice');
  const carol = rows.find(r => r.name === 'Carol');
  assert.strictEqual(alice.wins, 1);
  assert.strictEqual(alice.losses, 0);
  assert.strictEqual(alice.points, 21);
  assert.strictEqual(carol.losses, 1);
  assert.strictEqual(carol.points, 15);
});

test('0-0 score is ignored (match not yet played)', () => {
  const t = makeTournament(['Alice', 'Bob', 'Carol', 'Dave'], [
    {
      round: 1,
      matches: [{ team1: ['Alice', 'Bob'], team2: ['Carol', 'Dave'], score1: 0, score2: 0 }],
    },
  ]);
  const rows = computeLeaderboardSorted(t);
  assert.ok(rows.every(r => r.matches === 0));
});

test('tie match increments ties counter', () => {
  const t = makeTournament(['Alice', 'Bob', 'Carol', 'Dave'], [
    {
      round: 1,
      matches: [{ team1: ['Alice', 'Bob'], team2: ['Carol', 'Dave'], score1: 21, score2: 21 }],
    },
  ]);
  const rows = computeLeaderboardSorted(t);
  assert.ok(rows.every(r => r.ties === 1));
  assert.ok(rows.every(r => r.wins === 0 && r.losses === 0));
});

test('multi-round accumulation: points sum across rounds', () => {
  const t = makeTournament(['Alice', 'Bob', 'Carol', 'Dave'], [
    {
      round: 1,
      matches: [{ team1: ['Alice', 'Bob'], team2: ['Carol', 'Dave'], score1: 21, score2: 10 }],
    },
    {
      round: 2,
      matches: [{ team1: ['Alice', 'Bob'], team2: ['Carol', 'Dave'], score1: 18, score2: 21 }],
    },
  ]);
  const rows = computeLeaderboardSorted(t);
  const alice = rows.find(r => r.name === 'Alice');
  assert.strictEqual(alice.points, 21 + 18);
  assert.strictEqual(alice.wins, 1);
  assert.strictEqual(alice.losses, 1);
  assert.strictEqual(alice.matches, 2);
});

test('computeLeaderboardSorted skips comp when opts.applyMatchCompensation is false', () => {
  const t = makeTournament(['A', 'B', 'C', 'D'], [
    {
      round: 1,
      matches: [{ team1: ['A', 'B'], team2: ['C', 'D'], score1: 21, score2: 10 }],
    },
  ]);
  const rows = computeLeaderboardSorted(t, 'points', { applyMatchCompensation: false });
  rows.forEach((r) => assert.strictEqual(r.matchComp, 0));
});

test('leaderboard sorted by points descending', () => {
  const t = makeTournament(['Alice', 'Bob', 'Carol', 'Dave'], [
    {
      round: 1,
      matches: [{ team1: ['Alice', 'Bob'], team2: ['Carol', 'Dave'], score1: 21, score2: 10 }],
    },
  ]);
  const rows = computeLeaderboardSorted(t);
  for (let i = 0; i < rows.length - 1; i++) {
    assert.ok(rows[i].points >= rows[i + 1].points, 'rows must be sorted points desc');
  }
});

/* ---- constants ---- */
console.log('\nconstants');
test('MIN_PLAYER_LEVEL is 1', () => assert.strictEqual(MIN_PLAYER_LEVEL, 1));
test('MAX_PLAYER_LEVEL is 5', () => assert.strictEqual(MAX_PLAYER_LEVEL, 5));
test('DEFAULT_PLAYER_LEVEL is 3', () => assert.strictEqual(DEFAULT_PLAYER_LEVEL, 3));

/* ---- summary ---- */
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
