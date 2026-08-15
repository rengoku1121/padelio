/**
 * Normal / Balanced Americano — one-round planner (partner, opponent, matchup, quartet).
 * Quartet = the set of four distinct players on one court (partnerships can change next time).
 * Exposes window.PadelioAmericanoPlanner and window.planAmericanoRound.
 */
((root) => {
  'use strict';
  if (!root) return;

  const DEFAULT_PLAYER_LEVEL = 3;
  const POWER_LEVEL_PARTNER_ALPHA = 8;
  const POWER_LEVEL_MATCH_BETA = 4;

  const COMMON_NAME_TYPOS = new Map([['pingku', 'Pingky']]);
  const normalizeNameKey = (s) => String(s ?? '').trim().toLowerCase();

  const fixCommonNameTypos = (name) => {
    const t = String(name ?? '').trim();
    const canon = COMMON_NAME_TYPOS.get(normalizeNameKey(t));
    return canon != null ? canon : t;
  };

  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const pairKey = (a, b) => {
    const x = String(a ?? '');
    const y = String(b ?? '');
    return x < y ? `${x}__${y}` : `${y}__${x}`;
  };

  const matchupKeyTeams = (t1a, t1b, t2a, t2b) => {
    const k1 = pairKey(t1a, t1b);
    const k2 = pairKey(t2a, t2b);
    return k1 < k2 ? `${k1}||${k2}` : `${k2}||${k1}`;
  };

  const quartetKeyFromFour = (n1, n2, n3, n4, resolve) => {
    const a = [resolve(n1), resolve(n2), resolve(n3), resolve(n4)].sort((x, y) =>
      String(x).localeCompare(String(y))
    );
    return a.join('|');
  };

  const makeResolve = (players) => {
    const map = new Map();
    (players || []).forEach((n) => {
      const display = fixCommonNameTypos(String(n ?? '').trim());
      const k = normalizeNameKey(display);
      if (display && !map.has(k)) map.set(k, display);
    });
    return (raw) => {
      const fixed = fixCommonNameTypos(raw);
      return map.get(normalizeNameKey(fixed)) ?? fixed;
    };
  };

  function getPriorRoundsCompleted(allRounds, roundNo) {
    return [...(Array.isArray(allRounds) ? allRounds : [])]
      .filter((r) => Number(r.round) < Number(roundNo))
      .sort((a, b) => Number(a.round) - Number(b.round));
  }

  function getPreviousRoundDatum(allRounds, roundNo) {
    const want = Number(roundNo) - 1;
    if (want < 1) return null;
    const exact = allRounds.find((r) => Number(r.round) === want);
    if (exact) return exact;
    const prior = getPriorRoundsCompleted(allRounds, roundNo);
    return prior.length ? prior[prior.length - 1] : null;
  }

  const consecutiveBenchStreak = (name, priorRounds, resolve) => {
    const canon = resolve(name);
    let streak = 0;
    for (let i = priorRounds.length - 1; i >= 0; i--) {
      const on = new Set();
      (priorRounds[i].matches || []).forEach((m) => {
        for (const x of [...(m.team1 || []), ...(m.team2 || [])]) on.add(resolve(x));
      });
      if (on.has(canon)) break;
      streak++;
    }
    return streak;
  };

  const getLastRoundPartnerSet = (prevRoundDatum, resolve) => {
    const out = new Set();
    if (!prevRoundDatum) return out;
    (prevRoundDatum.matches || []).forEach((m) => {
      const t1 = m.team1 || [];
      const t2 = m.team2 || [];
      if (t1.length === 2) out.add(pairKey(resolve(t1[0]), resolve(t1[1])));
      if (t2.length === 2) out.add(pairKey(resolve(t2[0]), resolve(t2[1])));
    });
    return out;
  };

  const pairCrossOpposeScore = (pA, pB, opposeCount) =>
    (opposeCount.get(pairKey(pA.m, pB.m)) || 0) +
    (opposeCount.get(pairKey(pA.m, pB.f)) || 0) +
    (opposeCount.get(pairKey(pA.f, pB.m)) || 0) +
    (opposeCount.get(pairKey(pA.f, pB.f)) || 0);

  /** Match script.js: lowest games played wins; RNG only breaks ties inside the same fairness tier */
  function fairnessTierCmp(a, b) {
    if (a.played !== b.played) return a.played - b.played;
    if (a.benchedLastRound !== b.benchedLastRound) return a.benchedLastRound ? -1 : 1;
    if (a.streak !== b.streak) return b.streak - a.streak;
    return 0;
  }

  function shuffleFairnessRuns(rows) {
    const sorted = [...rows].sort(fairnessTierCmp);
    const out = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      while (j < sorted.length && fairnessTierCmp(sorted[i], sorted[j]) === 0) j++;
      const run = sorted.slice(i, j);
      shuffle(run);
      out.push(...run);
      i = j;
    }
    return out;
  }

  const activeSetKey = (names, resolve) =>
    [...(names || [])].map((n) => resolve(n)).sort((a, b) => String(a).localeCompare(String(b))).join('|');

  const getRecentActiveSetKeys = (priorRounds, resolve, limit = 8) => {
    const out = new Set();
    const recent = [...(priorRounds || [])].slice(-limit);
    recent.forEach((r) => {
      const names = [];
      (r.matches || []).forEach((m) => {
        names.push(...(m.team1 || []), ...(m.team2 || []));
      });
      if (names.length >= 4) out.add(activeSetKey(names, resolve));
    });
    return out;
  };

  const getRecentQuartetKeys = (priorRounds, resolve, limit = 12) => {
    const out = new Map();
    const recent = [...(priorRounds || [])].slice(-limit);
    recent.forEach((r, idx) => {
      const ageWeight = recent.length - idx;
      (r.matches || []).forEach((m) => {
        const row = [...(m.team1 || []), ...(m.team2 || [])];
        if (row.length === 4) {
          const key = activeSetKey(row, resolve);
          out.set(key, (out.get(key) || 0) + ageWeight);
        }
      });
    });
    return out;
  };

  function weightedPickWithoutReplacement(rows, slots) {
    const pool = [...rows];
    const selected = [];

    while (selected.length < slots && pool.length) {
      const weights = pool.map((x) => {
        let w = 1 / Math.max(1, x.played + 1);
        if (x.benchedLastRound) w += 1.8;
        if (x.streak > 0) w += x.streak * 1.2;
        return Math.max(0.01, w);
      });
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      let pickIndex = 0;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          pickIndex = i;
          break;
        }
      }
      selected.push(pool[pickIndex]);
      pool.splice(pickIndex, 1);
    }

    return selected;
  }

  function scoreActiveCandidate(selectedRows, slots, priorRounds, resolve, stats, lastRound) {
    const names = selectedRows.map((x) => x.name);
    const canon = names.map((n) => resolve(n));
    const played = selectedRows.map((x) => x.played);
    const maxPlayed = Math.max(...played);
    const minPlayed = Math.min(...played);
    const sumPlayed = played.reduce((a, b) => a + b, 0);
    const benchedCount = selectedRows.filter((x) => x.benchedLastRound).length;

    let score = 0;

    // Main fairness: keep match counts as even as possible.
    score += (maxPlayed - minPlayed) * 100000;
    score += sumPlayed * 1000;

    // Prefer players who benched last round, but never at the cost of repeating the same quartet.
    if (lastRound) score -= benchedCount * 250;

    const recentActiveSets = getRecentActiveSetKeys(priorRounds, resolve, 6);
    const recentQuartets = getRecentQuartetKeys(priorRounds, resolve, 12);

    // For 1 court, this is the important fix: do not pick the same 4-player group again.
    if (slots === 4) {
      const qk = activeSetKey(canon, (x) => x);
      const oldQuartetWeight = recentQuartets.get(qk) || 0;
      const allTimeQuartetCount = stats.quartetCount.get(qk) || 0;
      score += oldQuartetWeight * 500000;
      score += allTimeQuartetCount * 250000;
    }

    // For multi-court, avoid a full active set that was just used.
    const ask = activeSetKey(canon, (x) => x);
    if (recentActiveSets.has(ask)) score += 150000;

    // Avoid selecting people who have already been grouped together too often.
    for (let i = 0; i < canon.length; i++) {
      for (let j = i + 1; j < canon.length; j++) {
        const k = pairKey(canon[i], canon[j]);
        score += (stats.partnerCount.get(k) || 0) * 18;
        score += (stats.opposeCount.get(k) || 0) * 6;
      }
    }

    score += Math.random() * 100;
    return score;
  }

  function pickActivePlayersNormal(allNames, slots, allRounds, roundNo) {
    const resolve = makeResolve(allNames);
    const priorRounds = getPriorRoundsCompleted(allRounds, roundNo);
    const lastRound = getPreviousRoundDatum(allRounds, roundNo);
    const playCount = new Map();
    const playedLastRound = new Set();

    priorRounds.forEach((r) => {
      (r.matches || []).forEach((m) => {
        for (const name of [...(m.team1 || []), ...(m.team2 || [])]) {
          const c = resolve(name);
          playCount.set(c, (playCount.get(c) || 0) + 1);
        }
      });
    });
    if (lastRound) {
      (lastRound.matches || []).forEach((m) => {
        for (const name of [...(m.team1 || []), ...(m.team2 || [])]) {
          playedLastRound.add(resolve(name));
        }
      });
    }

    const keyed = allNames.map((name) => ({
      name,
      played: playCount.get(resolve(name)) ?? playCount.get(name) ?? 0,
      streak: consecutiveBenchStreak(name, priorRounds, resolve),
      benchedLastRound: lastRound ? !playedLastRound.has(resolve(name)) : false
    }));

    if (!lastRound) {
      // Old code used allNames.slice(0, slots), which made the opening groups fixed/predictable.
      return shuffleFairnessRuns(keyed).slice(0, slots).map((x) => x.name);
    }

    const stats = buildSessionStats(allNames, priorRounds, resolve);
    const ordered = shuffleFairnessRuns(keyed);
    const candidates = [];

    candidates.push(ordered.slice(0, slots));

    const attempts = Math.min(700, Math.max(160, allNames.length * slots * 5));
    for (let i = 0; i < attempts; i++) {
      candidates.push(weightedPickWithoutReplacement(keyed, slots));
    }

    let best = null;
    let bestScore = Infinity;

    for (const cand of candidates) {
      if (!cand || cand.length !== slots) continue;
      const unique = new Set(cand.map((x) => resolve(x.name)));
      if (unique.size !== slots) continue;

      const score = scoreActiveCandidate(cand, slots, priorRounds, resolve, stats, lastRound);
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    return (best || ordered.slice(0, slots)).map((x) => x.name);
  }

  function buildSessionStats(playerNames, priorRoundsFiltered, resolveOuter) {
    const resolve =
      typeof resolveOuter === 'function'
        ? resolveOuter
        : makeResolve(playerNames);

    const partnerCount = new Map();
    const opposeCount = new Map();
    const matchupCount = new Map();
    const quartetCount = new Map();

    priorRoundsFiltered.forEach((r) => {
      (r.matches || []).forEach((m) => {
        const t1 = m.team1 || [];
        const t2 = m.team2 || [];
        if (t1.length === 2) {
          const k = pairKey(resolve(t1[0]), resolve(t1[1]));
          partnerCount.set(k, (partnerCount.get(k) || 0) + 1);
        }
        if (t2.length === 2) {
          const k = pairKey(resolve(t2[0]), resolve(t2[1]));
          partnerCount.set(k, (partnerCount.get(k) || 0) + 1);
        }
        t1.forEach((a) => {
          t2.forEach((b) => {
            const k = pairKey(resolve(a), resolve(b));
            opposeCount.set(k, (opposeCount.get(k) || 0) + 1);
          });
        });
        if (t1.length === 2 && t2.length === 2) {
          const mk = matchupKeyTeams(t1[0], t1[1], t2[0], t2[1]);
          matchupCount.set(mk, (matchupCount.get(mk) || 0) + 1);
          const qk = quartetKeyFromFour(t1[0], t1[1], t2[0], t2[1], resolve);
          quartetCount.set(qk, (quartetCount.get(qk) || 0) + 1);
        }
      });
    });

    return { resolve, partnerCount, opposeCount, matchupCount, quartetCount };
  }

  function getLevel(levelByName, resolve, rawName) {
    if (!levelByName || !(levelByName instanceof Map)) return DEFAULT_PLAYER_LEVEL;
    const cn = resolve(rawName);
    return levelByName.has(cn) ? Number(levelByName.get(cn)) || DEFAULT_PLAYER_LEVEL : DEFAULT_PLAYER_LEVEL;
  }

  /** Same structure as script.js pairing: oppose + matchup-ish team balance + beta|sumDiff| */
  function levelTermsForCourt(pAR, pBR, resolve, levelByName) {
    if (!(levelByName instanceof Map) || levelByName.size === 0) return 0;
    const getL = (n) => getLevel(levelByName, resolve, n);
    const names = [pAR.m, pAR.f, pBR.m, pBR.f];
    const levels = names.map(getL);
    let lo = Infinity;
    let hi = -Infinity;
    for (const L of levels) {
      if (L < lo) lo = L;
      if (L > hi) hi = L;
    }
    const spread = hi - lo;
    if (!(spread > 0)) return 0;

    let s =
      POWER_LEVEL_MATCH_BETA *
      Math.abs(levels[0] + levels[1] - (levels[2] + levels[3]));
    const dm = Math.abs(levels[0] - levels[1]);
    const enf = Math.abs(levels[2] - levels[3]);
    s += POWER_LEVEL_PARTNER_ALPHA * Math.max(0, spread - dm);
    s += POWER_LEVEL_PARTNER_ALPHA * Math.max(0, spread - enf);
    return s;
  }

  function scoreCourtMatch(
    stats,
    phase,
    pA,
    pB,
    resolve,
    levelByName,
    lastRoundPartnerSet,
    relaxPartnerLastRound,
    ignoreLevels
  ) {
    const rA = resolve(pA.m);
    const rB = resolve(pA.f);
    const rC = resolve(pB.m);
    const rD = resolve(pB.f);

    let s =
      (stats.partnerCount.get(pairKey(rA, rB)) || 0) * 50 +
      (stats.partnerCount.get(pairKey(rC, rD)) || 0) * 50;

    if (!relaxPartnerLastRound) {
      s += lastRoundPartnerSet.has(pairKey(rA, rB)) ? 80000 : 0;
      s += lastRoundPartnerSet.has(pairKey(rC, rD)) ? 80000 : 0;
    }

    const pAR = { m: rA, f: rB };
    const pBR = { m: rC, f: rD };
    s += pairCrossOpposeScore(pAR, pBR, stats.opposeCount) * 10;

    const mk = matchupKeyTeams(rA, rB, rC, rD);
    s += (stats.matchupCount.get(mk) || 0) * phase.matchupMul * 200;

    const qk = quartetKeyFromFour(rA, rB, rC, rD, (x) => x);
    s += (stats.quartetCount.get(qk) || 0) * phase.quartetWeight;

    if (!ignoreLevels) {
      s += levelTermsForCourt(pAR, pBR, resolve, levelByName);
    }

    return s;
  }

  const splitsForQuad = (a, b, c, d) => [
    { team1: [a, b], team2: [c, d] },
    { team1: [a, c], team2: [b, d] },
    { team1: [a, d], team2: [b, c] }
  ];

  /** Optional Set of pairKey strings to avoid when regenerating a round. */
  let reshuffleAvoidPartners = null;

  function bestPairingOneCourt(
    fourPlayers,
    stats,
    phase,
    resolve,
    levelByName,
    lastRoundPartnerSet,
    relaxPartnerLastRound,
    ignoreLevels
  ) {
    const a = resolve(fourPlayers[0]);
    const b = resolve(fourPlayers[1]);
    const c = resolve(fourPlayers[2]);
    const d = resolve(fourPlayers[3]);

    let bestSplit = null;
    let best = Infinity;
    const winners = [];

    splitsForQuad(a, b, c, d).forEach(({ team1: t1, team2: t2 }) => {
      const pA = { m: t1[0], f: t1[1] };
      const pB = { m: t2[0], f: t2[1] };
      let sc = scoreCourtMatch(
        stats,
        phase,
        pA,
        pB,
        resolve,
        levelByName,
        lastRoundPartnerSet,
        relaxPartnerLastRound,
        ignoreLevels
      );
      if (reshuffleAvoidPartners && reshuffleAvoidPartners.size) {
        if (reshuffleAvoidPartners.has(pairKey(t1[0], t1[1]))) sc += 1e6;
        if (reshuffleAvoidPartners.has(pairKey(t2[0], t2[1]))) sc += 1e6;
      }
      if (sc < best) {
        best = sc;
        winners.length = 0;
        winners.push({ team1: [...t1], team2: [...t2], total: sc });
      } else if (sc === best && reshuffleAvoidPartners && reshuffleAvoidPartners.size) {
        winners.push({ team1: [...t1], team2: [...t2], total: sc });
      }
    });
    if (!winners.length) return null;
    bestSplit =
      winners.length === 1
        ? winners[0]
        : winners[Math.floor(Math.random() * winners.length)];
    return bestSplit;
  }

  /** All ways to split 8 sorted players into two quads sharing first anchor — 35 partitions */
  function forEachEightPartition(sorted8, cb) {
    const anchor = sorted8[0];
    const others = sorted8.filter((x) => x !== anchor);
    const walk3 = (start, chosen) => {
      if (chosen.length === 3) {
        const quad1 = [anchor, ...chosen];
        const quad2 = sorted8.filter((x) => !quad1.includes(x));
        cb([quad1, quad2]);
        return;
      }
      for (let i = start; i <= others.length - (3 - chosen.length); i++) {
        walk3(i + 1, [...chosen, others[i]]);
      }
    };
    walk3(0, []);
  }

  function planTwoCourtsFromGroups(
    quad1Canon,
    quad2Canon,
    stats,
    phase,
    resolve,
    levelByName,
    lastRoundPartnerSet,
    relaxPartnerLastRound,
    ignoreLevels
  ) {
    const q1 = bestPairingOneCourt(
      quad1Canon,
      stats,
      phase,
      resolve,
      levelByName,
      lastRoundPartnerSet,
      relaxPartnerLastRound,
      ignoreLevels
    );
    const q2 = bestPairingOneCourt(
      quad2Canon,
      stats,
      phase,
      resolve,
      levelByName,
      lastRoundPartnerSet,
      relaxPartnerLastRound,
      ignoreLevels
    );
    if (!q1 || !q2) return null;
    const matches = [
      { court: 1, team1: [...q1.team1], team2: [...q1.team2], score1: '', score2: '' },
      { court: 2, team1: [...q2.team1], team2: [...q2.team2], score1: '', score2: '' }
    ];
    return { matches, score: q1.total + q2.total };
  }

  function duplicatePartnersFromLastRound(matches, prevRound, resolve, relaxPartnerLastRound) {
    if (relaxPartnerLastRound || !prevRound) return false;
    const lastSet = getLastRoundPartnerSet(prevRound, resolve);
    for (const m of matches) {
      const t1 = m.team1 || [];
      const t2 = m.team2 || [];
      if (
        (t1.length === 2 && lastSet.has(pairKey(resolve(t1[0]), resolve(t1[1])))) ||
        (t2.length === 2 && lastSet.has(pairKey(resolve(t2[0]), resolve(t2[1]))))
      ) {
        return true;
      }
    }
    return false;
  }

  function finalizeBundle(bundle, prevRoundDatum, resolve, relaxPartnerLastRound) {
    if (!bundle) return null;
    let sc = bundle.score;
    if (duplicatePartnersFromLastRound(bundle.matches, prevRoundDatum, resolve, relaxPartnerLastRound)) {
      sc += 1e12;
    }
    return { matches: bundle.matches, score: sc };
  }

  function validateMatches(matches, courtCount, resolve) {
    if (!Array.isArray(matches) || matches.length !== courtCount) return false;
    const seenPlayer = new Set();
    const needPlayers = courtCount * 4;
    for (const m of matches) {
      const row = [...(m.team1 || []), ...(m.team2 || [])];
      if (row.length !== 4) return false;
      for (const p of row) {
        const c = resolve(p);
        if (seenPlayer.has(c)) return false;
        seenPlayer.add(c);
      }
    }
    return seenPlayer.size === needPlayers;
  }

  function bundleFromCourtGroups(groups, stats, phase, resolve, levelByName, lastRoundPartnerSet, relaxPartnerLastRound, ignoreLevels, courtBase) {
    const matches = [];
    let score = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (!g || g.length !== 4) return null;
      const pick = bestPairingOneCourt(
        g,
        stats,
        phase,
        resolve,
        levelByName,
        lastRoundPartnerSet,
        relaxPartnerLastRound,
        ignoreLevels
      );
      if (!pick) return null;
      score += pick.total;
      matches.push({
        court: courtBase + i + 1,
        team1: [...pick.team1],
        team2: [...pick.team2],
        score1: '',
        score2: ''
      });
    }
    return { matches, score };
  }

  function shuffleCourtGroups(activeRaw, courtCount) {
    const s = shuffle([...activeRaw]);
    const groups = [];
    for (let c = 0; c < courtCount; c++) {
      groups.push(s.slice(c * 4, c * 4 + 4));
    }
    return groups;
  }

  function hillClimbMulti(
    groups,
    bundle,
    stats,
    phase,
    resolve,
    levelByName,
    lastRoundPartnerSet,
    relaxPartnerLastRound,
    ignoreLevels,
    maxSteps
  ) {
    let curG = groups.map((r) => [...r]);
    let curScore = bundle.score;
    let curMatches = bundle.matches;
    const nCourts = curG.length;
    if (nCourts < 2) return { matches: curMatches, score: curScore };

    for (let step = 0; step < maxSteps; step++) {
      const ci = Math.floor(Math.random() * nCourts);
      let cj = Math.floor(Math.random() * nCourts);
      if (cj === ci) cj = (cj + 1) % nCourts;
      const pi = Math.floor(Math.random() * 4);
      const pj = Math.floor(Math.random() * 4);
      const ng = curG.map((r) => [...r]);
      const t = ng[ci][pi];
      ng[ci][pi] = ng[cj][pj];
      ng[cj][pj] = t;
      const nb = bundleFromCourtGroups(
        ng,
        stats,
        phase,
        resolve,
        levelByName,
        lastRoundPartnerSet,
        relaxPartnerLastRound,
        ignoreLevels,
        0
      );
      if (nb && nb.score < curScore) {
        curG = ng;
        curScore = nb.score;
        curMatches = nb.matches;
      }
    }
    return { matches: curMatches, score: curScore };
  }

  function tryPlanActive(
    activeRaw,
    courtCount,
    stats,
    phase,
    levelByName,
    lastRoundPartnerSet,
    relaxPartnerLastRound,
    ignoreLevels,
    lastDatum
  ) {
    const { resolve } = stats;

    const activeCanon = activeRaw.map((n) => resolve(n));
    if (activeCanon.length !== courtCount * 4) return null;

    if (courtCount === 1) {
      const r = bestPairingOneCourt(
        activeRaw,
        stats,
        phase,
        resolve,
        levelByName,
        lastRoundPartnerSet,
        relaxPartnerLastRound,
        ignoreLevels
      );
      if (!r) return null;
      const bb = finalizeBundle(
        {
          matches: [{ court: 1, team1: [...r.team1], team2: [...r.team2], score1: '', score2: '' }],
          score: r.total
        },
        lastDatum,
        resolve,
        relaxPartnerLastRound
      );
      return bb;
    }

    if (courtCount === 2) {
      const sortedCanon = [...activeCanon].sort((x, y) => String(x).localeCompare(String(y)));
      let best = null;

      forEachEightPartition(sortedCanon, (pairs) => {
        const quad1Canon = pairs[0];
        const quad2Canon = pairs[1];
        const cand = planTwoCourtsFromGroups(
          quad1Canon,
          quad2Canon,
          stats,
          phase,
          resolve,
          levelByName,
          lastRoundPartnerSet,
          relaxPartnerLastRound,
          ignoreLevels
        );
        const fin = finalizeBundle(cand, lastDatum, resolve, relaxPartnerLastRound);
        if (fin && (!best || fin.score < best.score)) best = fin;
      });

      return best;
    }

    /** 3+ courts: random partition + short hill climbing */
    const attemptsPhase =
      phase.multiAttemptsHint || Math.min(200, Math.max(70, courtCount * 45 + 60));
    const climbSteps = Math.min(140, Math.max(35, courtCount * 28));
    let best = null;
    for (let a = 0; a < attemptsPhase; a++) {
      let groups = shuffleCourtGroups(activeRaw, courtCount);
      let cand = bundleFromCourtGroups(
        groups,
        stats,
        phase,
        resolve,
        levelByName,
        lastRoundPartnerSet,
        relaxPartnerLastRound,
        ignoreLevels,
        0
      );
      if (!cand) continue;
      cand = hillClimbMulti(
        groups,
        cand,
        stats,
        phase,
        resolve,
        levelByName,
        lastRoundPartnerSet,
        relaxPartnerLastRound,
        ignoreLevels,
        climbSteps
      );
      cand = finalizeBundle(cand, lastDatum, resolve, relaxPartnerLastRound);
      if (cand && (!best || cand.score < best.score)) best = cand;
    }
    return best;
  }

  function phaseListForLevel(useLevels) {
    const base = [
      { quartetWeight: 260, matchupMul: 1, partnerLastRound: false, ignoreLevels: false },
      { quartetWeight: 55, matchupMul: 1, partnerLastRound: false, ignoreLevels: false },
      { quartetWeight: 18, matchupMul: 0.85, partnerLastRound: false, ignoreLevels: false },
      { quartetWeight: 0, matchupMul: 0.45, partnerLastRound: false, ignoreLevels: false },
      { quartetWeight: 0, matchupMul: 0, partnerLastRound: false, ignoreLevels: false },
      { quartetWeight: 0, matchupMul: 0, partnerLastRound: true, ignoreLevels: false }
    ];
    if (!useLevels) {
      base.forEach((p) => {
        p.ignoreLevels = true;
      });
    }
    return base;
  }

  function planAmericanoRound(params) {
    const {
      players,
      courtCount,
      priorRounds,
      roundNo,
      levelByName = null,
      opts = {}
    } = params || {};

    const roster = [...(players || [])].map((x) => String(x ?? '').trim()).filter(Boolean);
    const rn = Number(roundNo) || 1;
    const cc = Number(courtCount) || 0;
    const priorFiltered = getPriorRoundsCompleted(priorRounds, rn);
    const stats = buildSessionStats(roster, priorFiltered);

    let levelMap = null;
    if (levelByName instanceof Map) levelMap = levelByName.size ? levelByName : null;
    else if (levelByName && typeof levelByName === 'object') {
      const m = new Map();
      for (const [k, v] of Object.entries(levelByName)) {
        const key = stats.resolve(k);
        m.set(key, Number(v));
      }
      levelMap = m.size ? m : null;
    }

    const useLevels = Boolean(levelMap && levelMap.size);
    const pickFn =
      typeof opts.pickActiveFn === 'function'
        ? opts.pickActiveFn
        : pickActivePlayersNormal;

    let activeRaw;
    if (
      Array.isArray(opts.fixedActiveNames) &&
      opts.fixedActiveNames.length === cc * 4 &&
      cc > 0
    ) {
      activeRaw = opts.fixedActiveNames.map((x) => String(x ?? '').trim());
    } else {
      activeRaw = pickFn(roster, cc * 4, priorRounds, rn);
    }

    const slots = cc * 4;

    if (cc <= 0) {
      return { matches: [], error: '' };
    }
    if (!activeRaw || activeRaw.length !== slots) {
      return {
        matches: [],
        error: 'active_roster_mismatch'
      };
    }

    const lastDatum = getPreviousRoundDatum(priorRounds, rn);
    const lastRoundPartnerSet = getLastRoundPartnerSet(lastDatum, stats.resolve);

    const phases = phaseListForLevel(useLevels && !opts.ignoreLevels);

    reshuffleAvoidPartners =
      opts.avoidPartners && opts.avoidPartners.size ? opts.avoidPartners : null;

    let lastErr = '';
    try {
      for (let pi = 0; pi < phases.length; pi++) {
        const phase = phases[pi];
        const relaxPR = phase.partnerLastRound === true;
        const ignLev = phase.ignoreLevels === true;
        phase.multiAttemptsHint = Math.min(
          240,
          Math.max(72, roster.length * 12 + cc * 40)
        );

        const cand = tryPlanActive(
          activeRaw,
          cc,
          stats,
          phase,
          levelMap,
          lastRoundPartnerSet,
          relaxPR,
          ignLev,
          lastDatum
        );
        const ok =
          cand &&
          Array.isArray(cand.matches) &&
          cand.matches.length === cc &&
          validateMatches(cand.matches, cc, stats.resolve);

        if (ok) {
          if (pi > 0) {
            console.warn('[PadelioAmericanoPlanner] fairness constraints relaxed', {
              phaseIndex: pi,
              phase
            });
          }
          return { matches: cand.matches, phaseIndex: pi };
        }

        lastErr = 'no_feasible_round';
      }

      return { matches: [], error: lastErr };
    } finally {
      reshuffleAvoidPartners = null;
    }
  }

  const _exports = {
    planAmericanoRound,
    buildSessionStats,
    pickActivePlayersNormal,
    getPriorRoundsCompleted,
    getPreviousRoundDatum,
    DEFAULT_PLAYER_LEVEL,
    POWER_LEVEL_PARTNER_ALPHA,
    POWER_LEVEL_MATCH_BETA
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = _exports;
  } else {
    const g = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this;
    g.PadelioAmericanoPlanner = _exports;
    g.planAmericanoRound = planAmericanoRound;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
