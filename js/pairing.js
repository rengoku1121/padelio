/* =========================
   Padelio / pairing.js
   Pure functions: player selection, fairness, and round-building algorithms.
   No DOM, no app state — safe for unit testing in Node.js.

   Depends on scoring.js (must be loaded first in browser).

   Browser:  loaded after scoring.js, before script.js → extends window.Padelio
   Node.js:  require('./pairing.js') → returns the exported object
   ========================= */
(() => {
  'use strict';

  /* ---------- scoring dependency ---------- */
  const _scoring = (typeof module !== 'undefined' && module.exports !== undefined)
    ? require('./scoring.js')
    : (window.Padelio || {});

  const computeLeaderboardSorted = _scoring.computeLeaderboardSorted;
  const isMexicanoFamilyMode = _scoring.isMexicanoFamilyMode;

  /* ---------- private utils (local copies, no external deps) ---------- */
  const safeJsonParse = (val, fallback) => {
    if (val == null) return fallback;
    if (typeof val !== 'string') return val;
    try {
      const out = JSON.parse(val);
      return out == null ? fallback : out;
    } catch {
      return fallback;
    }
  };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  const normalizeNameKey = (s) => String(s ?? '').trim().toLowerCase();

  const COMMON_NAME_TYPOS = new Map([['pingku', 'Pingky']]);

  const fixCommonNameTypos = (name) => {
    const t = String(name ?? '').trim();
    const canon = COMMON_NAME_TYPOS.get(normalizeNameKey(t));
    return canon != null ? canon : t;
  };

  const MIN_PLAYER_LEVEL = 1;
  const MAX_PLAYER_LEVEL = 5;
  const DEFAULT_PLAYER_LEVEL = 3;

  const clampPlayerLevel = (v) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return DEFAULT_PLAYER_LEVEL;
    return Math.max(MIN_PLAYER_LEVEL, Math.min(MAX_PLAYER_LEVEL, n));
  };

  const normalizePlayers = (arr) =>
    (Array.isArray(arr) ? arr : []).map((p) => {
      if (typeof p === 'string') {
        return { name: fixCommonNameTypos(p), gender: null, level: DEFAULT_PLAYER_LEVEL };
      }
      return {
        name: fixCommonNameTypos(String(p?.name || '')),
        gender: p?.gender || null,
        level: clampPlayerLevel(p?.level)
      };
    }).filter(p => p.name.trim().length > 0);

  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const pairKey = (a, b) => {
    const x = String(a || '');
    const y = String(b || '');
    return x < y ? `${x}__${y}` : `${y}__${x}`;
  };

  /** Order-independent 4-player set key (a "match group of four"). */
  const groupKeyOf4 = (a, b, c, d) =>
    [a, b, c, d].map(String).sort().join('|');

  const makeRosterNameResolve = (allNames) => {
    const map = new Map();
    (allNames || []).forEach((n) => {
      const display = fixCommonNameTypos(n);
      const k = normalizeNameKey(display);
      if (!map.has(k)) map.set(k, display);
    });
    return (raw) => {
      const fixed = fixCommonNameTypos(raw);
      return map.get(normalizeNameKey(fixed)) ?? fixed;
    };
  };

  /* ---------- round helpers ---------- */
  const getPriorRoundsCompleted = (allRounds, roundNo) =>
    (Array.isArray(allRounds) ? allRounds : [])
      .filter((r) => Number(r.round) < Number(roundNo))
      .sort((a, b) => Number(a.round) - Number(b.round));

  const getPreviousRoundDatum = (allRounds, roundNo) => {
    const want = Number(roundNo) - 1;
    if (want < 1) return null;
    const exact = allRounds.find((r) => Number(r.round) === want);
    if (exact) return exact;
    const prior = getPriorRoundsCompleted(allRounds, roundNo);
    return prior.length ? prior[prior.length - 1] : null;
  };

  /** 1 = team1 won, 2 = team2, 0 = tie or unscored. */
  const getMatchWinSide = (match) => {
    const s1 = match?.score1;
    const s2 = match?.score2;
    const empty1 = s1 === '' || s1 == null;
    const empty2 = s2 === '' || s2 == null;
    if (empty1 && empty2) return 0;
    const n1 = Number(s1) || 0;
    const n2 = Number(s2) || 0;
    if (n1 === 0 && n2 === 0) return 0;
    if (n1 > n2) return 1;
    if (n2 > n1) return 2;
    return 0;
  };

  const countRoundPlayerSlots = (roundsArr) =>
    (Array.isArray(roundsArr) ? roundsArr : []).reduce(
      (sum, r) =>
        sum +
        (r.matches || []).reduce(
          (s, m) => s + (m.team1?.length || 0) + (m.team2?.length || 0),
          0
        ),
      0
    );

  /* ---------- Mexicano court ladder ---------- */
  const getMexicanoTargetCourtsFromPrevRound = (prevRound, maxCourts, resolve) => {
    const target = new Map();
    if (!prevRound || maxCourts < 1) return target;

    (prevRound.matches || []).forEach((m) => {
      const court = Math.min(maxCourts, Math.max(1, Number(m.court) || 1));
      const winSide = getMatchWinSide(m);
      const setTeam = (team, side) => {
        (team || []).forEach((raw) => {
          const name = resolve(raw);
          let next = court;
          if (winSide === side) next = Math.max(1, court - 1);
          else if (winSide && winSide !== side) next = Math.min(maxCourts, court + 1);
          target.set(name, next);
        });
      };
      setTeam(m.team1, 1);
      setTeam(m.team2, 2);
    });
    return target;
  };

  const getMexicanoTeamTargetCourtsFromPrevRound = (prevRound, maxCourts, resolve) => {
    const target = new Map();
    if (!prevRound || maxCourts < 1) return target;

    (prevRound.matches || []).forEach((m) => {
      const court = Math.min(maxCourts, Math.max(1, Number(m.court) || 1));
      const winSide = getMatchWinSide(m);
      const t1 = m.team1 || [];
      const t2 = m.team2 || [];
      if (t1.length < 2 || t2.length < 2) return;
      const k1 = pairKey(resolve(t1[0]), resolve(t1[1]));
      const k2 = pairKey(resolve(t2[0]), resolve(t2[1]));
      const nextFor = (won) => {
        if (!winSide) return court;
        if (won) return Math.max(1, court - 1);
        return Math.min(maxCourts, court + 1);
      };
      target.set(k1, nextFor(winSide === 1));
      target.set(k2, nextFor(winSide === 2));
    });
    return target;
  };

  /** Fill courts 1..N with quads; prefer players whose ladder target matches that court. */
  const orderActiveForMexicanoCourts = (active, targetCourtByName, standingsOrder, maxCourts) => {
    const remaining = [...active];
    const standRank = new Map();
    standingsOrder.forEach((name, i) => standRank.set(name, i));
    remaining.forEach((name, i) => {
      if (!standRank.has(name)) standRank.set(name, standingsOrder.length + i);
    });

    const rankOf = (a, b) => (standRank.get(a) ?? 9999) - (standRank.get(b) ?? 9999);

    const pull = (predicate, count) => {
      remaining.sort(rankOf);
      const picked = [];
      const keep = [];
      for (const name of remaining) {
        if (picked.length < count && predicate(name)) picked.push(name);
        else keep.push(name);
      }
      remaining.length = 0;
      remaining.push(...keep);
      return picked;
    };

    const ordered = [];
    for (let c = 1; c <= maxCourts; c++) {
      let quad = pull((n) => targetCourtByName.get(n) === c, 4);
      if (quad.length < 4) quad = quad.concat(pull(() => true, 4 - quad.length));
      ordered.push(...quad);
    }
    if (remaining.length) ordered.push(...remaining);
    return ordered;
  };

  const orderPairsForMexicanoCourts = (activePairs, targetByPairKey, rankByKey, maxCourts, keyFn) => {
    const remaining = [...activePairs];
    const rankOf = (a, b) => (rankByKey.get(keyFn(a)) ?? 9999) - (rankByKey.get(keyFn(b)) ?? 9999);

    const pull = (predicate, count) => {
      remaining.sort(rankOf);
      const picked = [];
      const keep = [];
      for (const p of remaining) {
        if (picked.length < count && predicate(p)) picked.push(p);
        else keep.push(p);
      }
      remaining.length = 0;
      remaining.push(...keep);
      return picked;
    };

    const ordered = [];
    for (let c = 1; c <= maxCourts; c++) {
      let block = pull((p) => targetByPairKey.get(keyFn(p)) === c, 2);
      if (block.length < 2) block = block.concat(pull(() => true, 2 - block.length));
      ordered.push(...block);
    }
    if (remaining.length) ordered.push(...remaining);
    return ordered;
  };

  /** Swiss-system court ordering for individual players (top of standings -> court 1). */
  const orderActiveByStandings = (active, standingsOrder, rosterOrder) => {
    const standRank = new Map();
    standingsOrder.forEach((name, i) => standRank.set(name, i));
    const rosterRank = new Map();
    (rosterOrder || []).forEach((name, i) => rosterRank.set(name, i));
    return [...active].sort((a, b) => {
      const ra = standRank.get(a);
      const rb = standRank.get(b);
      if (ra != null && rb != null && ra !== rb) return ra - rb;
      if (ra != null && rb == null) return -1;
      if (ra == null && rb != null) return 1;
      const sa = rosterRank.get(a) ?? 9999;
      const sb = rosterRank.get(b) ?? 9999;
      return sa - sb;
    });
  };

  /** Swiss-system court ordering for fixed pairs (top team -> court 1 1st seat, etc.). */
  const orderPairsByTeamPoints = (activePairs, rankByKey, keyFn) => {
    return [...activePairs].sort((a, b) => {
      const ra = rankByKey.get(keyFn(a)) ?? 9999;
      const rb = rankByKey.get(keyFn(b)) ?? 9999;
      return ra - rb;
    });
  };

  const buildFixedPairsMexicanoCourtMatches = (orderedPairs) => {
    const matches = [];
    const numCourts = Math.floor(orderedPairs.length / 2);
    for (let c = 0; c < numCourts; c++) {
      const p1 = orderedPairs[c * 2];
      const p2 = orderedPairs[c * 2 + 1];
      if (!p1 || !p2) break;
      matches.push({
        court: c + 1,
        team1: [p1.m, p1.f],
        team2: [p2.m, p2.f],
        score1: '',
        score2: ''
      });
    }
    return matches;
  };

  /* ---------- pair/matchup keys ---------- */
  const matchupKey = (p1, p2) => {
    const t1 = pairKey(p1.m, p1.f);
    const t2 = pairKey(p2.m, p2.f);
    return t1 < t2 ? `${t1}||${t2}` : `${t2}||${t1}`;
  };

  /* ---------- match history ---------- */
  /**
   * Build partner/opponent/matchup history from completed rounds.
   * @param {Array} rounds  - array of round objects (already parsed, not JSON string)
   */
  const buildMixHistory = (rounds) => {
    const partnerCount = new Map();
    const opposeCount = new Map();
    const matchupCount = new Map();

    (Array.isArray(rounds) ? rounds : []).forEach((r) => {
      (r.matches || []).forEach((m) => {
        const t1 = m.team1 || [];
        const t2 = m.team2 || [];

        if (t1.length === 2) {
          const k = pairKey(t1[0], t1[1]);
          partnerCount.set(k, (partnerCount.get(k) || 0) + 1);
        }
        if (t2.length === 2) {
          const k = pairKey(t2[0], t2[1]);
          partnerCount.set(k, (partnerCount.get(k) || 0) + 1);
        }

        t1.forEach((a) => {
          t2.forEach((b) => {
            const k = pairKey(a, b);
            opposeCount.set(k, (opposeCount.get(k) || 0) + 1);
          });
        });

        if (t1.length === 2 && t2.length === 2) {
          const k = matchupKey({ m: t1[0], f: t1[1] }, { m: t2[0], f: t2[1] });
          matchupCount.set(k, (matchupCount.get(k) || 0) + 1);
        }
      });
    });

    return { partnerCount, opposeCount, matchupCount };
  };

  /**
   * Build a richer Mix Americano history that the round-level optimizer needs:
   *
   *   partnerCount   Map<pairKey,         count>   (only counts M-F partner pairs)
   *   opposeCount    Map<pairKey,         count>   (any cross-team opponent pair)
   *   meetingCount   Map<pairKey,         count>   (partner + opponent)
   *   groupCount     Map<groupKeyOf4,     count>   (same 4-player match group repeats)
   *   gamesPlayed    Map<name,            count>
   *   byeCount       Map<name,            count>
   *   partners       Map<name,            Set<partnerName>>
   *   opponents      Map<name,            Set<opponentName>>
   *   meetings       Map<name,            Set<otherName>>      (partner ∪ opponent)
   *   playedLastRound Set<name>
   *
   * @param {Array}    allRounds   - prior rounds (already parsed)
   * @param {string[]} maleRoster  - full male roster (for keying sets)
   * @param {string[]} femaleRoster - full female roster
   * @param {number}  [upToRoundNo] - if provided, only rounds with round < upToRoundNo are counted
   */
  const buildMixFairnessHistory = (allRounds, maleRoster, femaleRoster, upToRoundNo) => {
    const males = Array.isArray(maleRoster) ? maleRoster : [];
    const females = Array.isArray(femaleRoster) ? femaleRoster : [];
    const allNames = [...males, ...females];
    const isM = new Set(males);
    const isF = new Set(females);

    const partnerCount = new Map();
    const opposeCount = new Map();
    const meetingCount = new Map();
    const groupCount = new Map();
    const gamesPlayed = new Map();
    const byeCount = new Map();
    const partners = new Map();
    const opponents = new Map();
    const meetings = new Map();
    const courtUsage = new Map(); // name -> Map<courtNo,count>
    const playedLastRound = new Set();

    allNames.forEach((n) => {
      gamesPlayed.set(n, 0);
      byeCount.set(n, 0);
      partners.set(n, new Set());
      opponents.set(n, new Set());
      meetings.set(n, new Set());
      courtUsage.set(n, new Map());
    });

    const priorRounds = (Array.isArray(allRounds) ? allRounds : [])
      .filter((r) =>
        upToRoundNo == null ? true : Number(r.round) < Number(upToRoundNo)
      )
      .sort((a, b) => Number(a.round) - Number(b.round));

    let lastRoundPlayers = null;

    priorRounds.forEach((r, idx) => {
      const onCourt = new Set();
      (r.matches || []).forEach((m) => {
        const t1 = m.team1 || [];
        const t2 = m.team2 || [];
        if (t1.length !== 2 || t2.length !== 2) return;

        [...t1, ...t2].forEach((p) => {
          if (gamesPlayed.has(p)) {
            gamesPlayed.set(p, gamesPlayed.get(p) + 1);
            onCourt.add(p);
            const cu = courtUsage.get(p);
            const cNum = Number(m.court) || 0;
            if (cNum > 0) cu.set(cNum, (cu.get(cNum) || 0) + 1);
          }
        });

        [t1, t2].forEach((team) => {
          const [a, b] = team;
          const k = pairKey(a, b);
          partnerCount.set(k, (partnerCount.get(k) || 0) + 1);
          if (partners.has(a)) partners.get(a).add(b);
          if (partners.has(b)) partners.get(b).add(a);
        });

        t1.forEach((a) =>
          t2.forEach((b) => {
            const k = pairKey(a, b);
            opposeCount.set(k, (opposeCount.get(k) || 0) + 1);
            if (opponents.has(a)) opponents.get(a).add(b);
            if (opponents.has(b)) opponents.get(b).add(a);
          })
        );

        const all4 = [...t1, ...t2];
        for (let i = 0; i < 4; i++) {
          for (let j = i + 1; j < 4; j++) {
            const a = all4[i];
            const b = all4[j];
            const k = pairKey(a, b);
            meetingCount.set(k, (meetingCount.get(k) || 0) + 1);
            if (meetings.has(a)) meetings.get(a).add(b);
            if (meetings.has(b)) meetings.get(b).add(a);
          }
        }

        const gk = groupKeyOf4(t1[0], t1[1], t2[0], t2[1]);
        groupCount.set(gk, (groupCount.get(gk) || 0) + 1);
      });

      allNames.forEach((n) => {
        if (!onCourt.has(n)) byeCount.set(n, (byeCount.get(n) || 0) + 1);
      });

      if (idx === priorRounds.length - 1) lastRoundPlayers = onCourt;
    });

    if (lastRoundPlayers) {
      lastRoundPlayers.forEach((n) => playedLastRound.add(n));
    }

    return {
      partnerCount,
      opposeCount,
      meetingCount,
      groupCount,
      gamesPlayed,
      byeCount,
      partners,
      opponents,
      meetings,
      courtUsage,
      playedLastRound,
      allNames,
      males: [...males],
      females: [...females],
      isMale: (n) => isM.has(n),
      isFemale: (n) => isF.has(n),
      priorRoundCount: priorRounds.length
    };
  };

  /* ---------- pair scoring helpers ---------- */
  /** Cross-team opposition score for two pairs {m,f}. */
  const pairCrossOpposeScore = (pA, pB, opposeCount) => {
    const a1 = pA.m, a2 = pA.f, b1 = pB.m, b2 = pB.f;
    return (
      (opposeCount.get(pairKey(a1, b1)) || 0) +
      (opposeCount.get(pairKey(a1, b2)) || 0) +
      (opposeCount.get(pairKey(a2, b1)) || 0) +
      (opposeCount.get(pairKey(a2, b2)) || 0)
    );
  };

  /** Iterate the 4 cross-team opponent pairs for Mexicano pair objects {m,f}. */
  const forEachMexOpponentPair = (pairA, pairB, cb) => {
    const a1 = pairA.m, a2 = pairA.f, b1 = pairB.m, b2 = pairB.f;
    cb(a1, b1); cb(a1, b2); cb(a2, b1); cb(a2, b2);
  };

  const fixedPairMatchupScore = (pA, pB, matchupCount) =>
    matchupCount.get(matchupKey(pA, pB)) || 0;

  const getLastRoundFixedMatchupSet = (lastRound) => {
    const out = new Set();
    if (!lastRound) return out;
    (lastRound.matches || []).forEach((m) => {
      const t1 = m.team1 || [];
      const t2 = m.team2 || [];
      if (t1.length === 2 && t2.length === 2) {
        out.add(matchupKey({ m: t1[0], f: t1[1] }, { m: t2[0], f: t2[1] }));
      }
    });
    return out;
  };

  const scoreFixedPairCourtMatch = (p1, p2, matchupCount, opposeCount, lastRoundMatchups) => {
    let s = fixedPairMatchupScore(p1, p2, matchupCount) * 1000000;
    s += pairCrossOpposeScore(p1, p2, opposeCount) * 25;
    if (lastRoundMatchups?.has(matchupKey(p1, p2))) s += 500000;
    return s;
  };

  const fixedPairMatchingsToCourts = (pairings) =>
    pairings.map(([p1, p2], i) => ({
      court: i + 1,
      team1: [p1.m, p1.f],
      team2: [p2.m, p2.f],
      score1: '',
      score2: ''
    }));

  const enumerateFixedPairMatchings = (pairs, out) => {
    if (pairs.length === 0) { out.push([]); return; }
    if (pairs.length < 2) return;
    const [p0, ...rest] = pairs;
    for (let i = 0; i < rest.length; i++) {
      const p1 = rest[i];
      const remaining = rest.filter((_, idx) => idx !== i);
      const sub = [];
      enumerateFixedPairMatchings(remaining, sub);
      for (const sm of sub) out.push([[p0, p1], ...sm]);
    }
  };

  const buildBestFixedPairMatchesExhaustive = (selectedPairs, matchupCount, opposeCount, lastRoundMatchups) => {
    const k = selectedPairs.length;
    const numCourts = k / 2;
    const all = [];
    enumerateFixedPairMatchings([...selectedPairs], all);
    if (!all.length) return null;

    let bestScore = Infinity;
    const bestPlans = [];

    for (const plan of all) {
      if (plan.length !== numCourts) continue;
      let total = 0;
      for (const [p1, p2] of plan) {
        total += scoreFixedPairCourtMatch(p1, p2, matchupCount, opposeCount, lastRoundMatchups);
      }
      if (total < bestScore) {
        bestScore = total;
        bestPlans.length = 0;
        bestPlans.push(plan);
      } else if (total === bestScore) {
        bestPlans.push(plan);
      }
    }

    if (!bestPlans.length) return null;
    const pick = bestPlans[Math.floor(Math.random() * bestPlans.length)];
    return fixedPairMatchingsToCourts(pick);
  };

  /* ---------- level helpers ---------- */
  const makeLevelByNameMap = (playersFull) => {
    const m = new Map();
    (playersFull || []).forEach((p) => {
      m.set(p.name, clampPlayerLevel(p.level));
    });
    return m;
  };

  const getLevelForPairing = (levelByName, resolve, name) => {
    if (!levelByName || !levelByName.size) return DEFAULT_PLAYER_LEVEL;
    const k = resolve(name);
    return levelByName.has(k) ? levelByName.get(k) : DEFAULT_PLAYER_LEVEL;
  };

  const activeLevelSpread = (activeNames, getL) => {
    if (!activeNames.length) return 0;
    let lo = MAX_PLAYER_LEVEL;
    let hi = MIN_PLAYER_LEVEL;
    for (const n of activeNames) {
      const L = getL(n);
      if (L < lo) lo = L;
      if (L > hi) hi = L;
    }
    return hi - lo;
  };

  const POWER_LEVEL_PARTNER_ALPHA = 8;
  const POWER_LEVEL_MATCH_BETA = 4;

  /* ---------- bench streak helpers ---------- */
  const consecutiveBenchStreak = (name, priorRounds, resolve) => {
    const res = resolve || ((n) => n);
    const canon = res(name);
    let streak = 0;
    for (let i = priorRounds.length - 1; i >= 0; i--) {
      const on = new Set();
      (priorRounds[i].matches || []).forEach((m) => {
        for (const x of [...(m.team1 || []), ...(m.team2 || [])]) on.add(res(x));
      });
      if (on.has(canon)) break;
      streak++;
    }
    return streak;
  };

  const consecutiveBenchStreakForPair = (pair, priorRounds, resolve) => {
    const kWant = pairKey(resolve(pair.m), resolve(pair.f));
    let streak = 0;
    for (let i = priorRounds.length - 1; i >= 0; i--) {
      let on = false;
      (priorRounds[i].matches || []).forEach((m) => {
        for (const t of [m.team1, m.team2]) {
          if (t && t.length === 2) {
            const k = pairKey(resolve(t[0]), resolve(t[1]));
            if (k === kWant) on = true;
          }
        }
      });
      if (on) break;
      streak++;
    }
    return streak;
  };

  const getLastRoundPartnerSet = (prevRoundDatum, resolve) => {
    const res = resolve || ((x) => String(x ?? '').trim());
    const out = new Set();
    if (!prevRoundDatum) return out;
    (prevRoundDatum.matches || []).forEach((m) => {
      const t1 = m.team1 || [];
      const t2 = m.team2 || [];
      if (t1.length === 2) out.add(pairKey(res(t1[0]), res(t1[1])));
      if (t2.length === 2) out.add(pairKey(res(t2[0]), res(t2[1])));
    });
    return out;
  };

  const getFixedPairsOnCourtLastRound = (lastRound, resolve) => {
    const onCourt = new Set();
    if (!lastRound) return onCourt;
    (lastRound.matches || []).forEach((m) => {
      for (const team of [m.team1, m.team2]) {
        if (team && team.length === 2) {
          onCourt.add(pairKey(resolve(team[0]), resolve(team[1])));
        }
      }
    });
    return onCourt;
  };

  /* ---------- fairness tier ---------- */
  const fairnessTierCmp = (a, b) => {
    if (a.played !== b.played) return a.played - b.played;
    if (a.benchedLastRound !== b.benchedLastRound) return a.benchedLastRound ? -1 : 1;
    if (a.streak !== b.streak) return b.streak - a.streak;
    return 0;
  };

  const shuffleFairnessRuns = (rows) => {
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
  };

  /* ---------- player selection ---------- */
  const pickActivePlayersNormal = (allNames, slots, allRounds, roundNo) => {
    const resolve = makeRosterNameResolve(allNames);
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

    if (!lastRound) return allNames.slice(0, slots);

    const ordered = shuffleFairnessRuns(keyed);
    return ordered.slice(0, slots).map((x) => x.name);
  };

  const pickActiveFixedPairs = (allPairs, pairSlots, allRounds, roundNo) => {
    const flatNames = allPairs.flatMap((p) => [p.m, p.f]);
    const resolve = makeRosterNameResolve(flatNames);
    const tKey = (p) => pairKey(resolve(p.m), resolve(p.f));

    const priorRounds = getPriorRoundsCompleted(allRounds, roundNo);
    const lastRound = getPreviousRoundDatum(allRounds, roundNo);
    const playCount = new Map();
    allPairs.forEach((p) => playCount.set(tKey(p), 0));

    priorRounds.forEach((r) => {
      (r.matches || []).forEach((m) => {
        for (const team of [m.team1, m.team2]) {
          if (team && team.length === 2) {
            const k = pairKey(resolve(team[0]), resolve(team[1]));
            if (playCount.has(k)) playCount.set(k, (playCount.get(k) || 0) + 1);
          }
        }
      });
    });

    const playedLastRound = new Set();
    if (lastRound) {
      (lastRound.matches || []).forEach((m) => {
        for (const team of [m.team1, m.team2]) {
          if (team && team.length === 2) {
            playedLastRound.add(pairKey(resolve(team[0]), resolve(team[1])));
          }
        }
      });
    }

    const n = allPairs.length;
    const keyToIdx = new Map(allPairs.map((p, i) => [tKey(p), i]));
    const rot = ((Number(roundNo) || 1) - 1 + n * 100) % n;

    if (!lastRound) return allPairs.slice(0, pairSlots);

    const keyed = allPairs.map((p) => {
      const tk = tKey(p);
      return {
        pair: p,
        key: tk,
        played: playCount.get(tk) || 0,
        streak: consecutiveBenchStreakForPair(p, priorRounds, resolve),
        tieRot: (keyToIdx.get(tk) - rot + n) % n,
        benchedLastRound: lastRound ? !playedLastRound.has(tk) : false
      };
    });

    const byPriority = (a, b) => {
      if (a.benchedLastRound !== b.benchedLastRound) return a.benchedLastRound ? -1 : 1;
      if (a.played !== b.played) return a.played - b.played;
      if (a.streak !== b.streak) return b.streak - a.streak;
      return a.tieRot - b.tieRot;
    };

    const neverPlayed = keyed.filter((x) => x.played === 0).sort(byPriority);
    const selected = neverPlayed.slice(0, pairSlots);
    const selectedKeys = new Set(selected.map((x) => x.key));

    if (selected.length < pairSlots) {
      const needed = pairSlots - selected.length;
      const restPool = keyed.filter((x) => !selectedKeys.has(x.key)).sort(byPriority);
      selected.push(...restPool.slice(0, needed));
    }

    return selected.slice(0, pairSlots).map((x) => x.pair);
  };

  const pickActiveFixedPairsMexicano = (allPairs, pairSlots, allRounds, roundNo) => {
    const flatNames = allPairs.flatMap((p) => [p.m, p.f]);
    const resolve = makeRosterNameResolve(flatNames);
    const tKey = (p) => pairKey(resolve(p.m), resolve(p.f));
    const priorRounds = getPriorRoundsCompleted(allRounds, roundNo);
    const lastRound = getPreviousRoundDatum(allRounds, roundNo);

    const playCount = new Map();
    allPairs.forEach((p) => playCount.set(tKey(p), 0));
    priorRounds.forEach((r) => {
      (r.matches || []).forEach((m) => {
        for (const team of [m.team1, m.team2]) {
          if (team && team.length === 2) {
            const k2 = pairKey(resolve(team[0]), resolve(team[1]));
            if (playCount.has(k2)) playCount.set(k2, (playCount.get(k2) || 0) + 1);
          }
        }
      });
    });

    if (!lastRound || pairSlots <= 0) {
      return allPairs.slice(0, Math.min(pairSlots, allPairs.length));
    }

    const pairsOnCourtLast = getFixedPairsOnCourtLastRound(lastRound, resolve);
    const mustPlay = allPairs.filter((p) => !pairsOnCourtLast.has(tKey(p)));
    if (mustPlay.length > pairSlots) {
      return pickActiveFixedPairs(allPairs, pairSlots, allRounds, roundNo);
    }

    const taken = new Set();
    const selected = [];
    mustPlay.forEach((p) => {
      const k2 = tKey(p);
      if (!taken.has(k2)) { taken.add(k2); selected.push(p); }
    });

    const n = allPairs.length;
    const keyToIdx = new Map(allPairs.map((p, i) => [tKey(p), i]));
    const rot = ((Number(roundNo) || 1) - 1 + n * 100) % n;

    const pool = allPairs.filter((p) => !taken.has(tKey(p)));
    const keyed = pool.map((p) => {
      const tk = tKey(p);
      return {
        pair: p, key: tk,
        played: playCount.get(tk) || 0,
        streak: consecutiveBenchStreakForPair(p, priorRounds, resolve),
        tieRot: (keyToIdx.get(tk) - rot + n) % n
      };
    });
    keyed.sort((a, b) => {
      if (a.played !== b.played) return a.played - b.played;
      if (a.streak !== b.streak) return b.streak - a.streak;
      return a.tieRot - b.tieRot;
    });
    const need = pairSlots - selected.length;
    keyed.slice(0, need).forEach((x) => {
      if (!taken.has(x.key)) { taken.add(x.key); selected.push(x.pair); }
    });

    return selected.slice(0, pairSlots);
  };

  const pickActivePlayersMexicano = (allNames, slots, allRounds, roundNo) => {
    const resolve = makeRosterNameResolve(allNames);
    const priorRounds = getPriorRoundsCompleted(allRounds, roundNo);
    const lastRound = getPreviousRoundDatum(allRounds, roundNo);

    const playCount = new Map();
    allNames.forEach((n) => playCount.set(n, 0));
    priorRounds.forEach((r) => {
      (r.matches || []).forEach((m) => {
        for (const name of [...(m.team1 || []), ...(m.team2 || [])]) {
          const c = resolve(name);
          if (playCount.has(c)) playCount.set(c, (playCount.get(c) || 0) + 1);
        }
      });
    });

    if (!lastRound || slots <= 0) {
      return allNames.slice(0, Math.min(slots, allNames.length));
    }

    const onCourtLast = new Set();
    (lastRound.matches || []).forEach((m) => {
      for (const raw of [...(m.team1 || []), ...(m.team2 || [])]) {
        onCourtLast.add(resolve(raw));
      }
    });

    const mustPlay = allNames.filter((n) => !onCourtLast.has(resolve(n)));
    if (mustPlay.length > slots) {
      return pickActivePlayersNormal(allNames, slots, allRounds, roundNo);
    }

    const taken = new Set();
    const selected = [];
    mustPlay.forEach((n) => {
      if (!taken.has(n)) { taken.add(n); selected.push(n); }
    });

    const n = allNames.length;
    const pos = new Map(allNames.map((name, i) => [name, i]));
    const rot = ((Number(roundNo) || 1) - 1 + n * 100) % n;

    const pool = allNames.filter((name) => !taken.has(name));
    const keyed = pool.map((name) => ({
      name,
      played: playCount.get(name) || 0,
      streak: consecutiveBenchStreak(name, priorRounds, resolve),
      tieRot: (pos.get(name) - rot + n) % n
    }));

    keyed.sort((a, b) => {
      if ((a.played === 0) !== (b.played === 0)) return a.played === 0 ? -1 : 1;
      if (a.played !== b.played) return a.played - b.played;
      if (a.streak !== b.streak) return b.streak - a.streak;
      return a.tieRot - b.tieRot;
    });

    const need = slots - selected.length;
    keyed.slice(0, need).forEach((x) => {
      if (!taken.has(x.name)) { taken.add(x.name); selected.push(x.name); }
    });

    return selected.slice(0, slots);
  };

  /* ---------- Normal Mexicano: dynamic capacity & fairness-first active/bye ---------- */

  const mexLexLess = (a, b) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] < b[i]) return true;
      if (a[i] > b[i]) return false;
    }
    return false;
  };

  const mexLexEqual = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  };

  const countAvoidPartnerHits = (team1, team2, resolve, avoidPartners) => {
    if (!avoidPartners || avoidPartners.size === 0) return 0;
    let hits = 0;
    const t1 = Array.isArray(team1) ? team1 : [];
    const t2 = Array.isArray(team2) ? team2 : [];
    if (t1.length === 2) {
      const k = pairKey(resolve(t1[0]), resolve(t1[1]));
      if (avoidPartners.has(k)) hits++;
    }
    if (t2.length === 2) {
      const k = pairKey(resolve(t2[0]), resolve(t2[1]));
      if (avoidPartners.has(k)) hits++;
    }
    return hits;
  };

  const activeSetKey = (names, resolve) =>
    (Array.isArray(names) ? names : [])
      .map((n) => resolve(n))
      .filter(Boolean)
      .sort()
      .join('|');

  const computeMexicanoRoundCapacity = (totalPlayers, courts) => {
    const n = Math.max(0, Math.floor(Number(totalPlayers) || 0));
    const c = Math.max(0, Math.floor(Number(courts) || 0));
    const maxPlayersPerRound = c * 4;
    const rawPlaying = Math.min(n, maxPlayersPerRound);
    const playingPlayersPerRound = Math.floor(rawPlaying / 4) * 4;
    const usedCourtsPerRound = playingPlayersPerRound / 4;
    const byePlayersPerRound = n - playingPlayersPerRound;
    return {
      playingPlayersPerRound,
      byePlayersPerRound,
      usedCourtsPerRound,
      maxPlayersPerRound
    };
  };

  const computeMexicanoSessionTargets = (totalPlayers, courts, roundCount) => {
    const cap = computeMexicanoRoundCapacity(totalPlayers, courts);
    const rounds = Math.max(0, Math.floor(Number(roundCount) || 0));
    const n = Math.max(0, Math.floor(Number(totalPlayers) || 0));
    const totalPlayingSlots = rounds * cap.playingPlayersPerRound;
    const totalByeSlots = rounds * cap.byePlayersPerRound;
    const idealGamesPerPlayer = n > 0 ? totalPlayingSlots / n : 0;
    const idealByesPerPlayer = n > 0 ? totalByeSlots / n : 0;
    return {
      ...cap,
      roundCount: rounds,
      totalPlayingSlots,
      totalByeSlots,
      idealGamesPerPlayer,
      idealByesPerPlayer,
      minExpectedGames: Math.floor(idealGamesPerPlayer),
      maxExpectedGames: Math.ceil(idealGamesPerPlayer),
      minExpectedByes: Math.floor(idealByesPerPlayer),
      maxExpectedByes: Math.ceil(idealByesPerPlayer)
    };
  };

  const tallyMexicanoPlayerStats = (allNames, allRounds, roundNo) => {
    const resolve = makeRosterNameResolve(allNames);
    const priorRounds = getPriorRoundsCompleted(allRounds, roundNo);
    const lastRound = getPreviousRoundDatum(allRounds, roundNo);
    const gamesPlayed = new Map();
    const byeCount = new Map();
    allNames.forEach((n) => {
      gamesPlayed.set(n, 0);
      byeCount.set(n, 0);
    });
    priorRounds.forEach((r) => {
      const onCourt = new Set();
      (r.matches || []).forEach((m) => {
        [...(m.team1 || []), ...(m.team2 || [])].forEach((raw) => {
          const c = resolve(raw);
          if (gamesPlayed.has(c)) {
            gamesPlayed.set(c, (gamesPlayed.get(c) || 0) + 1);
            onCourt.add(c);
          }
        });
      });
      allNames.forEach((n) => {
        if (!onCourt.has(n)) byeCount.set(n, (byeCount.get(n) || 0) + 1);
      });
    });
    const playedLastRound = new Set();
    if (lastRound) {
      (lastRound.matches || []).forEach((m) => {
        [...(m.team1 || []), ...(m.team2 || [])].forEach((raw) => {
          playedLastRound.add(resolve(raw));
        });
      });
    }
    const mustPlay = lastRound
      ? allNames.filter((n) => !playedLastRound.has(resolve(n)))
      : [];
    return { gamesPlayed, byeCount, mustPlay, playedLastRound, priorRounds, lastRound, resolve };
  };

  const projectMexicanoFairnessAfterRound = (allNames, gamesPlayed, byeCount, activeSet) => {
    const active = new Set(activeSet);
    const gamesAfter = allNames.map((n) =>
      (gamesPlayed.get(n) || 0) + (active.has(n) ? 1 : 0)
    );
    const byesAfter = allNames.map((n) =>
      (byeCount.get(n) || 0) + (active.has(n) ? 0 : 1)
    );
    const gamesDiff = Math.max(...gamesAfter) - Math.min(...gamesAfter);
    const byeDiff = Math.max(...byesAfter) - Math.min(...byesAfter);
    return { gamesDiff, byeDiff, gamesAfter, byesAfter };
  };

  /**
   * Enumerate fair active sets for Normal Mexicano. Uses games/bye balance
   * first; must-play-last-round players are always included when capacity allows.
   */
  const enumerateNormalMexicanoFairActiveSets = (
    allNames,
    courts,
    allRounds,
    roundNo,
    maxCandidates = 16,
    slotsOverride = null
  ) => {
    const arr = Array.isArray(allNames) ? allNames : [];
    const want = slotsOverride != null
      ? Math.max(0, Math.floor(Number(slotsOverride) || 0))
      : computeMexicanoRoundCapacity(arr.length, courts).playingPlayersPerRound;
    if (want <= 0) return [[]];
    if (want >= arr.length) return [arr.slice()];

    const { gamesPlayed, byeCount, mustPlay, lastRound, resolve, priorRounds } =
      tallyMexicanoPlayerStats(arr, allRounds, roundNo);
    const pos = new Map(arr.map((name, i) => [name, i]));

    if (!lastRound) {
      const indexed = arr.map((name) => ({
        name,
        games: gamesPlayed.get(name) || 0,
        byes: byeCount.get(name) || 0,
        streak: consecutiveBenchStreak(name, priorRounds, resolve),
        idx: pos.get(name)
      }));
      indexed.sort((a, b) =>
        a.games - b.games ||
        a.byes - b.byes ||
        b.streak - a.streak ||
        a.idx - b.idx
      );
      return enumerateFairActiveSets(arr, want, allRounds, roundNo, maxCandidates);
    }

    let forced = [];
    if (mustPlay.length > want) {
      const sortedMust = [...mustPlay].sort((a, b) =>
        (gamesPlayed.get(a) || 0) - (gamesPlayed.get(b) || 0) ||
        (byeCount.get(b) || 0) - (byeCount.get(a) || 0) ||
        (pos.get(a) ?? 0) - (pos.get(b) ?? 0)
      );
      return [sortedMust.slice(0, want)];
    }
    forced = mustPlay.slice();
    const forcedSet = new Set(forced);
    const remaining = want - forced.length;
    const pool = arr.filter((n) => !forcedSet.has(n));

    const keyed = pool.map((name) => ({
      name,
      games: gamesPlayed.get(name) || 0,
      byes: byeCount.get(name) || 0,
      benchedLast: false,
      idx: pos.get(name)
    }));
    keyed.sort((a, b) =>
      a.games - b.games ||
      a.byes - b.byes ||
      a.idx - b.idx
    );

    if (remaining >= pool.length) {
      return [[...forced, ...pool]];
    }

    const capN = Math.max(1, Math.floor(Number(maxCandidates) || 1));
    const combos = [];
    const combo = [];
    const dfs = (start) => {
      if (combos.length >= capN) return;
      if (combo.length === remaining) {
        combos.push([...forced, ...combo]);
        return;
      }
      for (let k = start; k < keyed.length; k++) {
        if (keyed.length - k < remaining - combo.length) break;
        combo.push(keyed[k].name);
        dfs(k + 1);
        combo.pop();
        if (combos.length >= capN) return;
      }
    };
    dfs(0);
    if (combos.length === 0) combos.push([...forced, ...keyed.slice(0, remaining).map((x) => x.name)]);
    return combos;
  };

  const pickNormalMexicanoActivePlayers = (allNames, courts, allRounds, roundNo) => {
    const candidates = enumerateNormalMexicanoFairActiveSets(
      allNames, courts, allRounds, roundNo, 16
    );
    if (!candidates.length) return [];
    const { gamesPlayed, byeCount } = tallyMexicanoPlayerStats(allNames, allRounds, roundNo);
    const targets = computeMexicanoSessionTargets(
      allNames.length, courts,
      Math.max(roundNo, getPriorRoundsCompleted(allRounds, roundNo).length + 1)
    );
    const idealGamesInt = Number.isInteger(targets.idealGamesPerPlayer);
    const idealByesInt = Number.isInteger(targets.idealByesPerPlayer);

    let best = candidates[0];
    let bestTuple = null;
    for (const active of candidates) {
      const proj = projectMexicanoFairnessAfterRound(allNames, gamesPlayed, byeCount, active);
      let exactPenalty = 0;
      if (idealGamesInt) {
        exactPenalty += proj.gamesAfter.reduce((s, g) =>
          s + Math.abs(g - targets.idealGamesPerPlayer), 0
        );
      }
      if (idealByesInt) {
        exactPenalty += proj.byesAfter.reduce((s, b) =>
          s + Math.abs(b - targets.idealByesPerPlayer), 0
        );
      }
      const tuple = [proj.gamesDiff, proj.byeDiff, exactPenalty, -active.length];
      if (!bestTuple || mexLexLess(tuple, bestTuple)) {
        bestTuple = tuple;
        best = active;
      }
    }
    return best;
  };

  /**
   * Mix Americano active selector: runs the Normal fairness selector
   * SEPARATELY for males and females so the bench/games balance follows the
   * same rules as Normal Americano while preserving the Mix invariant that
   * every match is exactly 2 males + 2 females.
   *
   * @param {string[]} maleNames    - full male roster (display order)
   * @param {string[]} femaleNames  - full female roster (display order)
   * @param {number}   courtCount   - courts available for this round
   * @param {Array}    allRounds    - tournament rounds JSON (already parsed)
   * @param {number}   roundNo      - current round number (1-indexed)
   * @returns {{ activeM: string[], activeF: string[], effectiveCourts: number, active: string[] }}
   *   Empty arrays if the gender pools cannot fill even a single court.
   */
  const pickActivePlayersMixBalancedGender = (
    maleNames,
    femaleNames,
    courtCount,
    allRounds,
    roundNo
  ) => {
    const males = Array.isArray(maleNames) ? maleNames : [];
    const females = Array.isArray(femaleNames) ? femaleNames : [];
    const requestedCourts = Math.max(0, Math.floor(Number(courtCount) || 0));

    const effectiveCourts = Math.min(
      requestedCourts,
      Math.floor(males.length / 2),
      Math.floor(females.length / 2)
    );

    if (effectiveCourts <= 0) {
      return { activeM: [], activeF: [], effectiveCourts: 0, active: [] };
    }

    const need = effectiveCourts * 2;
    const activeM = pickActivePlayersNormal(males, need, allRounds, roundNo);
    const activeF = pickActivePlayersNormal(females, need, allRounds, roundNo);

    return {
      activeM,
      activeF,
      effectiveCourts,
      active: [...activeM, ...activeF]
    };
  };

  /**
   * Enumerate fair active-player candidate sets for one gender pool.
   *
   * "Fair" means the choice preserves the same games-played fairness invariant
   * as `pickActivePlayersNormal`: players in a lower fairness tier (fewer
   * games, longer bench streak, benched last round) are ALWAYS active; only
   * the boundary tier (players tied on tier with the cutoff) has the freedom
   * to be swapped in or out of the active set. Any combination within that
   * boundary tier produces an equally fair round.
   *
   * The first candidate emitted is the deterministic "default" (boundary
   * picked in roster index order), which matches what
   * `pickActivePlayersMixBalancedGender` would deterministically return when
   * no within-tier shuffle is applied. Callers can rely on this ordering for
   * stable behavior when multiple alternatives produce the same partner-gap.
   *
   * @param {string[]} pool          - full single-gender roster
   * @param {number}   need          - active slots required
   * @param {Array}    allRounds     - tournament rounds (already parsed)
   * @param {number}   roundNo       - current round number (1-indexed)
   * @param {number}  [maxCandidates] - hard cap on returned candidates (default 16)
   * @returns {string[][]} array of fair active sets, each of size `need`
   */
  const enumerateFairActiveSets = (pool, need, allRounds, roundNo, maxCandidates = 16) => {
    const arr = Array.isArray(pool) ? pool : [];
    const want = Math.max(0, Math.floor(Number(need) || 0));
    if (want <= 0) return [[]];
    if (want >= arr.length) return [arr.slice()];

    const resolve = makeRosterNameResolve(arr);
    const priorRounds = getPriorRoundsCompleted(allRounds, roundNo);
    const lastRound = getPreviousRoundDatum(allRounds, roundNo);
    const playCount = new Map();
    const playedLastRound = new Set();
    priorRounds.forEach((r) => {
      (r.matches || []).forEach((m) => {
        for (const n of [...(m.team1 || []), ...(m.team2 || [])]) {
          const c = resolve(n);
          playCount.set(c, (playCount.get(c) || 0) + 1);
        }
      });
    });
    if (lastRound) {
      (lastRound.matches || []).forEach((m) => {
        for (const n of [...(m.team1 || []), ...(m.team2 || [])]) {
          playedLastRound.add(resolve(n));
        }
      });
    }

    // Fairness tier (lower = higher priority to play): [played, !benchedLast, -streak].
    const tierOf = (name) => {
      const c = resolve(name);
      const played = playCount.get(c) || 0;
      const benchedLast = lastRound ? !playedLastRound.has(c) : false;
      const streak = consecutiveBenchStreak(name, priorRounds, resolve);
      return [played, benchedLast ? 0 : 1, -streak];
    };
    const tierCmp = (a, b) => {
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
      }
      return 0;
    };

    const indexed = arr.map((name, idx) => ({ name, idx, tier: tierOf(name) }));
    indexed.sort((a, b) => tierCmp(a.tier, b.tier) || a.idx - b.idx);

    // Group consecutive equal tiers and walk in order: fully fitting tiers
    // become forced; the first tier that overflows the remaining slot count
    // is the boundary where we choose `pick` of `members.length`.
    const forced = [];
    let remaining = want;
    let boundary = null;
    let i = 0;
    while (i < indexed.length && remaining > 0) {
      let j = i + 1;
      while (j < indexed.length && tierCmp(indexed[i].tier, indexed[j].tier) === 0) j++;
      const tierMembers = indexed.slice(i, j).map((x) => x.name);
      if (tierMembers.length <= remaining) {
        forced.push(...tierMembers);
        remaining -= tierMembers.length;
      } else {
        boundary = { members: tierMembers, pick: remaining };
        remaining = 0;
      }
      i = j;
    }

    if (!boundary) return [forced];

    const cap = Math.max(1, Math.floor(Number(maxCandidates) || 1));
    const combos = [];
    const pickN = boundary.pick;
    const combo = [];
    const dfs = (start) => {
      if (combos.length >= cap) return;
      if (combo.length === pickN) {
        combos.push([...forced, ...combo]);
        return;
      }
      for (let k = start; k < boundary.members.length; k++) {
        if (boundary.members.length - k < pickN - combo.length) break;
        combo.push(boundary.members[k]);
        dfs(k + 1);
        combo.pop();
        if (combos.length >= cap) return;
      }
    };
    dfs(0);

    return combos;
  };

  /* ---------- Mix Americano fairness optimizer ---------- */

  // Scoring weights for individual Mix match candidates (pair-level).
  // Partner repeats are an order of magnitude more expensive than opponent /
  // meeting / group penalties so the optimizer treats them as a near-hard
  // constraint: a repeated M+F partner pair is only accepted when no candidate
  // round avoids it while still respecting games / bye fairness.
  const MIX_W_PARTNER = 100000;
  // Opponent repeats are the next most expensive after partner repeats. They
  // dwarf meeting/group penalties but stay an order of magnitude below partner
  // priority so a partner repeat is never accepted to "fix" an opponent
  // repeat. Repeating an opponent pair once costs 50000; twice costs 100000.
  const MIX_W_OPPONENT = 50000;
  const MIX_W_MEETING = 500;
  const MIX_W_GROUP = 5000;
  const MIX_B_NEW_PARTNER = 5000;
  const MIX_B_NEW_OPPONENT = 5000;
  const MIX_B_NEW_MEETING = 500;

  // Round-level (re-rank) weights for the unique partner/opponent/meeting
  // deficit per player. Squared to push the optimizer hardest on the players
  // with the largest gaps. Partner deficit dominates so unique-partner
  // coverage stays the primary key; opponent deficit comes next and clearly
  // beats meeting / spread tie-breakers.
  const MIX_W_DEFICIT_PARTNER = 20000;
  const MIX_W_DEFICIT_OPPONENT = 5000;
  const MIX_W_DEFICIT_MEETING = 100;
  const MIX_W_SPREAD_MEETING = 50;

  const MIX_BB_TOP_K = 128;
  const MIX_BB_MAX_NODES = 400000;

  /**
   * Return the two possible team splits for a Mix quad: two males [m1,m2]
   * partnered with two females [f1,f2].
   *   1) (m1+f1) vs (m2+f2)
   *   2) (m1+f2) vs (m2+f1)
   */
  const splitMixQuad = (males, females) => {
    const [m1, m2] = males;
    const [f1, f2] = females;
    return [
      { teamA: [m1, f1], teamB: [m2, f2] },
      { teamA: [m1, f2], teamB: [m2, f1] }
    ];
  };

  /**
   * Pair-level score for a Mix match candidate. Lower is better.
   * Captures repeated partner/opponent/meeting/group penalties plus
   * "first time" bonuses.
   */
  const scoreMixMatchPair = (teamA, teamB, history) => {
    const mA = teamA[0], fA = teamA[1];
    const mB = teamB[0], fB = teamB[1];

    let partnerPenalty = 0;
    let partnerNew = 0;
    [pairKey(mA, fA), pairKey(mB, fB)].forEach((k) => {
      const c = history.partnerCount.get(k) || 0;
      partnerPenalty += c * MIX_W_PARTNER;
      if (c === 0) partnerNew++;
    });

    let oppPenalty = 0;
    let oppNew = 0;
    [
      pairKey(mA, mB), pairKey(mA, fB),
      pairKey(fA, mB), pairKey(fA, fB)
    ].forEach((k) => {
      const c = history.opposeCount.get(k) || 0;
      oppPenalty += c * MIX_W_OPPONENT;
      if (c === 0) oppNew++;
    });

    let meetingPenalty = 0;
    let meetingNew = 0;
    [
      pairKey(mA, fA), pairKey(mA, mB), pairKey(mA, fB),
      pairKey(fA, mB), pairKey(fA, fB), pairKey(mB, fB)
    ].forEach((k) => {
      const c = history.meetingCount.get(k) || 0;
      meetingPenalty += c * MIX_W_MEETING;
      if (c === 0) meetingNew++;
    });

    const gk = groupKeyOf4(mA, fA, mB, fB);
    const groupPenalty = (history.groupCount.get(gk) || 0) * MIX_W_GROUP;

    const bonus =
      partnerNew * MIX_B_NEW_PARTNER +
      oppNew * MIX_B_NEW_OPPONENT +
      meetingNew * MIX_B_NEW_MEETING;

    return partnerPenalty + oppPenalty + meetingPenalty + groupPenalty - bonus;
  };

  /**
   * Max possible unique partners for one Mix player given games played.
   *   capped at the number of opposite-gender players available.
   */
  const maxPossibleUniqueMixPartners = (oppositeCount, gamesAfter) =>
    Math.max(0, Math.min(oppositeCount, gamesAfter));

  /** Max possible unique opponents: every game gives 2 opponents, capped at totalOthers. */
  const maxPossibleUniqueMixOpponents = (totalOthers, gamesAfter) =>
    Math.max(0, Math.min(totalOthers, gamesAfter * 2));

  /** Max possible unique meetings: every game gives 3 meetings (1 partner + 2 opponents). */
  const maxPossibleUniqueMixMeetings = (totalOthers, gamesAfter) =>
    Math.max(0, Math.min(totalOthers, gamesAfter * 3));

  /* ---------- Mix opponent metric helpers ---------- */

  /**
   * Lexicographic "less than" for fixed-length numeric tuples. Returns true
   * iff `a < b` in lex order. Used as the universal ranker for round and
   * schedule candidates.
   */
  const lexLess = (a, b) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] < b[i]) return true;
      if (a[i] > b[i]) return false;
    }
    return false;
  };

  /**
   * Iterate the 4 opponent pairs (A-C, A-D, B-C, B-D) of one Mix match and
   * invoke `cb(keyA, keyB)` for each.
   */
  const forEachOpponentPair = (team1, team2, cb) => {
    const a = team1[0], b = team1[1];
    const c = team2[0], d = team2[1];
    cb(a, c); cb(a, d); cb(b, c); cb(b, d);
  };

  /**
   * Count repeated opponent pairs in a proposed Mix round vs `opposeCount`
   * (prior history, exclusive of the proposed round). A pair counts as
   * "repeated" if `opposeCount(A, B) > 0` even though both pairings are still
   * mutually disjoint matches.
   */
  const countMixOpponentRepeatsInRound = (matches, opposeCount) => {
    if (!Array.isArray(matches) || !opposeCount) return 0;
    let r = 0;
    for (const m of matches) {
      forEachOpponentPair(m.team1 || [], m.team2 || [], (a, b) => {
        if ((opposeCount.get(pairKey(a, b)) || 0) > 0) r++;
      });
    }
    return r;
  };

  /**
   * Count opponent pairs in the proposed Mix round that have never occurred
   * before in `opposeCount`. The "fresh opponent" complement of
   * `countMixOpponentRepeatsInRound`.
   */
  const countMixNewOpponentPairsInRound = (matches, opposeCount) => {
    if (!Array.isArray(matches) || !opposeCount) return 0;
    let n = 0;
    for (const m of matches) {
      forEachOpponentPair(m.team1 || [], m.team2 || [], (a, b) => {
        if ((opposeCount.get(pairKey(a, b)) || 0) === 0) n++;
      });
    }
    return n;
  };

  /**
   * Project per-player unique opponent counts after `matches` is appended to
   * the prior `history.opponents` map. Returns the aggregate statistics
   * needed for round / schedule lex-ranking.
   */
  const projectMixUniqueOpponentStats = (matches, history) => {
    const arr = Array.isArray(matches) ? matches : [];
    const males = history.males || [];
    const females = history.females || [];
    const all = [...males, ...females];
    if (all.length === 0) {
      return {
        minUniqueOpponents: 0,
        avgUniqueOpponents: 0,
        totalUniqueOpponents: 0,
        totalOpponentDeficit: 0
      };
    }

    const playedThisRound = new Set();
    const newOpponents = new Map();
    const addPair = (a, b) => {
      if (!newOpponents.has(a)) newOpponents.set(a, new Set());
      if (!newOpponents.has(b)) newOpponents.set(b, new Set());
      newOpponents.get(a).add(b);
      newOpponents.get(b).add(a);
    };
    for (const m of arr) {
      [...(m.team1 || []), ...(m.team2 || [])].forEach((n) => playedThisRound.add(n));
      forEachOpponentPair(m.team1 || [], m.team2 || [], addPair);
    }

    const totalOthers = males.length + females.length - 1;
    let total = 0;
    let min = Infinity;
    let totalDeficit = 0;
    for (const name of all) {
      const before = history.opponents.get(name) || new Set();
      const added = newOpponents.get(name);
      let uniq = before.size;
      if (added) added.forEach((q) => { if (!before.has(q)) uniq++; });
      total += uniq;
      if (uniq < min) min = uniq;
      const gamesAfter = (history.gamesPlayed.get(name) || 0) +
        (playedThisRound.has(name) ? 1 : 0);
      const maxO = maxPossibleUniqueMixOpponents(totalOthers, gamesAfter);
      totalDeficit += Math.max(0, maxO - uniq);
    }
    return {
      minUniqueOpponents: Number.isFinite(min) ? min : 0,
      avgUniqueOpponents: total / all.length,
      totalUniqueOpponents: total,
      totalOpponentDeficit: totalDeficit
    };
  };

  /**
   * Summary of opponent quality for a fully completed Mix schedule (or for a
   * report rebuilt from history). Returns:
   *   repeatedOpponentPairs   number of unordered pairs with opposeCount > 1
   *   totalOpponentRepeats    sum of (opposeCount - 1) across all such pairs
   *   repeatedOpponentPairsByPair  Map<pairKey, count> for pairs with count > 1
   *   minUniqueOpponents      lowest unique opponent count among all players
   *   avgUniqueOpponents      average unique opponent count
   */
  const summarizeMixOpponentQuality = (history) => {
    let repeatedPairs = 0;
    let totalRepeats = 0;
    const repeatedDetail = new Map();
    history.opposeCount.forEach((c, k) => {
      if (c > 1) {
        repeatedPairs++;
        totalRepeats += c - 1;
        repeatedDetail.set(k, c);
      }
    });
    const males = history.males || [];
    const females = history.females || [];
    const all = [...males, ...females];
    let min = Infinity;
    let total = 0;
    all.forEach((n) => {
      const s = (history.opponents.get(n) || new Set()).size;
      total += s;
      if (s < min) min = s;
    });
    return {
      repeatedOpponentPairs: repeatedPairs,
      totalOpponentRepeats: totalRepeats,
      repeatedOpponentPairsByPair: repeatedDetail,
      minUniqueOpponents: Number.isFinite(min) ? min : 0,
      avgUniqueOpponents: all.length ? total / all.length : 0
    };
  };

  /**
   * Count repeated M-F partner pairs in `matches` vs prior `partnerCount`.
   * Centralized so the round-level and schedule-level rankers share one
   * implementation.
   */
  const countMixPartnerRepeatsInRound = (matches, partnerCount) => {
    if (!Array.isArray(matches) || !partnerCount) return 0;
    let r = 0;
    for (const m of matches) {
      if ((partnerCount.get(pairKey(m.team1[0], m.team1[1])) || 0) > 0) r++;
      if ((partnerCount.get(pairKey(m.team2[0], m.team2[1])) || 0) > 0) r++;
    }
    return r;
  };

  /**
   * Round-level re-rank penalty. Lower is better.
   * Sums squared deficits in unique-partner / unique-opponent / unique-meeting
   * counts after the round, plus a small spread penalty so meetings stay
   * balanced across players (not just maximized for some and ignored for others).
   *
   * The pair-level new/repeat bonuses are already baked into match scores,
   * so this layer only adds the per-player gap penalty.
   */
  const computeMixRoundBalance = (picks, history) => {
    const males = history.males;
    const females = history.females;
    const playedThisRound = new Set();
    const newPartners = new Map();
    const newOpponents = new Map();
    const newMeetings = new Map();

    const incSet = (mp, name, other) => {
      let s = mp.get(name);
      if (!s) { s = new Set(); mp.set(name, s); }
      s.add(other);
    };

    for (const p of picks) {
      const t1 = p.teamA;
      const t2 = p.teamB;
      [...t1, ...t2].forEach((n) => playedThisRound.add(n));

      const [mA, fA] = t1;
      const [mB, fB] = t2;
      incSet(newPartners, mA, fA);
      incSet(newPartners, fA, mA);
      incSet(newPartners, mB, fB);
      incSet(newPartners, fB, mB);

      [[mA, mB], [mA, fB], [fA, mB], [fA, fB]].forEach(([a, b]) => {
        incSet(newOpponents, a, b);
        incSet(newOpponents, b, a);
      });

      const all4 = [mA, fA, mB, fB];
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          incSet(newMeetings, all4[i], all4[j]);
          incSet(newMeetings, all4[j], all4[i]);
        }
      }
    }

    const totalOthers = males.length + females.length - 1;
    let partnerSqSum = 0;
    let opponentSqSum = 0;
    let meetingSqSum = 0;
    let minMeetings = Infinity;
    let maxMeetings = -Infinity;

    const evalGender = (name, oppositeCount) => {
      const gamesBefore = history.gamesPlayed.get(name) || 0;
      const gamesAfter = gamesBefore + (playedThisRound.has(name) ? 1 : 0);

      const partnersBefore = history.partners.get(name) || new Set();
      const opponentsBefore = history.opponents.get(name) || new Set();
      const meetingsBefore = history.meetings.get(name) || new Set();

      const addedP = newPartners.get(name);
      const addedO = newOpponents.get(name);
      const addedM = newMeetings.get(name);

      let uniqP = partnersBefore.size;
      if (addedP) addedP.forEach((q) => { if (!partnersBefore.has(q)) uniqP++; });
      let uniqO = opponentsBefore.size;
      if (addedO) addedO.forEach((q) => { if (!opponentsBefore.has(q)) uniqO++; });
      let uniqM = meetingsBefore.size;
      if (addedM) addedM.forEach((q) => { if (!meetingsBefore.has(q)) uniqM++; });

      const maxP = maxPossibleUniqueMixPartners(oppositeCount, gamesAfter);
      const maxO = maxPossibleUniqueMixOpponents(totalOthers, gamesAfter);
      const maxM = maxPossibleUniqueMixMeetings(totalOthers, gamesAfter);

      const dP = Math.max(0, maxP - uniqP);
      const dO = Math.max(0, maxO - uniqO);
      const dM = Math.max(0, maxM - uniqM);

      partnerSqSum += dP * dP;
      opponentSqSum += dO * dO;
      meetingSqSum += dM * dM;
      if (uniqM < minMeetings) minMeetings = uniqM;
      if (uniqM > maxMeetings) maxMeetings = uniqM;
    };

    males.forEach((n) => evalGender(n, females.length));
    females.forEach((n) => evalGender(n, males.length));

    const spread =
      Number.isFinite(minMeetings) && Number.isFinite(maxMeetings)
        ? (maxMeetings - minMeetings) * MIX_W_SPREAD_MEETING
        : 0;

    return (
      partnerSqSum * MIX_W_DEFICIT_PARTNER +
      opponentSqSum * MIX_W_DEFICIT_OPPONENT +
      meetingSqSum * MIX_W_DEFICIT_MEETING +
      spread
    );
  };

  /**
   * Partition active males/females into `usedCourts` disjoint Mix matches that
   * minimize the total fairness penalty. Branch-and-bound with a top-K beam so
   * we can re-rank by per-player deficit balance at the round level.
   *
   * Randomness is only used as a tiny tie-breaker.
   */
  const buildMatchesForActiveMix = (activeM, activeF, usedCourts, history, opts = {}) => {
    const random = opts.random || Math.random;
    if (!Number.isInteger(usedCourts) || usedCourts <= 0) return null;
    if (!Array.isArray(activeM) || activeM.length !== usedCourts * 2) return null;
    if (!Array.isArray(activeF) || activeF.length !== usedCourts * 2) return null;

    const nM = activeM.length;
    const nF = activeF.length;

    // 1) Enumerate every valid 2M+2F match candidate and its best split.
    const candidates = [];
    for (let i = 0; i < nM; i++) {
      for (let j = i + 1; j < nM; j++) {
        for (let k = 0; k < nF; k++) {
          for (let l = k + 1; l < nF; l++) {
            const mA = activeM[i], mB = activeM[j];
            const fA = activeF[k], fB = activeF[l];
            const splits = splitMixQuad([mA, mB], [fA, fB]);
            let bestSc = Infinity;
            let bestSplit = null;
            for (const sp of splits) {
              const sc = scoreMixMatchPair(sp.teamA, sp.teamB, history);
              if (sc < bestSc) {
                bestSc = sc;
                bestSplit = sp;
              }
            }
            candidates.push({
              score: bestSc,
              jitter: random() * 0.0001,
              teamA: bestSplit.teamA,
              teamB: bestSplit.teamB,
              maleMask: (1 << i) | (1 << j),
              femaleMask: (1 << k) | (1 << l),
              anchorM: i
            });
          }
        }
      }
    }
    if (candidates.length === 0) return null;

    // 2) Group by smallest-male anchor and sort ascending by score+jitter.
    const byAnchorM = Array.from({ length: nM }, () => []);
    for (const c of candidates) byAnchorM[c.anchorM].push(c);
    for (const arr of byAnchorM) {
      arr.sort((a, b) => (a.score - b.score) || (a.jitter - b.jitter));
    }

    // 3) Branch-and-bound: keep top MIX_BB_TOP_K complete rounds.
    const topRounds = [];
    let acceptThreshold = Infinity;
    let nodes = 0;

    const insertCandidate = (score, picks) => {
      if (topRounds.length < MIX_BB_TOP_K) {
        let i = topRounds.length;
        while (i > 0 && topRounds[i - 1].score > score) i--;
        topRounds.splice(i, 0, { score, picks: picks.slice() });
        if (topRounds.length === MIX_BB_TOP_K) {
          acceptThreshold = topRounds[MIX_BB_TOP_K - 1].score;
        }
      } else if (score < acceptThreshold) {
        topRounds.pop();
        let i = topRounds.length;
        while (i > 0 && topRounds[i - 1].score > score) i--;
        topRounds.splice(i, 0, { score, picks: picks.slice() });
        acceptThreshold = topRounds[MIX_BB_TOP_K - 1].score;
      }
    };

    const dfs = (mMask, fMask, partial, picks) => {
      if (nodes >= MIX_BB_MAX_NODES) return;
      nodes++;

      if (picks.length === usedCourts) {
        insertCandidate(partial, picks);
        return;
      }
      if (partial >= acceptThreshold) return;

      let anchor = -1;
      for (let i = 0; i < nM; i++) {
        if (!(mMask & (1 << i))) { anchor = i; break; }
      }
      if (anchor < 0) return;

      const list = byAnchorM[anchor];
      for (const c of list) {
        if (c.maleMask & mMask) continue;
        if (c.femaleMask & fMask) continue;
        if (partial + c.score >= acceptThreshold) break;
        picks.push(c);
        dfs(mMask | c.maleMask, fMask | c.femaleMask, partial + c.score, picks);
        picks.pop();
        if (nodes >= MIX_BB_MAX_NODES) return;
      }
    };

    dfs(0, 0, 0, []);

    // Fallback: pure greedy when BB couldn't complete a round under the budget.
    if (topRounds.length === 0) {
      let mMask = 0, fMask = 0;
      const picks = [];
      for (let step = 0; step < usedCourts; step++) {
        let anchor = -1;
        for (let i = 0; i < nM; i++) {
          if (!(mMask & (1 << i))) { anchor = i; break; }
        }
        if (anchor < 0) return null;
        const pick = (byAnchorM[anchor] || []).find(
          (c) => !(c.maleMask & mMask) && !(c.femaleMask & fMask)
        );
        if (!pick) return null;
        picks.push(pick);
        mMask |= pick.maleMask;
        fMask |= pick.femaleMask;
      }
      topRounds.push({
        score: picks.reduce((s, p) => s + p.score, 0),
        picks
      });
    }

    // 4) Re-rank by a lexicographic tuple. The pair-level penalties already
    //    bake the partner / opponent priority into `cand.score`, but the
    //    combined score can let opponent quality slip when many candidates
    //    tie. Explicit lex-ranking guarantees opponent rotation wins over
    //    meeting / group / spread tie-breakers inside one active set:
    //      1) repeatedPartnerPairs ASC  (always 0 unless structurally forced)
    //      2) repeatedOpponentPairs ASC (next strongest fairness layer)
    //      3) projected unique-opponent deficit ASC
    //      4) -minUniqueOpponents DESC (push the worst-served player up)
    //      5) round-level deficit balance ASC (meeting/spread tie-breakers)
    //      6) combined score ASC, then base score ASC for stability.
    const candidateAsMatches = (picks) => picks.map((p) => ({
      team1: p.teamA, team2: p.teamB
    }));
    let bestCandidate = topRounds[0];
    let bestLex = null;
    for (const cand of topRounds) {
      const matchesView = candidateAsMatches(cand.picks);
      const balance = computeMixRoundBalance(cand.picks, history);
      const combined = cand.score + balance;
      const partnerRepeats = countMixPartnerRepeatsInRound(matchesView, history.partnerCount);
      const oppRepeats = countMixOpponentRepeatsInRound(matchesView, history.opposeCount);
      const proj = projectMixUniqueOpponentStats(matchesView, history);
      const tuple = [
        partnerRepeats,
        oppRepeats,
        proj.totalOpponentDeficit,
        -proj.minUniqueOpponents,
        balance,
        combined,
        cand.score
      ];
      if (!bestLex || lexLess(tuple, bestLex)) {
        bestLex = tuple;
        bestCandidate = cand;
      }
    }

    // 5) Court numbering — assign 1..usedCourts in order. Could be extended to
    //    rotate by per-player court usage, but Mix sessions are usually short
    //    so the simple assignment keeps the UI predictable.
    const matches = bestCandidate.picks.map((p, i) => ({
      court: i + 1,
      team1: p.teamA,
      team2: p.teamB,
      score1: '',
      score2: ''
    }));

    return {
      matches,
      baseScore: bestCandidate.score,
      combinedScore: bestLex ? bestLex[5] : bestCandidate.score
    };
  };

  /**
   * Build a full Mix Americano round dynamically (per-round fair optimizer).
   *
   * Pipeline:
   *  1. Pick `2 * effectiveCourts` males and `2 * effectiveCourts` females via
   *     the Normal Americano fairness selector (applied separately per gender).
   *  2. Enumerate every valid 2M+2F match candidate over the active pool.
   *  3. Branch-and-bound for the lowest-penalty disjoint set covering all
   *     courts; keep a top-K beam.
   *  4. Re-rank by per-player partner/opponent/meeting deficit balance and pick
   *     the lowest combined score.
   *  5. Assign court numbers.
   *
   * Mix hard invariants enforced by construction:
   *  - exactly 2M + 2F per court,
   *  - every team is M + F,
   *  - effective courts capped at min(courts, floor(M/2), floor(F/2)).
   *
   * @param {string[]} maleNames    - full male roster (display order)
   * @param {string[]} femaleNames  - full female roster (display order)
   * @param {number}   courtCount   - courts available for this round
   * @param {Array}    allRounds    - tournament rounds JSON (already parsed)
   * @param {number}   roundNo      - current round number (1-indexed)
   * @param {object}  [opts]        - { random } - inject deterministic RNG for tests
   * @returns {{ matches, activeM, activeF, effectiveCourts, baseScore?, combinedScore? }}
   */
  const buildMixDynamicMatches = (
    maleNames,
    femaleNames,
    courtCount,
    allRounds,
    roundNo,
    opts = {}
  ) => {
    const males = Array.isArray(maleNames) ? maleNames : [];
    const females = Array.isArray(femaleNames) ? femaleNames : [];
    const requestedCourts = Math.max(0, Math.floor(Number(courtCount) || 0));
    const effectiveCourts = Math.min(
      requestedCourts,
      Math.floor(males.length / 2),
      Math.floor(females.length / 2)
    );

    if (effectiveCourts <= 0) {
      return { matches: [], activeM: [], activeF: [], effectiveCourts: 0 };
    }

    const need = effectiveCourts * 2;
    const history = buildMixFairnessHistory(allRounds, males, females, roundNo);

    // Enumerate fair active candidate sets per gender. The first emitted
    // candidate is the deterministic default (boundary-tier picks in roster
    // index order). We do NOT early-exit on the first zero partner-repeat
    // round: alternative active sets with the same partner safety may yield
    // fewer opponent repeats or a stronger projected unique-opponent floor.
    const ACTIVE_CAP_PER_GENDER = opts.activeCapPerGender || 12;
    const maleCandidates = enumerateFairActiveSets(
      males, need, allRounds, roundNo, ACTIVE_CAP_PER_GENDER
    );
    const femaleCandidates = enumerateFairActiveSets(
      females, need, allRounds, roundNo, ACTIVE_CAP_PER_GENDER
    );

    // Lex rank candidate rounds by:
    //   1) repeatedPartnerPairs ASC   (never accept a repeat if any candidate avoids it)
    //   2) repeatedOpponentPairs ASC  (next priority — the new requirement)
    //   3) -minUniqueOpponents        (push the worst-served player up)
    //   4) -avgUniqueOpponents        (overall opponent breadth)
    //   5) combinedScore ASC          (existing meeting / group / spread quality)
    //
    // Early-exit when (0 partner repeats, 0 opponent repeats) is reached:
    // those are the primary fairness keys and nothing later can beat them.
    // The remaining tie-breakers (min/avg unique opps, combined score) are
    // already optimized inside the BB for the chosen active set, so the
    // exit keeps the slow stress matrix tractable without sacrificing the
    // user-visible fairness rules.
    let best = null;
    let bestTuple = null;
    outer: for (const activeM of maleCandidates) {
      for (const activeF of femaleCandidates) {
        const built = buildMatchesForActiveMix(
          activeM, activeF, effectiveCourts, history, opts
        );
        if (!built || !Array.isArray(built.matches) || built.matches.length !== effectiveCourts) {
          continue;
        }
        const partnerRepeats = countMixPartnerRepeatsInRound(built.matches, history.partnerCount);
        const oppRepeats = countMixOpponentRepeatsInRound(built.matches, history.opposeCount);
        const proj = projectMixUniqueOpponentStats(built.matches, history);
        const combined = built.combinedScore != null
          ? built.combinedScore
          : (built.baseScore || 0);
        const tuple = [
          partnerRepeats,
          oppRepeats,
          -proj.minUniqueOpponents,
          -proj.avgUniqueOpponents,
          combined
        ];

        if (!bestTuple || lexLess(tuple, bestTuple)) {
          bestTuple = tuple;
          best = {
            activeM: activeM.slice(),
            activeF: activeF.slice(),
            matches: built.matches,
            baseScore: built.baseScore,
            combinedScore: built.combinedScore,
            partnerRepeats,
            opponentRepeats: oppRepeats,
            minUniqueOpponents: proj.minUniqueOpponents,
            avgUniqueOpponents: proj.avgUniqueOpponents
          };
        }

        if (best.partnerRepeats === 0 && best.opponentRepeats === 0) break outer;
      }
    }

    if (!best) {
      return { matches: [], activeM: [], activeF: [], effectiveCourts };
    }

    return {
      matches: best.matches,
      activeM: best.activeM,
      activeF: best.activeF,
      effectiveCourts,
      baseScore: best.baseScore,
      combinedScore: best.combinedScore,
      repeatedPartnerPairs: best.partnerRepeats,
      repeatedOpponentPairs: best.opponentRepeats,
      minUniqueOpponents: best.minUniqueOpponents,
      avgUniqueOpponents: best.avgUniqueOpponents
    };
  };

  /**
   * Build a fairness report describing the Mix session as it stands after all
   * `allRounds` have been played. Useful for tests and the dev console.
   *
   * Returns games/byes per player (overall and per gender), repeated partner
   * pair counts, unique partner/opponent/meeting counts per player, repeated
   * group counts, and warnings when full coverage is mathematically impossible.
   */
  const buildMixFairnessReport = (maleRoster, femaleRoster, allRounds, courts) => {
    const males = Array.isArray(maleRoster) ? maleRoster : [];
    const females = Array.isArray(femaleRoster) ? femaleRoster : [];
    const allNames = [...males, ...females];
    const totalPlayers = allNames.length;
    const totalRounds = (Array.isArray(allRounds) ? allRounds : []).length;

    const history = buildMixFairnessHistory(allRounds, males, females, totalRounds + 1);

    const gamesByPlayer = {};
    const byesByPlayer = {};
    allNames.forEach((n) => {
      gamesByPlayer[n] = history.gamesPlayed.get(n) || 0;
      byesByPlayer[n] = history.byeCount.get(n) || 0;
    });

    const gamesArr = Object.values(gamesByPlayer);
    const byesArr = Object.values(byesByPlayer);
    const gamesM = males.map((n) => gamesByPlayer[n]);
    const gamesF = females.map((n) => gamesByPlayer[n]);
    const byesM = males.map((n) => byesByPlayer[n]);
    const byesF = females.map((n) => byesByPlayer[n]);

    const minMax = (arr) => arr.length
      ? { min: Math.min(...arr), max: Math.max(...arr), diff: Math.max(...arr) - Math.min(...arr) }
      : { min: 0, max: 0, diff: 0 };

    let repeatedPartnerPairs = 0;
    let totalPartnerRepeats = 0;
    history.partnerCount.forEach((c) => {
      if (c > 1) {
        repeatedPartnerPairs++;
        totalPartnerRepeats += c - 1;
      }
    });

    const oppQuality = summarizeMixOpponentQuality(history);
    const repeatedOpponentPairCount = oppQuality.repeatedOpponentPairs;
    const totalOpponentRepeats = oppQuality.totalOpponentRepeats;
    // Legacy field: total extra partner occurrences (same as totalPartnerRepeats).
    const repeatedPartnerPairOccurrences = totalPartnerRepeats;
    // Legacy field: total extra opponent occurrences.
    const repeatedOpponentPairOccurrences = totalOpponentRepeats;

    let repeatedGroups = 0;
    history.groupCount.forEach((c) => { if (c > 1) repeatedGroups += c - 1; });

    const uniquePartnersByPlayer = {};
    const uniqueOpponentsByPlayer = {};
    const uniqueMeetingsByPlayer = {};
    const partnerListByPlayer = {};
    const opponentListByPlayer = {};
    const meetingListByPlayer = {};
    allNames.forEach((n) => {
      const pSet = history.partners.get(n) || new Set();
      const oSet = history.opponents.get(n) || new Set();
      const mSet = history.meetings.get(n) || new Set();
      uniquePartnersByPlayer[n] = pSet.size;
      uniqueOpponentsByPlayer[n] = oSet.size;
      uniqueMeetingsByPlayer[n] = mSet.size;
      partnerListByPlayer[n] = [...pSet];
      opponentListByPlayer[n] = [...oSet];
      meetingListByPlayer[n] = [...mSet];
    });

    const warnings = [];
    if (males.length !== females.length) {
      warnings.push(
        `Male and female player counts are not equal (${males.length}M / ${females.length}F).` +
        ' Bye distribution is balanced within each gender as much as possible.'
      );
    }
    const overallGamesDiff = minMax(gamesArr).diff;
    const overallByeDiff = minMax(byesArr).diff;
    const maleByeDiff = minMax(byesM).diff;
    const femaleByeDiff = minMax(byesF).diff;
    if (overallByeDiff > 1 && males.length === females.length) {
      warnings.push(`byeDifference ${overallByeDiff} > 1`);
    }
    if (overallGamesDiff > 1 && males.length === females.length) {
      warnings.push(`gamesPlayedDifference ${overallGamesDiff} > 1`);
    }
    if (maleByeDiff > 1) warnings.push(`male bye difference ${maleByeDiff} > 1`);
    if (femaleByeDiff > 1) warnings.push(`female bye difference ${femaleByeDiff} > 1`);

    // Full-meeting coverage feasibility (each player should ideally meet every
    // other player at least once).
    const matchesPerRound = Math.min(
      Math.max(0, Number(courts) || 0),
      Math.floor(males.length / 2),
      Math.floor(females.length / 2)
    );
    const meetingsPerPlayerMax = totalRounds * 3; // 1 partner + 2 opponents per game (best case)
    const fullMeetingFeasible = meetingsPerPlayerMax >= totalPlayers - 1;
    if (!fullMeetingFeasible && totalPlayers > 1) {
      warnings.push(
        `Full meeting coverage infeasible: each player has at most ${meetingsPerPlayerMax} ` +
        `meetings across ${totalRounds} rounds vs ${totalPlayers - 1} other players.`
      );
    }

    const minimumUniqueOpponentCount = oppQuality.minUniqueOpponents;
    const averageUniqueOpponentCount = oppQuality.avgUniqueOpponents;
    const totalOthers = totalPlayers - 1;
    const repeatedOpponentPairsDetail = [];
    oppQuality.repeatedOpponentPairsByPair.forEach((count, key) => {
      const sep = key.indexOf('\0');
      const a = sep >= 0 ? key.slice(0, sep) : key;
      const b = sep >= 0 ? key.slice(sep + 1) : '';
      repeatedOpponentPairsDetail.push({ playerA: a, playerB: b, count });
    });
    repeatedOpponentPairsDetail.sort((x, y) =>
      (y.count - x.count) || x.playerA.localeCompare(y.playerA) || x.playerB.localeCompare(y.playerB)
    );

    allNames.forEach((n) => {
      const games = gamesByPlayer[n] || 0;
      const uniqO = uniqueOpponentsByPlayer[n] || 0;
      const maxO = maxPossibleUniqueMixOpponents(totalOthers, games);
      if (games > 0 && uniqO < maxO && maxO - uniqO >= 2) {
        warnings.push(
          `${n} has ${uniqO} unique opponents vs ${maxO} possible after ${games} games.`
        );
      }
    });
    if (
      repeatedOpponentPairCount > 0 &&
      males.length === females.length &&
      overallGamesDiff <= 1
    ) {
      warnings.push(
        `${repeatedOpponentPairCount} repeated opponent pair(s) ` +
        `(${totalOpponentRepeats} extra occurrence(s)); a better schedule may exist.`
      );
    }

    return {
      totalPlayers,
      totalMales: males.length,
      totalFemales: females.length,
      courts: Math.max(0, Number(courts) || 0),
      rounds: totalRounds,
      matchesPerRound,
      usedCourtsPerRound: matchesPerRound,
      maleByePerRound: Math.max(0, males.length - matchesPerRound * 2),
      femaleByePerRound: Math.max(0, females.length - matchesPerRound * 2),
      gamesByPlayer,
      byesByPlayer,
      gamesRange: minMax(gamesArr),
      byesRange: minMax(byesArr),
      gamesRangeMale: minMax(gamesM),
      gamesRangeFemale: minMax(gamesF),
      byesRangeMale: minMax(byesM),
      byesRangeFemale: minMax(byesF),
      repeatedPartnerPairs: repeatedPartnerPairOccurrences,
      repeatedPartnerPairCount: repeatedPartnerPairs,
      totalPartnerRepeats,
      repeatedOpponentPairs: repeatedOpponentPairOccurrences,
      repeatedOpponentPairCount,
      totalOpponentRepeats,
      repeatedOpponentPairsDetail,
      minimumUniqueOpponentCount,
      averageUniqueOpponentCount,
      repeatedGroups,
      uniquePartnersByPlayer,
      uniqueOpponentsByPlayer,
      uniqueMeetingsByPlayer,
      partnerListByPlayer,
      opponentListByPlayer,
      meetingListByPlayer,
      warnings
    };
  };

  /** Deterministic PRNG for Mix candidate-schedule generation (tests / simulations). */
  const makeMixSeededRandom = (seed) => {
    let state = (seed >>> 0) || 1;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };

  /**
   * Lex-rank a fully completed Mix schedule. Lower tuple is better.
   * Priority mirrors the user-facing fairness order: partner safety first,
   * then opponent rotation breadth, then meeting coverage.
   */
  const rankMixScheduleQuality = (history, males, females) => {
    let partnerRepeatPairs = 0;
    let totalPartnerRepeats = 0;
    history.partnerCount.forEach((c) => {
      if (c > 1) {
        partnerRepeatPairs++;
        totalPartnerRepeats += c - 1;
      }
    });
    const opp = summarizeMixOpponentQuality(history);
    const all = [...males, ...females];
    let minMeetings = Infinity;
    let totalMeetings = 0;
    all.forEach((n) => {
      const s = (history.meetings.get(n) || new Set()).size;
      totalMeetings += s;
      if (s < minMeetings) minMeetings = s;
    });
    const tuple = [
      partnerRepeatPairs,
      totalPartnerRepeats,
      opp.repeatedOpponentPairs,
      opp.totalOpponentRepeats,
      -opp.minUniqueOpponents,
      -opp.avgUniqueOpponents,
      Number.isFinite(minMeetings) ? -minMeetings : 0
    ];
    return {
      tuple,
      partnerRepeatPairs,
      totalPartnerRepeats,
      repeatedOpponentPairs: opp.repeatedOpponentPairs,
      totalOpponentRepeats: opp.totalOpponentRepeats,
      minUniqueOpponents: opp.minUniqueOpponents,
      avgUniqueOpponents: opp.avgUniqueOpponents,
      minUniqueMeetings: Number.isFinite(minMeetings) ? minMeetings : 0,
      totalUniqueMeetings: totalMeetings
    };
  };

  /**
   * Generate many candidate Mix schedules for a known horizon (round count)
   * and return the lex-best one. Intended for tests and offline simulations;
   * the live UI keeps generating rounds on demand via `buildMixDynamicMatches`.
   *
   * @param {string[]} maleRoster
   * @param {string[]} femaleRoster
   * @param {number}   courtCount
   * @param {number}   totalRounds
   * @param {object}  [opts] - { candidateCount, baseSeed, seeds, activeCapPerGender }
   * @returns {{ rounds, report, seed, quality, candidatesTried }}
   */
  const buildBestMixCandidateSchedule = (
    maleRoster,
    femaleRoster,
    courtCount,
    totalRounds,
    opts = {}
  ) => {
    const males = Array.isArray(maleRoster) ? maleRoster : [];
    const females = Array.isArray(femaleRoster) ? femaleRoster : [];
    const courts = Math.max(0, Math.floor(Number(courtCount) || 0));
    const rounds = Math.max(0, Math.floor(Number(totalRounds) || 0));
    const candidateCount = Math.max(
      1,
      Math.floor(Number(opts.candidateCount) || 100)
    );
    const baseSeed = opts.baseSeed != null ? (opts.baseSeed >>> 0) : 1;
    const seedList = Array.isArray(opts.seeds) ? opts.seeds : null;
    const activeCap = opts.activeCapPerGender;

    let bestRounds = null;
    let bestTuple = null;
    let bestSeed = baseSeed;
    let bestQuality = null;

    for (let i = 0; i < candidateCount; i++) {
      const seed = seedList ? (seedList[i] >>> 0) : ((baseSeed + i * 9973) >>> 0);
      const random = makeMixSeededRandom(seed);
      const allRounds = [];
      for (let r = 1; r <= rounds; r++) {
        const built = buildMixDynamicMatches(
          males,
          females,
          courts,
          allRounds,
          r,
          {
            random,
            activeCapPerGender: activeCap
          }
        );
        allRounds.push({ round: r, matches: built.matches });
      }

      const history = buildMixFairnessHistory(allRounds, males, females, rounds + 1);
      const quality = rankMixScheduleQuality(history, males, females);
      if (!bestTuple || lexLess(quality.tuple, bestTuple)) {
        bestTuple = quality.tuple;
        bestRounds = allRounds;
        bestSeed = seed;
        bestQuality = quality;
      }
    }

    const report = buildMixFairnessReport(males, females, bestRounds || [], courts);
    return {
      rounds: bestRounds || [],
      report,
      seed: bestSeed,
      quality: bestQuality,
      candidatesTried: candidateCount
    };
  };

  /* ---------- match building ---------- */
  const buildNormalPairs = (activeNames, partnerCount, lastRoundPartnerSet, levelByName, rosterNames) => {
    const resolve = makeRosterNameResolve(rosterNames || activeNames);
    const getL = (n) => getLevelForPairing(levelByName, resolve, n);
    const spread = levelByName && levelByName.size
      ? activeLevelSpread(activeNames, getL)
      : 0;
    const pool = shuffle(activeNames);
    const pairs = [];
    while (pool.length >= 2) {
      const p = pool.shift();
      let bestJ = -1;
      let bestScore = Infinity;
      for (let j = 0; j < pool.length; j++) {
        const q = pool[j];
        const k = pairKey(p, q);
        const partnerSeen = partnerCount.get(k) || 0;
        const repeatedFromLastRound = lastRoundPartnerSet.has(k) ? 1 : 0;
        let s = repeatedFromLastRound * 100000 + partnerSeen * 100;
        if (spread > 0) {
          const d = Math.abs(getL(p) - getL(q));
          s += POWER_LEVEL_PARTNER_ALPHA * Math.max(0, spread - d);
        }
        if (s < bestScore) { bestScore = s; bestJ = j; }
      }
      if (bestJ < 0) bestJ = 0;
      const q = pool.splice(bestJ, 1)[0];
      pairs.push({ m: p, f: q });
    }
    return pairs;
  };

  const buildBestNormalMatches = (activeNames, maxCourts, history, allRounds, roundNo, rosterNames, levelByName) => {
    const { partnerCount, opposeCount, matchupCount } = history;
    const resolve = makeRosterNameResolve(rosterNames || activeNames);
    const prevRound = getPreviousRoundDatum(allRounds, roundNo);
    const lastRoundPartnerSet = getLastRoundPartnerSet(prevRound, resolve);
    const getL = (n) => getLevelForPairing(levelByName, resolve, n);
    const levelSpread = levelByName && levelByName.size
      ? activeLevelSpread(activeNames, getL)
      : 0;
    const neededPairs = maxCourts * 2;
    const attempts = Math.max(80, Math.min(260, activeNames.length * 18));
    let best = null;

    for (let i = 0; i < attempts; i++) {
      const pairs = buildNormalPairs(
        activeNames, partnerCount, lastRoundPartnerSet, levelByName, rosterNames
      ).slice(0, neededPairs);
      if (pairs.length < neededPairs) continue;

      const pool = shuffle([...pairs]);
      const matches = [];
      let score = 0;

      for (let c = 0; c < maxCourts; c++) {
        if (pool.length < 2) break;
        const p1 = pool.shift();
        let bestJ = -1;
        let bestPairScore = Infinity;

        for (let j = 0; j < pool.length; j++) {
          const p2 = pool[j];
          const sOpp = pairCrossOpposeScore(p1, p2, opposeCount);
          const sMatchup = matchupCount.get(matchupKey(p1, p2)) || 0;
          let pairScore = sOpp * 10 + sMatchup * 200;
          if (levelSpread > 0) {
            const s1 = getL(p1.m) + getL(p1.f);
            const s2 = getL(p2.m) + getL(p2.f);
            pairScore += POWER_LEVEL_MATCH_BETA * Math.abs(s1 - s2);
          }
          if (pairScore < bestPairScore) { bestPairScore = pairScore; bestJ = j; }
        }

        if (bestJ < 0) break;
        const p2 = pool.splice(bestJ, 1)[0];
        matches.push({
          court: c + 1,
          team1: [p1.m, p1.f],
          team2: [p2.m, p2.f],
          score1: '',
          score2: ''
        });

        const partnerPenalty =
          (partnerCount.get(pairKey(p1.m, p1.f)) || 0) +
          (partnerCount.get(pairKey(p2.m, p2.f)) || 0);
        const repeatLastRoundPenalty =
          (lastRoundPartnerSet.has(pairKey(p1.m, p1.f)) ? 1 : 0) +
          (lastRoundPartnerSet.has(pairKey(p2.m, p2.f)) ? 1 : 0);
        score += repeatLastRoundPenalty * 100000 + partnerPenalty * 50 + bestPairScore;
      }

      if (matches.length !== maxCourts) continue;
      if (!best || score < best.score) best = { score, matches };
    }

    return best?.matches || [];
  };

  const buildBestFixedPairMatches = (selectedPairs, history, lastRoundMatchups) => {
    const { opposeCount, matchupCount } = history;
    const k = selectedPairs.length;
    if (k < 2 || k % 2 !== 0) return [];
    const numCourts = k / 2;
    const lastMu = lastRoundMatchups || new Set();

    if (k <= 12) {
      const exact = buildBestFixedPairMatchesExhaustive(selectedPairs, matchupCount, opposeCount, lastMu);
      if (exact?.length === numCourts) return exact;
    }

    const attempts = Math.max(120, Math.min(400, k * 28));
    let best = null;

    for (let a = 0; a < attempts; a++) {
      const pool = shuffle([...selectedPairs]);
      const matches = [];
      let totalScore = 0;

      for (let c = 0; c < numCourts; c++) {
        if (pool.length < 2) break;
        const p1 = pool.shift();

        let bestPairScore = Infinity;
        const candidates = [];

        for (let j = 0; j < pool.length; j++) {
          const p2 = pool[j];
          const pairScore = scoreFixedPairCourtMatch(p1, p2, matchupCount, opposeCount, lastMu);
          if (pairScore < bestPairScore) {
            bestPairScore = pairScore;
            candidates.length = 0;
            candidates.push(j);
          } else if (pairScore === bestPairScore) {
            candidates.push(j);
          }
        }

        if (!candidates.length) break;
        const bestJ = candidates[Math.floor(Math.random() * candidates.length)];
        const p2 = pool.splice(bestJ, 1)[0];
        totalScore += bestPairScore;
        matches.push({
          court: c + 1,
          team1: [p1.m, p1.f],
          team2: [p2.m, p2.f],
          score1: '',
          score2: ''
        });
      }

      if (matches.length !== numCourts) continue;
      if (!best || totalScore < best.totalScore) {
        best = { totalScore, matches };
      } else if (totalScore === best.totalScore && Math.random() < 0.35) {
        best = { totalScore, matches };
      }
    }

    return best?.matches || [];
  };

  /* ---------- Mexicano scoring (team-split selection) ---------- */
  const MEXICANO_CLASSIC_SPLIT_BIAS = 38;
  const MEX_W_OPPONENT = 10000;
  const MEX_W_OPPONENT_REPEAT2 = 50000;
  const MEX_B_NEW_OPPONENT = 2000;
  const MEX_W_MEETING = 300;

  const scoreMexOpponentPairs = (pairA, pairB, opposeCount) => {
    let s = 0;
    forEachMexOpponentPair(pairA, pairB, (a, b) => {
      const c = opposeCount.get(pairKey(a, b)) || 0;
      s += c * MEX_W_OPPONENT;
      if (c >= 2) s += MEX_W_OPPONENT_REPEAT2;
      if (c === 0) s -= MEX_B_NEW_OPPONENT;
    });
    return s;
  };

  const scoreMexMeetingPairs = (pairA, pairB, partnerCount, opposeCount) => {
    let s = 0;
    forEachMexOpponentPair(pairA, pairB, (a, b) => {
      const meetings =
        (partnerCount.get(pairKey(a, b)) || 0) +
        (opposeCount.get(pairKey(a, b)) || 0);
      if (meetings > 0) s += meetings * MEX_W_MEETING;
    });
    return s;
  };

  const mexSplitOpponentLexMetrics = (pairA, pairB, history) => {
    const { partnerCount, opposeCount } = history;
    let wouldBecome3x = 0;
    let wouldBecome2x = 0;
    let newOpponentPairs = 0;
    let meetingRepeatCount = 0;
    let sumOpponentCount = 0;
    let maxOpponentCount = 0;
    forEachMexOpponentPair(pairA, pairB, (a, b) => {
      const oc = opposeCount.get(pairKey(a, b)) || 0;
      sumOpponentCount += oc;
      if (oc > maxOpponentCount) maxOpponentCount = oc;
      if (oc >= 2) wouldBecome3x++;
      if (oc >= 1) wouldBecome2x++;
      if (oc === 0) newOpponentPairs++;
      const meetings = (partnerCount.get(pairKey(a, b)) || 0) + oc;
      if (meetings > 0) meetingRepeatCount++;
    });
    return {
      wouldBecome3x,
      wouldBecome2x,
      sumOpponentCount,
      maxOpponentCount,
      newOpponentPairs,
      meetingRepeatCount
    };
  };

  const scoreMexicanoTwoTeams = (team1, team2, history, lastRoundPartnerSet, resolve, levelByName) => {
    const { partnerCount, opposeCount, matchupCount } = history;
    const a1 = resolve(team1[0]);
    const a2 = resolve(team1[1]);
    const b1 = resolve(team2[0]);
    const b2 = resolve(team2[1]);
    const pairA = { m: a1, f: a2 };
    const pairB = { m: b1, f: b2 };
    let s = 0;
    s += (partnerCount.get(pairKey(a1, a2)) || 0) * 50;
    s += (partnerCount.get(pairKey(b1, b2)) || 0) * 50;
    s += (lastRoundPartnerSet.has(pairKey(a1, a2)) ? 80000 : 0);
    s += (lastRoundPartnerSet.has(pairKey(b1, b2)) ? 80000 : 0);
    s += scoreMexOpponentPairs(pairA, pairB, opposeCount);
    s += scoreMexMeetingPairs(pairA, pairB, partnerCount, opposeCount);
    s += (matchupCount.get(matchupKey(pairA, pairB)) || 0) * 200;
    if (levelByName && levelByName.size) {
      const sum = (x, y) =>
        getLevelForPairing(levelByName, resolve, x) +
        getLevelForPairing(levelByName, resolve, y);
      s += POWER_LEVEL_MATCH_BETA * Math.abs(sum(a1, a2) - sum(b1, b2));
    }
    return s;
  };

  const pickBestMexicanoQuadSplit = (quadNames, history, lastRoundPartnerSet, resolve, levelByName) => {
    const [a, b, c, d] = quadNames;
    const splits = [
      { classic: true, t1: [a, b], t2: [c, d] },
      { classic: false, t1: [a, c], t2: [b, d] },
      { classic: false, t1: [a, d], t2: [b, c] }
    ];
    let best = null;
    let bestLex = null;
    for (const sp of splits) {
      let sc = scoreMexicanoTwoTeams(sp.t1, sp.t2, history, lastRoundPartnerSet, resolve, levelByName);
      if (!sp.classic) sc += MEXICANO_CLASSIC_SPLIT_BIAS;
      const pairA = {
        m: resolve(sp.t1[0]),
        f: resolve(sp.t1[1])
      };
      const pairB = {
        m: resolve(sp.t2[0]),
        f: resolve(sp.t2[1])
      };
      const metrics = mexSplitOpponentLexMetrics(pairA, pairB, history);
      const tuple = [
        metrics.wouldBecome3x,
        metrics.wouldBecome2x,
        metrics.sumOpponentCount,
        metrics.maxOpponentCount,
        -metrics.newOpponentPairs,
        metrics.meetingRepeatCount,
        sc
      ];
      if (!bestLex || lexLess(tuple, bestLex)) {
        bestLex = tuple;
        best = { sc, t1: sp.t1, t2: sp.t2 };
      }
    }
    return { team1: best.t1, team2: best.t2 };
  };

  /* ---------- Normal Mexicano match scoring (isolated from Mix Mexicano) ---------- */
  const NM_W_EXACT_MATCH = 100000;
  const NM_W_CONSECUTIVE_EXACT = 500000;
  const NM_W_GROUP = 50000;
  const NM_W_PARTNER = 20000;
  const NM_W_PARTNER_REPEAT2 = 100000;
  const NM_W_MEETING = 3000;
  const NM_B_NEW_MEETING = 1000;
  const NM_W_FAIRNESS_HARD = 1000000;
  const NORMAL_MEX_CLASSIC_SPLIT_BIAS = 38;

  const buildMexicanoHistory = (rounds) => {
    const base = buildMixHistory(rounds);
    const groupCount = new Map();
    (Array.isArray(rounds) ? rounds : []).forEach((r) => {
      (r.matches || []).forEach((m) => {
        const t1 = m.team1 || [];
        const t2 = m.team2 || [];
        if (t1.length === 2 && t2.length === 2) {
          const gk = groupKeyOf4(t1[0], t1[1], t2[0], t2[1]);
          groupCount.set(gk, (groupCount.get(gk) || 0) + 1);
        }
      });
    });
    return { ...base, groupCount };
  };

  const getLastRoundMatchupSet = (lastRound, resolve) => {
    const out = new Set();
    if (!lastRound) return out;
    (lastRound.matches || []).forEach((m) => {
      const t1 = m.team1 || [];
      const t2 = m.team2 || [];
      if (t1.length === 2 && t2.length === 2) {
        out.add(matchupKey(
          { m: resolve(t1[0]), f: resolve(t1[1]) },
          { m: resolve(t2[0]), f: resolve(t2[1]) }
        ));
      }
    });
    return out;
  };

  const scoreNormalMexicanoMatch = (
    team1,
    team2,
    history,
    lastRoundPartnerSet,
    lastRoundMatchupSet,
    resolve,
    levelByName
  ) => {
    const { partnerCount, opposeCount, matchupCount, groupCount } = history;
    const a1 = resolve(team1[0]);
    const a2 = resolve(team1[1]);
    const b1 = resolve(team2[0]);
    const b2 = resolve(team2[1]);
    const pairA = { m: a1, f: a2 };
    const pairB = { m: b1, f: b2 };
    const mk = matchupKey(pairA, pairB);
    const gk = groupKeyOf4(a1, a2, b1, b2);
    let s = 0;
    const pA = partnerCount.get(pairKey(a1, a2)) || 0;
    const pB = partnerCount.get(pairKey(b1, b2)) || 0;
    s += pA * NM_W_PARTNER + (pA >= 2 ? NM_W_PARTNER_REPEAT2 : 0);
    s += pB * NM_W_PARTNER + (pB >= 2 ? NM_W_PARTNER_REPEAT2 : 0);
    s += (lastRoundPartnerSet.has(pairKey(a1, a2)) ? 80000 : 0);
    s += (lastRoundPartnerSet.has(pairKey(b1, b2)) ? 80000 : 0);
    s += scoreMexOpponentPairs(pairA, pairB, opposeCount);
    const all4 = [a1, a2, b1, b2];
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const meetings =
          (partnerCount.get(pairKey(all4[i], all4[j])) || 0) +
          (opposeCount.get(pairKey(all4[i], all4[j])) || 0);
        if (meetings > 0) s += meetings * NM_W_MEETING;
        else s -= NM_B_NEW_MEETING;
      }
    }
    const exactCount = matchupCount.get(mk) || 0;
    s += exactCount * NM_W_EXACT_MATCH;
    if (lastRoundMatchupSet.has(mk)) s += NM_W_CONSECUTIVE_EXACT;
    s += (groupCount.get(gk) || 0) * NM_W_GROUP;
    if (levelByName && levelByName.size) {
      const sum = (x, y) =>
        getLevelForPairing(levelByName, resolve, x) +
        getLevelForPairing(levelByName, resolve, y);
      s += POWER_LEVEL_MATCH_BETA * Math.abs(sum(a1, a2) - sum(b1, b2));
    }
    return s;
  };

  const mexNormalSplitLexMetrics = (team1, team2, history, lastRoundMatchupSet, resolve) => {
    const { partnerCount, opposeCount, matchupCount, groupCount } = history;
    const a1 = resolve(team1[0]);
    const a2 = resolve(team1[1]);
    const b1 = resolve(team2[0]);
    const b2 = resolve(team2[1]);
    const pairA = { m: a1, f: a2 };
    const pairB = { m: b1, f: b2 };
    const mk = matchupKey(pairA, pairB);
    const gk = groupKeyOf4(a1, a2, b1, b2);
    const exactCount = matchupCount.get(mk) || 0;
    const wouldExactRepeat = exactCount > 0 ? 1 : 0;
    const wouldConsecutiveExact = lastRoundMatchupSet.has(mk) ? 1 : 0;
    const wouldGroup3x = (groupCount.get(gk) || 0) >= 2 ? 1 : 0;
    const pRep =
      ((partnerCount.get(pairKey(a1, a2)) || 0) >= 2 ? 1 : 0) +
      ((partnerCount.get(pairKey(b1, b2)) || 0) >= 2 ? 1 : 0);
    const opp = mexSplitOpponentLexMetrics(pairA, pairB, history);
    return {
      wouldExactRepeat,
      wouldConsecutiveExact,
      wouldGroup3x,
      partnerWould3x: pRep,
      ...opp
    };
  };

  const pickBestNormalMexicanoQuadSplit = (
    quadNames,
    history,
    lastRoundPartnerSet,
    lastRoundMatchupSet,
    resolve,
    levelByName,
    opts = {}
  ) => {
    const random = opts.random || Math.random;
    const avoidPartners = opts.avoidPartners || null;
    const [a, b, c, d] = quadNames;
    const splits = [
      { classic: true, t1: [a, b], t2: [c, d] },
      { classic: false, t1: [a, c], t2: [b, d] },
      { classic: false, t1: [a, d], t2: [b, c] }
    ];
    let bestLex = null;
    const winners = [];
    for (const sp of splits) {
      let sc = scoreNormalMexicanoMatch(
        sp.t1, sp.t2, history, lastRoundPartnerSet, lastRoundMatchupSet, resolve, levelByName
      );
      if (!sp.classic) sc += NORMAL_MEX_CLASSIC_SPLIT_BIAS;
      const m = mexNormalSplitLexMetrics(
        sp.t1, sp.t2, history, lastRoundMatchupSet, resolve
      );
      const avoidHit = countAvoidPartnerHits(sp.t1, sp.t2, resolve, avoidPartners);
      const tuple = [
        avoidHit,
        m.wouldConsecutiveExact,
        m.wouldExactRepeat,
        m.wouldGroup3x,
        m.partnerWould3x,
        m.wouldBecome3x,
        m.wouldBecome2x,
        m.sumOpponentCount,
        -m.newOpponentPairs,
        sc
      ];
      if (!bestLex || mexLexLess(tuple, bestLex)) {
        bestLex = tuple;
        winners.length = 0;
        winners.push({ sc, t1: sp.t1, t2: sp.t2 });
      } else if (mexLexEqual(tuple, bestLex)) {
        winners.push({ sc, t1: sp.t1, t2: sp.t2 });
      }
    }
    const best = winners[Math.floor(random() * winners.length)] || winners[0];
    return { team1: best.t1, team2: best.t2, score: best.sc };
  };

  const buildNormalMexicanoRoundFromActive = (
    players,
    active,
    usedCourts,
    rounds,
    roundNo,
    tournament,
    playersFull,
    opts = {}
  ) => {
    const rn = Number(roundNo) || 1;
    const tSub = {
      ...tournament,
      rounds: JSON.stringify(
        safeJsonParse(tournament?.rounds, []).filter((r) => Number(r.round) < rn)
      )
    };
    const history = buildMexicanoHistory(rounds);
    const prevRound = getPreviousRoundDatum(rounds, roundNo);
    const resolve = makeRosterNameResolve(players);
    const lastRoundPartnerSet = getLastRoundPartnerSet(prevRound, resolve);
    const lastRoundMatchupSet = getLastRoundMatchupSet(prevRound, resolve);
    const levelByName = makeLevelByNameMap(playersFull || []);

    const board = computeLeaderboardSorted(tSub, 'points', { applyMatchCompensation: false });
    const standingsOrder = board.map((row) => row.name);

    let ordered = [];
    if (rn === 1) {
      const act = new Set(active);
      ordered = players.filter((n) => act.has(n));
    } else {
      ordered = orderActiveByStandings(active, standingsOrder, players);
    }

    const matches = [];
    let roundScore = 0;
    for (let c = 0; c < usedCourts; c++) {
      const quad = ordered.slice(c * 4, c * 4 + 4);
      if (quad.length < 4) break;
      const split = pickBestNormalMexicanoQuadSplit(
        quad, history, lastRoundPartnerSet, lastRoundMatchupSet, resolve, levelByName, opts
      );
      roundScore += split.score || 0;
      matches.push({
        court: c + 1,
        team1: split.team1,
        team2: split.team2,
        score1: '',
        score2: ''
      });
    }
    return { matches, roundScore };
  };

  /* ---------- Fixed Mexicano: dynamic capacity & fairness (fixed partners) ---------- */
  const FXM_W_FAIRNESS_HARD = 1000000;

  const computeFixedMexicanoRoundCapacity = (pairCount, courts) => {
    const pairs = Math.max(0, Math.floor(Number(pairCount) || 0));
    const c = Math.max(0, Math.floor(Number(courts) || 0));
    const maxPairsPerRound = c * 2;
    const rawPlaying = Math.min(pairs, maxPairsPerRound);
    const playingPairsPerRound = Math.floor(rawPlaying / 2) * 2;
    const usedCourtsPerRound = playingPairsPerRound / 2;
    const byePairsPerRound = pairs - playingPairsPerRound;
    return {
      playingPairsPerRound,
      byePairsPerRound,
      usedCourtsPerRound,
      playingPlayersPerRound: playingPairsPerRound * 2,
      byePlayersPerRound: byePairsPerRound * 2,
      maxPairsPerRound
    };
  };

  const computeFixedMexicanoSessionTargets = (pairCount, courts, roundCount) =>
    computeMexicanoSessionTargets(
      Math.max(0, Math.floor(Number(pairCount) || 0)) * 2,
      courts,
      roundCount
    );

  const tallyFixedMexicanoPairStats = (allPairs, allRounds, roundNo, tKey, resolve) => {
    const priorRounds = getPriorRoundsCompleted(allRounds, roundNo);
    const lastRound = getPreviousRoundDatum(allRounds, roundNo);
    const gamesPlayed = new Map();
    const byeCount = new Map();
    allPairs.forEach((p) => {
      const k = tKey(p);
      gamesPlayed.set(k, 0);
      byeCount.set(k, 0);
    });
    priorRounds.forEach((r) => {
      const onCourt = new Set();
      (r.matches || []).forEach((m) => {
        for (const team of [m.team1, m.team2]) {
          if (team && team.length === 2) {
            const k2 = pairKey(resolve(team[0]), resolve(team[1]));
            if (gamesPlayed.has(k2)) {
              gamesPlayed.set(k2, (gamesPlayed.get(k2) || 0) + 1);
              onCourt.add(k2);
            }
          }
        }
      });
      allPairs.forEach((p) => {
        const k = tKey(p);
        if (!onCourt.has(k)) byeCount.set(k, (byeCount.get(k) || 0) + 1);
      });
    });
    const playedLastRound = new Set();
    if (lastRound) {
      (lastRound.matches || []).forEach((m) => {
        for (const team of [m.team1, m.team2]) {
          if (team && team.length === 2) {
            playedLastRound.add(pairKey(resolve(team[0]), resolve(team[1])));
          }
        }
      });
    }
    const mustPlay = lastRound
      ? allPairs.filter((p) => !playedLastRound.has(tKey(p)))
      : [];
    return { gamesPlayed, byeCount, mustPlay, lastRound, priorRounds };
  };

  const projectFixedMexicanoFairnessAfterRound = (allPairs, gamesPlayed, byeCount, activePairs, tKey) => {
    const activeKeys = new Set(activePairs.map(tKey));
    const gamesAfter = [];
    const byesAfter = [];
    for (const p of allPairs) {
      const k = tKey(p);
      const on = activeKeys.has(k);
      const g = (gamesPlayed.get(k) || 0) + (on ? 1 : 0);
      const b = (byeCount.get(k) || 0) + (on ? 0 : 1);
      gamesAfter.push(g, g);
      byesAfter.push(b, b);
    }
    const gamesDiff = gamesAfter.length ? Math.max(...gamesAfter) - Math.min(...gamesAfter) : 0;
    const byeDiff = byesAfter.length ? Math.max(...byesAfter) - Math.min(...byesAfter) : 0;
    return { gamesDiff, byeDiff, gamesAfter, byesAfter };
  };

  const enumerateFixedMexicanoFairActiveSets = (
    allPairs,
    courts,
    allRounds,
    roundNo,
    tKey,
    resolve,
    maxCandidates = 16
  ) => {
    const arr = Array.isArray(allPairs) ? allPairs : [];
    const cap = computeFixedMexicanoRoundCapacity(arr.length, courts);
    const want = cap.playingPairsPerRound;
    if (want <= 0) return [[]];
    if (want >= arr.length) return [arr.slice()];

    const { gamesPlayed, byeCount, mustPlay, lastRound } =
      tallyFixedMexicanoPairStats(arr, allRounds, roundNo, tKey, resolve);
    const pos = new Map(arr.map((p, i) => [tKey(p), i]));

    if (!lastRound) {
      const pool = [...arr];
      const capN = Math.max(1, Math.floor(Number(maxCandidates) || 1));
      const combos = [];
      const combo = [];
      const dfs = (start) => {
        if (combos.length >= capN) return;
        if (combo.length === want) {
          combos.push([...combo]);
          return;
        }
        for (let k = start; k < pool.length; k++) {
          if (pool.length - k < want - combo.length) break;
          combo.push(pool[k]);
          dfs(k + 1);
          combo.pop();
          if (combos.length >= capN) return;
        }
      };
      dfs(0);
      if (combos.length === 0) combos.push(pool.slice(0, want));
      return combos;
    }

    let forced = [];
    if (mustPlay.length > want) {
      const sortedMust = [...mustPlay].sort((a, b) =>
        (gamesPlayed.get(tKey(a)) || 0) - (gamesPlayed.get(tKey(b)) || 0) ||
        (byeCount.get(tKey(b)) || 0) - (byeCount.get(tKey(a)) || 0) ||
        (pos.get(tKey(a)) ?? 0) - (pos.get(tKey(b)) ?? 0)
      );
      return [sortedMust.slice(0, want)];
    }
    forced = mustPlay.slice();
    const forcedSet = new Set(forced.map(tKey));
    const remaining = want - forced.length;
    const pool = arr.filter((p) => !forcedSet.has(tKey(p)));

    const keyed = pool.map((p) => ({
      pair: p,
      games: gamesPlayed.get(tKey(p)) || 0,
      byes: byeCount.get(tKey(p)) || 0,
      idx: pos.get(tKey(p))
    }));
    keyed.sort((a, b) =>
      a.games - b.games ||
      a.byes - b.byes ||
      a.idx - b.idx
    );

    if (remaining >= pool.length) {
      return [[...forced, ...pool]];
    }

    const capN = Math.max(1, Math.floor(Number(maxCandidates) || 1));
    const combos = [];
    const combo = [];
    const dfs = (start) => {
      if (combos.length >= capN) return;
      if (combo.length === remaining) {
        combos.push([...forced, ...combo]);
        return;
      }
      for (let k = start; k < keyed.length; k++) {
        if (keyed.length - k < remaining - combo.length) break;
        combo.push(keyed[k].pair);
        dfs(k + 1);
        combo.pop();
        if (combos.length >= capN) return;
      }
    };
    dfs(0);
    if (combos.length === 0) {
      combos.push([...forced, ...keyed.slice(0, remaining).map((x) => x.pair)]);
    }
    return combos;
  };

  /** Fixed Mexicano matchup score (no within-team partner penalty; partners stay fixed). */
  const scoreFixedMexicanoPairMatch = (
    p1,
    p2,
    history,
    lastRoundMatchupSet,
    resolve,
    levelByName
  ) => {
    const { opposeCount, matchupCount, groupCount } = history;
    const a1 = resolve(p1.m);
    const a2 = resolve(p1.f);
    const b1 = resolve(p2.m);
    const b2 = resolve(p2.f);
    const pairA = { m: a1, f: a2 };
    const pairB = { m: b1, f: b2 };
    const mk = matchupKey(pairA, pairB);
    const gk = groupKeyOf4(a1, a2, b1, b2);
    let s = 0;
    s += scoreMexOpponentPairs(pairA, pairB, opposeCount);
    const cross = [
      [a1, b1], [a1, b2], [a2, b1], [a2, b2]
    ];
    for (const [x, y] of cross) {
      const meetings =
        (history.partnerCount.get(pairKey(x, y)) || 0) +
        (opposeCount.get(pairKey(x, y)) || 0);
      if (meetings > 0) s += meetings * NM_W_MEETING;
      else s -= NM_B_NEW_MEETING;
    }
    const exactCount = matchupCount.get(mk) || 0;
    s += exactCount * NM_W_EXACT_MATCH;
    if (lastRoundMatchupSet.has(mk)) s += NM_W_CONSECUTIVE_EXACT;
    s += (groupCount.get(gk) || 0) * NM_W_GROUP;
    if (levelByName && levelByName.size) {
      const sum = (x, y) =>
        getLevelForPairing(levelByName, resolve, x) +
        getLevelForPairing(levelByName, resolve, y);
      s += POWER_LEVEL_MATCH_BETA * Math.abs(sum(a1, a2) - sum(b1, b2));
    }
    return s;
  };

  const buildBestFixedMexicanoMatches = (
    selectedPairs,
    history,
    lastRoundMatchupSet,
    resolve,
    levelByName
  ) => {
    const k = selectedPairs.length;
    if (k < 2 || k % 2 !== 0) return { matches: [], roundScore: 0 };
    const numCourts = k / 2;

    const scorePlan = (plan) => {
      let total = 0;
      for (const [p1, p2] of plan) {
        total += scoreFixedMexicanoPairMatch(
          p1, p2, history, lastRoundMatchupSet, resolve, levelByName
        );
      }
      return total;
    };

    if (k <= 12) {
      const all = [];
      enumerateFixedPairMatchings([...selectedPairs], all);
      let bestScore = Infinity;
      let bestPlan = null;
      for (const plan of all) {
        if (plan.length !== numCourts) continue;
        const sc = scorePlan(plan);
        if (sc < bestScore) {
          bestScore = sc;
          bestPlan = plan;
        }
      }
      if (bestPlan) {
        return {
          matches: fixedPairMatchingsToCourts(bestPlan),
          roundScore: bestScore
        };
      }
    }

    const lastMu = lastRoundMatchupSet || new Set();
    const greedy = buildBestFixedPairMatches(
      selectedPairs,
      history,
      lastMu
    );
    let roundScore = 0;
    if (greedy.length === numCourts) {
      for (const m of greedy) {
        const p1 = { m: m.team1[0], f: m.team1[1] };
        const p2 = { m: m.team2[0], f: m.team2[1] };
        roundScore += scoreFixedMexicanoPairMatch(
          p1, p2, history, lastRoundMatchupSet, resolve, levelByName
        );
      }
    }
    return { matches: greedy, roundScore };
  };

  const buildFixedMexicanoRoundFromActive = (
    allPairObjs,
    activePairs,
    usedCourts,
    allRounds,
    roundNo,
    tournament,
    playersFull
  ) => {
    const flatNames = allPairObjs.flatMap((p) => [p.m, p.f]);
    const resolve = makeRosterNameResolve(flatNames);
    const tKey = (p) => pairKey(resolve(p.m), resolve(p.f));
    const keyToIdx = new Map();
    allPairObjs.forEach((p, i) => { keyToIdx.set(tKey(p), i); });

    const rn = Number(roundNo) || 1;
    const tSub = {
      ...tournament,
      rounds: JSON.stringify(
        safeJsonParse(tournament?.rounds, []).filter((r) => Number(r.round) < rn)
      )
    };
    const history = buildMexicanoHistory(allRounds);
    const prevRound = getPreviousRoundDatum(allRounds, roundNo);
    const lastRoundMatchupSet = getLastRoundMatchupSet(prevRound, resolve);
    const levelByName = makeLevelByNameMap(playersFull || []);

    const board = computeLeaderboardSorted(tSub, 'points', { applyMatchCompensation: false });
    const pt = new Map(board.map((r) => [r.name, r.points]));
    const teamPts = (p) => (pt.get(resolve(p.m)) || 0) + (pt.get(resolve(p.f)) || 0);
    const rankByKey = new Map();
    [...activePairs]
      .sort((a, b) => {
        const d = teamPts(b) - teamPts(a);
        if (d !== 0) return d;
        return (keyToIdx.get(tKey(a)) ?? 0) - (keyToIdx.get(tKey(b)) ?? 0);
      })
      .forEach((p, i) => rankByKey.set(tKey(p), i));

    let ordered;
    if (rn === 1) {
      ordered = [...activePairs].sort(
        (a, b) => (keyToIdx.get(tKey(a)) ?? 0) - (keyToIdx.get(tKey(b)) ?? 0)
      );
    } else {
      ordered = orderPairsByTeamPoints(activePairs, rankByKey, tKey);
    }

    if (ordered.length < 2) return { matches: [], roundScore: 0 };
    const matches = buildFixedPairsMexicanoCourtMatches(ordered);
    let roundScore = 0;
    for (let c = 0; c < matches.length; c++) {
      const m = matches[c];
      roundScore += scoreFixedMexicanoPairMatch(
        { m: m.team1[0], f: m.team1[1] },
        { m: m.team2[0], f: m.team2[1] },
        history,
        lastRoundMatchupSet,
        resolve,
        levelByName
      );
    }
    return { matches, roundScore };
  };

  /* ---------- round builders ---------- */
  const buildFixedPairsMexicanoMatches = (allPairObjs, courts, allRounds, roundNo, tournament, playersFull) => {
    const cap = computeFixedMexicanoRoundCapacity(allPairObjs.length, courts);
    if (cap.usedCourtsPerRound <= 0) return [];

    const flatNames = allPairObjs.flatMap((p) => [p.m, p.f]);
    const resolve = makeRosterNameResolve(flatNames);
    const tKey = (p) => pairKey(resolve(p.m), resolve(p.f));

    const candidates = enumerateFixedMexicanoFairActiveSets(
      allPairObjs, courts, allRounds, roundNo, tKey, resolve, 16
    );
    const { gamesPlayed, byeCount } = tallyFixedMexicanoPairStats(
      allPairObjs, allRounds, roundNo, tKey, resolve
    );
    const targets = computeFixedMexicanoSessionTargets(
      allPairObjs.length,
      courts,
      Math.max(roundNo, getPriorRoundsCompleted(allRounds, roundNo).length + 1)
    );
    const idealGamesInt = Number.isInteger(targets.idealGamesPerPlayer);
    const idealByesInt = Number.isInteger(targets.idealByesPerPlayer);

    let bestMatches = null;
    let bestTuple = null;
    for (const active of candidates) {
      if (active.length !== cap.playingPairsPerRound) continue;
      const { matches, roundScore } = buildFixedMexicanoRoundFromActive(
        allPairObjs,
        active,
        cap.usedCourtsPerRound,
        allRounds,
        roundNo,
        tournament,
        playersFull
      );
      if (!matches.length) continue;

      const proj = projectFixedMexicanoFairnessAfterRound(
        allPairObjs, gamesPlayed, byeCount, active, tKey
      );
      let fairnessPenalty = 0;
      if (proj.gamesDiff > 1 || proj.byeDiff > 1) fairnessPenalty += FXM_W_FAIRNESS_HARD;
      let exactPenalty = 0;
      if (idealGamesInt) {
        exactPenalty += proj.gamesAfter.reduce(
          (s, g) => s + Math.abs(g - targets.idealGamesPerPlayer), 0
        );
      }
      if (idealByesInt) {
        exactPenalty += proj.byesAfter.reduce(
          (s, b) => s + Math.abs(b - targets.idealByesPerPlayer), 0
        );
      }
      const tuple = [fairnessPenalty, proj.gamesDiff, proj.byeDiff, exactPenalty, roundScore];
      if (!bestTuple || mexLexLess(tuple, bestTuple)) {
        bestTuple = tuple;
        bestMatches = matches;
      }
    }
    return bestMatches || [];
  };

  /**
   * Mexicano: R1 by roster order; R2+ winners move up toward court 1.
   * @param {string[]} players - name strings
   * @param {number}   courts
   * @param {Array}    rounds  - already parsed round objects
   * @param {number}   roundNo
   * @param {object}   tournament
   * @param {Array}    [playersFull] - [{name,level,...}] for Balanced mode level display
   */
  function buildMexicanoMatches(players, courts, rounds, roundNo, tournament, playersFull, opts = {}) {
    const cap = computeMexicanoRoundCapacity(players.length, courts);
    if (cap.usedCourtsPerRound <= 0) return [];

    const random = opts.random || Math.random;
    const resolve = makeRosterNameResolve(players);
    const candidates = enumerateNormalMexicanoFairActiveSets(
      players, courts, rounds, roundNo, 16
    );
    const { gamesPlayed, byeCount } = tallyMexicanoPlayerStats(players, rounds, roundNo);
    const targets = computeMexicanoSessionTargets(
      players.length,
      courts,
      Math.max(roundNo, getPriorRoundsCompleted(rounds, roundNo).length + 1)
    );
    const idealGamesInt = Number.isInteger(targets.idealGamesPerPlayer);
    const idealByesInt = Number.isInteger(targets.idealByesPerPlayer);
    const avoidActiveKey = opts.avoidActiveKey || '';

    let bestTuple = null;
    const winners = [];
    for (const active of candidates) {
      const { matches, roundScore } = buildNormalMexicanoRoundFromActive(
        players,
        active,
        cap.usedCourtsPerRound,
        rounds,
        roundNo,
        tournament,
        playersFull,
        opts
      );
      const proj = projectMexicanoFairnessAfterRound(players, gamesPlayed, byeCount, active);
      let fairnessPenalty = 0;
      if (proj.gamesDiff > 1 || proj.byeDiff > 1) fairnessPenalty += NM_W_FAIRNESS_HARD;
      let exactPenalty = 0;
      if (idealGamesInt) {
        exactPenalty += proj.gamesAfter.reduce(
          (s, g) => s + Math.abs(g - targets.idealGamesPerPlayer), 0
        );
      }
      if (idealByesInt) {
        exactPenalty += proj.byesAfter.reduce(
          (s, b) => s + Math.abs(b - targets.idealByesPerPlayer), 0
        );
      }
      const avoidActiveHit =
        avoidActiveKey && activeSetKey(active, resolve) === avoidActiveKey ? 1 : 0;
      const tuple = [
        fairnessPenalty,
        proj.gamesDiff,
        proj.byeDiff,
        exactPenalty,
        avoidActiveHit,
        roundScore
      ];
      if (!bestTuple || mexLexLess(tuple, bestTuple)) {
        bestTuple = tuple;
        winners.length = 0;
        winners.push(matches);
      } else if (mexLexEqual(tuple, bestTuple)) {
        winners.push(matches);
      }
    }
    if (winners.length === 0) return [];
    return winners[Math.floor(random() * winners.length)] || winners[0];
  }

  /**
   * Fairness report for a completed Mexicano session (read-only; tests / debug).
   */
  const buildMexicanoFairnessReport = (rosterNames, allRounds, courts, roundCount) => {
    const names = Array.isArray(rosterNames) ? rosterNames : [];
    const rounds = Array.isArray(allRounds) ? allRounds : [];
    const history = buildMexicanoHistory(rounds);
    const cap = computeMexicanoRoundCapacity(names.length, courts);
    const roundsCnt = roundCount != null ? Math.floor(Number(roundCount) || 0) : rounds.length;
    const targets = computeMexicanoSessionTargets(names.length, courts, roundsCnt);

    const gamesByPlayer = Object.fromEntries(names.map((n) => [n, 0]));
    const byesByPlayer = Object.fromEntries(names.map((n) => [n, 0]));
    rounds.forEach((r) => {
      (r.matches || []).forEach((m) => {
        [...(m.team1 || []), ...(m.team2 || [])].forEach((n) => {
          if (n in gamesByPlayer) gamesByPlayer[n]++;
        });
      });
    });
    names.forEach((n) => {
      byesByPlayer[n] = rounds.length - gamesByPlayer[n];
    });

    let repeatedPartnerPairCount = 0;
    let totalPartnerRepeats = 0;
    history.partnerCount.forEach((c) => {
      if (c > 1) {
        repeatedPartnerPairCount++;
        totalPartnerRepeats += c - 1;
      }
    });

    let repeatedOpponentPairCount = 0;
    let totalOpponentRepeats = 0;
    let opponentPairsRepeated3x = 0;
    const repeatedOpponentPairsDetail = [];
    history.opposeCount.forEach((c, k) => {
      if (c >= 3) opponentPairsRepeated3x++;
      if (c > 1) {
        repeatedOpponentPairCount++;
        totalOpponentRepeats += c - 1;
        const sep = k.indexOf('__');
        repeatedOpponentPairsDetail.push({
          playerA: sep >= 0 ? k.slice(0, sep) : k,
          playerB: sep >= 0 ? k.slice(sep + 2) : '',
          count: c
        });
      }
    });
    repeatedOpponentPairsDetail.sort((x, y) =>
      (y.count - x.count) || x.playerA.localeCompare(y.playerA) || x.playerB.localeCompare(y.playerB)
    );

    let repeatedExactMatches = 0;
    let repeatedMatchGroups = 0;
    const repeatedExactMatchesDetail = [];
    history.matchupCount.forEach((c, k) => {
      if (c > 1) {
        repeatedExactMatches += c - 1;
        repeatedExactMatchesDetail.push({ key: k, count: c });
      }
    });
    history.groupCount.forEach((c) => {
      if (c > 1) repeatedMatchGroups += c - 1;
    });
    repeatedExactMatchesDetail.sort((x, y) =>
      (y.count - x.count) || String(x.key).localeCompare(String(y.key))
    );

    const uniqueOpponentsByPlayer = Object.fromEntries(names.map((n) => [n, new Set()]));
    const uniqueMeetingsByPlayer = Object.fromEntries(names.map((n) => [n, new Set()]));
    rounds.forEach((r) => {
      (r.matches || []).forEach((m) => {
        const t1 = m.team1 || [];
        const t2 = m.team2 || [];
        if (t1.length === 2) {
          uniqueMeetingsByPlayer[t1[0]]?.add(t1[1]);
          uniqueMeetingsByPlayer[t1[1]]?.add(t1[0]);
        }
        if (t2.length === 2) {
          uniqueMeetingsByPlayer[t2[0]]?.add(t2[1]);
          uniqueMeetingsByPlayer[t2[1]]?.add(t2[0]);
        }
        t1.forEach((a) => {
          t2.forEach((b) => {
            uniqueOpponentsByPlayer[a]?.add(b);
            uniqueOpponentsByPlayer[b]?.add(a);
            uniqueMeetingsByPlayer[a]?.add(b);
            uniqueMeetingsByPlayer[b]?.add(a);
          });
        });
      });
    });

    const oppCounts = names.map((n) => (uniqueOpponentsByPlayer[n] || new Set()).size);
    const meetCounts = names.map((n) => (uniqueMeetingsByPlayer[n] || new Set()).size);
    const minimumUniqueOpponentCount = oppCounts.length ? Math.min(...oppCounts) : 0;
    const averageUniqueOpponentCount = oppCounts.length
      ? oppCounts.reduce((a, b) => a + b, 0) / oppCounts.length
      : 0;
    const minimumUniqueMeetingCount = meetCounts.length ? Math.min(...meetCounts) : 0;
    const averageUniqueMeetingCount = meetCounts.length
      ? meetCounts.reduce((a, b) => a + b, 0) / meetCounts.length
      : 0;

    const gamesArr = names.map((n) => gamesByPlayer[n]);
    const byesArr = names.map((n) => byesByPlayer[n]);
    const minMax = (arr) => arr.length
      ? { min: Math.min(...arr), max: Math.max(...arr), diff: Math.max(...arr) - Math.min(...arr) }
      : { min: 0, max: 0, diff: 0 };
    const gamesRange = minMax(gamesArr);
    const byesRange = minMax(byesArr);
    const gamesPlayedDifference = gamesRange.diff;
    const byeDifference = byesRange.diff;

    const warnings = [];
    if (!Number.isInteger(targets.idealGamesPerPlayer) || !Number.isInteger(targets.idealByesPerPlayer)) {
      warnings.push('ideal games/byes per player are not integers for this configuration');
    }
    if (gamesPlayedDifference > 1) {
      warnings.push(`games played difference ${gamesPlayedDifference} exceeds 1`);
    }
    if (byeDifference > 1) {
      warnings.push(`bye difference ${byeDifference} exceeds 1`);
    }
    if (Number.isInteger(targets.idealGamesPerPlayer) && gamesRange.max > targets.maxExpectedGames) {
      warnings.push('some players exceeded max expected games');
    }
    if (Number.isInteger(targets.idealByesPerPlayer) && byesRange.max > targets.maxExpectedByes) {
      warnings.push('some players exceeded max expected byes');
    }
    if (opponentPairsRepeated3x > 0) {
      warnings.push(`${opponentPairsRepeated3x} opponent pair(s) repeated 3+ times`);
    }
    if (minimumUniqueOpponentCount < 6 && names.length >= 10) {
      warnings.push(
        `minimum unique opponents ${minimumUniqueOpponentCount} may be low for ${names.length} players`
      );
    }
    if (repeatedExactMatches > 0) {
      warnings.push(`${repeatedExactMatches} exact team-vs-team repeat(s)`);
    }

    return {
      totalPlayers: names.length,
      courts: Math.max(0, Number(courts) || 0),
      rounds: rounds.length,
      roundCount: roundsCnt,
      ...cap,
      ...targets,
      gamesByPlayer,
      byesByPlayer,
      gamesRange,
      byesRange,
      gamesPlayedDifference,
      byeDifference,
      repeatedPartnerPairs: totalPartnerRepeats,
      repeatedPartnerPairCount,
      totalPartnerRepeats,
      repeatedOpponentPairs: totalOpponentRepeats,
      repeatedOpponentPairCount,
      totalOpponentRepeats,
      opponentPairsRepeated3x,
      repeatedOpponentPairsDetail,
      repeatedExactMatches,
      repeatedMatchGroups,
      repeatedExactMatchesDetail,
      uniqueOpponentsByPlayer: Object.fromEntries(
        names.map((n) => [n, (uniqueOpponentsByPlayer[n] || new Set()).size])
      ),
      uniqueMeetingsByPlayer: Object.fromEntries(
        names.map((n) => [n, (uniqueMeetingsByPlayer[n] || new Set()).size])
      ),
      minimumUniqueOpponentCount,
      averageUniqueOpponentCount,
      minimumUniqueMeetingCount,
      averageUniqueMeetingCount,
      warnings
    };
  };

  const rankMexicanoScheduleQuality = (report) => {
    const gamesDiff = report.gamesPlayedDifference ?? report.gamesRange?.diff ?? 0;
    const byeDiff = report.byeDifference ?? report.byesRange?.diff ?? 0;
    let exactTargetPenalty = 0;
    if (Number.isInteger(report.idealGamesPerPlayer)) {
      exactTargetPenalty += Object.values(report.gamesByPlayer || {}).reduce(
        (s, g) => s + Math.abs(g - report.idealGamesPerPlayer), 0
      );
    }
    if (Number.isInteger(report.idealByesPerPlayer)) {
      exactTargetPenalty += Object.values(report.byesByPlayer || {}).reduce(
        (s, b) => s + Math.abs(b - report.idealByesPerPlayer), 0
      );
    }
    return {
      tuple: [
        gamesDiff,
        byeDiff,
        exactTargetPenalty,
        report.repeatedExactMatches || 0,
        report.repeatedMatchGroups || 0,
        report.totalPartnerRepeats || 0,
        report.totalOpponentRepeats || 0,
        -(report.minimumUniqueMeetingCount ?? 0)
      ]
    };
  };

  /**
   * Known-horizon schedule optimizer (tests / debug only; not wired to live UI).
   */
  const buildBestMexicanoCandidateSchedule = (roster, courts, roundCount, opts = {}) => {
    const names = Array.isArray(roster) ? roster.slice() : [];
    const roundsWanted = Math.max(0, Math.floor(Number(roundCount) || 0));
    const courtCount = Math.max(0, Math.floor(Number(courts) || 0));
    const candidateCount = Math.max(
      50,
      Math.floor(Number(opts.candidateCount) || 50)
    );
    const baseSeed = opts.baseSeed != null ? (opts.baseSeed >>> 0) : 1;
    const seedList = Array.isArray(opts.seeds) ? opts.seeds : null;
    const tournamentStub = { rounds: '[]', players: JSON.stringify(names) };

    let bestRounds = null;
    let bestTuple = null;
    let bestSeed = baseSeed;
    let bestQuality = null;

    for (let i = 0; i < candidateCount; i++) {
      const seed = seedList ? (seedList[i] >>> 0) : ((baseSeed + i * 7919) >>> 0);
      const rot = names.length ? seed % names.length : 0;
      const rotated = names.length
        ? [...names.slice(rot), ...names.slice(0, rot)]
        : [];
      const allRounds = [];
      for (let r = 1; r <= roundsWanted; r++) {
        const matches = buildMexicanoMatches(
          rotated, courtCount, allRounds, r, tournamentStub, null
        );
        allRounds.push({ round: r, matches });
      }
      const report = buildMexicanoFairnessReport(rotated, allRounds, courtCount, roundsWanted);
      const quality = rankMexicanoScheduleQuality(report);
      if (!bestTuple || mexLexLess(quality.tuple, bestTuple)) {
        bestTuple = quality.tuple;
        bestRounds = allRounds;
        bestSeed = seed;
        bestQuality = quality;
      }
    }

    const finalReport = buildMexicanoFairnessReport(
      names, bestRounds || [], courtCount, roundsWanted
    );
    return {
      rounds: bestRounds || [],
      report: finalReport,
      seed: bestSeed,
      quality: bestQuality,
      candidatesTried: candidateCount
    };
  };

  /* ---------- Mix Mexicano: dynamic capacity, fairness, scoring (isolated from Normal) ---------- */
  const MM_W_EXACT_MATCH = 100000;
  const MM_W_CONSECUTIVE_EXACT = 500000;
  const MM_W_GROUP = 50000;
  const MM_W_PARTNER = 20000;
  const MM_W_PARTNER_REPEAT2 = 100000;
  const MM_W_MEETING = 3000;
  const MM_B_NEW_MEETING = 1000;
  const MM_W_FAIRNESS_HARD = 1000000;
  const MIX_MEX_PARALLEL_BIAS = 12;

  const computeMixMexicanoRoundCapacity = (maleCount, femaleCount, courts) => {
    const m = Math.max(0, Math.floor(Number(maleCount) || 0));
    const f = Math.max(0, Math.floor(Number(femaleCount) || 0));
    const c = Math.max(0, Math.floor(Number(courts) || 0));
    const effectiveCourtsPerRound = Math.min(c, Math.floor(m / 2), Math.floor(f / 2));
    const playingPerGender = effectiveCourtsPerRound * 2;
    return {
      effectiveCourtsPerRound,
      usedCourtsPerRound: effectiveCourtsPerRound,
      playingPerGender,
      malePlayingPerRound: playingPerGender,
      femalePlayingPerRound: playingPerGender,
      maleByesPerRound: Math.max(0, m - playingPerGender),
      femaleByesPerRound: Math.max(0, f - playingPerGender),
      maxPlayersPerRound: playingPerGender * 2
    };
  };

  const computeMixMexicanoSessionTargets = (maleCount, femaleCount, courts, roundCount) => {
    const cap = computeMixMexicanoRoundCapacity(maleCount, femaleCount, courts);
    const rounds = Math.max(0, Math.floor(Number(roundCount) || 0));
    const m = Math.max(0, Math.floor(Number(maleCount) || 0));
    const f = Math.max(0, Math.floor(Number(femaleCount) || 0));
    const slotsPerGender = rounds * cap.playingPerGender;
    const idealGamesPerMale = m > 0 ? slotsPerGender / m : 0;
    const idealGamesPerFemale = f > 0 ? slotsPerGender / f : 0;
    const idealByesPerMale = m > 0 ? (rounds * cap.maleByesPerRound) / m : 0;
    const idealByesPerFemale = f > 0 ? (rounds * cap.femaleByesPerRound) / f : 0;
    return {
      ...cap,
      roundCount: rounds,
      idealGamesPerMale,
      idealGamesPerFemale,
      idealByesPerMale,
      idealByesPerFemale,
      minExpectedGamesMale: Math.floor(idealGamesPerMale),
      maxExpectedGamesMale: Math.ceil(idealGamesPerMale),
      minExpectedByesMale: Math.floor(idealByesPerMale),
      maxExpectedByesMale: Math.ceil(idealByesPerMale),
      minExpectedGamesFemale: Math.floor(idealGamesPerFemale),
      maxExpectedGamesFemale: Math.ceil(idealGamesPerFemale),
      minExpectedByesFemale: Math.floor(idealByesPerFemale),
      maxExpectedByesFemale: Math.ceil(idealByesPerFemale)
    };
  };

  const enumerateMixMexicanoFairActiveSets = (
    genderPool,
    slotsNeeded,
    allRounds,
    roundNo,
    maxCandidates = 12
  ) =>
    enumerateNormalMexicanoFairActiveSets(
      genderPool, 0, allRounds, roundNo, maxCandidates, slotsNeeded
    );

  const scoreMixMexicanoMatch = (
    team1,
    team2,
    history,
    lastRoundPartnerSet,
    lastRoundMatchupSet,
    resolve,
    levelByName
  ) => {
    const { partnerCount, opposeCount, matchupCount, groupCount } = history;
    const a1 = resolve(team1[0]);
    const a2 = resolve(team1[1]);
    const b1 = resolve(team2[0]);
    const b2 = resolve(team2[1]);
    const pairA = { m: a1, f: a2 };
    const pairB = { m: b1, f: b2 };
    const mk = matchupKey(pairA, pairB);
    const gk = groupKeyOf4(a1, a2, b1, b2);
    let s = 0;
    const pA = partnerCount.get(pairKey(a1, a2)) || 0;
    const pB = partnerCount.get(pairKey(b1, b2)) || 0;
    s += pA * MM_W_PARTNER + (pA >= 2 ? MM_W_PARTNER_REPEAT2 : 0);
    s += pB * MM_W_PARTNER + (pB >= 2 ? MM_W_PARTNER_REPEAT2 : 0);
    s += (lastRoundPartnerSet.has(pairKey(a1, a2)) ? 80000 : 0);
    s += (lastRoundPartnerSet.has(pairKey(b1, b2)) ? 80000 : 0);
    s += scoreMexOpponentPairs(pairA, pairB, opposeCount);
    const all4 = [a1, a2, b1, b2];
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const meetings =
          (partnerCount.get(pairKey(all4[i], all4[j])) || 0) +
          (opposeCount.get(pairKey(all4[i], all4[j])) || 0);
        if (meetings > 0) s += meetings * MM_W_MEETING;
        else s -= MM_B_NEW_MEETING;
      }
    }
    const exactCount = matchupCount.get(mk) || 0;
    s += exactCount * MM_W_EXACT_MATCH;
    if (lastRoundMatchupSet.has(mk)) s += MM_W_CONSECUTIVE_EXACT;
    s += (groupCount.get(gk) || 0) * MM_W_GROUP;
    if (levelByName && levelByName.size) {
      const sum = (x, y) =>
        getLevelForPairing(levelByName, resolve, x) +
        getLevelForPairing(levelByName, resolve, y);
      s += POWER_LEVEL_MATCH_BETA * Math.abs(sum(a1, a2) - sum(b1, b2));
    }
    return s;
  };

  const mixMexCourtLexMetrics = (team1, team2, history, lastRoundMatchupSet, resolve) => {
    const a1 = resolve(team1[0]);
    const a2 = resolve(team1[1]);
    const b1 = resolve(team2[0]);
    const b2 = resolve(team2[1]);
    const pairA = { m: a1, f: a2 };
    const pairB = { m: b1, f: b2 };
    const mk = matchupKey(pairA, pairB);
    const gk = groupKeyOf4(a1, a2, b1, b2);
    const { partnerCount, matchupCount, groupCount } = history;
    const exactCount = matchupCount.get(mk) || 0;
    const pRep =
      ((partnerCount.get(pairKey(a1, a2)) || 0) >= 2 ? 1 : 0) +
      ((partnerCount.get(pairKey(b1, b2)) || 0) >= 2 ? 1 : 0);
    const opp = mexSplitOpponentLexMetrics(pairA, pairB, history);
    return {
      wouldExactRepeat: exactCount > 0 ? 1 : 0,
      wouldConsecutiveExact: lastRoundMatchupSet.has(mk) ? 1 : 0,
      wouldGroup3x: (groupCount.get(gk) || 0) >= 2 ? 1 : 0,
      partnerWould3x: pRep,
      ...opp
    };
  };

  const pickBestMixMexicanoCourtPairing = (
    m0,
    m1,
    f0,
    f1,
    history,
    lastRoundPartnerSet,
    lastRoundMatchupSet,
    resolve,
    levelByName
  ) => {
    const parallel = {
      parallel: true,
      t1: [m0, f0],
      t2: [m1, f1]
    };
    const cross = {
      parallel: false,
      t1: [m0, f1],
      t2: [m1, f0]
    };
    let best = null;
    let bestLex = null;
    for (const sp of [parallel, cross]) {
      let sc = scoreMixMexicanoMatch(
        sp.t1, sp.t2, history, lastRoundPartnerSet, lastRoundMatchupSet, resolve, levelByName
      );
      if (!sp.parallel) sc += MIX_MEX_PARALLEL_BIAS;
      const pairA = { m: resolve(sp.t1[0]), f: resolve(sp.t1[1]) };
      const pairB = { m: resolve(sp.t2[0]), f: resolve(sp.t2[1]) };
      const m = mixMexCourtLexMetrics(sp.t1, sp.t2, history, lastRoundMatchupSet, resolve);
      const tuple = [
        m.wouldConsecutiveExact,
        m.wouldExactRepeat,
        m.wouldGroup3x,
        m.partnerWould3x,
        m.wouldBecome3x,
        m.wouldBecome2x,
        m.sumOpponentCount,
        -m.newOpponentPairs,
        sc
      ];
      if (!bestLex || mexLexLess(tuple, bestLex)) {
        bestLex = tuple;
        best = { sc, t1: sp.t1, t2: sp.t2 };
      }
    }
    return { team1: best.t1, team2: best.t2, score: best.sc };
  };

  const buildMixMexicanoRoundFromActive = (
    malesAll,
    femalesAll,
    activeM,
    activeF,
    effectiveCourts,
    allRounds,
    roundNo,
    tournament,
    playersFull
  ) => {
    const rn = Number(roundNo) || 1;
    const rosterNames = [...malesAll, ...femalesAll];
    const tSub = {
      ...tournament,
      rounds: JSON.stringify(
        safeJsonParse(tournament?.rounds, []).filter((r) => Number(r.round) < rn)
      )
    };
    const history = buildMexicanoHistory(allRounds);
    const prevRound = getPreviousRoundDatum(allRounds, roundNo);
    const resolve = makeRosterNameResolve(rosterNames);
    const lastRoundPartnerSet = getLastRoundPartnerSet(prevRound, resolve);
    const lastRoundMatchupSet = getLastRoundMatchupSet(prevRound, resolve);
    const levelByName = makeLevelByNameMap(playersFull || []);

    const board = computeLeaderboardSorted(tSub, 'points', { applyMatchCompensation: false });
    const standingsOrder = board.map((row) => row.name);

    let orderedM;
    let orderedF;
    if (rn === 1) {
      const actM = new Set(activeM);
      const actF = new Set(activeF);
      orderedM = malesAll.filter((n) => actM.has(n));
      orderedF = femalesAll.filter((n) => actF.has(n));
    } else {
      orderedM = orderActiveByStandings(activeM, standingsOrder, malesAll);
      orderedF = orderActiveByStandings(activeF, standingsOrder, femalesAll);
    }

    const matches = [];
    let roundScore = 0;
    for (let c = 0; c < effectiveCourts; c++) {
      const m0 = orderedM[c * 2];
      const m1 = orderedM[c * 2 + 1];
      const f0 = orderedF[c * 2];
      const f1 = orderedF[c * 2 + 1];
      if (!m0 || !m1 || !f0 || !f1) break;
      const split = pickBestMixMexicanoCourtPairing(
        m0, m1, f0, f1,
        history, lastRoundPartnerSet, lastRoundMatchupSet, resolve, levelByName
      );
      roundScore += split.score || 0;
      matches.push({
        court: c + 1,
        team1: split.team1,
        team2: split.team2,
        score1: '',
        score2: ''
      });
    }
    return { matches, roundScore };
  };

  /**
   * Mix Mexicano: equal M/F per court (2M+2F), Swiss per gender, Mexicano-style fairness.
   */
  function buildMixMexicanoMatches(playersFull, courts, allRounds, roundNo, tournament) {
    const malesAll = playersFull.filter((p) => p.gender === 'M').map((p) => p.name);
    const femalesAll = playersFull.filter((p) => p.gender === 'F').map((p) => p.name);
    const cap = computeMixMexicanoRoundCapacity(malesAll.length, femalesAll.length, courts);
    if (cap.effectiveCourtsPerRound <= 0) return [];

    const need = cap.playingPerGender;
    const maleCandidates = enumerateMixMexicanoFairActiveSets(
      malesAll, need, allRounds, roundNo, 16
    );
    const femaleCandidates = enumerateMixMexicanoFairActiveSets(
      femalesAll, need, allRounds, roundNo, 16
    );

    const statsM = tallyMexicanoPlayerStats(malesAll, allRounds, roundNo);
    const statsF = tallyMexicanoPlayerStats(femalesAll, allRounds, roundNo);
    const horizon = Math.max(
      roundNo,
      getPriorRoundsCompleted(allRounds, roundNo).length + 1
    );
    const targets = computeMixMexicanoSessionTargets(
      malesAll.length, femalesAll.length, courts, horizon
    );
    const idealGamesMInt = Number.isInteger(targets.idealGamesPerMale);
    const idealGamesFInt = Number.isInteger(targets.idealGamesPerFemale);
    const idealByesMInt = Number.isInteger(targets.idealByesPerMale);
    const idealByesFInt = Number.isInteger(targets.idealByesPerFemale);
    const history = buildMexicanoHistory(allRounds);

    let bestMatches = null;
    let bestTuple = null;
    for (const activeM of maleCandidates) {
      if (activeM.length !== need) continue;
      for (const activeF of femaleCandidates) {
        if (activeF.length !== need) continue;
        const { matches, roundScore } = buildMixMexicanoRoundFromActive(
          malesAll,
          femalesAll,
          activeM,
          activeF,
          cap.effectiveCourtsPerRound,
          allRounds,
          roundNo,
          tournament,
          playersFull
        );
        if (!matches.length) continue;

        const projM = projectMexicanoFairnessAfterRound(
          malesAll, statsM.gamesPlayed, statsM.byeCount, activeM
        );
        const projF = projectMexicanoFairnessAfterRound(
          femalesAll, statsF.gamesPlayed, statsF.byeCount, activeF
        );
        let fairnessPenalty = 0;
        if (projM.gamesDiff > 1 || projM.byeDiff > 1) fairnessPenalty += MM_W_FAIRNESS_HARD;
        if (projF.gamesDiff > 1 || projF.byeDiff > 1) fairnessPenalty += MM_W_FAIRNESS_HARD;

        let exactPenalty = 0;
        if (idealGamesMInt) {
          exactPenalty += projM.gamesAfter.reduce(
            (s, g) => s + Math.abs(g - targets.idealGamesPerMale), 0
          );
        }
        if (idealGamesFInt) {
          exactPenalty += projF.gamesAfter.reduce(
            (s, g) => s + Math.abs(g - targets.idealGamesPerFemale), 0
          );
        }
        if (idealByesMInt) {
          exactPenalty += projM.byesAfter.reduce(
            (s, b) => s + Math.abs(b - targets.idealByesPerMale), 0
          );
        }
        if (idealByesFInt) {
          exactPenalty += projF.byesAfter.reduce(
            (s, b) => s + Math.abs(b - targets.idealByesPerFemale), 0
          );
        }

        const gamesDiff = Math.max(projM.gamesDiff, projF.gamesDiff);
        const byeDiff = Math.max(projM.byeDiff, projF.byeDiff);
        const partnerRepeats = countMixPartnerRepeatsInRound(matches, history.partnerCount);
        const oppRepeats = countMixOpponentRepeatsInRound(matches, history.opposeCount);
        const tuple = [
          fairnessPenalty,
          gamesDiff,
          byeDiff,
          exactPenalty,
          partnerRepeats,
          oppRepeats,
          roundScore
        ];
        if (!bestTuple || mexLexLess(tuple, bestTuple)) {
          bestTuple = tuple;
          bestMatches = matches;
        }
      }
    }
    return bestMatches || [];
  }

  const buildMixMexicanoFairnessReport = (
    maleRoster,
    femaleRoster,
    allRounds,
    courts,
    roundCount
  ) => {
    const males = Array.isArray(maleRoster) ? maleRoster : [];
    const females = Array.isArray(femaleRoster) ? femaleRoster : [];
    const names = [...males, ...females];
    const rounds = Array.isArray(allRounds) ? allRounds : [];
    const cap = computeMixMexicanoRoundCapacity(males.length, females.length, courts);
    const roundsCnt = roundCount != null ? Math.floor(Number(roundCount) || 0) : rounds.length;
    const targets = computeMixMexicanoSessionTargets(
      males.length, females.length, courts, roundsCnt
    );

    const base = buildMexicanoFairnessReport(names, rounds, courts, roundsCnt);
    const gamesM = males.map((n) => base.gamesByPlayer[n] ?? 0);
    const gamesF = females.map((n) => base.gamesByPlayer[n] ?? 0);
    const byesM = males.map((n) => base.byesByPlayer[n] ?? 0);
    const byesF = females.map((n) => base.byesByPlayer[n] ?? 0);
    const minMax = (arr) => arr.length
      ? { min: Math.min(...arr), max: Math.max(...arr), diff: Math.max(...arr) - Math.min(...arr) }
      : { min: 0, max: 0, diff: 0 };

    const warnings = [...(base.warnings || [])];
    if (males.length !== females.length) {
      warnings.push(
        `Male and female counts differ (${males.length}M / ${females.length}F); ` +
        'bye balance is enforced per gender.'
      );
    }
    const maleGamesRange = minMax(gamesM);
    const femaleGamesRange = minMax(gamesF);
    const maleByesRange = minMax(byesM);
    const femaleByesRange = minMax(byesF);
    if (maleGamesRange.diff > 1) {
      warnings.push(`male games played difference ${maleGamesRange.diff} exceeds 1`);
    }
    if (femaleGamesRange.diff > 1) {
      warnings.push(`female games played difference ${femaleGamesRange.diff} exceeds 1`);
    }

    return {
      ...base,
      ...cap,
      ...targets,
      totalMales: males.length,
      totalFemales: females.length,
      maleGamesRange,
      femaleGamesRange,
      maleByesRange,
      femaleByesRange,
      gamesPlayedDifferenceMale: maleGamesRange.diff,
      gamesPlayedDifferenceFemale: femaleGamesRange.diff,
      byeDifferenceMale: maleByesRange.diff,
      byeDifferenceFemale: femaleByesRange.diff,
      warnings
    };
  };

  /* ---------- dual export ---------- */
  const _exports = {
    pairKey,
    matchupKey,
    makeRosterNameResolve,
    getPriorRoundsCompleted,
    getPreviousRoundDatum,
    getMatchWinSide,
    countRoundPlayerSlots,
    getMexicanoTargetCourtsFromPrevRound,
    getMexicanoTeamTargetCourtsFromPrevRound,
    orderActiveForMexicanoCourts,
    orderPairsForMexicanoCourts,
    orderActiveByStandings,
    orderPairsByTeamPoints,
    buildFixedPairsMexicanoCourtMatches,
    pairCrossOpposeScore,
    fixedPairMatchupScore,
    getLastRoundFixedMatchupSet,
    scoreFixedPairCourtMatch,
    fixedPairMatchingsToCourts,
    enumerateFixedPairMatchings,
    buildBestFixedPairMatchesExhaustive,
    makeLevelByNameMap,
    getLevelForPairing,
    activeLevelSpread,
    consecutiveBenchStreak,
    consecutiveBenchStreakForPair,
    getLastRoundPartnerSet,
    getFixedPairsOnCourtLastRound,
    fairnessTierCmp,
    shuffleFairnessRuns,
    pickActivePlayersNormal,
    pickActivePlayersMixBalancedGender,
    enumerateFairActiveSets,
    buildMixDynamicMatches,
    buildMixFairnessHistory,
    buildMixFairnessReport,
    buildBestMixCandidateSchedule,
    buildMatchesForActiveMix,
    makeMixSeededRandom,
    rankMixScheduleQuality,
    summarizeMixOpponentQuality,
    countMixOpponentRepeatsInRound,
    countMixNewOpponentPairsInRound,
    projectMixUniqueOpponentStats,
    countMixPartnerRepeatsInRound,
    lexLess,
    scoreMixMatchPair,
    splitMixQuad,
    groupKeyOf4,
    pickActiveFixedPairs,
    pickActiveFixedPairsMexicano,
    pickActivePlayersMexicano,
    computeMexicanoRoundCapacity,
    computeMexicanoSessionTargets,
    pickNormalMexicanoActivePlayers,
    buildNormalPairs,
    buildBestNormalMatches,
    buildMixHistory,
    buildMexicanoHistory,
    scoreNormalMexicanoMatch,
    scoreMexicanoTwoTeams,
    pickBestNormalMexicanoQuadSplit,
    pickBestMexicanoQuadSplit,
    buildBestFixedPairMatches,
    computeFixedMexicanoRoundCapacity,
    computeFixedMexicanoSessionTargets,
    buildFixedPairsMexicanoMatches,
    buildMexicanoMatches,
    buildMexicanoFairnessReport,
    buildBestMexicanoCandidateSchedule,
    rankMexicanoScheduleQuality,
    computeMixMexicanoRoundCapacity,
    computeMixMexicanoSessionTargets,
    enumerateMixMexicanoFairActiveSets,
    scoreMixMexicanoMatch,
    pickBestMixMexicanoCourtPairing,
    buildMixMexicanoMatches,
    buildMixMexicanoFairnessReport,
    scoreMexOpponentPairs,
    mexSplitOpponentLexMetrics,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = _exports;
  } else {
    window.Padelio = Object.assign(window.Padelio || {}, _exports);
  }
})();
