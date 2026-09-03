'use strict';

/**
 * Regression: prior rounds must never vanish across next/regenerate/undo/sync.
 * Simulates the state helpers used by js/script.js (not a browser e2e).
 *
 * Run: node tests/rounds-persistence.test.js
 */

const assert = require('assert');
const pairing = require('../js/pairing.js');
const normal = require('../js/normal-americano-planner.js');

const {
  buildMexicanoMatches,
  buildMixMexicanoMatches,
  buildFixedPairsMexicanoMatches,
  buildBestNormalMatches,
  buildMixHistory,
  pickActivePlayersNormal,
} = pairing;

const planNormal = normal.planNormalAmericanoRound;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
    passed++;
  } catch (e) {
    console.error('  ✗', name);
    console.error('   ', e.message);
    failed++;
  }
}

function scoreRound(round, seed) {
  (round.matches || []).forEach((m, idx) => {
    const a = ((seed + idx * 37) % 17) + 1;
    const b = ((seed * 7 + idx * 11) % 17) + 1;
    m.score1 = String(a);
    m.score2 = String(a === b ? (b % 17) + 1 : b);
  });
}

function fingerprintRounds(rounds) {
  return JSON.stringify(
    (rounds || []).map((r) => ({
      round: Number(r.round),
      matches: (r.matches || []).map((m) => ({
        court: m.court,
        t1: [...(m.team1 || [])].map(String).sort(),
        t2: [...(m.team2 || [])].map(String).sort(),
        s1: m.score1,
        s2: m.score2,
      })),
    }))
  );
}

function priorIntact(before, after, upToRoundExclusive) {
  const b = (before || []).filter((r) => Number(r.round) < upToRoundExclusive);
  const a = (after || []).filter((r) => Number(r.round) < upToRoundExclusive);
  assert.strictEqual(
    fingerprintRounds(b),
    fingerprintRounds(a),
    `prior rounds before ${upToRoundExclusive} changed`
  );
}

/** Mirror script.js syncCurrentTournament gate. */
function syncLike(currentRoundsRaw, freshRoundsRaw) {
  const curR = JSON.parse(currentRoundsRaw || '[]');
  const freshR = JSON.parse(freshRoundsRaw || '[]');
  const countSlots = (roundsArr) =>
    roundsArr.reduce(
      (sum, r) =>
        sum +
        (r.matches || []).reduce(
          (s, m) => s + (m.team1?.length || 0) + (m.team2?.length || 0),
          0
        ),
      0
    );
  const wCur = countSlots(curR);
  const wFresh = countSlots(freshR);
  if (wFresh < wCur || freshR.length < curR.length) {
    return currentRoundsRaw; // keep in-memory
  }
  return freshRoundsRaw;
}

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => `P${i + 1}`);
}

function simulateMexicano(nPlayers, courts, totalRounds) {
  const players = makePlayers(nPlayers);
  const tournament = {
    mode: 'mexicano',
    courts,
    players: JSON.stringify(players.map((name) => ({ name, level: 3 }))),
    rounds: '[]',
  };
  const pf = players.map((name) => ({ name, level: 3 }));
  const rounds = [];
  for (let r = 1; r <= totalRounds; r++) {
    const matches = buildMexicanoMatches(players, courts, rounds, r, tournament, pf);
    assert.ok(matches.length > 0, `mexicano R${r} produced 0 matches`);
    const round = { round: r, matches };
    scoreRound(round, r * 17);
    rounds.push(round);
    tournament.rounds = JSON.stringify(rounds);
  }
  return { players, rounds, tournament, pf };
}

console.log('Rounds persistence / vanish regression\n');

test('Mexicano 12p/2c/6r — all prior rounds stay after each next round', () => {
  const players = makePlayers(12);
  const tournament = {
    mode: 'mexicano',
    courts: 2,
    players: JSON.stringify(players.map((name) => ({ name, level: 3 }))),
    rounds: '[]',
  };
  const pf = players.map((name) => ({ name, level: 3 }));
  const rounds = [];
  for (let r = 1; r <= 6; r++) {
    const before = JSON.parse(JSON.stringify(rounds));
    const matches = buildMexicanoMatches(players, 2, rounds, r, tournament, pf);
    assert.ok(matches.length === 2, `expected 2 courts at R${r}`);
    const round = { round: r, matches };
    scoreRound(round, r * 9);
    rounds.push(round);
    priorIntact(before, rounds, r);
    tournament.rounds = JSON.stringify(rounds);
  }
  assert.strictEqual(rounds.length, 6);
});

test('Mexicano 15p/3c/5r — regenerating current round does not touch scored priors', () => {
  const { players, rounds, tournament, pf } = simulateMexicano(15, 3, 4);
  // score R1-R3, leave R4 unscored then "regenerate" R4
  const scored = rounds.slice(0, 3);
  const beforePriors = JSON.parse(JSON.stringify(scored));
  const priorOnly = scored.slice();
  const matches = buildMexicanoMatches(players, 3, priorOnly, 4, tournament, pf, {
    avoidPartners: new Set(),
  });
  assert.ok(matches.length === 3);
  const after = [...priorOnly, { round: 4, matches }];
  priorIntact(beforePriors, after, 4);
});

test('Normal Americano 8p/2c — multi-round history grows without dropping priors', () => {
  const players = makePlayers(8);
  const rounds = [];
  for (let r = 1; r <= 5; r++) {
    const before = JSON.parse(JSON.stringify(rounds));
    const out = planNormal({ players, courts: 2, priorRounds: rounds, roundNo: r });
    assert.ok(out.matches && out.matches.length === 2, `normal R${r}`);
    const round = { round: r, matches: out.matches };
    scoreRound(round, r * 3);
    rounds.push(round);
    priorIntact(before, rounds, r);
  }
});

test('Mix Mexicano 8p (4M4F)/2c — priors intact across 4 rounds', () => {
  const males = ['M1', 'M2', 'M3', 'M4'];
  const females = ['F1', 'F2', 'F3', 'F4'];
  const playersFull = [
    ...males.map((name) => ({ name, gender: 'M', level: 3 })),
    ...females.map((name) => ({ name, gender: 'F', level: 3 })),
  ];
  const tournament = {
    mode: 'mixmex',
    courts: 2,
    players: JSON.stringify(playersFull),
    rounds: '[]',
  };
  const rounds = [];
  for (let r = 1; r <= 4; r++) {
    const before = JSON.parse(JSON.stringify(rounds));
    const matches = buildMixMexicanoMatches(playersFull, 2, rounds, r, tournament);
    assert.ok(matches.length >= 1, `mixmex R${r}`);
    const round = { round: r, matches };
    scoreRound(round, r * 5);
    rounds.push(round);
    priorIntact(before, rounds, r);
  }
});

test('Fixed Mexicano 8 players / 2c — priors intact', () => {
  const playersFull = makePlayers(8).map((name, i) => ({
    name,
    gender: i % 2 ? 'M' : 'F',
    level: 3,
  }));
  const pairs = [];
  for (let i = 0; i + 1 < playersFull.length; i += 2) {
    pairs.push({ m: playersFull[i].name, f: playersFull[i + 1].name });
  }
  const tournament = {
    mode: 'fixedmex',
    courts: 2,
    players: JSON.stringify(playersFull),
    rounds: '[]',
  };
  const rounds = [];
  for (let r = 1; r <= 4; r++) {
    const before = JSON.parse(JSON.stringify(rounds));
    const matches = buildFixedPairsMexicanoMatches(
      pairs,
      2,
      rounds,
      r,
      tournament,
      playersFull
    );
    assert.ok(matches.length >= 1, `fixedmex R${r}`);
    const round = { round: r, matches };
    scoreRound(round, r * 11);
    rounds.push(round);
    priorIntact(before, rounds, r);
  }
});

test('Simulated Undo Next Round — only drops newest round, keeps scored priors', () => {
  const { rounds } = simulateMexicano(12, 2, 5);
  const snap = JSON.parse(JSON.stringify(rounds.slice(0, 4))); // before next into R5
  // after "next" we have 5 rounds; undo restores snap
  const afterUndo = snap;
  assert.strictEqual(afterUndo.length, 4);
  priorIntact(rounds, [...afterUndo, rounds[4]], 5);
  // scores on R1-R4 still present
  afterUndo.forEach((r) => {
    (r.matches || []).forEach((m) => {
      assert.ok(m.score1 !== '' && m.score2 !== '', `R${r.round} scores missing after undo next`);
    });
  });
});

test('Sync race: stale shorter list must NOT clobber fuller in-memory rounds', () => {
  const full = simulateMexicano(12, 2, 5).rounds;
  const fullRaw = JSON.stringify(full);
  const staleRaw = JSON.stringify(full.slice(0, 2));
  const kept = syncLike(fullRaw, staleRaw);
  assert.strictEqual(kept, fullRaw);
});

test('Sync race: empty SDK payload must NOT wipe local rounds', () => {
  const fullRaw = JSON.stringify(simulateMexicano(10, 2, 4).rounds);
  const kept = syncLike(fullRaw, '[]');
  assert.strictEqual(kept, fullRaw);
});

test('Sync race: equal-length empty shells must NOT wipe scored rounds (slot guard)', () => {
  const full = simulateMexicano(12, 2, 3).rounds;
  const shells = full.map((r) => ({ round: r.round, matches: [] }));
  const kept = syncLike(JSON.stringify(full), JSON.stringify(shells));
  assert.strictEqual(kept, JSON.stringify(full));
});

test('Regenerate filter only removes target round number', () => {
  const { rounds } = simulateMexicano(12, 2, 5);
  const roundNo = 5;
  const filtered = rounds.filter((r) => Number(r.round) !== roundNo);
  assert.strictEqual(filtered.length, 4);
  priorIntact(rounds, filtered, 5);
});

test('Dangerous UX: Undo after Next Round looks like “new match vanished” but priors OK', () => {
  // Documents expected product behavior — not a pairing bug.
  const beforeNext = simulateMexicano(8, 2, 3).rounds;
  const afterNext = [
    ...beforeNext,
    {
      round: 4,
      matches: [
        {
          court: 1,
          team1: ['P1', 'P2'],
          team2: ['P3', 'P4'],
          score1: '',
          score2: '',
        },
      ],
    },
  ];
  const undone = beforeNext; // undo snapshot
  assert.strictEqual(undone.length, 3);
  assert.ok(!undone.some((r) => Number(r.round) === 4));
  priorIntact(beforeNext, undone, 4);
  assert.ok(afterNext.length === 4);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
