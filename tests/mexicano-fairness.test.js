/* =========================
   tests/mexicano-fairness.test.js
   Run: node tests/mexicano-fairness.test.js
   ========================= */
'use strict';

const assert = require('assert');
const {
  pairKey,
  matchupKey,
  computeMexicanoRoundCapacity,
  computeMexicanoSessionTargets,
  buildMexicanoMatches,
  buildMexicanoFairnessReport,
  buildBestMexicanoCandidateSchedule,
} = require('../js/pairing.js');

let passed = 0;
let failed = 0;

function test (name, fn) {
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

function buildTournament (players, courts, mode = 'mexicano') {
  return {
    mode,
    courts,
    players: JSON.stringify(players.map((p) => (typeof p === 'string' ? { name: p, level: 3 } : p))),
    rounds: JSON.stringify([]),
  };
}

function playersFullFromNames (names) {
  return names.map((name) => ({ name, level: 3, gender: name.charCodeAt(0) % 2 ? 'M' : 'F' }));
}

function scoreRoundDeterministic (round, seed) {
  (round.matches || []).forEach((m, idx) => {
    const a = ((seed + idx * 37) % 17) + 1;
    const b = ((seed * 7 + idx * 11) % 17) + 1;
    m.score1 = String(a);
    m.score2 = String(a === b ? (b % 17) + 1 : b);
  });
}

function mulberry32 (seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulateMexicano (rosterNames, courts, totalRounds, seed = 1, opts = {}) {
  const tournament = buildTournament(rosterNames, courts);
  const playersFull = rosterNames.map((name) => ({ name, level: 3 }));
  const random = typeof opts.random === 'function' ? opts.random : mulberry32(seed >>> 0);
  const rounds = [];
  for (let r = 1; r <= totalRounds; r++) {
    tournament.rounds = JSON.stringify(rounds);
    const matches = buildMexicanoMatches(
      rosterNames, courts, rounds, r, tournament, playersFull, { random }
    );
    const round = { round: r, matches };
    scoreRoundDeterministic(round, seed + r * 100);
    rounds.push(round);
  }
  return rounds;
}

function hasConsecutiveExactMatch (rounds) {
  for (let i = 1; i < rounds.length; i++) {
    const prev = new Set();
    (rounds[i - 1].matches || []).forEach((m) => {
      const t1 = m.team1 || [];
      const t2 = m.team2 || [];
      if (t1.length === 2 && t2.length === 2) {
        prev.add(matchupKey({ m: t1[0], f: t1[1] }, { m: t2[0], f: t2[1] }));
      }
    });
    for (const m of rounds[i].matches || []) {
      const t1 = m.team1 || [];
      const t2 = m.team2 || [];
      if (t1.length === 2 && t2.length === 2) {
        const mk = matchupKey({ m: t1[0], f: t1[1] }, { m: t2[0], f: t2[1] });
        if (prev.has(mk)) return true;
      }
    }
  }
  return false;
}

function maxPartnerCount (rounds) {
  const counts = new Map();
  for (const rd of rounds) {
    for (const m of rd.matches || []) {
      for (const team of [m.team1 || [], m.team2 || []]) {
        if (team.length === 2) {
          const k = pairKey(team[0], team[1]);
          counts.set(k, (counts.get(k) || 0) + 1);
        }
      }
    }
  }
  let max = 0;
  counts.forEach((c) => { if (c > max) max = c; });
  return max;
}

console.log('\nMexicano dynamic fairness');

test('computeMexicanoRoundCapacity — 10p / 3c uses 2 courts (8 players)', () => {
  const cap = computeMexicanoRoundCapacity(10, 3);
  assert.strictEqual(cap.playingPlayersPerRound, 8);
  assert.strictEqual(cap.usedCourtsPerRound, 2);
  assert.strictEqual(cap.byePlayersPerRound, 2);
});

test('computeMexicanoSessionTargets — 15p / 3c / 5r ideal 4 games and 1 bye', () => {
  const t = computeMexicanoSessionTargets(15, 3, 5);
  assert.strictEqual(t.playingPlayersPerRound, 12);
  assert.strictEqual(t.byePlayersPerRound, 3);
  assert.strictEqual(t.idealGamesPerPlayer, 4);
  assert.strictEqual(t.idealByesPerPlayer, 1);
});

test('15p / 3c / 5r — every player exactly 4 games and 1 bye', () => {
  const roster = [
    'Fabio', 'ridel', 'gavin', 'dio', 'fedi', 'Senas',
    'pingky', 'filia', 'maria', 'Sharon', 'cindy', 'Esther',
    'Edwin', 'vanesya', 'Nico'
  ];
  const rounds = simulateMexicano(roster, 3, 5, 42);
  const report = buildMexicanoFairnessReport(roster, rounds, 3, 5);

  assert.strictEqual(report.gamesPlayedDifference, 0);
  assert.strictEqual(report.byeDifference, 0);
  assert.strictEqual(report.playingPlayersPerRound, 12);
  assert.strictEqual(report.usedCourtsPerRound, 3);
  roster.forEach((n) => {
    assert.strictEqual(report.gamesByPlayer[n], 4, `${n} games`);
    assert.strictEqual(report.byesByPlayer[n], 1, `${n} byes`);
  });
});

test('dynamic matrix — games/bye diff ≤ 1; exact when ideal is integer', () => {
  const matrix = [
    { n: 4, c: 1, r: 4 },
    { n: 5, c: 1, r: 5 },
    { n: 7, c: 1, r: 7 },
    { n: 8, c: 2, r: 4 },
    { n: 10, c: 2, r: 5 },
    { n: 12, c: 2, r: 6 },
    { n: 15, c: 3, r: 5 },
    { n: 16, c: 3, r: 5 },
    { n: 18, c: 4, r: 5 },
    { n: 20, c: 4, r: 5 },
  ];

  for (const { n, c, r } of matrix) {
    const roster = Array.from({ length: n }, (_, i) => `P${i + 1}`);
    const rounds = simulateMexicano(roster, c, r, n + c);
    const report = buildMexicanoFairnessReport(roster, rounds, c, r);
    const targets = computeMexicanoSessionTargets(n, c, r);

    assert.ok(report.gamesPlayedDifference <= 1, `${n}p/${c}c/${r}r games diff`);
    assert.ok(report.byeDifference <= 1, `${n}p/${c}c/${r}r bye diff`);

    if (Number.isInteger(targets.idealGamesPerPlayer)) {
      assert.strictEqual(
        report.gamesPlayedDifference, 0,
        `${n}p/${c}c/${r}r exact games (ideal=${targets.idealGamesPerPlayer})`
      );
    }
    if (Number.isInteger(targets.idealByesPerPlayer)) {
      assert.strictEqual(
        report.byeDifference, 0,
        `${n}p/${c}c/${r}r exact byes (ideal=${targets.idealByesPerPlayer})`
      );
    }
  }
});

test('rotation — no consecutive exact match repeat (15p / 3c / 5r)', () => {
  const roster = Array.from({ length: 15 }, (_, i) => `P${i + 1}`);
  const rounds = simulateMexicano(roster, 3, 5, 7);
  assert.strictEqual(hasConsecutiveExactMatch(rounds), false);
});

test('rotation — no partner pair at 4x (15p / 3c / 5r)', () => {
  const roster = Array.from({ length: 15 }, (_, i) => `P${i + 1}`);
  const rounds = simulateMexicano(roster, 3, 5, 11);
  assert.ok(maxPartnerCount(rounds) <= 3, `max partner count ${maxPartnerCount(rounds)}`);
});

test('buildBestMexicanoCandidateSchedule improves 15p/3c/5r vs single greedy pass', () => {
  const roster = Array.from({ length: 15 }, (_, i) => `P${i + 1}`);
  const greedy = simulateMexicano(roster, 3, 5, 1, { random: mulberry32(1) });
  const greedyReport = buildMexicanoFairnessReport(roster, greedy, 3, 5);

  const optimized = buildBestMexicanoCandidateSchedule(roster, 3, 5, {
    candidateCount: 50,
    baseSeed: 1
  });
  const optReport = optimized.report;

  const rotationCost = (r) =>
    (r.repeatedExactMatches || 0) * 100 +
    (r.totalPartnerRepeats || 0) * 10 +
    (r.totalOpponentRepeats || 0);

  assert.ok(optReport.gamesPlayedDifference <= greedyReport.gamesPlayedDifference);
  assert.ok(optReport.byeDifference <= greedyReport.byeDifference);
  assert.ok(
    rotationCost(optReport) <= rotationCost(greedyReport),
    `optimizer rotation cost ${rotationCost(optReport)} > greedy ${rotationCost(greedyReport)}`
  );
  assert.ok(optimized.candidatesTried >= 50);
});

test('buildMexicanoFairnessReport exposes capacity and repeat fields', () => {
  const roster = Array.from({ length: 15 }, (_, i) => `P${i + 1}`);
  const rounds = simulateMexicano(roster, 3, 5, 3);
  const report = buildMexicanoFairnessReport(roster, rounds, 3, 5);

  assert.strictEqual(report.playingPlayersPerRound, 12);
  assert.strictEqual(report.byePlayersPerRound, 3);
  assert.strictEqual(report.usedCourtsPerRound, 3);
  assert.strictEqual(report.idealGamesPerPlayer, 4);
  assert.strictEqual(report.idealByesPerPlayer, 1);
  assert.ok(typeof report.repeatedExactMatches === 'number');
  assert.ok(typeof report.repeatedMatchGroups === 'number');
  assert.ok(Array.isArray(report.repeatedExactMatchesDetail));
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
