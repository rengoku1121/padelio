/* =========================
   Padelio / normal-americano-planner.js

   Rolling dynamic fairness engine for Normal Americano.
   Generates ONE round at a time from current tournament history.

   Hard rules:
   - Each match is exactly 2 vs 2 with 4 unique players.
   - Used courts <= available courts; no incomplete matches.
   - Bye and games-played spread kept <= 1 when mathematically possible.
   - No consecutive byes unless unavoidable.

   Soft rules (scored, lower is better):
   - Minimize repeated partners, opponents, meetings, group-of-four, exact match.
   - Rotate court usage per player.

   Browser:  loaded after pairing.js, before script.js
             extends window.Padelio and exposes window.planNormalAmericanoRound.
   Node.js:  require('./normal-americano-planner.js')
   ========================= */
(() => {
  'use strict';

  const COMMON_NAME_TYPOS = new Map([['pingku', 'Pingky']]);

  const normalizeNameKey = (s) => String(s ?? '').trim().toLowerCase();

  const fixCommonNameTypos = (name) => {
    const t = String(name ?? '').trim();
    const canon = COMMON_NAME_TYPOS.get(normalizeNameKey(t));
    return canon != null ? canon : t;
  };

  const makeResolve = (allNames) => {
    const map = new Map();
    (allNames || []).forEach((n) => {
      const display = fixCommonNameTypos(n);
      const k = normalizeNameKey(display);
      if (display && !map.has(k)) map.set(k, display);
    });
    return (raw) => {
      const fixed = fixCommonNameTypos(raw);
      return map.get(normalizeNameKey(fixed)) ?? fixed;
    };
  };

  const pairKey = (a, b) => {
    const x = String(a ?? '');
    const y = String(b ?? '');
    return x < y ? `${x}__${y}` : `${y}__${x}`;
  };

  /** Unordered pair-of-pairs (team-vs-team) key — order of teams doesn't matter. */
  const teamVsTeamKey = (a1, a2, b1, b2) => {
    const k1 = pairKey(a1, a2);
    const k2 = pairKey(b1, b2);
    return k1 < k2 ? `${k1}||${k2}` : `${k2}||${k1}`;
  };

  /** Group-of-four key — order-independent set of 4 players in the same match. */
  const groupKey = (a, b, c, d) =>
    [a, b, c, d].map(String).sort().join('|');

  /* ---------- Dynamic capacity ---------- */

  /**
   * Returns capacity numbers for a single round given total players and courts.
   * playingPlayersPerRound is always a multiple of 4.
   */
  const computeRoundCapacity = (totalPlayers, courts) => {
    const players = Math.max(0, Number(totalPlayers) || 0);
    const courtCount = Math.max(0, Number(courts) || 0);
    const playersPerMatch = 4;
    const maxPlayersPerRound = courtCount * playersPerMatch;
    const candidate = Math.min(players, maxPlayersPerRound);
    const playingPlayersPerRound = Math.max(
      0,
      Math.floor(candidate / playersPerMatch) * playersPerMatch
    );
    const byePlayersPerRound = Math.max(0, players - playingPlayersPerRound);
    const usedCourtsPerRound = playingPlayersPerRound / playersPerMatch;
    return {
      totalPlayers: players,
      courts: courtCount,
      playersPerMatch,
      maxPlayersPerRound,
      playingPlayersPerRound,
      byePlayersPerRound,
      usedCourtsPerRound
    };
  };

  /* ---------- History stats ---------- */

  const getPriorRoundsCompleted = (allRounds, roundNo) =>
    (Array.isArray(allRounds) ? allRounds : [])
      .filter((r) => Number(r.round) < Number(roundNo))
      .sort((a, b) => Number(a.round) - Number(b.round));

  const getPreviousRoundDatum = (allRounds, roundNo) => {
    const want = Number(roundNo) - 1;
    if (want < 1) return null;
    const list = Array.isArray(allRounds) ? allRounds : [];
    const exact = list.find((r) => Number(r.round) === want);
    if (exact) return exact;
    const prior = getPriorRoundsCompleted(allRounds, roundNo);
    return prior.length ? prior[prior.length - 1] : null;
  };

  /**
   * Build all history counters from prior rounds.
   * Returns counts keyed by resolved (canonical) player names.
   */
  const buildHistory = (allNames, allRounds, roundNo) => {
    const resolve = makeResolve(allNames);
    const canonNames = allNames.map((n) => resolve(n));

    const gamesPlayed = new Map();
    const byeCount = new Map();
    const partnerCount = new Map();
    const opponentCount = new Map();
    const groupCount = new Map();
    const exactMatchCount = new Map();
    const courtUsage = new Map();
    const meetings = new Map();
    const previousRoundBye = new Set();

    canonNames.forEach((n) => {
      gamesPlayed.set(n, 0);
      byeCount.set(n, 0);
      courtUsage.set(n, new Map());
      meetings.set(n, new Set());
    });

    const priorRounds = getPriorRoundsCompleted(allRounds, roundNo);
    const prevRound = getPreviousRoundDatum(allRounds, roundNo);

    priorRounds.forEach((r) => {
      const playedThisRound = new Set();
      (r.matches || []).forEach((match) => {
        const t1 = (match.team1 || []).map((n) => resolve(n)).filter(Boolean);
        const t2 = (match.team2 || []).map((n) => resolve(n)).filter(Boolean);
        if (t1.length !== 2 || t2.length !== 2) return;

        const courtNum = Math.max(1, Number(match.court) || 1);

        [...t1, ...t2].forEach((n) => {
          if (!gamesPlayed.has(n)) gamesPlayed.set(n, 0);
          gamesPlayed.set(n, (gamesPlayed.get(n) || 0) + 1);
          playedThisRound.add(n);
          if (!courtUsage.has(n)) courtUsage.set(n, new Map());
          const courtMap = courtUsage.get(n);
          courtMap.set(courtNum, (courtMap.get(courtNum) || 0) + 1);
        });

        const k1 = pairKey(t1[0], t1[1]);
        partnerCount.set(k1, (partnerCount.get(k1) || 0) + 1);
        const k2 = pairKey(t2[0], t2[1]);
        partnerCount.set(k2, (partnerCount.get(k2) || 0) + 1);

        t1.forEach((a) => {
          t2.forEach((b) => {
            const k = pairKey(a, b);
            opponentCount.set(k, (opponentCount.get(k) || 0) + 1);
          });
        });

        const gk = groupKey(t1[0], t1[1], t2[0], t2[1]);
        groupCount.set(gk, (groupCount.get(gk) || 0) + 1);
        const tk = teamVsTeamKey(t1[0], t1[1], t2[0], t2[1]);
        exactMatchCount.set(tk, (exactMatchCount.get(tk) || 0) + 1);

        // Track each player's set of distinct meeting partners + opponents.
        const matchPlayers = [...t1, ...t2];
        for (const a of matchPlayers) {
          const set = meetings.get(a);
          if (!set) continue;
          for (const b of matchPlayers) {
            if (a !== b) set.add(b);
          }
        }
      });

      canonNames.forEach((n) => {
        if (!playedThisRound.has(n)) {
          if (!byeCount.has(n)) byeCount.set(n, 0);
          byeCount.set(n, (byeCount.get(n) || 0) + 1);
        }
      });
    });

    if (prevRound) {
      const playedLast = new Set();
      (prevRound.matches || []).forEach((m) => {
        for (const n of [...(m.team1 || []), ...(m.team2 || [])]) {
          const c = resolve(n);
          if (c) playedLast.add(c);
        }
      });
      canonNames.forEach((n) => {
        if (!playedLast.has(n)) previousRoundBye.add(n);
      });
    }

    return {
      resolve,
      canonNames,
      gamesPlayed,
      byeCount,
      partnerCount,
      opponentCount,
      groupCount,
      exactMatchCount,
      courtUsage,
      meetings,
      previousRoundBye,
      priorRoundsCount: priorRounds.length
    };
  };

  /* ---------- Meeting helpers ---------- */

  /** The 6 unordered pair player-meetings inside a 2v2 match. */
  const matchMeetingPairs = (teamA, teamB) => {
    const [a1, a2] = teamA;
    const [b1, b2] = teamB;
    return [
      [a1, a2], [b1, b2],
      [a1, b1], [a1, b2], [a2, b1], [a2, b2]
    ];
  };

  /**
   * Each player can meet at most 3 new people per match (1 partner + 2 opponents),
   * capped by the total number of other players in the tournament.
   */
  const maximumPossibleUniqueMeetings = (totalPlayers, gamesPlayed) => {
    const total = Math.max(0, Number(totalPlayers) - 1);
    const cap = Math.max(0, Number(gamesPlayed) * 3);
    return Math.min(total, cap);
  };

  /**
   * Convenience builder for callers that don't already have a history object.
   * Returns Map<player, Set<player>> of players already met as partner or opponent.
   */
  const buildUniqueMeetingSets = (allNames, allRounds, roundNo) =>
    buildHistory(allNames, allRounds, roundNo).meetings;

  /* ---------- Bye / active selection ---------- */

  /**
   * Choose which players sit out this round, balancing bye + games-played fairness.
   * Returns the active player list as the complement.
   */
  const pickByeAndActive = (canonNames, history, capacity, opts = {}) => {
    const random = opts.random || Math.random;
    const byeNeeded = capacity.byePlayersPerRound;
    const playing = capacity.playingPlayersPerRound;
    const n = canonNames.length;

    if (byeNeeded <= 0) {
      return {
        active: canonNames.slice(0, playing),
        bye: [],
        forcedConsecutive: 0
      };
    }
    if (byeNeeded >= n) {
      return { active: [], bye: [...canonNames], forcedConsecutive: 0 };
    }

    const rows = canonNames.map((name) => ({
      name,
      gamesPlayed: history.gamesPlayed.get(name) || 0,
      byeCount: history.byeCount.get(name) || 0,
      hadByeLastRound: history.previousRoundBye.has(name)
    }));

    const maxByeSoFar = rows.reduce((m, r) => Math.max(m, r.byeCount), 0);
    const minByeSoFar = rows.reduce((m, r) => Math.min(m, r.byeCount), Infinity);
    const minGamesSoFar = rows.reduce((m, r) => Math.min(m, r.gamesPlayed), Infinity);

    rows.forEach((r) => {
      const ahead = r.gamesPlayed - minGamesSoFar;
      const byeDeficit = maxByeSoFar - r.byeCount;
      const consecutivePenalty = r.hadByeLastRound ? 500 : 0;
      const eligibilityScore =
        ahead * 100 +
        byeDeficit * 200 -
        r.byeCount * 200 -
        consecutivePenalty +
        random() * 0.5;
      r.eligibility = eligibilityScore;
      r.tier = r.byeCount;
    });

    rows.sort((a, b) => {
      if (a.byeCount !== b.byeCount) return a.byeCount - b.byeCount;
      if (a.hadByeLastRound !== b.hadByeLastRound) return a.hadByeLastRound ? 1 : -1;
      if (a.gamesPlayed !== b.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
      return b.eligibility - a.eligibility;
    });

    // Two-stage selection: prefer non-consecutive byes; only use repeats if forced.
    const nonConsecutive = rows.filter((r) => !r.hadByeLastRound);
    const consecutive = rows.filter((r) => r.hadByeLastRound);

    const ordered = [...nonConsecutive, ...consecutive];

    const bye = [];
    const byeSet = new Set();
    let forcedConsecutive = 0;
    for (const r of ordered) {
      if (bye.length >= byeNeeded) break;
      bye.push(r.name);
      byeSet.add(r.name);
      if (r.hadByeLastRound) forcedConsecutive++;
    }

    const active = canonNames.filter((n2) => !byeSet.has(n2));

    return { active, bye, forcedConsecutive };
  };

  /* ---------- Match-building penalties ---------- */

  // Strong partner-repeat penalty: repeated partner pairs only survive if no
  // valid non-repeating alternative exists under the hard bye/games rules.
  const W_PARTNER = 10000;
  const W_OPPONENT = 3000;
  const W_MEETING = 1000;          // scaled gradient: penalty per prior meeting
  const W_REPEATED_MEETING = 3000; // flat per-pair penalty whenever the pair has met before
  const W_GROUP = 5000;
  const W_EXACT = 8000;
  const W_COURT = 50;
  const W_LAST_ROUND_PARTNER = 600;
  const B_NEW_PARTNER = 1000;
  const B_NEW_OPPONENT = 500;
  const B_NEW_MEETING = 2000;      // bonus for brand-new meeting pairs
  // Round-level meeting balance/deficit weights (applied to top-K candidates).
  // worstDeficit pushes minUniqueMeetings up directly; balance keeps the
  // spread tight; squared sum still penalizes concentrated dispersion.
  const W_MEETING_WORST_DEFICIT = 3000;
  const W_MEETING_BALANCE = 1000;
  const W_MEETING_DEFICIT_SQ = 100;

  /**
   * Score one team-mate pair.
   *   partnerCount × W_PARTNER  (+ last-round nudge)  − new-partner bonus.
   */
  const scorePartnerPair = (a, b, history, lastPartnerSet) => {
    const k = pairKey(a, b);
    const c = history.partnerCount.get(k) || 0;
    let s = c * W_PARTNER;
    if (c === 0) s -= B_NEW_PARTNER;
    if (lastPartnerSet && lastPartnerSet.has(k)) s += W_LAST_ROUND_PARTNER;
    return s;
  };

  /** Score one opponent pair: opponentCount × W_OPPONENT − new-opponent bonus. */
  const scoreOpponentPair = (a, b, history) => {
    const k = pairKey(a, b);
    const opp = history.opponentCount.get(k) || 0;
    let s = opp * W_OPPONENT;
    if (opp === 0) s -= B_NEW_OPPONENT;
    return s;
  };

  /**
   * Total fairness penalty for a candidate match (teamA vs teamB).
   * Lower is better. Combines:
   *  - heavy partner-repeat penalty for both team-mate pairs;
   *  - opponent-repeat penalty for all 4 cross-team pairs;
   *  - meeting (partner OR opponent) penalty for all 6 pairs in the match;
   *  - 4-player group repeat penalty;
   *  - exact match-up repeat penalty;
   *  - bonuses subtracted for brand-new partner / opponent / meeting pairs.
   */
  const scoreMatchPair = (teamA, teamB, history, lastPartnerSet) => {
    const [a1, a2] = teamA;
    const [b1, b2] = teamB;

    let s = scorePartnerPair(a1, a2, history, lastPartnerSet);
    s += scorePartnerPair(b1, b2, history, lastPartnerSet);

    s += scoreOpponentPair(a1, b1, history);
    s += scoreOpponentPair(a1, b2, history);
    s += scoreOpponentPair(a2, b1, history);
    s += scoreOpponentPair(a2, b2, history);

    // Meeting penalty / new-meeting bonus across all 6 unordered pairs.
    // Both a scaled gradient (meeting * W_MEETING) and a flat per-pair repeated
    // penalty (W_REPEATED_MEETING) are applied so the optimizer aggressively
    // prefers pairs that have never met before.
    const pairs = matchMeetingPairs(teamA, teamB);
    for (const [x, y] of pairs) {
      const k = pairKey(x, y);
      const meeting =
        (history.opponentCount.get(k) || 0) +
        (history.partnerCount.get(k) || 0);
      s += meeting * W_MEETING;
      if (meeting === 0) s -= B_NEW_MEETING;
      else s += W_REPEATED_MEETING;
    }

    const gk = groupKey(a1, a2, b1, b2);
    s += (history.groupCount.get(gk) || 0) * W_GROUP;
    const tk = teamVsTeamKey(a1, a2, b1, b2);
    s += (history.exactMatchCount.get(tk) || 0) * W_EXACT;
    return s;
  };

  const scoreCourtAssignment = (playersOnCourt, courtNum, history) => {
    let s = 0;
    for (const name of playersOnCourt) {
      const map = history.courtUsage.get(name);
      if (!map) continue;
      s += (map.get(courtNum) || 0) * W_COURT;
    }
    return s;
  };

  /* ---------- Build matches from active players ---------- */

  /** All 3 unique 2v2 splits of a quad {a,b,c,d}. */
  const splitQuad = (quad) => {
    const [a, b, c, d] = quad;
    return [
      { teamA: [a, b], teamB: [c, d] },
      { teamA: [a, c], teamB: [b, d] },
      { teamA: [a, d], teamB: [b, c] }
    ];
  };

  /** Lowest-penalty split of one 4-player group. */
  const bestSplitForQuad = (quad, history, lastPartnerSet, random) => {
    const splits = splitQuad(quad);
    let bestScore = Infinity;
    const winners = [];
    for (const sp of splits) {
      const sc = scoreMatchPair(sp.teamA, sp.teamB, history, lastPartnerSet);
      if (sc < bestScore) {
        bestScore = sc;
        winners.length = 0;
        winners.push(sp);
      } else if (sc === bestScore) {
        winners.push(sp);
      }
    }
    const rng = random || Math.random;
    const pick = winners[Math.floor(rng() * winners.length)];
    return { teamA: pick.teamA, teamB: pick.teamB, score: bestScore };
  };

  // Hard budget for the branch-and-bound search. Tuned so 20-player / 5-court
  // rounds complete in well under a second while leaving room for pruning to
  // explore meaningfully better solutions for moderate sizes.
  const MAX_BB_NODES = 600000;
  // Number of best (lowest base-score) complete rounds the BB keeps for the
  // round-level meeting balance re-rank. Bigger K explores more candidates but
  // weakens BB pruning, so we keep it modest.
  const BB_TOP_K = 128;

  /**
   * Round-level meeting score: simulate the impact of `picks` on each player's
   * unique-meeting set and return the combined balance + squared-deficit
   * penalty (positive numbers are worse).
   *
   *   uniqueMeetingDifference × W_MEETING_BALANCE
   *   + sum(meetingDeficit²) × W_MEETING_DEFICIT_SQ
   *
   * Pair-level new/repeated meeting bonus/penalty is already baked into the
   * match score (`scoreMatchPair`), so this layer only adds the per-player
   * fairness terms that cannot be captured by individual matches.
   */
  const computeRoundMeetingBalance = (picks, history, totalPlayers) => {
    const canon = history.canonNames;
    const deltaNew = new Map();
    const playedThisRound = new Set();

    for (const pick of picks) {
      const players = [pick.teamA[0], pick.teamA[1], pick.teamB[0], pick.teamB[1]];
      players.forEach((p) => playedThisRound.add(p));
      for (const p of players) {
        const set = history.meetings.get(p);
        if (!set) continue;
        let newCount = 0;
        for (const q of players) {
          if (q === p) continue;
          if (!set.has(q)) newCount++;
        }
        if (newCount > 0) deltaNew.set(p, (deltaNew.get(p) || 0) + newCount);
      }
    }

    let maxUnique = -Infinity;
    let minUnique = Infinity;
    let worstDeficit = 0;
    let deficitSqSum = 0;

    for (const p of canon) {
      const set = history.meetings.get(p);
      const currentSize = set ? set.size : 0;
      const afterSize = currentSize + (deltaNew.get(p) || 0);
      const gamesAfter =
        (history.gamesPlayed.get(p) || 0) + (playedThisRound.has(p) ? 1 : 0);
      const maxPossible = maximumPossibleUniqueMeetings(totalPlayers, gamesAfter);
      const deficit = Math.max(0, maxPossible - afterSize);
      if (deficit > worstDeficit) worstDeficit = deficit;
      deficitSqSum += deficit * deficit;
      if (afterSize > maxUnique) maxUnique = afterSize;
      if (afterSize < minUnique) minUnique = afterSize;
    }

    const balancePenalty =
      Number.isFinite(minUnique) && Number.isFinite(maxUnique)
        ? (maxUnique - minUnique) * W_MEETING_BALANCE
        : 0;
    const worstPenalty = worstDeficit * W_MEETING_WORST_DEFICIT;
    const deficitPenalty = deficitSqSum * W_MEETING_DEFICIT_SQ;
    return worstPenalty + balancePenalty + deficitPenalty;
  };

  /**
   * Partition `active` (length must equal usedCourts * 4) into `usedCourts`
   * disjoint matches that minimize the total fairness penalty.
   *
   * Algorithm:
   *   1. Enumerate every 4-player combination; for each, compute its best split
   *      score via `scoreMatchPair`.
   *   2. Group candidates by their smallest player index (= anchor).
   *   3. Branch-and-bound: at each depth, the smallest unmatched player drives
   *      the anchor; iterate that anchor's candidates in score order and prune
   *      branches where the running partial score is already >= the best
   *      complete solution found so far.
   *   4. Assign court numbers to the winning picks by court usage spread.
   *
   * Randomness is only used as a tiny tie-breaker after fairness scores match.
   * If the node budget is exhausted before completing, the best partial result
   * (or a pure greedy walk) is returned so the round is always playable.
   */
  const buildMatchesForActive = (
    active,
    usedCourts,
    history,
    lastPartnerSet,
    opts = {}
  ) => {
    const random = opts.random || Math.random;
    if (!Number.isInteger(usedCourts) || usedCourts <= 0) return null;
    if (!Array.isArray(active) || active.length !== usedCourts * 4) return null;

    const n = active.length;
    const totalPlayers = history.canonNames.length;
    // 1) Enumerate candidate matches: every 4-player subset × best split.
    const candidates = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) {
          for (let l = k + 1; l < n; l++) {
            const quad = [active[i], active[j], active[k], active[l]];
            const splits = splitQuad(quad);
            let bestSc = Infinity;
            const splitWinners = [];
            const reshuffle = !!(opts.avoidPartners && opts.avoidPartners.size);
            for (const sp of splits) {
              let sc = scoreMatchPair(sp.teamA, sp.teamB, history, lastPartnerSet);
              if (reshuffle) {
                const kA = pairKey(sp.teamA[0], sp.teamA[1]);
                const kB = pairKey(sp.teamB[0], sp.teamB[1]);
                if (opts.avoidPartners.has(kA)) sc += 1000000;
                if (opts.avoidPartners.has(kB)) sc += 1000000;
              }
              if (sc < bestSc) {
                bestSc = sc;
                splitWinners.length = 0;
                splitWinners.push(sp);
              } else if (sc === bestSc && reshuffle) {
                splitWinners.push(sp);
              }
            }
            const bestSplit = splitWinners[
              reshuffle ? Math.floor(random() * splitWinners.length) : 0
            ];
            candidates.push({
              indices: [i, j, k, l],
              playerMask: (1 << i) | (1 << j) | (1 << k) | (1 << l),
              score: bestSc,
              jitter: random() * 0.0001,
              teamA: bestSplit.teamA,
              teamB: bestSplit.teamB,
              quad
            });
          }
        }
      }
    }

    if (candidates.length === 0) return null;

    // 2) Group candidates by smallest-index anchor and sort by score.
    const byAnchor = Array.from({ length: n }, () => []);
    for (const c of candidates) byAnchor[c.indices[0]].push(c);
    for (const arr of byAnchor) {
      arr.sort((x, y) => (x.score - y.score) || (x.jitter - y.jitter));
    }

    // 3) Branch-and-bound keeping the top BB_TOP_K disjoint-match sets by base
    //    score. We re-rank later by base + round-level meeting balance.
    const topRounds = []; // ascending by score
    let acceptThreshold = Infinity;
    let nodes = 0;

    const insertCandidate = (score, picks) => {
      if (topRounds.length < BB_TOP_K) {
        let i = topRounds.length;
        while (i > 0 && topRounds[i - 1].score > score) i--;
        topRounds.splice(i, 0, { score, picks: picks.slice() });
        if (topRounds.length === BB_TOP_K) {
          acceptThreshold = topRounds[BB_TOP_K - 1].score;
        }
      } else if (score < acceptThreshold) {
        topRounds.pop();
        let i = topRounds.length;
        while (i > 0 && topRounds[i - 1].score > score) i--;
        topRounds.splice(i, 0, { score, picks: picks.slice() });
        acceptThreshold = topRounds[BB_TOP_K - 1].score;
      }
    };

    const dfs = (pickedMask, partialScore, picks) => {
      if (nodes >= MAX_BB_NODES) return;
      nodes++;

      if (picks.length === usedCourts) {
        insertCandidate(partialScore, picks);
        return;
      }
      if (partialScore >= acceptThreshold) return;

      let anchor = -1;
      for (let i = 0; i < n; i++) {
        if (!(pickedMask & (1 << i))) { anchor = i; break; }
      }
      if (anchor < 0) return;

      const list = byAnchor[anchor];
      for (const c of list) {
        if (c.playerMask & pickedMask) continue;
        if (partialScore + c.score >= acceptThreshold) break; // sorted asc => prune the rest
        picks.push(c);
        dfs(pickedMask | c.playerMask, partialScore + c.score, picks);
        picks.pop();
        if (nodes >= MAX_BB_NODES) return;
      }
    };

    dfs(0, 0, []);

    // Fallback: pure greedy by score (only triggered when the BB never reached
    // a complete round, which can happen if the node budget runs out mid-DFS).
    if (topRounds.length === 0) {
      let pickedMask = 0;
      const picks = [];
      for (let step = 0; step < usedCourts; step++) {
        let anchor = -1;
        for (let i = 0; i < n; i++) {
          if (!(pickedMask & (1 << i))) { anchor = i; break; }
        }
        if (anchor < 0) return null;
        const list = byAnchor[anchor] || [];
        const pick = list.find((c) => !(c.playerMask & pickedMask));
        if (!pick) return null;
        picks.push(pick);
        pickedMask |= pick.playerMask;
      }
      topRounds.push({
        score: picks.reduce((s, p) => s + p.score, 0),
        picks
      });
    }

    // 4) Re-rank candidates by combined (base + meeting balance) score.
    let bestCandidate = topRounds[0];
    let bestCombined = Infinity;
    let bestBalance = 0;
    for (const cand of topRounds) {
      const balance = computeRoundMeetingBalance(cand.picks, history, totalPlayers);
      const combined = cand.score + balance;
      if (
        combined < bestCombined ||
        (combined === bestCombined && cand.score < bestCandidate.score)
      ) {
        bestCombined = combined;
        bestBalance = balance;
        bestCandidate = cand;
      }
    }

    const bestPicks = bestCandidate.picks;
    const bestTotal = bestCandidate.score;

    // 5) Greedy court assignment to spread per-player court usage.
    const remaining = bestPicks.map((p) => ({
      teamA: p.teamA,
      teamB: p.teamB,
      score: p.score,
      quad: p.quad
    }));
    const matches = [];
    let totalScore = 0;

    for (let courtNum = 1; courtNum <= usedCourts; courtNum++) {
      let bestIdx = 0;
      let bestPenalty = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const q = remaining[i];
        const courtPenalty = scoreCourtAssignment(q.quad, courtNum, history);
        const combined = q.score + courtPenalty + random() * 0.01;
        if (combined < bestPenalty) {
          bestPenalty = combined;
          bestIdx = i;
        }
      }
      const picked = remaining.splice(bestIdx, 1)[0];
      matches.push({
        court: courtNum,
        team1: picked.teamA,
        team2: picked.teamB,
        score1: '',
        score2: '',
        _matchScore: picked.score,
        _courtScore: bestPenalty - picked.score
      });
      totalScore += bestPenalty;
    }

    const repeatedPartner = matches.filter((m) => {
      const k1 = pairKey(m.team1[0], m.team1[1]);
      const k2 = pairKey(m.team2[0], m.team2[1]);
      return (history.partnerCount.get(k1) || 0) > 0 ||
        (history.partnerCount.get(k2) || 0) > 0;
    }).length;

    return {
      matches,
      totalScore,
      baseRoundScore: bestTotal,
      meetingBalanceScore: bestBalance,
      repeatedPartner
    };
  };

  const shuffleCopy = (arr, random) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  /* ---------- Round validation ---------- */

  const validateRound = (matches, capacity, history, opts = {}) => {
    const issues = [];

    if (!Array.isArray(matches)) {
      issues.push('matches must be an array');
      return { ok: false, issues };
    }
    if (matches.length > capacity.usedCourtsPerRound) {
      issues.push('too many matches for available courts');
    }
    const seenPlayers = new Set();
    const seenCourts = new Set();
    for (const m of matches) {
      if (!m || !Array.isArray(m.team1) || !Array.isArray(m.team2)) {
        issues.push('invalid match shape');
        continue;
      }
      if (m.team1.length !== 2 || m.team2.length !== 2) {
        issues.push('teams must have exactly 2 players');
      }
      const players = [...m.team1, ...m.team2];
      const unique = new Set(players);
      if (unique.size !== players.length) {
        issues.push('duplicate player within match');
      }
      for (const p of players) {
        if (seenPlayers.has(p)) issues.push(`player appears twice in round: ${p}`);
        seenPlayers.add(p);
      }
      if (seenCourts.has(m.court)) issues.push(`court used twice: ${m.court}`);
      seenCourts.add(m.court);
    }

    if (opts.strict !== false) {
      // Hard requirement: round must fill usedCourts exactly.
      if (matches.length !== capacity.usedCourtsPerRound) {
        issues.push(
          `match count ${matches.length} != expected ${capacity.usedCourtsPerRound}`
        );
      }
    }

    return { ok: issues.length === 0, issues };
  };

  /* ---------- Fairness report ---------- */

  /**
   * Build a fairness report given the full set of rounds (including the round just generated).
   * Used for dev/test inspection.
   */
  const buildFairnessReport = (allNames, allRounds, courts) => {
    const totalPlayers = allNames.length;
    const courtCount = Math.max(0, Number(courts) || 0);
    const completed = (Array.isArray(allRounds) ? allRounds : []).filter(
      (r) => (r.matches || []).length > 0
    );
    const roundCount = completed.length;
    const capacity = computeRoundCapacity(totalPlayers, courtCount);
    const history = buildHistory(allNames, completed, roundCount + 1);

    const gamesArr = [...history.gamesPlayed.values()];
    const byesArr = [...history.byeCount.values()];

    const minGames = gamesArr.length ? Math.min(...gamesArr) : 0;
    const maxGames = gamesArr.length ? Math.max(...gamesArr) : 0;
    const minByes = byesArr.length ? Math.min(...byesArr) : 0;
    const maxByes = byesArr.length ? Math.max(...byesArr) : 0;

    const partnerRepeats = [];
    for (const [k, v] of history.partnerCount.entries()) {
      if (v > 1) partnerRepeats.push({ key: k, count: v });
    }
    const opponentRepeats = [];
    for (const [k, v] of history.opponentCount.entries()) {
      if (v > 1) opponentRepeats.push({ key: k, count: v });
    }
    const exactRepeats = [];
    for (const [k, v] of history.exactMatchCount.entries()) {
      if (v > 1) exactRepeats.push({ key: k, count: v });
    }
    const groupRepeats = [];
    for (const [k, v] of history.groupCount.entries()) {
      if (v > 1) groupRepeats.push({ key: k, count: v });
    }

    const uniqueMeetingCount = new Map();
    const partnersByPlayer = new Map();
    const opponentsByPlayer = new Map();
    history.canonNames.forEach((n) => {
      uniqueMeetingCount.set(n, new Set());
      partnersByPlayer.set(n, new Map());
      opponentsByPlayer.set(n, new Map());
    });
    const noteMeeting = (a, b) => {
      if (!a || !b || a === b) return;
      if (uniqueMeetingCount.has(a)) uniqueMeetingCount.get(a).add(b);
      if (uniqueMeetingCount.has(b)) uniqueMeetingCount.get(b).add(a);
    };
    const notePartners = (a, b) => {
      if (!a || !b || a === b) return;
      if (partnersByPlayer.has(a)) {
        const m = partnersByPlayer.get(a);
        m.set(b, (m.get(b) || 0) + 1);
      }
      if (partnersByPlayer.has(b)) {
        const m = partnersByPlayer.get(b);
        m.set(a, (m.get(a) || 0) + 1);
      }
    };
    const noteOpponents = (a, b) => {
      if (!a || !b || a === b) return;
      if (opponentsByPlayer.has(a)) {
        const m = opponentsByPlayer.get(a);
        m.set(b, (m.get(b) || 0) + 1);
      }
      if (opponentsByPlayer.has(b)) {
        const m = opponentsByPlayer.get(b);
        m.set(a, (m.get(a) || 0) + 1);
      }
    };
    completed.forEach((r) => {
      (r.matches || []).forEach((m) => {
        const t1 = (m.team1 || []).map((n) => history.resolve(n));
        const t2 = (m.team2 || []).map((n) => history.resolve(n));
        if (t1.length === 2) {
          noteMeeting(t1[0], t1[1]);
          notePartners(t1[0], t1[1]);
        }
        if (t2.length === 2) {
          noteMeeting(t2[0], t2[1]);
          notePartners(t2[0], t2[1]);
        }
        t1.forEach((a) => t2.forEach((b) => {
          noteMeeting(a, b);
          noteOpponents(a, b);
        }));
      });
    });
    const meetingArr = [...uniqueMeetingCount.values()].map((s) => s.size);
    const minMeetings = meetingArr.length ? Math.min(...meetingArr) : 0;
    const maxMeetings = meetingArr.length ? Math.max(...meetingArr) : 0;
    const totalMeetingSum = meetingArr.reduce((s, c) => s + c, 0);
    const averageUniqueMeetings =
      meetingArr.length ? totalMeetingSum / meetingArr.length : 0;
    const uniqueMeetingDifference = meetingArr.length ? maxMeetings - minMeetings : 0;

    const mapMapToObj = (m) => Object.fromEntries(
      [...m.entries()].map(([k, v]) => [k, Object.fromEntries(v)])
    );
    const partnerListByPlayer = mapMapToObj(partnersByPlayer);
    const opponentListByPlayer = mapMapToObj(opponentsByPlayer);
    const uniqueMeetingListByPlayer = Object.fromEntries(
      [...uniqueMeetingCount.entries()].map(([k, v]) => [k, [...v].sort()])
    );
    const uniquePartnerCountByPlayer = Object.fromEntries(
      [...partnersByPlayer.entries()].map(([k, v]) => [k, v.size])
    );
    const uniqueOpponentCountByPlayer = Object.fromEntries(
      [...opponentsByPlayer.entries()].map(([k, v]) => [k, v.size])
    );
    const partnerArr = [...partnersByPlayer.values()].map((m) => m.size);
    const opponentArr = [...opponentsByPlayer.values()].map((m) => m.size);
    const minUniquePartners = partnerArr.length ? Math.min(...partnerArr) : 0;
    const maxUniquePartners = partnerArr.length ? Math.max(...partnerArr) : 0;
    const minUniqueOpponents = opponentArr.length ? Math.min(...opponentArr) : 0;
    const maxUniqueOpponents = opponentArr.length ? Math.max(...opponentArr) : 0;

    // Per-player maximum possible unique meetings and deficit (using the
    // feasibility cap min(totalPlayers - 1, gamesPlayed × 3)).
    const maximumPossibleUniqueMeetingsByPlayer = {};
    const meetingDeficitByPlayer = {};
    let totalMeetingDeficit = 0;
    history.canonNames.forEach((p) => {
      const games = history.gamesPlayed.get(p) || 0;
      const maxPossible = maximumPossibleUniqueMeetings(totalPlayers, games);
      const current = (uniqueMeetingCount.get(p) || new Set()).size;
      const deficit = Math.max(0, maxPossible - current);
      maximumPossibleUniqueMeetingsByPlayer[p] = maxPossible;
      meetingDeficitByPlayer[p] = deficit;
      totalMeetingDeficit += deficit;
    });

    const courtUsagePerPlayer = {};
    history.canonNames.forEach((n) => {
      const map = history.courtUsage.get(n) || new Map();
      const obj = {};
      [...map.entries()].forEach(([court, c]) => {
        obj[court] = c;
      });
      courtUsagePerPlayer[n] = obj;
    });

    const warnings = [];
    const byeDiff = byesArr.length ? maxByes - minByes : 0;
    const gamesDiff = gamesArr.length ? maxGames - minGames : 0;
    if (byeDiff > 1) warnings.push(`byeDifference ${byeDiff} > 1`);
    if (gamesDiff > 1) warnings.push(`gamesPlayedDifference ${gamesDiff} > 1`);

    // Full meeting coverage feasibility.
    //   Each match exposes a player to 3 new meeting-candidates (1 partner + 2 opponents).
    //   So a player needs at least ceil((totalPlayers - 1) / 3) matches to meet everyone.
    //   Total required play-slots = required * totalPlayers, rounded up to whole rounds.
    const requiredGamesPerPlayer =
      totalPlayers > 1 ? Math.ceil((totalPlayers - 1) / 3) : 0;
    const playingPerRound = capacity.playingPlayersPerRound;
    const expectedMinRoundsForFullMeeting =
      playingPerRound > 0
        ? Math.ceil((requiredGamesPerPlayer * totalPlayers) / playingPerRound)
        : 0;
    const fullMeetingPossible =
      totalPlayers <= 1 ||
      (expectedMinRoundsForFullMeeting > 0 && roundCount >= expectedMinRoundsForFullMeeting);
    let meetingCoverageRecommendation = null;
    if (totalPlayers > 1 && roundCount > 0 && !fullMeetingPossible) {
      meetingCoverageRecommendation =
        `Full everyone-meets-everyone coverage is mathematically impossible with ` +
        `${roundCount} round(s); each player can meet at most ` +
        `${requiredGamesPerPlayer * 3} other players. ` +
        `Use at least ${expectedMinRoundsForFullMeeting} rounds so every player ` +
        `can meet every other player. The scheduler still maximizes meetings ` +
        `toward each player's feasible maximum.`;
      warnings.push(meetingCoverageRecommendation);
    }

    const partnerRepeatPairs = partnerRepeats.reduce(
      (s, x) => s + (x.count - 1),
      0
    );
    const opponentRepeatPairs = opponentRepeats.reduce(
      (s, x) => s + (x.count - 1),
      0
    );
    const groupRepeatPairs = groupRepeats.reduce(
      (s, x) => s + (x.count - 1),
      0
    );

    // Composite "final schedule" penalty (lower is better) matching the
    // optimizer's priority order. Bye / games imbalance dominates; then
    // partner / opponent / group repeats; finally meeting balance and deficit;
    // total unique meetings bonus.
    const finalSchedulePenalty =
      gamesDiff * 100000 +
      byeDiff * 100000 +
      partnerRepeatPairs * 50000 +
      opponentRepeatPairs * 20000 +
      groupRepeatPairs * 10000 +
      uniqueMeetingDifference * 5000 +
      totalMeetingDeficit * 1000 -
      totalMeetingSum * 500;

    let score = 100;
    if (byeDiff > 1) score -= 40;
    if (gamesDiff > 1) score -= 40;
    score -= Math.min(25, partnerRepeatPairs * 5);
    score -= Math.min(20, opponentRepeatPairs * 3);
    score -= Math.min(15, exactRepeats.reduce((s, x) => s + x.count, 0) * 10);
    score -= Math.min(10, groupRepeatPairs * 5);
    if (meetingArr.length) {
      // Penalize meeting deficit against the feasible max (data-driven, so it
      // does not punish results that are already at the mathematical ceiling).
      score -= Math.min(15, totalMeetingDeficit * 0.5);
      score -= Math.min(10, uniqueMeetingDifference * 1.5);
    }
    score = Math.max(0, Math.min(100, Math.round(score)));

    let rating = 'Excellent';
    if (score < 90) rating = 'Good';
    if (score < 75) rating = 'Acceptable';
    if (score < 60) rating = 'Unfair';

    return {
      totalPlayers,
      totalCourts: courtCount,
      usedCourtsPerRound: capacity.usedCourtsPerRound,
      playingPlayersPerRound: capacity.playingPlayersPerRound,
      byePlayersPerRound: capacity.byePlayersPerRound,
      totalRounds: roundCount,
      gamesPlayed: Object.fromEntries(history.gamesPlayed),
      byeCount: Object.fromEntries(history.byeCount),
      gamesPlayedDifference: gamesDiff,
      byeDifference: byeDiff,
      minGamesPlayed: gamesArr.length ? minGames : 0,
      maxGamesPlayed: gamesArr.length ? maxGames : 0,
      minByeCount: byesArr.length ? minByes : 0,
      maxByeCount: byesArr.length ? maxByes : 0,
      partnerRepeats,
      opponentRepeats,
      groupRepeats,
      exactMatchRepeats: exactRepeats,
      partnerRepeatPairs,
      opponentRepeatPairs,
      groupRepeatPairs,
      partnerListByPlayer,
      opponentListByPlayer,
      uniqueMeetingListByPlayer,
      uniquePartnerCountByPlayer,
      uniqueOpponentCountByPlayer,
      minUniquePartners,
      maxUniquePartners,
      minUniqueOpponents,
      maxUniqueOpponents,
      uniqueMeetingCount: Object.fromEntries(
        [...uniqueMeetingCount.entries()].map(([k, v]) => [k, v.size])
      ),
      maximumPossibleUniqueMeetingsByPlayer,
      meetingDeficitByPlayer,
      minUniqueMeetings: meetingArr.length ? minMeetings : 0,
      maxUniqueMeetings: meetingArr.length ? maxMeetings : 0,
      averageUniqueMeetings,
      uniqueMeetingDifference,
      totalMeetingDeficit,
      totalUniqueMeetingCount: totalMeetingSum,
      expectedMinRoundsForFullMeeting,
      fullMeetingPossible,
      meetingCoverageRecommendation,
      finalSchedulePenalty,
      courtUsage: courtUsagePerPlayer,
      fairnessScore: score,
      rating,
      warnings
    };
  };

  /* ---------- Main entrypoint ---------- */

  /**
   * Plan one Normal Americano round from current history.
   *
   * @param {object} params
   * @param {string[]} params.players - roster names (display strings)
   * @param {number} params.courts - available courts
   * @param {Array} params.priorRounds - tournament.rounds JSON (already parsed)
   * @param {number} params.roundNo - current round number (1-indexed)
   * @param {object} [params.opts]
   * @param {function} [params.opts.random] - inject deterministic RNG for tests
   *
   * @returns {{ matches: Array, byes: string[], capacity: object, warnings: string[], error?: string }}
   */
  const planNormalAmericanoRound = (params) => {
    const {
      players = [],
      courts = 0,
      priorRounds = [],
      roundNo = 1,
      opts = {}
    } = params || {};

    const random = opts.random || Math.random;

    const cleanPlayers = (Array.isArray(players) ? players : [])
      .map((n) => fixCommonNameTypos(String(n || '').trim()))
      .filter((n) => n.length > 0);

    if (cleanPlayers.length < 4) {
      return {
        matches: [],
        byes: [...cleanPlayers],
        capacity: computeRoundCapacity(cleanPlayers.length, courts),
        warnings: [],
        error: 'Normal Americano requires at least 4 players because each match is 2 vs 2.'
      };
    }

    const capacity = computeRoundCapacity(cleanPlayers.length, courts);
    if (capacity.usedCourtsPerRound <= 0) {
      return {
        matches: [],
        byes: [...cleanPlayers],
        capacity,
        warnings: ['No court can be used this round; need at least 4 players and 1 court.']
      };
    }

    const history = buildHistory(cleanPlayers, priorRounds, roundNo);
    const canonNames = history.canonNames;

    // Pick byes / active.
    const { active, bye, forcedConsecutive } = pickByeAndActive(
      canonNames,
      history,
      capacity,
      { random }
    );

    if (active.length !== capacity.playingPlayersPerRound) {
      return {
        matches: [],
        byes: bye,
        capacity,
        warnings: ['Active player count mismatch; aborting.'],
        error: 'Unable to satisfy round capacity.'
      };
    }

    // Build last-round partner set for the active players, so we can penalize repeats.
    const lastPartnerSet = new Set();
    const prevRound = getPreviousRoundDatum(priorRounds, roundNo);
    if (prevRound) {
      (prevRound.matches || []).forEach((m) => {
        for (const team of [m.team1, m.team2]) {
          if (Array.isArray(team) && team.length === 2) {
            lastPartnerSet.add(pairKey(history.resolve(team[0]), history.resolve(team[1])));
          }
        }
      });
    }

    const built = buildMatchesForActive(
      active,
      capacity.usedCourtsPerRound,
      history,
      lastPartnerSet,
      { random, avoidPartners: opts.avoidPartners || null }
    );

    if (!built || built.matches.length !== capacity.usedCourtsPerRound) {
      return {
        matches: [],
        byes: bye,
        capacity,
        warnings: ['Match builder failed to produce a valid round.'],
        error: 'Failed to build matches.'
      };
    }

    // Strip private scoring fields before returning.
    const cleanMatches = built.matches.map((m) => ({
      court: m.court,
      team1: [...m.team1],
      team2: [...m.team2],
      score1: '',
      score2: ''
    }));

    const validation = validateRound(cleanMatches, capacity, history);
    const warnings = [...validation.issues];
    if (forcedConsecutive > 0) {
      warnings.push(`${forcedConsecutive} player(s) received a consecutive bye (unavoidable).`);
    }

    // Predict bye/games spread AFTER this round to flag avoidable unfairness.
    const projected = projectByeAndGames(canonNames, history, bye, cleanMatches);
    if (projected.byeDifference > 1) {
      warnings.push(`Projected byeDifference ${projected.byeDifference} > 1.`);
    }
    if (projected.gamesPlayedDifference > 1) {
      warnings.push(`Projected gamesPlayedDifference ${projected.gamesPlayedDifference} > 1.`);
    }

    return {
      matches: cleanMatches,
      byes: bye,
      capacity,
      warnings,
      projected
    };
  };

  const projectByeAndGames = (canonNames, history, byes, matches) => {
    const games = new Map(history.gamesPlayed);
    const byeC = new Map(history.byeCount);
    canonNames.forEach((n) => {
      if (!games.has(n)) games.set(n, 0);
      if (!byeC.has(n)) byeC.set(n, 0);
    });
    const playedSet = new Set();
    matches.forEach((m) => {
      [...(m.team1 || []), ...(m.team2 || [])].forEach((n) => {
        if (!games.has(n)) games.set(n, 0);
        games.set(n, (games.get(n) || 0) + 1);
        playedSet.add(n);
      });
    });
    byes.forEach((n) => {
      if (!byeC.has(n)) byeC.set(n, 0);
      byeC.set(n, (byeC.get(n) || 0) + 1);
    });
    const ga = [...games.values()];
    const ba = [...byeC.values()];
    return {
      gamesPlayedDifference: ga.length ? Math.max(...ga) - Math.min(...ga) : 0,
      byeDifference: ba.length ? Math.max(...ba) - Math.min(...ba) : 0,
      gamesPlayed: Object.fromEntries(games),
      byeCount: Object.fromEntries(byeC)
    };
  };

  /* ---------- Exports ---------- */

  const _exports = {
    planNormalAmericanoRound,
    computeRoundCapacity,
    buildHistory,
    pickByeAndActive,
    buildMatchesForActive,
    validateRound,
    buildFairnessReport,
    pairKey,
    groupKey,
    teamVsTeamKey
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = _exports;
  } else {
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    g.PadelioNormalAmericano = _exports;
    g.planNormalAmericanoRound = planNormalAmericanoRound;
    if (g.Padelio && typeof g.Padelio === 'object') {
      g.Padelio.planNormalAmericanoRound = planNormalAmericanoRound;
      g.Padelio.computeRoundCapacity = computeRoundCapacity;
      g.Padelio.buildNormalFairnessReport = buildFairnessReport;
    }
  }
})();
