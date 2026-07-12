/* =========================
   Padelio / scoring.js
   Pure functions: match scoring profiles, leaderboard computation.
   No DOM, no state — safe for unit testing in Node.js.

   Browser:  loaded before script.js → populates window.Padelio
   Node.js:  require('./scoring.js') → returns the same object
   ========================= */
(() => {
  'use strict';

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

  /* ---------- mode helpers ---------- */
  const isMexicanoFamilyMode = (m) =>
    m === 'mexicano' || m === 'mixmex' || m === 'fixedmex';

  /* ---------- games scoring (Mexicano best-of-N) ---------- */
  const gamesNeededToWinMatch = (bestOf) =>
    Math.max(1, Math.ceil((Number(bestOf) || 3) / 2));

  const gamesOppFromEntered = (entered, profile) => {
    const max = profile.bestOf;
    const s = clamp(Number(entered), 0, max);
    return max - s;
  };

  const isMexGamesScoreTie = (g1, g2) => {
    const a = Number(g1) || 0;
    const b = Number(g2) || 0;
    return a === b && a > 0;
  };

  const isMexMatchComplete = (g1, g2, profile) => {
    const W = profile.gamesTarget;
    const maxTotal = profile.bestOf;
    const a = Number(g1) || 0;
    const b = Number(g2) || 0;
    // All scheduled games played — including final ties (e.g. 2-2 in best of 4).
    if (a + b >= maxTotal) return true;
    if (isMexGamesScoreTie(a, b)) return false;
    const leader = Math.max(a, b);
    const trailer = Math.min(a, b);
    if (leader >= W && trailer >= W - 1) return true;
    if (leader >= W && leader > trailer && trailer >= 1 && a + b >= maxTotal - 1) return true;
    return false;
  };

  const mexGamesScoreHint = (profile) => {
    const W = profile.gamesTarget;
    const n = profile.bestOf;
    return `Best of ${n} · isi satu sisi, lawan otomatis (total ${n} game, mis. ${W}-${n - W}, ${Math.floor(n / 2)}-${Math.floor(n / 2)}) · menang = ${W} game`;
  };

  const normalizeMexGamesScores = (g1, g2, profile) => {
    const W = profile.gamesTarget;
    const maxTotal = profile.bestOf;
    let a = Math.max(0, Math.floor(Number(g1) || 0));
    let b = Math.max(0, Math.floor(Number(g2) || 0));

    a = Math.min(a, maxTotal);
    b = Math.min(b, maxTotal);

    if (a === b && a > 0 && a + b <= maxTotal && (a < W || a + b === maxTotal)) {
      return { g1: a, g2: b };
    }

    if (a >= W && b >= W) {
      if (a >= b) b = Math.min(b, W - 1, Math.max(0, maxTotal - a));
      else a = Math.min(a, W - 1, Math.max(0, maxTotal - b));
    }
    if (a >= W) b = Math.min(b, Math.max(0, maxTotal - a));
    if (b >= W) a = Math.min(a, Math.max(0, maxTotal - b));

    while (a + b > maxTotal) {
      if (a >= b && a > 0) a--;
      else if (b > 0) b--;
      else break;
    }

    return { g1: a, g2: b };
  };

  const applyMexGamesScoresToMatch = (match, profile, g1, g2) => {
    const norm = normalizeMexGamesScores(g1, g2, profile);
    match.score1 = norm.g1;
    match.score2 = norm.g2;
    return norm;
  };

  const canAwardMexGame = (match, profile) => {
    const g1 = Number(match.score1) || 0;
    const g2 = Number(match.score2) || 0;
    if (isMexGamesScoreTie(g1, g2)) return false;
    return !isMexMatchComplete(g1, g2, profile);
  };

  /* ---------- scoring profile ---------- */
  /**
   * Rally (mirror) vs best-of games, available for every tournament mode.
   *
   * Reads the generic `score_kind` / `best_of_games` fields first. Falls back to
   * the legacy Mexicano-only `mex_score_kind` / `mex_best_of_games` fields (only
   * consulted for Mexicano-family modes, matching the old behavior) so older
   * saved tournaments and share links keep working unchanged. Anything else —
   * including tournaments with no scoring-kind field at all — defaults to rally,
   * so existing data can never silently become games mode.
   */
  const getTournamentScoringProfile = (t) => {
    const mode = t?.mode || 'normal';
    const legacyMexKind = isMexicanoFamilyMode(mode) ? t?.mex_score_kind : null;
    const kind = t?.score_kind || legacyMexKind || 'rally';

    if (kind === 'games') {
      const bestOf = Math.min(
        7,
        Math.max(3, Number(t?.best_of_games ?? t?.mex_best_of_games) || 3)
      );
      return {
        style: 'games',
        rallyCap: null,
        gamesTarget: gamesNeededToWinMatch(bestOf),
        bestOf,
        mirrorOpp: false
      };
    }
    return {
      style: 'rally',
      rallyCap: Number(t?.points_to_win) || 21,
      gamesTarget: null,
      bestOf: null,
      mirrorOpp: true
    };
  };

  /* ---------- leaderboard ---------- */
  /**
   * Legacy constant exported for backward compatibility. The current +M
   * compensation is computed dynamically from real completed match data
   * (see `applyMatchCompensationToLeaderboardRows`), so this is no longer
   * used to scale points.
   */
  const MATCH_COMPENSATION_POINTS_PER_GAP = 0;

  const formatLeaderboardDiff = (diff) => {
    const n = Number(diff) || 0;
    return n > 0 ? `+${n}` : String(n);
  };

  /**
   * +M compensation:
   *   averagePointsPerPlayerPerMatch = totalIndividualPoints / totalPlayerAppearances
   *   missedMatchCount = maxGamesPlayed - playerGamesPlayed
   *   matchComp = round(averagePointsPerPlayerPerMatch × missedMatchCount)
   *   adjustedPoints = totalPoints + matchComp
   *
   * Compensation is 0 when every player has the same match count or no
   * completed matches exist yet. The function returns new row objects with
   * `pointsRaw`, `matchComp`, `matchCompGap`, `matchCompAverage` populated and
   * `points` rewritten to the adjusted value.
   *
   * @param {Array<{matches?: number, points?: number}>} rows
   * @returns {typeof rows}
   */
  const applyMatchCompensationToLeaderboardRows = (rows) => {
    if (!rows?.length) return rows || [];
    let maxMatches = 0;
    let totalAppearances = 0;
    let totalPoints = 0;
    for (const r of rows) {
      const m = Number(r.matches) || 0;
      if (m > maxMatches) maxMatches = m;
      totalAppearances += m;
      totalPoints += Number(r.points) || 0;
    }
    const average = totalAppearances > 0 ? totalPoints / totalAppearances : 0;
    return rows.map((r) => {
      const pointsRaw = Number(r.points) || 0;
      const matches = Number(r.matches) || 0;
      const gap = maxMatches > 0 ? Math.max(0, maxMatches - matches) : 0;
      const matchComp = gap > 0 ? Math.round(average * gap) : 0;
      return {
        ...r,
        pointsRaw,
        matchComp,
        matchCompGap: gap,
        matchCompAverage: average,
        points: pointsRaw + matchComp
      };
    });
  };

  const annotateLeaderboardRowsWithoutCompensation = (rows) =>
    (rows || []).map((r) => ({
      ...r,
      pointsRaw: Number(r.points) || 0,
      matchComp: 0,
      matchCompGap: 0,
      matchCompAverage: 0
    }));

  /**
   * Standings sort:
   *   points mode  -> adjustedPoints, winRate, diff, pointsRaw, matches asc, name
   *   winRate mode -> winRate, wins, adjustedPoints, diff, matches, name
   */
  const sortLeaderboardRows = (rows, sortMode) => {
    const byWinRate = sortMode === 'winRate';
    const adj = (r) => Number(r.points) || 0;
    const raw = (r) => (r.pointsRaw != null ? Number(r.pointsRaw) : Number(r.points) || 0);
    return [...rows].sort((a, b) => {
      if (byWinRate) {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        if (b.wins !== a.wins) return b.wins - a.wins;
        const ap = adj(a);
        const bp = adj(b);
        if (bp !== ap) return bp - ap;
        if (b.diff !== a.diff) return b.diff - a.diff;
        if (b.matches !== a.matches) return b.matches - a.matches;
        return String(a.name).localeCompare(String(b.name));
      }
      const ap = adj(a);
      const bp = adj(b);
      if (bp !== ap) return bp - ap;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.diff !== a.diff) return b.diff - a.diff;
      const ar = raw(a);
      const br = raw(b);
      if (br !== ar) return br - ar;
      if (a.matches !== b.matches) return a.matches - b.matches;
      return String(a.name).localeCompare(String(b.name));
    });
  };

  /**
   * @param {object} tournamentLike  - object with .players (JSON string) and .rounds (JSON string)
   * @param {'points'|'winRate'} [sortMode]
   * @param {{ applyMatchCompensation?: boolean }} [opts] Default true for standings UI; false for Swiss/pairing order.
   */
  const computeLeaderboardSorted = (tournamentLike, sortMode = 'points', opts = {}) => {
    const applyComp = opts.applyMatchCompensation !== false;
    const players = normalizePlayers(safeJsonParse(tournamentLike?.players, [])).map((p) => p.name);
    const rounds = safeJsonParse(tournamentLike?.rounds, []);
    const rosterResolve = makeRosterNameResolve(players);

    const scores = {};
    players.forEach((p) => {
      scores[p] = { points: 0, conceded: 0, wins: 0, losses: 0, ties: 0, matches: 0 };
    });

    rounds.forEach((round) => {
      (round.matches || []).forEach((match) => {
        const s1 = match.score1;
        const s2 = match.score2;

        const hasScore = (s1 !== '' && s1 != null) || (s2 !== '' && s2 != null);
        if (!hasScore) return;
        if (Number(s1) === 0 && Number(s2) === 0) return;

        const score1 = Number(s1) || 0;
        const score2 = Number(s2) || 0;

        const apply = (fn) => {
          match.team1?.forEach((raw) => {
            const p = rosterResolve(raw);
            if (scores[p]) fn(p, 1);
          });
          match.team2?.forEach((raw) => {
            const p = rosterResolve(raw);
            if (scores[p]) fn(p, 2);
          });
        };

        apply((p, side) => {
          scores[p].points += side === 1 ? score1 : score2;
          scores[p].conceded += side === 1 ? score2 : score1;
        });

        if (score1 > score2) {
          apply((p, side) => {
            if (side === 1) scores[p].wins++;
            else scores[p].losses++;
          });
        } else if (score2 > score1) {
          apply((p, side) => {
            if (side === 2) scores[p].wins++;
            else scores[p].losses++;
          });
        } else {
          apply((p) => { scores[p].ties++; });
        }

        apply((p) => { scores[p].matches++; });
      });
    });

    const rows = Object.entries(scores).map(([name, data]) => {
      const winRate = data.matches > 0 ? (data.wins / data.matches) * 100 : 0;
      const diff = data.points - data.conceded;
      return { name, ...data, winRate, diff };
    });
    const enriched = applyComp
      ? applyMatchCompensationToLeaderboardRows(rows)
      : annotateLeaderboardRowsWithoutCompensation(rows);
    return sortLeaderboardRows(enriched, sortMode);
  };

  /* ---------- dual export ---------- */
  const _exports = {
    isMexicanoFamilyMode,
    gamesNeededToWinMatch,
    gamesOppFromEntered,
    isMexGamesScoreTie,
    isMexMatchComplete,
    mexGamesScoreHint,
    normalizeMexGamesScores,
    applyMexGamesScoresToMatch,
    canAwardMexGame,
    getTournamentScoringProfile,
    MATCH_COMPENSATION_POINTS_PER_GAP,
    formatLeaderboardDiff,
    applyMatchCompensationToLeaderboardRows,
    annotateLeaderboardRowsWithoutCompensation,
    sortLeaderboardRows,
    computeLeaderboardSorted,
    MIN_PLAYER_LEVEL,
    MAX_PLAYER_LEVEL,
    DEFAULT_PLAYER_LEVEL
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = _exports;
  } else {
    window.Padelio = Object.assign(window.Padelio || {}, _exports);
  }
})();
