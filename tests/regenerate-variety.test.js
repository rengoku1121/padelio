'use strict';

const assert = require('assert');
const pairing = require('../js/pairing.js');
const normal = require('../js/normal-americano-planner.js');

const { buildMexicanoMatches, pairKey } = pairing;
const planFn = normal.planNormalAmericanoRound;

function canon(matches) {
  return (matches || [])
    .map((m) => {
      const t1 = [...(m.team1 || [])].map(String).sort();
      const t2 = [...(m.team2 || [])].map(String).sort();
      return [t1.join('+'), t2.join('+')].sort().join(' vs ');
    })
    .sort()
    .join(' | ');
}

function bench(players, matches) {
  const on = new Set();
  for (const m of matches || []) {
    for (const side of ['team1', 'team2']) {
      for (const p of m[side] || []) on.add(String(p));
    }
  }
  return players.filter((p) => !on.has(p)).sort().join(',');
}

function collectAvoid(matches) {
  const avoidPartners = new Set();
  const active = [];
  (matches || []).forEach((m) => {
    for (const team of [m.team1, m.team2]) {
      if (Array.isArray(team) && team.length === 2) {
        avoidPartners.add(pairKey(team[0], team[1]));
      }
    }
    for (const n of [...(m.team1 || []), ...(m.team2 || [])]) active.push(String(n));
  });
  return {
    avoidPartners,
    avoidActiveKey: active.slice().sort().join('|')
  };
}

function mex(players, courts, rounds = [], roundNo = 1, opts = {}) {
  const t = {
    mode: 'mexicano',
    courts,
    players: JSON.stringify(players.map((n) => ({ name: n, level: 3 }))),
    rounds: JSON.stringify(rounds)
  };
  const pf = players.map((n) => ({ name: n, level: 3 }));
  return buildMexicanoMatches(players, courts, rounds, roundNo, t, pf, opts);
}

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

console.log('Regenerate variety (4–5 players / 1 court)');

test('Mexicano 4p: regenerate with avoid changes partners', () => {
  const players = ['A', 'B', 'C', 'D'];
  const first = mex(players, 1);
  assert.ok(first.length === 1, 'expected 1 match');
  const fp1 = canon(first);
  const avoid = collectAvoid(first);
  const seconds = new Set();
  for (let i = 0; i < 20; i++) {
    seconds.add(canon(mex(players, 1, [], 1, avoid)));
  }
  assert.ok([...seconds].some((s) => s !== fp1), `expected different split, got only ${[...seconds]}`);
});

test('Mexicano 5p: regenerate can change bench or partners', () => {
  const players = ['A', 'B', 'C', 'D', 'E'];
  const first = mex(players, 1);
  const fp1 = canon(first);
  const b1 = bench(players, first);
  const avoid = collectAvoid(first);
  let changed = false;
  for (let i = 0; i < 30; i++) {
    const next = mex(players, 1, [], 1, avoid);
    if (canon(next) !== fp1 || bench(players, next) !== b1) {
      changed = true;
      break;
    }
  }
  assert.ok(changed, 'expected regenerate to change matchup or bench');
});

test('Normal 4p: avoid partners forces different split', () => {
  const players = ['A', 'B', 'C', 'D'];
  const first = planFn({ players, courts: 1, priorRounds: [], roundNo: 1 }).matches;
  const fp1 = canon(first);
  const avoid = collectAvoid(first);
  const seconds = new Set();
  for (let i = 0; i < 20; i++) {
    const out = planFn({
      players,
      courts: 1,
      priorRounds: [],
      roundNo: 1,
      opts: { avoidPartners: avoid.avoidPartners }
    });
    seconds.add(canon(out.matches));
  }
  assert.ok([...seconds].some((s) => s !== fp1), `expected different split, got ${[...seconds]}`);
});

test('Normal 5p: regenerate still varies', () => {
  const players = ['A', 'B', 'C', 'D', 'E'];
  const sets = new Set();
  for (let i = 0; i < 40; i++) {
    const out = planFn({ players, courts: 1, priorRounds: [], roundNo: 1 });
    sets.add(canon(out.matches) + ' #' + bench(players, out.matches));
  }
  assert.ok(sets.size >= 3, `expected variety, got ${sets.size}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
