/* =========================
   Padelio / Padel Americano
   Refactor: cleaner state, safer JSON, debounced saves, stable round viewing
   ========================= */

(() => {
  'use strict';

  /* ---------- DOM helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------- small utils ---------- */
  let adsInitialized = false;

  function updateAdVisibility(page) {
    const adWrap = document.getElementById('content-ad-wrap');
    const contentPages = ['home', 'about', 'privacy', 'terms'];

    if (!adWrap) return;

    const shouldShowAd = contentPages.includes(page);

    if (!shouldShowAd) {
      adWrap.classList.add('hidden');
      return;
    }

    adWrap.classList.remove('hidden');

    if (!adsInitialized && window.adsbygoogle) {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        adsInitialized = true;
      } catch (err) {
        console.error('AdSense init error:', err);
      }
    }
  }
  
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const safeJsonParse = (val, fallback) => {
    if (val == null) return fallback;
    if (typeof val !== 'string') return val; // already object/array
    try {
      const out = JSON.parse(val);
      return out == null ? fallback : out;
    } catch {
      return fallback;
    }
  };

  const _escDiv = document.createElement('div');
  const escapeHtml = (text) => {
    _escDiv.textContent = String(text ?? '');
    return _escDiv.innerHTML;
  };

  const TOAST_DURATION_MS = 3200;
  const toast = (message) => {
    const prev = document.getElementById('app-toast');
    if (prev) prev.remove();

    const wrap = document.createElement('div');
    wrap.id = 'app-toast';
    wrap.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]';

    const card = document.createElement('div');
    card.className =
      'relative min-w-[260px] max-w-[88vw] px-4 py-3 pr-10 rounded-2xl border border-emerald-400/55 dark:border-emerald-300/35 bg-emerald-50/95 dark:bg-emerald-500/20 backdrop-blur-md text-emerald-950 dark:text-emerald-50 shadow-[0_14px_38px_-14px_rgba(16,185,129,0.28)] dark:shadow-[0_14px_38px_-14px_rgba(16,185,129,0.65)]';
    card.style.opacity = '0';
    card.style.transition = 'opacity 180ms ease';

    const text = document.createElement('div');
    text.className = 'font-semibold text-sm leading-snug';
    text.textContent = String(message || '');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close notification');
    closeBtn.className =
      'absolute top-1.5 right-1.5 w-7 h-7 rounded-full text-emerald-800 dark:text-emerald-100/90 hover:text-slate-900 dark:hover:text-white hover:bg-emerald-400/25 transition-colors text-base leading-none';
    closeBtn.textContent = '×';

    const timer = document.createElement('div');
    timer.className =
      'absolute left-2 right-2 bottom-1 h-0.5 rounded-full bg-emerald-600/35 dark:bg-emerald-200/80 origin-left';
    timer.style.width = '100%';
    timer.style.transition = `width ${TOAST_DURATION_MS}ms linear`;

    card.appendChild(text);
    card.appendChild(closeBtn);
    card.appendChild(timer);
    wrap.appendChild(card);
    document.body.appendChild(wrap);

    let closed = false;
    const removeToast = () => {
      if (closed) return;
      closed = true;
      clearTimeout(removeTimer);
      wrap.remove();
    };

    closeBtn.addEventListener('click', removeToast, { once: true });
    const removeTimer = setTimeout(removeToast, TOAST_DURATION_MS);

    requestAnimationFrame(() => {
      card.style.opacity = '1';
      timer.style.width = '0%';
    });

  };
  const TOAST_AFTER_RELOAD_KEY = 'padelio_toast_after_reload';
  const queueToastAfterReload = (message) => {
    try {
      sessionStorage.setItem(TOAST_AFTER_RELOAD_KEY, String(message || '').trim());
    } catch {}
  };
  const flushQueuedToast = () => {
    try {
      const msg = sessionStorage.getItem(TOAST_AFTER_RELOAD_KEY);
      if (!msg) return;
      sessionStorage.removeItem(TOAST_AFTER_RELOAD_KEY);
      setTimeout(() => toast(msg), 160);
    } catch {}
  };

  const debounce = (fn, wait) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  const normalizeNameKey = (s) => String(s ?? '').trim().toLowerCase();

  /** Known display typos → canonical name (case as shown). */
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

  /** Same key for roster + add flow: trim, typo map, then case-insensitive compare. */
  const playerNameDuplicateKey = (name) =>
    normalizeNameKey(fixCommonNameTypos(String(name ?? '').trim()));

  const hasDuplicatePlayerNames = (arr) => {
    const seen = new Set();
    for (const p of normalizePlayers(arr)) {
      const k = playerNameDuplicateKey(p.name);
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  };

  const countGender = (players) => {
    const norm = normalizePlayers(players);
    let m = 0, f = 0;
    norm.forEach(p => {
      if (p.gender === 'M') m++;
      if (p.gender === 'F') f++;
    });
    return { m, f, total: norm.length };
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
    const x = String(a || '');
    const y = String(b || '');
    return x < y ? `${x}__${y}` : `${y}__${x}`;
  };

  /** Map match / roster spelling to one canonical roster label (incl. common typos). */
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

  /**
   * Mexicano court ladder: winners move up (toward court 1), losers move down.
   * Court 1 is the top / winners court when multiple courts exist.
   */
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

  /** Fill courts 1..N with quads of four; prefer players whose ladder target matches that court. */
  const orderActiveForMexicanoCourts = (
    active,
    targetCourtByName,
    standingsOrder,
    maxCourts
  ) => {
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

  /**
   * Swiss-system court ordering: rank active players purely by their global standings position.
   * Top 4 -> court 1, next 4 -> court 2, etc. Players missing from standings (e.g. zero points)
   * appended in roster order to keep stable behavior.
   */
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

  /**
   * Swiss-system court ordering for fixed pairs by combined team points.
   * Top pair -> court 1 slot 1, second pair -> court 1 slot 2 (1v2), etc.
   */
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

  const matchupKey = (p1, p2) => {
    const t1 = pairKey(p1.m, p1.f);
    const t2 = pairKey(p2.m, p2.f);
    return t1 < t2 ? `${t1}||${t2}` : `${t2}||${t1}`;
  };

  const groupKeyOf4 = (a, b, c, d) =>
    [a, b, c, d].map(String).sort().join('|');

  const getPlayersFull = () => {
    const raw = safeJsonParse(state.currentTournament?.players, []);
    return normalizePlayers(raw); // [{name, gender, level}]
  };

  const getPlayersFullFromTournament = (t) => {
    const raw = safeJsonParse(t?.players, []);
    return normalizePlayers(raw);
  };

  const getMaxCourtsForTournament = (t) => {
    if (!t) return 1;
    const mode = t.mode || 'normal';
    const playersFull = getPlayersFullFromTournament(t);
    if (isMixLikeMode(mode)) {
      const males = playersFull.filter((p) => p.gender === 'M').length;
      const females = playersFull.filter((p) => p.gender === 'F').length;
      return Math.max(1, Math.min(10, Math.floor(males / 2), Math.floor(females / 2)));
    }
    const capByPlayers = Math.floor(playersFull.length / 4);
    return Math.max(1, Math.min(10, capByPlayers));
  };

  const isFixedPairRosterMode = (m) => m === 'fixed' || m === 'fixedmex';

  const isMixLikeMode = (m) => m === 'mix' || m === 'mixmex';

  const getPlayersOnCourtInRound = (roundData, resolve) => {
    const onCourt = new Set();
    if (!roundData?.matches) return onCourt;
    roundData.matches.forEach((m) => {
      ['team1', 'team2'].forEach((side) => {
        (m[side] || []).forEach((raw) => {
          const key = playerNameDuplicateKey(resolve(raw));
          if (key) onCourt.add(key);
        });
      });
    });
    return onCourt;
  };

  const roundHasScoreActivity = (roundData) => {
    if (!roundData?.matches?.length) return false;
    for (const m of roundData.matches) {
      const s1 = m.score1;
      const s2 = m.score2;
      const hasScore =
        (s1 !== '' && s1 != null) || (s2 !== '' && s2 != null);
      if (hasScore && !(Number(s1) === 0 && Number(s2) === 0)) return true;
      const mg = m.mx_game;
      if (mg && (Number(mg.i1) > 0 || Number(mg.i2) > 0)) return true;
    }
    return false;
  };

  const canRegenerateRound = (roundNo) => {
    if (state.shareViewerMode || !state.currentTournament) return false;
    const cr = Number(state.currentTournament.current_round) || 1;
    const rn = Number(roundNo) || 1;
    if (rn !== cr) return false;
    const rounds = getRounds();
    const roundData = rounds.find((r) => Number(r.round) === rn);
    if (!roundData) return false;
    return !roundHasScoreActivity(roundData);
  };

  const computeBenchForRound = (roundData, tournamentLike) => {
    if (!roundData || !tournamentLike) {
      return { kind: 'none', count: 0, males: [], females: [], players: [], pairs: [] };
    }
    const mode = tournamentLike.mode || 'normal';
    const playersFull = getPlayersFullFromTournament(tournamentLike);
    const rosterNames = playersFull.map((p) => p.name);
    const resolve = makeRosterNameResolve(rosterNames);
    const onCourt = getPlayersOnCourtInRound(roundData, resolve);

    if (isFixedPairRosterMode(mode)) {
      const benchPairs = [];
      const benchIndividuals = [];
      for (let i = 0; i + 1 < playersFull.length; i += 2) {
        const n1 = playersFull[i].name;
        const n2 = playersFull[i + 1].name;
        const k1 = playerNameDuplicateKey(resolve(n1));
        const k2 = playerNameDuplicateKey(resolve(n2));
        const on1 = onCourt.has(k1);
        const on2 = onCourt.has(k2);
        if (!on1 && !on2) {
          benchPairs.push(`${fixCommonNameTypos(n1)} & ${fixCommonNameTypos(n2)}`);
        } else if (!on1) {
          benchIndividuals.push(fixCommonNameTypos(n1));
        } else if (!on2) {
          benchIndividuals.push(fixCommonNameTypos(n2));
        }
      }
      if (playersFull.length % 2 === 1) {
        const lone = playersFull[playersFull.length - 1].name;
        const kl = playerNameDuplicateKey(resolve(lone));
        if (!onCourt.has(kl)) benchIndividuals.push(fixCommonNameTypos(lone));
      }
      const count = benchPairs.length + benchIndividuals.length;
      return { kind: 'fixed', count, pairs: benchPairs, players: benchIndividuals };
    }

    if (isMixLikeMode(mode)) {
      const males = [];
      const females = [];
      playersFull.forEach((p) => {
        const k = playerNameDuplicateKey(resolve(p.name));
        if (onCourt.has(k)) return;
        if (p.gender === 'F') females.push(p.name);
        else males.push(p.name);
      });
      return { kind: 'mix', count: males.length + females.length, males, females };
    }

    const players = playersFull
      .map((p) => p.name)
      .filter((n) => !onCourt.has(playerNameDuplicateKey(resolve(n))));
    return { kind: 'players', count: players.length, players };
  };

  const renderBenchHtml = (bench) => {
    const chip = (label) =>
      `<span class="inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-semibold bg-amber-100/95 text-amber-900 dark:bg-amber-500/20 dark:text-amber-50 border border-amber-300/60 dark:border-amber-500/35">${escapeHtml(fixCommonNameTypos(label))}</span>`;
    if (bench.count === 0) return '';
    if (bench.kind === 'mix') {
      let html = '';
      if (bench.males.length) {
        html +=
          `<div class="mb-2"><span class="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Male bench</span>` +
          `<div class="flex flex-wrap gap-1.5 mt-1">${bench.males.map((n) => chip(n)).join('')}</div></div>`;
      }
      if (bench.females.length) {
        html +=
          `<div><span class="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Female bench</span>` +
          `<div class="flex flex-wrap gap-1.5 mt-1">${bench.females.map((n) => chip(n)).join('')}</div></div>`;
      }
      return html;
    }
    if (bench.kind === 'fixed') {
      const items = [...bench.pairs, ...bench.players];
      return `<div class="flex flex-wrap gap-1.5">${items.map((n) => chip(n)).join('')}</div>`;
    }
    return `<div class="flex flex-wrap gap-1.5">${bench.players.map((n) => chip(n)).join('')}</div>`;
  };

  const buildMixHistory = () => {
    const rounds = getRounds();
    const partnerCount = new Map();  // key: pairKey(M,F) => times partnered
    const opposeCount = new Map();   // key: pairKey(A,B) => times opposed (any gender)
    const matchupCount = new Map();  // key: matchupKey(pair,pair) => times faced as full pairs

    rounds.forEach((r) => {
      (r.matches || []).forEach((m) => {
        const t1 = m.team1 || [];
        const t2 = m.team2 || [];

        // partners
        if (t1.length === 2) {
          const k = pairKey(t1[0], t1[1]);
          partnerCount.set(k, (partnerCount.get(k) || 0) + 1);
        }
        if (t2.length === 2) {
          const k = pairKey(t2[0], t2[1]);
          partnerCount.set(k, (partnerCount.get(k) || 0) + 1);
        }

        // opponents: everyone in t1 vs everyone in t2
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

  const buildMixHistoryFromRounds = (rounds) => {
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

  const buildMexicanoHistoryFromRounds = (rounds) => {
    const base = buildMixHistoryFromRounds(rounds);
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

  /** Cross-team opposition score for two pairs {m,f} (names; gender not required). */
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

  /** Fixed Americano: how often two fixed teams already faced each other (partners unchanged). */
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

  /** Enumerate all ways to split active fixed teams into court matches (small groups only). */
  const enumerateFixedPairMatchings = (pairs, out) => {
    if (pairs.length === 0) {
      out.push([]);
      return;
    }
    if (pairs.length < 2) return;
    const [p0, ...rest] = pairs;
    for (let i = 0; i < rest.length; i++) {
      const p1 = rest[i];
      const remaining = rest.filter((_, idx) => idx !== i);
      const sub = [];
      enumerateFixedPairMatchings(remaining, sub);
      for (const sm of sub) {
        out.push([[p0, p1], ...sm]);
      }
    }
  };

  const buildBestFixedPairMatchesExhaustive = (
    selectedPairs,
    matchupCount,
    opposeCount,
    lastRoundMatchups
  ) => {
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

  /**
   * Normal mode only: levels 1–5. Map canonical roster name -> level.
   * When all players share one level, spread is 0 and pairing ignores power terms.
   */
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

  /** Weaker than partnerCount*100; nudges L+H style partners when levels vary. */
  const POWER_LEVEL_PARTNER_ALPHA = 8;
  /** Weaker than matchup*200; nudges even team strength on a court. */
  const POWER_LEVEL_MATCH_BETA = 4;

  /** Consecutive rounds benched, counting only from the latest round backward. */
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

  /** Benched streak for a fixed team — the pair sits or plays together. */
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

  /** Teammate pairs from the immediately previous round (by round number). */
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

  const isMexicanoFamilyMode = (m) =>
    m === 'mexicano' || m === 'mixmex' || m === 'fixedmex';

  const gamesNeededToWinMatch = (bestOf) =>
    Math.max(1, Math.ceil((Number(bestOf) || 3) / 2));

  /** Mexicano best-of: complementary games (BO4 → 3|1, 2|2, 1|3, 0|4). */
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

  /** Which fixed teams (pair keys) played in the previous round. */
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

  const canAwardMexGame = (match, profile) => {
    const g1 = Number(match.score1) || 0;
    const g2 = Number(match.score2) || 0;
    if (isMexGamesScoreTie(g1, g2)) return false;
    return !isMexMatchComplete(g1, g2, profile);
  };

  const mexGamesScoreHint = (profile) => {
    const W = profile.gamesTarget;
    const n = profile.bestOf;
    return `Best of ${n} · isi satu sisi, lawan otomatis (total ${n} game, mis. ${W}-${n - W}, ${Math.floor(n / 2)}-${Math.floor(n / 2)}) · menang = ${W} game`;
  };

  /** Best-of games: 0..bestOf per side, total ≤ bestOf, seri below win target (e.g. 1-1). */
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

  /**
   * Rally (mirror) vs best-of games, available for every tournament mode.
   *
   * Reads the generic `score_kind` / `best_of_games` fields first. Falls back to
   * the legacy Mexicano-only `mex_score_kind` / `mex_best_of_games` fields (only
   * consulted for Mexicano-family modes, matching the old behavior) so older
   * saved tournaments and share links keep working unchanged. Anything else —
   * including tournaments with no scoring-kind field at all — defaults to rally.
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

  /** Prefer classic 1+2 vs 3+4 when anti-repeat / balance scores tie. */
  const MEXICANO_CLASSIC_SPLIT_BIAS = 38;
  const MEX_W_OPPONENT = 10000;
  const MEX_W_OPPONENT_REPEAT2 = 50000;
  const MEX_B_NEW_OPPONENT = 2000;
  const MEX_W_MEETING = 300;

  const mexLexLess = (a, b) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] < b[i]) return true;
      if (a[i] > b[i]) return false;
    }
    return false;
  };

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

  const scoreMexicanoTwoTeams = (
    team1,
    team2,
    history,
    lastRoundPartnerSet,
    resolve,
    levelByName
  ) => {
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

  /** Pick 1+2 vs 3+4, 1+3 vs 2+4, or 1+4 vs 2+3 — classic wins on ties. */
  const pickBestMexicanoQuadSplit = (
    quadNames,
    history,
    lastRoundPartnerSet,
    resolve,
    levelByName
  ) => {
    const [a, b, c, d] = quadNames;
    const splits = [
      { classic: true, t1: [a, b], t2: [c, d] },
      { classic: false, t1: [a, c], t2: [b, d] },
      { classic: false, t1: [a, d], t2: [b, c] }
    ];
    let best = null;
    let bestLex = null;
    for (const sp of splits) {
      let sc = scoreMexicanoTwoTeams(
        sp.t1, sp.t2, history, lastRoundPartnerSet, resolve, levelByName
      );
      if (!sp.classic) sc += MEXICANO_CLASSIC_SPLIT_BIAS;
      const pairA = { m: resolve(sp.t1[0]), f: resolve(sp.t1[1]) };
      const pairB = { m: resolve(sp.t2[0]), f: resolve(sp.t2[1]) };
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
      if (!bestLex || mexLexLess(tuple, bestLex)) {
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
    levelByName
  ) => {
    const [a, b, c, d] = quadNames;
    const splits = [
      { classic: true, t1: [a, b], t2: [c, d] },
      { classic: false, t1: [a, c], t2: [b, d] },
      { classic: false, t1: [a, d], t2: [b, c] }
    ];
    let best = null;
    let bestLex = null;
    for (const sp of splits) {
      let sc = scoreNormalMexicanoMatch(
        sp.t1, sp.t2, history, lastRoundPartnerSet, lastRoundMatchupSet, resolve, levelByName
      );
      if (!sp.classic) sc += NORMAL_MEX_CLASSIC_SPLIT_BIAS;
      const pairA = { m: resolve(sp.t1[0]), f: resolve(sp.t1[1]) };
      const pairB = { m: resolve(sp.t2[0]), f: resolve(sp.t2[1]) };
      const m = mexNormalSplitLexMetrics(
        sp.t1, sp.t2, history, lastRoundMatchupSet, resolve
      );
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

  const TENNIS_PTS_LABEL = ['0', '15', '30', '40'];

  /**
   * Fair bench for Normal/Balanced: always prefer people with fewer games played, then bangku minggu lalu,
   * then who sat out the longest streak. RNG only breaks ties inside an equivalent fairness tier.
   */
  /** Sort key only — RNG lives in shuffleFairnessRuns for tied tiers. */
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

    // Round 1 is deterministic: first listed players enter first.
    if (!lastRound) return allNames.slice(0, slots);

    const ordered = shuffleFairnessRuns(keyed);
    return ordered.slice(0, slots).map((x) => x.name);
  };

  /**
   * Mix Americano active selector: same fairness ordering as Normal, but split
   * per gender so every round still produces 2M + 2F per court.
   * Returns { activeM, activeF, effectiveCourts }; empty arrays when no court
   * can be filled with at least 2M + 2F.
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
      return { activeM: [], activeF: [], effectiveCourts: 0 };
    }

    const need = effectiveCourts * 2;
    const activeM = pickActivePlayersNormal(males, need, allRounds, roundNo);
    const activeF = pickActivePlayersNormal(females, need, allRounds, roundNo);
    return { activeM, activeF, effectiveCourts };
  };

  /** Fixed-pair mode: same two players always one team; bench/fairness at team level. */
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
            if (playCount.has(k)) {
              playCount.set(k, (playCount.get(k) || 0) + 1);
            }
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

  /**
   * Mexicano-style benching for indivisible fixed teams (pair = two players on court or neither).
   * If too many teams "must play", falls back to Americano-style `pickActiveFixedPairs`.
   */
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
            if (playCount.has(k2)) {
              playCount.set(k2, (playCount.get(k2) || 0) + 1);
            }
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
      if (!taken.has(k2)) {
        taken.add(k2);
        selected.push(p);
      }
    });

    const n = allPairs.length;
    const keyToIdx = new Map(allPairs.map((p, i) => [tKey(p), i]));
    const rot = ((Number(roundNo) || 1) - 1 + n * 100) % n;

    const pool = allPairs.filter((p) => !taken.has(tKey(p)));
    const keyed = pool.map((p) => {
      const tk = tKey(p);
      return {
        pair: p,
        key: tk,
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
      if (!taken.has(x.key)) {
        taken.add(x.key);
        selected.push(x.pair);
      }
    });

    return selected.slice(0, pairSlots);
  };

  /**
   * Fixed Americano: partners stay fixed; pick opponents to spread team-vs-team matchups.
   */
  const buildBestFixedPairMatches = (selectedPairs, history, lastRoundMatchups) => {
    const { opposeCount, matchupCount } = history;
    const k = selectedPairs.length;
    if (k < 2 || k % 2 !== 0) return [];
    const numCourts = k / 2;
    const lastMu = lastRoundMatchups || new Set();

    if (k <= 12) {
      const exact = buildBestFixedPairMatchesExhaustive(
        selectedPairs,
        matchupCount,
        opposeCount,
        lastMu
      );
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
          const pairScore = scoreFixedPairCourtMatch(
            p1, p2, matchupCount, opposeCount, lastMu
          );
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

  /**
   * Mexicano bench fairness: everyone who sat out last round MUST play this round (when n > slots).
   * Remaining slots: lowest total games, then longest bench streak, then rotation tie-break.
   */
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
      if (!taken.has(n)) {
        taken.add(n);
        selected.push(n);
      }
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
      if (!taken.has(x.name)) {
        taken.add(x.name);
        selected.push(x.name);
      }
    });

    return selected.slice(0, slots);
  };

  /* ---------- Normal Mexicano: dynamic capacity & fairness-first active/bye ---------- */

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
    if (combos.length === 0) {
      combos.push([...forced, ...boundary.members.slice(0, pickN)]);
    }
    return combos;
  };

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
    if (combos.length === 0) {
      combos.push([...forced, ...keyed.slice(0, remaining).map((x) => x.name)]);
    }
    return combos;
  };

  const buildNormalMexicanoRoundFromActive = (
    players,
    active,
    usedCourts,
    rounds,
    roundNo,
    tournament
  ) => {
    const rn = Number(roundNo) || 1;
    const tSub = {
      ...tournament,
      rounds: JSON.stringify(
        safeJsonParse(tournament?.rounds, []).filter((r) => Number(r.round) < rn)
      )
    };
    const history = buildMexicanoHistoryFromRounds(rounds);
    const prevRound = getPreviousRoundDatum(rounds, roundNo);
    const resolve = makeRosterNameResolve(players);
    const lastRoundPartnerSet = getLastRoundPartnerSet(prevRound, resolve);
    const lastRoundMatchupSet = getLastRoundMatchupSet(prevRound, resolve);
    const levelByName = makeLevelByNameMap(getPlayersFull());

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
        quad, history, lastRoundPartnerSet, lastRoundMatchupSet, resolve, levelByName
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

  /* ---------- Mix Mexicano (isolated from Normal Mexicano; 2M+2F per court) ---------- */
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
      maleByesPerRound: Math.max(0, m - playingPerGender),
      femaleByesPerRound: Math.max(0, f - playingPerGender)
    };
  };

  const computeMixMexicanoSessionTargets = (maleCount, femaleCount, courts, roundCount) => {
    const cap = computeMixMexicanoRoundCapacity(maleCount, femaleCount, courts);
    const rounds = Math.max(0, Math.floor(Number(roundCount) || 0));
    const m = Math.max(0, Math.floor(Number(maleCount) || 0));
    const f = Math.max(0, Math.floor(Number(femaleCount) || 0));
    const slotsPerGender = rounds * cap.playingPerGender;
    return {
      ...cap,
      idealGamesPerMale: m > 0 ? slotsPerGender / m : 0,
      idealGamesPerFemale: f > 0 ? slotsPerGender / f : 0,
      idealByesPerMale: m > 0 ? (rounds * cap.maleByesPerRound) / m : 0,
      idealByesPerFemale: f > 0 ? (rounds * cap.femaleByesPerRound) / f : 0
    };
  };

  const enumerateMixMexicanoFairActiveSets = (pool, slotsNeeded, allRounds, roundNo, maxCandidates = 12) =>
    enumerateNormalMexicanoFairActiveSets(pool, 0, allRounds, roundNo, maxCandidates, slotsNeeded);

  const scoreMixMexicanoMatch = (
    team1,
    team2,
    history,
    lastRoundPartnerSet,
    lastRoundMatchupSet,
    resolve,
    levelByName
  ) => scoreNormalMexicanoMatch(
    team1, team2, history, lastRoundPartnerSet, lastRoundMatchupSet, resolve, levelByName
  );

  const pickBestMixMexicanoCourtPairing = (
    m0, m1, f0, f1,
    history,
    lastRoundPartnerSet,
    lastRoundMatchupSet,
    resolve,
    levelByName
  ) => {
    const options = [
      { parallel: true, t1: [m0, f0], t2: [m1, f1] },
      { parallel: false, t1: [m0, f1], t2: [m1, f0] }
    ];
    let best = null;
    let bestLex = null;
    for (const sp of options) {
      let sc = scoreMixMexicanoMatch(
        sp.t1, sp.t2, history, lastRoundPartnerSet, lastRoundMatchupSet, resolve, levelByName
      );
      if (!sp.parallel) sc += MIX_MEX_PARALLEL_BIAS;
      const m = mexNormalSplitLexMetrics(sp.t1, sp.t2, history, lastRoundMatchupSet, resolve);
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
    const history = buildMexicanoHistoryFromRounds(allRounds);
    const prevRound = getPreviousRoundDatum(allRounds, roundNo);
    const resolve = makeRosterNameResolve(rosterNames);
    const lastRoundPartnerSet = getLastRoundPartnerSet(prevRound, resolve);
    const lastRoundMatchupSet = getLastRoundMatchupSet(prevRound, resolve);
    const levelByName = makeLevelByNameMap(playersFull || getPlayersFull());

    const board = computeLeaderboardSorted(tSub, 'points', { applyMatchCompensation: false });
    const standingsOrder = board.map((row) => row.name);

    let orderedM;
    let orderedF;
    if (rn === 1) {
      orderedM = malesAll.filter((n) => new Set(activeM).has(n));
      orderedF = femalesAll.filter((n) => new Set(activeF).has(n));
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
   * Build teams with hard anti-repeat guard:
   * avoid using an exact teammate pair from previous round whenever possible.
   */
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
        if (s < bestScore) {
          bestScore = s;
          bestJ = j;
        }
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
          if (pairScore < bestPairScore) {
            bestPairScore = pairScore;
            bestJ = j;
          }
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

  function selectMode (mode) {
    if (mode === 'mix') state.newTournament.mode = 'mix';
    else if (mode === 'mixmex') state.newTournament.mode = 'mixmex';
    else if (mode === 'mexicano') state.newTournament.mode = 'mexicano';
    else if (mode === 'fixed') state.newTournament.mode = 'fixed';
    else if (mode === 'fixedmex') state.newTournament.mode = 'fixedmex';
    else if (mode === 'balanced') state.newTournament.mode = 'balanced';
    else state.newTournament.mode = 'normal';
    state.playerGenderDraft = 'M';
    state.newTournament.scoreKind = state.newTournament.scoreKind || 'rally';
    updateGenderUI();
    navigateTo('new-title');
  };

  function setPlayerGender (g) {
    state.playerGenderDraft = (g === 'F') ? 'F' : 'M';
    updateGenderUI();
  };

  function toggleGenderDraft () {
    state.playerGenderDraft = (state.playerGenderDraft === 'M') ? 'F' : 'M';
    updateGenderUI();
  };

  function updateGenderUI () {
    const isMix = isMixLikeMode(state.newTournament.mode);

    const btn = $('gender-toggle');
    const txt = $('gender-toggle-text');
    const hint = $('gender-balance-hint');

    if (btn) btn.classList.toggle('hidden', !isMix);

    if (txt) {
      txt.textContent = (state.playerGenderDraft === 'F') ? 'Female' : 'Male';
    }

    if (hint) {
      hint.classList.toggle('hidden', !isMix);
      if (isMix) {
        const { m, f } = countGender(state.newTournament.players);
        hint.textContent = `Current: Male ${m} • Female ${f} (must be equal to start)`;
      }
    }
  };

  /* ---------- App state ---------- */
  const state = {
    isEditingScore: false,
    lastRoundsView: null,
    viewingRound: null,
    deferredInstallPrompt: null,
    /** Read-only spectator mode when opening #p=… share link (no create/edit/delete). */
    shareViewerMode: false,
    shareViewerData: null,

    tournaments: [],
    currentTournament: null,

    playerGenderDraft: 'M',

    newTournament: {
      mode: 'normal', // 'normal' | 'balanced' | 'mix' | 'mixmex' | 'mexicano' | 'fixed' | 'fixedmex'
      title: '',
      courts: 0,
      /** 'number' = Court 1/2/3, 'letter' = Court A/B/C */
      courtStyle: 'number',
      points: 0,
      /** Every mode: 'rally' (target points) | 'games' (best-of, tennis-style current game). */
      scoreKind: 'rally',
      /** Best-of max games when scoreKind === 'games' (3–7); null until user picks. */
      bestOfGames: null,
      players: []
    },

    /** Leaderboard sub-view: detailed cards vs compact screenshot-friendly list. */
    hostLeaderboardLayout: 'standard',
    shareLeaderboardLayout: 'standard',
    /** Ranking: total points (Americano default) vs win rate % for display order. */
    hostLeaderboardSort: 'points',
    shareLeaderboardSort: 'points',
    /** Scope: 'individual' (per-player) vs 'pair' (per-fixed-team). Only meaningful for fixed/fixedmex. */
    hostLeaderboardScope: 'individual',
    shareLeaderboardScope: 'individual',
    /** Spectator mobile tab when rounds / leaderboard are not side-by-side. */
    shareMobileTab: 'leaderboard',
    /** Canonical player name currently being renamed on the host leaderboard (null = none). */
    lbRenamingFrom: null,
    /** Active match slot when opening the substitute-player modal. */
    substituteContext: null
  };

  const TOURNAMENT_DESKTOP_MQ = '(min-width: 1024px)';
  const isTournamentDesktopLayout = () => window.matchMedia(TOURNAMENT_DESKTOP_MQ).matches;

  const mountHostLeaderboardPanel = () => {
    const panel = $('host-leaderboard-panel');
    if (!panel) return;
    const slot = isTournamentDesktopLayout() ? $('host-lb-slot-desktop') : $('host-lb-slot-mobile');
    if (!slot || panel.parentElement === slot) return;
    slot.appendChild(panel);
  };

  const maybeRefreshDesktopLeaderboard = () => {
    if (!isTournamentDesktopLayout() || !state.currentTournament) return;
    if ($('page-rounds')?.classList.contains('hidden')) return;
    populateLeaderboardPanels(state.currentTournament, state.currentTournament.title || '');
  };

  const refreshHostTournamentDesktopUi = () => {
    mountHostLeaderboardPanel();
    const desktop = isTournamentDesktopLayout();
    const lbPage = $('page-leaderboard');
    if (desktop && lbPage && !lbPage.classList.contains('hidden')) {
      navigateTo('rounds');
      return;
    }
    if (desktop && state.currentTournament && !$('page-rounds')?.classList.contains('hidden')) {
      populateLeaderboardPanels(state.currentTournament, state.currentTournament.title || '');
      wireLeaderboardLayoutTabs();
    }
  };

  const refreshShareTournamentDesktopUi = () => {
    if (!state.shareViewerMode) return;
    const desktop = isTournamentDesktopLayout();
    if (desktop) {
      switchShareTab(state.shareMobileTab || 'leaderboard');
      applyShareLeaderboardLayoutUi();
      applyShareLeaderboardScopeUi(state.shareViewerData);
    } else {
      switchShareTab(state.shareMobileTab || 'leaderboard');
    }
  };

  let tournamentDesktopMqBound = false;
  const bindTournamentDesktopLayoutListener = () => {
    if (tournamentDesktopMqBound) return;
    tournamentDesktopMqBound = true;
    const mq = window.matchMedia(TOURNAMENT_DESKTOP_MQ);
    const onChange = () => {
      refreshHostTournamentDesktopUi();
      refreshShareTournamentDesktopUi();
    };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
  };

  const initTournamentDesktopLayout = () => {
    mountHostLeaderboardPanel();
    bindTournamentDesktopLayoutListener();
  };

  /** Locked in js/version.js — do not change here. */
  const APP_VERSION = typeof window.PADELIO_VERSION === 'string' ? window.PADELIO_VERSION : '1.6.15';

  const defaultConfig = { app_title: 'Padelio' };

  const refreshAppVersionLabel = () => {
    if (typeof window.padelioApplyVersionLabels === 'function') {
      window.padelioApplyVersionLabels();
      return;
    }
    const el = $('app-version');
    if (el) el.textContent = `Version ${APP_VERSION}`;
    const whatsNew = $('whats-new-version');
    if (whatsNew) whatsNew.textContent = `What’s new in ${APP_VERSION}`;
    const aboutV = $('about-app-version');
    if (aboutV) aboutV.textContent = `Version ${APP_VERSION}`;
    const spaAbout = $('spa-about-version');
    if (spaAbout) spaAbout.textContent = `Version ${APP_VERSION}`;
  };

  /* ---------- Round helpers ---------- */
  const syncCurrentTournament = () => {
    if (state.shareViewerMode) return;
    if (!state.currentTournament) return;
    const fresh = state.tournaments.find(
      (t) => t.__backendId === state.currentTournament.__backendId
    );
    if (!fresh) return;

    const curR = getRounds(); // uses cache — free if rounds haven't changed
    const freshR = safeJsonParse(fresh.rounds, []);
    const wCur = countRoundPlayerSlots(curR);
    const wFresh = countRoundPlayerSlots(freshR);

    // Avoid clobbering in-memory round history with a stale list copy (e.g. before onDataChanged).
    if (wFresh < wCur || freshR.length < curR.length) {
      state.currentTournament = {
        ...fresh,
        rounds: state.currentTournament.rounds,
        current_round: String(
          Math.max(Number(state.currentTournament.current_round) || 1, Number(fresh.current_round) || 1)
        )
      };
      return;
    }

    state.currentTournament = fresh;
    _roundsCache = { raw: null, data: [] }; // invalidate cache: tournament object replaced
  };

  // Avoid repeated JSON.parse on the same rounds string within a single user action.
  let _roundsCache = { raw: null, data: [] };

  const getRounds = () => {
    if (!state.currentTournament) return [];
    const raw = state.currentTournament.rounds ?? null;
    if (raw === _roundsCache.raw) return _roundsCache.data;
    const data = safeJsonParse(raw, []);
    _roundsCache = { raw, data };
    return data;
  };

  const setRounds = (roundsArr) => {
    if (!state.currentTournament) return;
    const raw = JSON.stringify(roundsArr);
    state.currentTournament.rounds = raw;
    const idx = state.tournaments.findIndex(
      (t) => t.__backendId === state.currentTournament.__backendId
    );
    if (idx >= 0) state.tournaments[idx] = { ...state.tournaments[idx], rounds: raw };
    _roundsCache = { raw, data: roundsArr };
  };

  const formatPlayerDisplayName = (raw) => {
    const resolved = fixCommonNameTypos(String(raw ?? '').trim());
    if (!resolved) return '';
    return resolved.charAt(0).toUpperCase() + resolved.slice(1);
  };

  const encodeLbPlayerAttr = (name) => encodeURIComponent(fixCommonNameTypos(String(name ?? '')));

  const decodeLbPlayerAttr = (encoded) => {
    try {
      return fixCommonNameTypos(decodeURIComponent(String(encoded ?? '')));
    } catch {
      return fixCommonNameTypos(String(encoded ?? ''));
    }
  };

  const playerNamesMatch = (a, b) =>
    playerNameDuplicateKey(a) === playerNameDuplicateKey(b);

  /** Update roster + all round team slots after a display-name change. */
  const renameTournamentPlayer = (oldName, newNameRaw) => {
    if (!state.currentTournament) {
      return { ok: false, error: 'No active tournament' };
    }

    const oldCanonical = fixCommonNameTypos(String(oldName ?? '').trim());
    if (!oldCanonical) return { ok: false, error: 'Player not found' };

    const formatted = formatPlayerDisplayName(newNameRaw);
    if (!formatted) return { ok: false, error: 'Name cannot be empty' };

    const players = getPlayersFull();
    const idx = players.findIndex((p) => playerNamesMatch(p.name, oldCanonical));
    if (idx < 0) return { ok: false, error: 'Player not found' };

    if (
      !playerNamesMatch(oldCanonical, formatted) &&
      players.some((p, i) => i !== idx && playerNamesMatch(p.name, formatted))
    ) {
      return { ok: false, error: 'That name is already in the list' };
    }

    players[idx].name = formatted;

    const oldKey = playerNameDuplicateKey(oldCanonical);
    const rounds = getRounds();
    rounds.forEach((round) => {
      (round.matches || []).forEach((match) => {
        ['team1', 'team2'].forEach((side) => {
          match[side] = (match[side] || []).map((raw) => {
            const fixed = fixCommonNameTypos(raw);
            return playerNameDuplicateKey(fixed) === oldKey ? formatted : fixed;
          });
        });
      });
    });

    state.currentTournament.players = JSON.stringify(players);
    setRounds(rounds);
    return { ok: true, name: formatted };
  };

  const getPlayersActiveInRound = (roundData, resolve) => {
    const busy = new Set();
    if (!roundData?.matches) return busy;
    roundData.matches.forEach((m) => {
      ['team1', 'team2'].forEach((side) => {
        (m[side] || []).forEach((raw) => {
          const key = resolve(raw);
          if (key) busy.add(playerNameDuplicateKey(key));
        });
      });
    });
    return busy;
  };

  const getSubstituteMatchContext = (roundNo, matchIdx, teamSide, slotIdx) => {
    const rounds = getRounds();
    const roundData = rounds.find((r) => Number(r.round) === Number(roundNo));
    if (!roundData?.matches?.[matchIdx]) return null;
    const match = roundData.matches[matchIdx];
    const side = teamSide === 'team2' ? 'team2' : 'team1';
    const slot = Number(slotIdx) === 1 ? 1 : 0;
    const team = match[side] || [];
    if (team.length < 2) return null;
    return {
      roundData,
      match,
      side,
      slot,
      outgoingName: fixCommonNameTypos(String(team[slot] ?? ''))
    };
  };

  const getRequiredSubstituteGender = (mode, playersFull, partnerName) => {
    if (!isMixLikeMode(mode)) return null;
    const partner = playersFull.find((p) => playerNamesMatch(p.name, partnerName));
    if (!partner?.gender) return null;
    return partner.gender === 'M' ? 'F' : 'M';
  };

  const isPlayerEligibleSubstitute = (
    player, outgoingName, busyKeys, partnerName, requiredGender
  ) => {
    if (playerNamesMatch(player.name, outgoingName)) return false;
    if (playerNamesMatch(player.name, partnerName)) return false;
    if (busyKeys.has(playerNameDuplicateKey(player.name))) return false;
    if (requiredGender && player.gender !== requiredGender) return false;
    return true;
  };

  const getEligibleSubstitutes = ({ roundNo, matchIdx, teamSide, slotIdx }) => {
    if (!state.currentTournament) return [];
    const ctx = getSubstituteMatchContext(roundNo, matchIdx, teamSide, slotIdx);
    if (!ctx) return [];

    const mode = state.currentTournament.mode || 'normal';
    const playersFull = getPlayersFull();
    const resolve = makeRosterNameResolve(playersFull.map((p) => p.name));
    const partnerName = ctx.match[ctx.side][1 - ctx.slot];
    const requiredGender = getRequiredSubstituteGender(mode, playersFull, partnerName);

    const busyKeys = getPlayersActiveInRound(ctx.roundData, resolve);
    busyKeys.delete(playerNameDuplicateKey(resolve(ctx.outgoingName)));

    const eligible = playersFull.filter((p) =>
      isPlayerEligibleSubstitute(
        p, ctx.outgoingName, busyKeys, partnerName, requiredGender
      )
    );

    eligible.sort((a, b) => {
      const aBench = !busyKeys.has(playerNameDuplicateKey(a.name));
      const bBench = !busyKeys.has(playerNameDuplicateKey(b.name));
      if (aBench !== bBench) return aBench ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return eligible.map((p) => ({
      name: p.name,
      gender: p.gender,
      isBench: !busyKeys.has(playerNameDuplicateKey(p.name))
    }));
  };

  const addGuestPlayerToRoster = (nameRaw, gender = null) => {
    if (!state.currentTournament) {
      return { ok: false, error: 'No active tournament' };
    }

    const formatted = formatPlayerDisplayName(nameRaw);
    if (!formatted) return { ok: false, error: 'Name cannot be empty' };

    const players = getPlayersFull();
    if (players.some((p) => playerNamesMatch(p.name, formatted))) {
      return { ok: false, error: 'That name is already in the list' };
    }

    const mode = state.currentTournament.mode || 'normal';
    const g = gender === 'M' || gender === 'F' ? gender : null;
    if (isMixLikeMode(mode) && !g) {
      return { ok: false, error: 'Select gender for guest player' };
    }

    players.push({ name: formatted, gender: g, level: DEFAULT_PLAYER_LEVEL });
    state.currentTournament.players = JSON.stringify(players);
    return { ok: true, name: formatted, gender: g };
  };

  const refreshAfterPlayerSubstitute = () => {
    if (!state.currentTournament) return;
    populateLeaderboardPanels(state.currentTournament, state.currentTournament.title || '');
    renderTournamentList();
    if (!$('page-rounds')?.classList.contains('hidden')) {
      ensureViewingRoundValid();
      renderSpecificRound(state.viewingRound ?? state.currentTournament.current_round);
      updateRoundArrowState();
    }
    maybeRefreshDesktopLeaderboard();
  };

  const substitutePlayerInMatch = async (
    roundNo, matchIdx, teamSide, slotIdx, newPlayerName, opts = {}
  ) => {
    if (state.shareViewerMode || !state.currentTournament) {
      return { ok: false, error: 'Not allowed' };
    }

    syncCurrentTournament();
    const ctx = getSubstituteMatchContext(roundNo, matchIdx, teamSide, slotIdx);
    if (!ctx) return { ok: false, error: 'Match not found' };

    const formatted = formatPlayerDisplayName(newPlayerName);
    if (!formatted) return { ok: false, error: 'Name cannot be empty' };
    if (playerNamesMatch(formatted, ctx.outgoingName)) {
      return { ok: false, error: 'Same player selected' };
    }

    const mode = state.currentTournament.mode || 'normal';
    const playersFull = getPlayersFull();
    const resolve = makeRosterNameResolve(playersFull.map((p) => p.name));
    const player = playersFull.find((p) => playerNamesMatch(p.name, formatted));
    if (!player) return { ok: false, error: 'Player not on roster' };

    const partnerName = ctx.match[ctx.side][1 - ctx.slot];
    const requiredGender = getRequiredSubstituteGender(mode, playersFull, partnerName);
    const busyKeys = getPlayersActiveInRound(ctx.roundData, resolve);
    busyKeys.delete(playerNameDuplicateKey(resolve(ctx.outgoingName)));

    if (
      !isPlayerEligibleSubstitute(
        player, ctx.outgoingName, busyKeys, partnerName, requiredGender
      )
    ) {
      if (requiredGender && player.gender !== requiredGender) {
        return {
          ok: false,
          error: `Mix mode requires a ${requiredGender === 'M' ? 'male' : 'female'} partner for this team`
        };
      }
      if (busyKeys.has(playerNameDuplicateKey(player.name))) {
        return { ok: false, error: `${player.name} is already playing another match this round` };
      }
      return { ok: false, error: 'That player cannot replace this slot' };
    }

    if (!opts.skipConfirm) {
      const msg =
        `Replace ${ctx.outgoingName} with ${formatted} for this match only?\n\n` +
        'Scores stay with the team. Past/future rounds are unchanged except fairness history for this match.';
      if (!window.confirm(msg)) return { ok: false, error: 'cancelled' };
    }

    const rounds = getRounds();
    const roundData = rounds.find((r) => Number(r.round) === Number(roundNo));
    const match = roundData?.matches?.[matchIdx];
    if (!match) return { ok: false, error: 'Match not found' };

    const side = teamSide === 'team2' ? 'team2' : 'team1';
    const slot = Number(slotIdx) === 1 ? 1 : 0;
    const outgoing = fixCommonNameTypos(String(match[side]?.[slot] ?? ctx.outgoingName));
    match[side][slot] = formatted;
    if (!Array.isArray(match.subs)) match.subs = [];
    match.subs.push({
      teamSide: side,
      slotIdx: slot,
      from: outgoing,
      to: formatted,
      at: Date.now()
    });

    setRounds(rounds);
    try {
      await saveCurrentTournament();
    } catch {
      toast('Saved locally; sync may retry');
    }

    refreshAfterPlayerSubstitute();
    toast(`${outgoing} replaced by ${formatted} for this match`);

    if (mode === 'fixed' || mode === 'fixedmex') {
      toast('Note: ad-hoc pair may not count in pair standings for this match');
    }

    return { ok: true, from: outgoing, to: formatted };
  };

  const getPlayers = () => {
    const raw = safeJsonParse(state.currentTournament?.players, []);
    const norm = normalizePlayers(raw);
    return norm.map(p => p.name);
  };

  const getAmericanoScheduleApi = () => {
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    return g.PadelioAmericanoSchedule || null;
  };

  /**
   * Normal Americano — used to gate pre-generated full-session schedules.
   * Disabled: the new rolling fairness planner generates rounds on demand
   * from history, so we no longer build a pre-baked social schedule.
   * Kept as a stub so older tournaments that still have `social_schedule_json`
   * don't crash; the round generator simply doesn't read it for new rounds.
   */
  const usesGeneratedAmericanoSchedule = () => false;

  const isGeneratedScheduleComplete = (result) =>
    !!(result?.partnerComplete && result?.opponentComplete);

  const parseStoredSocialSchedule = (t) => {
    const raw = safeJsonParse(t?.social_schedule_json, null);
    return Array.isArray(raw) && raw.length > 0 ? raw : null;
  };

  const buildSocialScheduleForPlayers = (playerNames, courts) => {
    const api = getAmericanoScheduleApi();
    if (!api || typeof api.generateAmericanoSchedule !== 'function') return null;
    const n = playerNames.length;
    const maxRetries = Math.min(500, Math.max(200, 150 + n * 12));
    const result = api.generateAmericanoSchedule(playerNames, courts, { maxRetries });
    if (!result) return null;
    const storage =
      typeof api.serializeScheduleRounds === 'function'
        ? api.serializeScheduleRounds(result)
        : result.rounds.map((round) => ({
            round: round.roundNumber,
            matches: round.matches.map((m) => ({
              teamA: m.teamA,
              teamB: m.teamB
            }))
          }));
    return { result, storage };
  };

  const matchesFromSocialScheduleRound = (roundEntry, rosterNames) => {
    const list = roundEntry?.matches;
    if (!Array.isArray(list) || list.length === 0) return [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const ta = m?.teamA;
      const tb = m?.teamB;
      if (!Array.isArray(ta) || !Array.isArray(tb) || ta.length !== 2 || tb.length !== 2) continue;
      for (const ix of [...ta, ...tb]) {
        if (typeof ix !== 'number' || ix < 0 || ix >= rosterNames.length) return [];
      }
      const team1 = [rosterNames[ta[0]], rosterNames[ta[1]]];
      const team2 = [rosterNames[tb[0]], rosterNames[tb[1]]];
      if (!team1[0] || !team1[1] || !team2[0] || !team2[1]) return [];
      out.push({ court: i + 1, team1, team2, score1: '', score2: '' });
    }
    return out;
  };

  const ensureSocialSchedule = async () => {
    const t = state.currentTournament;
    if (!usesGeneratedAmericanoSchedule(t)) return null;

    const courts = Number(t.courts) || 1;

    const cached = parseStoredSocialSchedule(t);
    if (cached) {
      // Reject cached schedules that contain partial rounds (greedy-packing artefact).
      // If any round has fewer matches than the court count we regenerate and re-store.
      const hasPartialRounds = cached.some((r) => r.matches.length !== courts);
      if (!hasPartialRounds) return cached;
      // Fall through → rebuild with a clean, full-round-only schedule.
    }

    const players = getPlayers();
    const built = buildSocialScheduleForPlayers(players, courts);
    if (!built?.storage?.length) return null;

    if (!isGeneratedScheduleComplete(built.result)) {
      console.warn('[Padelio] generated schedule incomplete', {
        partnerMissing: built.result.partnerCoverage?.missing?.length,
        opponentMissing: built.result.opponentCoverage?.missing?.length
      });
    }

    // Keep only complete rounds (exactly `courts` matches) and renumber sequentially.
    // Partial rounds generated by the greedy packer are dropped here; the round
    // planner fills those slots on demand with a full court count.
    const cleanStorage = built.storage
      .filter((r) => r.matches.length === courts)
      .map((r, i) => ({ ...r, round: i + 1 }));

    t.social_schedule_json = JSON.stringify(cleanStorage);
    await saveCurrentTournament();
    return cleanStorage;
  };

  const getMixAmericanoScheduleApi = () => {
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    return g.PadelioMixAmericanoSchedule || null;
  };

  /** Mix Americano — equal M/F, pre-generated session schedule (balanced mode unchanged). */
  const usesGeneratedMixSchedule = (t, playersOrCount, courtCount) => {
    if (!t) return false;
    if ((t.mode || '') !== 'mix') return false;

    const players = Array.isArray(playersOrCount)
      ? playersOrCount
      : safeJsonParse(t.players, []);
    const { m, f, total } = countGender(
      Array.isArray(playersOrCount) ? playersOrCount : players
    );
    if (total < 4 || m !== f || m < 2) return false;

    const c =
      courtCount != null && courtCount !== ''
        ? Number(courtCount)
        : Number(t.courts) || 0;
    if (c < 1) return false;

    return Math.min(c, Math.floor(m / 2), Math.floor(f / 2)) >= 1;
  };

  const parseStoredMixSchedule = (t) => {
    const raw = safeJsonParse(t?.mix_schedule_json, null);
    return Array.isArray(raw) && raw.length > 0 ? raw : null;
  };

  const buildMixScheduleForPlayers = (playersFull, courts) => {
    const api = getMixAmericanoScheduleApi();
    if (!api || typeof api.generateMixAmericanoSchedule !== 'function') return null;
    const n = playersFull.length;
    const maxRetries = Math.min(500, Math.max(200, 150 + n * 12));
    try {
      const result = api.generateMixAmericanoSchedule(playersFull, courts, { maxRetries });
      if (!result) return null;
      const storage =
        typeof api.serializeScheduleRounds === 'function'
          ? api.serializeScheduleRounds(result)
          : result.rounds.map((round) => ({
              round: round.roundNumber,
              matches: round.matches.map((m) => ({
                teamA: m.teamA,
                teamB: m.teamB
              }))
            }));
      return { result, storage };
    } catch (e) {
      console.warn('[Padelio] mix schedule build failed', e);
      return null;
    }
  };

  const ensureMixSchedule = async () => {
    const t = state.currentTournament;
    if (!usesGeneratedMixSchedule(t)) return null;

    const courts = Number(t.courts) || 1;

    const cached = parseStoredMixSchedule(t);
    if (cached) {
      const hasPartialRounds = cached.some((r) => r.matches.length !== courts);
      if (!hasPartialRounds) return cached;
    }

    const playersFull = getPlayersFull();
    const built = buildMixScheduleForPlayers(playersFull, courts);
    if (!built?.storage?.length) return null;

    if (!isGeneratedScheduleComplete(built.result)) {
      console.warn('[Padelio] mix generated schedule incomplete', {
        partnerMissing: built.result.partnerCoverage?.missing?.length,
        opponentMissing: built.result.opponentCoverage?.missing?.length
      });
    }

    const cleanStorage = built.storage
      .filter((r) => r.matches.length === courts)
      .map((r, i) => ({ ...r, round: i + 1 }));

    t.mix_schedule_json = JSON.stringify(cleanStorage);
    await saveCurrentTournament();
    return cleanStorage;
  };

  const getMaxRoundNumber = () => {
    if (!state.currentTournament) return 1;
    const rounds = getRounds();
    const maxFromRounds = rounds.reduce(
      (m, r) => Math.max(m, Number(r.round) || 1),
      1
    );
    const cr = Number(state.currentTournament.current_round) || 1;
    return Math.max(cr, maxFromRounds, 1);
  };

  const ensureViewingRoundValid = () => {
    if (!state.currentTournament) return;
    const maxRound = getMaxRoundNumber();
    if (state.viewingRound == null) state.viewingRound = state.currentTournament.current_round;
    state.viewingRound = clamp(Number(state.viewingRound) || 1, 1, maxRound);
  };

  /* ---------- Persist ---------- */
  const saveCurrentTournament = async () => {
    if (state.shareViewerMode) return;
    if (!state.currentTournament || !window.dataSdk) return;

    const result = await window.dataSdk.update(state.currentTournament);

    // keep reference fresh if SDK returns updated object
    if (result && result.isOk && result.data) {
      state.currentTournament = result.data;
      const i = state.tournaments.findIndex(
        (t) => t.__backendId === result.data.__backendId
      );
      if (i >= 0) state.tournaments[i] = result.data;
    }
    return result;
  };

  const debouncedSaveTournament = debounce(() => {
    // fire & forget (no await) to keep typing smooth
    saveCurrentTournament().catch(() => {});
    maybeRefreshDesktopLeaderboard();
  }, 250);

  /* ---------- Data SDK handler ---------- */
  const dataHandler = {
    onDataChanged(data) {
      if (state.shareViewerMode) return;
      state.tournaments = Array.isArray(data) ? data : [];

      // sync currentTournament to latest object
      syncCurrentTournament();

      renderTournamentList();

      // If rounds page visible, re-render the *viewingRound* safely
      const roundsPageVisible = !$('page-rounds')?.classList.contains('hidden');
      if (roundsPageVisible && state.currentTournament) {
        ensureViewingRoundValid();
        if (!state.isEditingScore) {
          renderSpecificRound(state.viewingRound);
        }
      }
    }
  };

  /* ---------- Element SDK init ---------- */
  if (window.elementSdk) {
    window.elementSdk.init({
      defaultConfig,
      onConfigChange: async (config) => {
        const title = (config?.app_title || defaultConfig.app_title);
        const el = $('main-title');
        if (el) el.textContent = title;
      },
      mapToCapabilities: () => ({
        recolorables: [],
        borderables: [],
        fontEditable: undefined,
        fontSizeable: undefined
      }),
      mapToEditPanelValues: (config) =>
        new Map([['app_title', config?.app_title || defaultConfig.app_title]])
    });
  }

  /* ---------- Data SDK init ---------- */
  const initApp = async () => {
    if (!window.dataSdk) return;
    const result = await window.dataSdk.init(dataHandler);
    if (!result?.isOk) console.error('Failed to initialize data SDK');
  };
  initApp();
  updateAdVisibility('home');
  refreshAppVersionLabel();
  flushQueuedToast();

  /** After long home list scroll, opening a tournament should start at the top of the rounds view. */
  const scrollAppToTop = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const app = $('app');
    if (app) app.scrollTop = 0;
  };

  const navigateTo = (page) => {
    const target = $('page-' + page);
    if (!target) {
      // Fallback for standalone pages (about/privacy/terms) where SPA sections
      // are not present in the DOM.
      const fallbackPath = {
        home: 'index.html',
        about: 'about.html',
        privacy: 'privacy-policy.html',
        terms: 'terms.html',
        contact: 'contact.html',
        guides: 'guides.html'
      }[page];

      if (fallbackPath) window.location.href = fallbackPath;
      return;
    }

    $$('.page').forEach((p) => p.classList.add('hidden'));
    target.classList.remove('hidden');
    target.classList.add('slide-in');

    if (page === 'home' && !state.shareViewerMode) {
      resetNewTournament();
      refreshAppVersionLabel();
    }

    if (page === 'new-players') {
      syncPlayerLevelControls();
      updateButtonStates();
    }

    if (page === 'new-points') {
      syncNewPointsPage();
    }

    if (page === 'rounds' && state.currentTournament) {
      syncHostCourtsMenuVisibility();
      requestAnimationFrame(() => {
        refreshHostTournamentDesktopUi();
        ensureViewingRoundValid();
        if (!state.isEditingScore) {
          renderSpecificRound(state.viewingRound ?? state.currentTournament.current_round);
          updateRoundArrowState();
        }
      });
    }

    updateAdVisibility(page);
  };

  /* ---------- New tournament flow ---------- */
  /** Applied via styles.css — avoids Tailwind CDN missing dynamic utilities. */
  const CHIP_SELECTED = 'padelio-chip-selected';

  const isBestOfGamesChosen = () => {
    const n = Number(state.newTournament.bestOfGames);
    return n >= 3 && n <= 7;
  };

  const canProceedFromPointsStep = () => {
    if (state.newTournament.scoreKind === 'games') {
      return isBestOfGamesChosen();
    }
    return state.newTournament.points > 0;
  };

  const resetNewTournament = () => {
    state.newTournament = {
      mode: 'normal',
      title: '',
      courts: 0,
      courtStyle: 'number',
      points: 0,
      scoreKind: 'rally',
      bestOfGames: null,
      players: []
    };
    state.playerGenderDraft = 'M';

    const t = $('tournament-title');
    if (t) t.value = '';

    $$('.court-btn').forEach((b) => b.classList.remove(CHIP_SELECTED));
    $$('.court-style-btn').forEach((b) => {
      const on = b.dataset.courtStyle === 'number';
      b.classList.toggle(CHIP_SELECTED, on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $$('.points-btn').forEach((b) => b.classList.remove(CHIP_SELECTED));
    $$('.mex-bo-btn').forEach((b) => b.classList.remove(CHIP_SELECTED));
    $$('.mex-kind-btn').forEach((b) => b.classList.remove(CHIP_SELECTED));

    const list = $('players-list');
    if (list) list.innerHTML = '';

    const count = $('player-count');
    if (count) count.textContent = '0 players added';

    updateMinPlayersText();
    updateGenderUI();
    updateButtonStates();
  };

  const updateButtonStates = () => {
    const btnToPoints = $('btn-to-points');
    const btnToPlayers = $('btn-to-players');
    const btnStart = $('btn-start');

    const setDisabled = (btn, disabled) => {
      if (!btn) return;
      btn.disabled = !!disabled;
      btn.classList.toggle('opacity-50', !!disabled);
      btn.classList.toggle('cursor-not-allowed', !!disabled);
    };

    setDisabled(btnToPoints, !(state.newTournament.courts > 0));

    setDisabled(btnToPlayers, !canProceedFromPointsStep());

    const courts = Number(state.newTournament.courts) || 0;
    const minPlayers = Math.max(4, courts * 4);
    const normPlayers = normalizePlayers(state.newTournament.players);

    let canStart = normPlayers.length >= minPlayers;

    if (isMixLikeMode(state.newTournament.mode)) {
      const { m, f, total } = countGender(normPlayers);
      canStart = canStart && total % 2 === 0 && m === f; // balanced
    }

    if (isFixedPairRosterMode(state.newTournament.mode)) {
      canStart = canStart && normPlayers.length % 2 === 0;
    }

    setDisabled(btnStart, !canStart);
  };

  const goToCourts = () => {
    const input = $('tournament-title');
    const title = input?.value?.trim() || '';
    if (!title) {
      input?.focus?.();
      return;
    }
    state.newTournament.title = title;
    navigateTo('new-courts');
  };

  /** Returns "Court 1" / "Court A" etc. based on style saved on tournament. */
  const formatCourtLabel = (courtNum, tournamentOrStyle) => {
    const style =
      typeof tournamentOrStyle === 'string'
        ? tournamentOrStyle
        : (tournamentOrStyle?.court_style || 'number');
    const n = Number(courtNum) || 1;
    if (style === 'letter') {
      const letter = String.fromCharCode(64 + n);
      return `Court ${letter}`;
    }
    return `Court ${n}`;
  };

  const selectCourtStyle = (style) => {
    const s = style === 'letter' ? 'letter' : 'number';
    state.newTournament.courtStyle = s;
    $$('.court-style-btn').forEach((b) => {
      const on = b.dataset.courtStyle === s;
      b.classList.toggle(CHIP_SELECTED, on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };

  const selectCourts = (num) => {
    state.newTournament.courts = Number(num) || 0;
    $$('.court-btn').forEach((b) => {
      b.classList.toggle(CHIP_SELECTED, Number(b.dataset.courts) === state.newTournament.courts);
    });
    updateMinPlayersText();
    updateButtonStates();
  };

  const goToPoints = () => {
    if (state.newTournament.courts > 0) {
      navigateTo('new-points');
    }
  };

  const syncNewPointsPage = () => {
    const tit = $('points-page-title');
    const sub = $('points-page-sub');
    const rallyPanel = $('points-panel-rally');
    const gamesPanel = $('points-panel-games');

    const kind = state.newTournament.scoreKind === 'games' ? 'games' : 'rally';

    if (tit) tit.textContent = 'Match scoring';
    if (sub) {
      sub.textContent =
        'Rally to a target, or best-of games (tennis-style: 0–40 per game; games won add to leaderboard).';
    }

    if (rallyPanel) rallyPanel.classList.toggle('hidden', kind !== 'rally');
    if (gamesPanel) gamesPanel.classList.toggle('hidden', kind !== 'games');

    $$('.mex-kind-btn').forEach((b) => {
      const k = b.dataset.scoreKind;
      const on = k === 'games' ? kind === 'games' : kind === 'rally';
      b.classList.toggle(CHIP_SELECTED, on);
    });

    $$('.mex-bo-btn').forEach((b) => {
      const bo = Number(b.dataset.bo);
      const on = kind === 'games' && isBestOfGamesChosen() && bo === Number(state.newTournament.bestOfGames);
      b.classList.toggle(CHIP_SELECTED, on);
    });

    $$('.points-btn').forEach((b) => {
      b.classList.toggle(CHIP_SELECTED, Number(b.dataset.points) === state.newTournament.points);
    });
  };

  const selectPoints = (num) => {
    state.newTournament.points = Number(num) || 0;
    $$('.points-btn').forEach((b) => {
      b.classList.toggle(CHIP_SELECTED, Number(b.dataset.points) === state.newTournament.points);
    });
    updateButtonStates();
  };

  const selectScoreKind = (kind) => {
    const next = kind === 'games' ? 'games' : 'rally';
    state.newTournament.scoreKind = next;
    state.newTournament.bestOfGames = null;
    if (next === 'games') {
      state.newTournament.points = 0;
      $$('.points-btn').forEach((b) => b.classList.remove(CHIP_SELECTED));
    }
    syncNewPointsPage();
    updateButtonStates();
  };

  const selectBestOfGames = (n) => {
    state.newTournament.bestOfGames = Math.min(7, Math.max(3, Number(n)));
    syncNewPointsPage();
    updateButtonStates();
  };

  const updateGenderBalanceWarning = () => {
    const warn = $('gender-balance-warning');
    if (!warn) return;

    if (!isMixLikeMode(state.newTournament.mode)) {
      warn.classList.add('hidden');
      return;
    }

    const players = normalizePlayers(state.newTournament.players);
    const total = players.length;

    const male = players.filter(p => p.gender === 'M').length;
    const female = players.filter(p => p.gender === 'F').length;

    if (total === 0) {
      warn.classList.add('hidden');
      return;
    }

    const expected = Math.floor(total / 2);

    if (male !== female) {
      warn.textContent = `⚠ Balance needed: should be ${expected} Male and ${expected} Female`;
      warn.classList.remove('hidden');
    } else {
      warn.classList.add('hidden');
    }
  };

  const syncMexicanoPlayersHint = () => {
    const el = $('mexicano-players-hint');
    const mx = $('mixmex-players-hint');
    if (el) el.classList.toggle('hidden', state.newTournament.mode !== 'mexicano');
    if (mx) mx.classList.toggle('hidden', state.newTournament.mode !== 'mixmex');
  };

  const syncFixedPairsHint = () => {
    const el = $('fixed-pairs-hint');
    const bulk = $('bulk-paste-fixed-hint');
    const mex = $('fixedmex-pairs-hint');
    const show = isFixedPairRosterMode(state.newTournament.mode);
    if (el) el.classList.toggle('hidden', !show);
    if (bulk) bulk.classList.toggle('hidden', !show);
    if (mex) mex.classList.toggle('hidden', state.newTournament.mode !== 'fixedmex');
  };

  const goToPlayers = () => {
    if (!canProceedFromPointsStep()) return;
    navigateTo('new-players');
    updateGenderUI();
    syncMexicanoPlayersHint();
    syncFixedPairsHint();
    syncPlayerLevelControls();
    updateButtonStates();
  };

  const readPlayerLevelDraft = () => clampPlayerLevel($('player-level')?.value);

  const syncDraftLevelPicker = () => {
    const sel = $('player-level');
    const picker = $('player-level-picker');
    if (!sel || !picker) return;
    const v = String(clampPlayerLevel(sel.value));
    sel.value = v;
    const valEl = picker.querySelector('.level-picker__value');
    if (valEl) valEl.textContent = `L${v}`;
    picker.querySelectorAll('.level-picker__option[data-level]').forEach((btn) => {
      const on = btn.getAttribute('data-level') === v;
      btn.classList.toggle('level-picker__option--active', on);
    });
  };

  const setDraftPlayerLevel = (n) => {
    const sel = $('player-level');
    if (!sel) return;
    sel.value = String(clampPlayerLevel(n));
    syncDraftLevelPicker();
    const picker = $('player-level-picker');
    if (picker) picker.removeAttribute('open');
  };

  const levelSelectFieldHtml = (index, level, show) => {
    if (!show) return '';
    const v = clampPlayerLevel(level);
    const btns = [1, 2, 3, 4, 5]
      .map(
        (n) =>
          `<button type="button" data-action="set-player-level" data-idx="${index}" data-level="${n}" ` +
          `class="level-rail__btn ${n === v ? 'level-rail__btn--active' : ''}" ` +
          `aria-pressed="${n === v}" aria-label="Power level L${n}">L${n}</button>`
      )
      .join('');
    return `<div class="level-rail" role="group" aria-label="Power level">${btns}</div>`;
  };

  const syncPlayerLevelControls = () => {
    const isBal = state.newTournament.mode === 'balanced';
    const wrap = $('player-level-wrap');
    if (wrap) wrap.classList.toggle('hidden', !isBal);
    const hint = $('power-level-hint');
    if (hint) hint.classList.toggle('hidden', !isBal);
    if (isBal) syncDraftLevelPicker();
  };

  const renderPlayersList = () => {
    const list = $('players-list');
    if (!list) return;

    const players = normalizePlayers(state.newTournament.players);
    const showLevelUi = state.newTournament.mode === 'balanced';

    if (isFixedPairRosterMode(state.newTournament.mode)) {
      const pairCount = Math.floor(players.length / 2);
      const rows = [];
      for (let pi = 0; pi < pairCount; pi++) {
        const a = players[pi * 2];
        const b = players[pi * 2 + 1];
        const ia = pi * 2;
        const ib = pi * 2 + 1;
        rows.push(`
        <div class="flex items-center justify-between bg-emerald-50/95 dark:bg-emerald-800/50 rounded-2xl border border-emerald-300/70 dark:border-emerald-600/40 px-4 py-3 slide-in shadow-cozy-sm gap-2">
          <div class="flex flex-col gap-1.5 min-w-0">
            <span class="text-[0.65rem] uppercase tracking-wide text-emerald-800/95 dark:text-emerald-300/90 font-bold">Pair ${pi + 1}</span>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
              <span class="font-medium text-emerald-900/95 dark:text-emerald-200/80">${escapeHtml(a.name)}</span>
              ${levelSelectFieldHtml(ia, a.level, showLevelUi)}
              <span class="text-emerald-700/90 dark:text-emerald-500/80">+</span>
              <span class="font-medium text-emerald-900/95 dark:text-emerald-200/80">${escapeHtml(b.name)}</span>
              ${levelSelectFieldHtml(ib, b.level, showLevelUi)}
            </div>
          </div>
          <button type="button" data-action="remove-fixed-pair" data-idx="${pi}" class="shrink-0 text-emerald-700 dark:text-emerald-400 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Remove this pair">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>`);
      }
      if (players.length % 2 === 1) {
        const last = players[players.length - 1];
        const li = players.length - 1;
        rows.push(`
        <div class="flex items-center justify-between bg-amber-50/95 dark:bg-amber-900/30 rounded-2xl border border-amber-400/55 dark:border-amber-500/40 px-4 py-3 slide-in shadow-cozy-sm gap-2">
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-[0.65rem] uppercase tracking-wide text-amber-900/90 dark:text-amber-200/90 font-bold">Incomplete pair</span>
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium truncate text-amber-950 dark:text-amber-100">${escapeHtml(last.name)}</span>
              ${levelSelectFieldHtml(li, last.level, showLevelUi)}
            </div>
            <span class="text-xs text-amber-900/85 dark:text-amber-200/80">Add one more player to complete the pair.</span>
          </div>
          <button type="button" data-action="remove-player" data-idx="${li}" class="shrink-0 text-amber-800 dark:text-amber-300 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Remove">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>`);
      }
      list.innerHTML = rows.join('');
    } else {
      list.innerHTML = players
        .map(
          (p, i) => `
        <div class="flex items-center justify-between bg-emerald-50/95 dark:bg-emerald-800/50 rounded-2xl border border-emerald-300/70 dark:border-emerald-600/40 px-4 py-3 slide-in shadow-cozy-sm gap-2">
          <div class="flex items-center flex-wrap gap-x-2 gap-y-1.5 min-w-0">
            <span class="font-medium">${escapeHtml(p.name)}</span>
            ${isMixLikeMode(state.newTournament.mode)
              ? `
                <button
                  type="button"
                  data-action="toggle-gender"
                  data-idx="${i}"
                  class="text-xs px-2 py-1 rounded-full bg-emerald-200/90 dark:bg-emerald-900/50 border border-emerald-400/60 dark:border-emerald-700 text-emerald-950 dark:text-emerald-200
         hover:border-emerald-500 dark:hover:border-emerald-300 hover:bg-emerald-300/90 dark:hover:bg-emerald-900/80 transition-all
         cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
                  title="Tap to switch gender"
                >
                  ${p.gender === 'F' ? 'Female' : 'Male'}
                  <span class="ml-1 opacity-70">↺</span>
                </button>
              `
              : ''
            }
            ${levelSelectFieldHtml(i, p.level, showLevelUi)}
          </div>

          <button data-action="remove-player" data-idx="${i}" class="shrink-0 text-emerald-700 dark:text-emerald-400 hover:text-red-600 dark:hover:text-red-400 transition-colors" aria-label="Remove player">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      `
        )
        .join('');
    }

    const count = $('player-count');
    if (count) count.textContent = `${players.length} players added`;
    syncMexicanoPlayersHint();
    syncFixedPairsHint();
    syncPlayerLevelControls();
  };

  const addPlayer = () => {
    const input = $('player-name');
    const raw = input?.value?.trim() || '';
    if (!raw) return;

    state.newTournament.players = normalizePlayers(state.newTournament.players);
    const resolved = fixCommonNameTypos(raw);
    if (state.newTournament.players.some(
      (p) => playerNameDuplicateKey(p.name) === playerNameDuplicateKey(resolved)
    )) {
      toast('That name is already in the list.');
      return;
    }

    const name = resolved.charAt(0).toUpperCase() + resolved.slice(1);

    const isMix = isMixLikeMode(state.newTournament.mode);
    const gender = isMix ? state.playerGenderDraft : null;
    const level =
      state.newTournament.mode === 'balanced'
        ? readPlayerLevelDraft()
        : DEFAULT_PLAYER_LEVEL;

    state.newTournament.players.push({ name, gender, level });

    input.value = '';
    input.focus();

    renderPlayersList();
    updateGenderBalanceWarning();
    updateGenderUI();
    updateButtonStates();
  };

  /** One name per line, or one tab-separated row (spreadsheet paste). Mix: uses current M/F draft for all. */
  const addPlayersFromBulkPaste = () => {
    const ta = $('player-names-bulk');
    if (!ta) return;
    const raw = ta.value || '';
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let names;
    if (lines.length === 1 && lines[0].includes('\t')) {
      names = lines[0].split(/\t/).map((s) => s.trim()).filter(Boolean);
    } else {
      names = lines;
    }
    if (names.length === 0) {
      toast('Paste at least one name (one per line).');
      return;
    }

    if (isFixedPairRosterMode(state.newTournament.mode) && names.length % 2 !== 0) {
      names = names.slice(0, names.length - 1);
      toast('Fixed pairs: nama harus berpasangan (urutan 1+2, 3+4, …). Baris terakhir tanpa pasangan diabaikan.');
    }

    state.newTournament.players = normalizePlayers(state.newTournament.players);
    const isMix = isMixLikeMode(state.newTournament.mode);
    const genderDraft = isMix ? state.playerGenderDraft : null;

    let added = 0;
    let skippedDup = 0;
    for (const rawName of names) {
      const resolved = fixCommonNameTypos(String(rawName || '').trim());
      if (!resolved) continue;
      if (
        state.newTournament.players.some(
          (p) => playerNameDuplicateKey(p.name) === playerNameDuplicateKey(resolved)
        )
      ) {
        skippedDup++;
        continue;
      }
      const name = resolved.charAt(0).toUpperCase() + resolved.slice(1);
      const level =
        state.newTournament.mode === 'balanced'
          ? readPlayerLevelDraft()
          : DEFAULT_PLAYER_LEVEL;
      state.newTournament.players.push({ name, gender: genderDraft, level });
      added++;
    }

    ta.value = '';
    const details = $('bulk-players-details');
    if (details) details.open = false;

    renderPlayersList();
    updateGenderBalanceWarning();
    updateGenderUI();
    updateButtonStates();

    if (added === 0 && skippedDup > 0) {
      toast('No new names added (all were duplicates).');
    } else if (added > 0) {
      toast(
        skippedDup
          ? `Added ${added} player(s). Skipped ${skippedDup} duplicate(s).`
          : `Added ${added} player(s).`
      );
    }
  };

  const removePlayer = (index) => {
    const norm = normalizePlayers(state.newTournament.players);
    norm.splice(index, 1);
    state.newTournament.players = norm;
    renderPlayersList();
    updateGenderBalanceWarning();
    updateGenderUI();
    updateButtonStates();
  };

  const removeFixedPair = (pairIndex) => {
    const norm = normalizePlayers(state.newTournament.players);
    const i = pairIndex * 2;
    if (i + 1 >= norm.length) return;
    norm.splice(i + 1, 1);
    norm.splice(i, 1);
    state.newTournament.players = norm;
    renderPlayersList();
    updateGenderBalanceWarning();
    updateGenderUI();
    updateButtonStates();
  };

  const togglePlayerGender = (index) => {
    if (!isMixLikeMode(state.newTournament.mode)) return;

    const norm = normalizePlayers(state.newTournament.players);
    const p = norm[index];
    if (!p) return;

    p.gender = (p.gender === 'F') ? 'M' : 'F';
    state.newTournament.players = norm;

    renderPlayersList();
    updateGenderBalanceWarning();
    updateGenderUI();
    updateButtonStates();
  };

  const setPlayerLevel = (index, value) => {
    if (state.newTournament.mode !== 'balanced') return;
    const norm = normalizePlayers(state.newTournament.players);
    const p = norm[index];
    if (!p) return;
    p.level = clampPlayerLevel(value);
    state.newTournament.players = norm;
    renderPlayersList();
    updateButtonStates();
  };

  const startTournament = async () => {
    const btn = $('btn-start');

    try {
      if (state.newTournament.players.length < 4) return;

      if (hasDuplicatePlayerNames(state.newTournament.players)) {
        toast('Duplicate player names. Remove duplicates before starting.');
        return;
      }

      const totalPlayers = normalizePlayers(state.newTournament.players).length;
      const totalCourts = state.newTournament.courts;
      const minPlayers = totalCourts * 4;

      if (totalPlayers < minPlayers) {
        toast(`Minimum ${minPlayers} players required for ${totalCourts} court(s).`);
        return;
      }

      if (isMixLikeMode(state.newTournament.mode)) {
        const { m, f, total } = countGender(state.newTournament.players);
        if (total % 2 !== 0 || m !== f) {
          toast(
            `Mix (Mix Mexicano) needs equal M/F. Male ${m} / Female ${f}.`
          );
          return;
        }
      }

      if (isFixedPairRosterMode(state.newTournament.mode)) {
        const n = normalizePlayers(state.newTournament.players).length;
        if (n % 2 !== 0) {
          toast('Fixed pairs: add an even number of names (complete pairs).');
          return;
        }
      }

      const plist = normalizePlayers(state.newTournament.players);
      const names = plist.map((p) => p.name);
      if (!window.dataSdk) return;

      if (state.tournaments.length >= 999) {
        toast('Maximum tournaments reached');
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.dataset.originalText = btn.dataset.originalText || btn.textContent || 'Start Tournament';
        btn.innerHTML = '<span class="animate-pulse">Creating...</span>';
        btn.classList.add('opacity-50', 'cursor-not-allowed');
      }

      let socialScheduleJson = null;
      let mixScheduleJson = null;

      const abortScheduleBuild = () => {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.originalText || 'Start Tournament';
          btn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
      };

      if (
        usesGeneratedAmericanoSchedule(
          { mode: state.newTournament.mode, courts: state.newTournament.courts },
          names.length,
          state.newTournament.courts
        )
      ) {
        if (!getAmericanoScheduleApi()) {
          toast('Modul jadwal belum termuat — muat ulang halaman.');
          abortScheduleBuild();
          return;
        }
        if (btn) btn.innerHTML = '<span class="animate-pulse">Membuat jadwal...</span>';
        const built = buildSocialScheduleForPlayers(names, state.newTournament.courts);
        if (!built?.storage?.length) {
          toast('Gagal membuat jadwal. Coba lagi.');
          abortScheduleBuild();
          return;
        }
        socialScheduleJson = JSON.stringify(built.storage);
        if (!isGeneratedScheduleComplete(built.result)) {
          toast('Jadwal belum 100% lengkap — babak awal pakai jadwal, sisanya pairing otomatis.');
        }
      }
      // Mix Americano (mode === 'mix') no longer pre-generates a full-session
      // schedule. Every Mix round is built dynamically via the same fairness
      // engine as Normal Americano, applied per gender, so we do NOT populate
      // `mix_schedule_json` here.

      const mexFam = isMexicanoFamilyMode(state.newTournament.mode);

      // Generic scoring choice, available for every mode.
      const score_kind = state.newTournament.scoreKind === 'games' ? 'games' : 'rally';
      let points_to_win = state.newTournament.points;
      let best_of_games = null;

      if (score_kind === 'games') {
        best_of_games = Math.min(7, Math.max(3, Number(state.newTournament.bestOfGames)));
        points_to_win = gamesNeededToWinMatch(best_of_games);
      }

      const tournament = {
        id: Date.now().toString(),
        title: state.newTournament.title,
        mode: state.newTournament.mode,
        courts: state.newTournament.courts,
        court_style: state.newTournament.courtStyle || 'number',
        points_to_win,
        score_kind,
        best_of_games,
        players: JSON.stringify(normalizePlayers(state.newTournament.players)),
        rounds: JSON.stringify([]),
        current_round: 1,
        created_at: new Date().toISOString(),
        // Legacy Mexicano-only mirror fields — kept so any older app build or
        // stored share link still reading `mex_score_kind` / `mex_best_of_games`
        // continues to work unchanged.
        ...(mexFam ? { mex_score_kind: score_kind, mex_best_of_games: best_of_games } : {}),
        ...(socialScheduleJson ? { social_schedule_json: socialScheduleJson } : {}),
        ...(mixScheduleJson ? { mix_schedule_json: mixScheduleJson } : {})
      };

      const result = await window.dataSdk.create(tournament);

      if (!result?.isOk) {
        toast('Failed to create tournament');
        return;
      }

      const createdId = result.data?.__backendId;
      resetNewTournament();

      if (createdId) {
        await openTournament(createdId);
      } else {
        navigateTo('home');
      }

    } catch (e) {
      toast('Failed to create tournament');
    } finally {
      // ✅ tombol selalu balik normal walau sudah pindah page
      const b = $('btn-start');
      if (b) {
        b.disabled = false;
        b.textContent = b.dataset.originalText || 'Start Tournament';
        b.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }
  };

  const updateMinPlayersText = () => {
    const el = $('min-players-text');
    if (!el) return;

    const courts = state.newTournament.courts || 1;
    const minPlayers = courts * 4;

    if (isFixedPairRosterMode(state.newTournament.mode)) {
      el.textContent = `Minimum ${minPlayers} players (even count; pairs: 1+2, 3+4, …)`;
    } else {
      el.textContent = `Minimum ${minPlayers} players required`;
    }
  };

  /* ---------- Tournament list ---------- */
  function renderTournamentList () {
    const list = $('tournament-list');
    if (!list) return;

    if (state.tournaments.length === 0) {
      list.innerHTML = '<p class="text-emerald-600 dark:text-emerald-400 text-center py-8 text-sm">No tournaments yet</p>';
      return;
    }

    list.innerHTML = state.tournaments
      .map((t) => {
        const players = safeJsonParse(t.players, []);
        const md = t.mode || 'normal';
        const modeLabel =
          md === 'mexicano'
            ? 'Mexicano'
            : md === 'mix'
              ? 'Mix'
              : md === 'fixedmex'
                ? 'Fixed pairs Mexicano'
                : md === 'fixed'
                  ? 'Fixed pairs Americano'
                  : md === 'balanced'
                    ? 'Balanced Americano'
                    : md === 'mixmex'
                      ? 'Mix Mexicano'
                      : 'Americano';
        return `
          <div class="flex items-stretch gap-2 slide-in">
            <button type="button" data-action="open-tournament" data-id="${t.__backendId}" class="flex-1 min-w-0 bg-emerald-50/95 dark:bg-emerald-800/50 hover:bg-emerald-100/80 dark:hover:bg-emerald-700/50 border border-emerald-300/70 dark:border-emerald-600/50 rounded-3xl p-4 text-left transition-all shadow-cozy-sm">
              <h3 class="font-semibold text-lg mb-1">${escapeHtml(t.title)}</h3>
              <div class="flex items-center gap-4 text-sm text-emerald-700 dark:text-emerald-300 flex-wrap">
                <span>${modeLabel}</span>
                <span>•</span>
                <span>${t.courts} court${t.courts > 1 ? 's' : ''}</span>
                <span>•</span>
                <span>${players.length} players</span>
                <span>•</span>
                <span>Round ${t.current_round}</span>
              </div>
            </button>
            <button type="button" data-action="delete-tournament" data-id="${t.__backendId}" aria-label="Delete tournament" class="shrink-0 self-stretch px-3 rounded-3xl border border-red-200/90 dark:border-red-800/60 bg-red-50/90 dark:bg-red-950/50 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors shadow-cozy-sm flex items-center justify-center" title="Delete tournament">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        `;
      })
      .join('');
  };

  /* ---------- Rounds generation/render ---------- */
  const mexAwardGamePts = (match, winnerTeam, profile) => {
    if (!canAwardMexGame(match, profile)) return false;
    let g1 = Number(match.score1) || 0;
    let g2 = Number(match.score2) || 0;
    if (winnerTeam === 1) g1++;
    else g2++;
    applyMexGamesScoresToMatch(match, profile, g1, g2);
    match.mx_game = { i1: 0, i2: 0 };
    return true;
  };

  const mexTennisPoint = async (matchIdx, team) => {
    if (state.shareViewerMode) return;
    syncCurrentTournament();
    if (!state.currentTournament) return;
    const profile = getTournamentScoringProfile(state.currentTournament);
    if (profile.style !== 'games') return;

    ensureViewingRoundValid();
    const rounds = getRounds();
    const activeRound = state.viewingRound ?? state.currentTournament.current_round;
    const roundData = rounds.find((r) => Number(r.round) === Number(activeRound));
    if (!roundData) return;
    const match = roundData.matches?.[matchIdx];
    if (!match) return;

    if (!canAwardMexGame(match, profile)) {
      toast(`Match sudah selesai (best of ${profile.bestOf}).`);
      return;
    }

    const g = match.mx_game ? { ...match.mx_game } : { i1: 0, i2: 0 };
    const side = team === 1 ? 1 : 2;
    let awarded = false;

    if (g.i1 >= 3 && g.i2 >= 3) {
      awarded = mexAwardGamePts(match, side, profile);
    } else if (side === 1) {
      if (g.i1 === 3 && g.i2 < 3) {
        awarded = mexAwardGamePts(match, 1, profile);
      } else {
        g.i1 = Math.min(g.i1 + 1, 3);
      }
    } else if (g.i2 === 3 && g.i1 < 3) {
      awarded = mexAwardGamePts(match, 2, profile);
    } else {
      g.i2 = Math.min(g.i2 + 1, 3);
    }

    if (!awarded) match.mx_game = g;

    setRounds(rounds);
    await saveCurrentTournament();
    renderSpecificRound(state.viewingRound ?? state.currentTournament.current_round);
  };

  const renderCourts = (roundData) => {
    const container = $('courts-container');
    if (!container) return;

    const matchCount = roundData?.matches?.length || 0;
    const gridOnDesktop = isTournamentDesktopLayout() && matchCount >= 2;
    container.className = gridOnDesktop
      ? 'host-courts-container host-courts-container--grid space-y-4'
      : 'host-courts-container space-y-4';

    const mode = state.currentTournament?.mode || 'normal';
    const sProf = getTournamentScoringProfile(state.currentTournament);
    const numMax = sProf.style === 'games' ? sProf.bestOf : sProf.rallyCap;
    const scoreHint =
      sProf.style === 'games' ? mexGamesScoreHint(sProf) : `Rally to ${sProf.rallyCap} (scores mirror)`;

    let levelForDisplay = null;
    if (mode === 'balanced') {
      const playersFull = getPlayersFull();
      const levelByName = makeLevelByNameMap(playersFull);
      const resolve = makeRosterNameResolve(playersFull.map((p) => p.name));
      levelForDisplay = (rawName) => {
        const key = resolve(rawName);
        return levelByName.has(key) ? levelByName.get(key) : DEFAULT_PLAYER_LEVEL;
      };
    }

    const playerCourtLine = (rawName, matchIdx, teamSide, slotIdx) => {
      const nameHtml = escapeHtml(fixCommonNameTypos(rawName));
      const replaceIconBtn =
        !state.shareViewerMode
          ? `<button type="button" data-action="substitute-player" data-match-idx="${matchIdx}" data-team-side="${teamSide}" data-slot-idx="${slotIdx}"
              class="inline-flex shrink-0 items-center justify-center w-6 h-6 rounded-lg text-teal-700/75 dark:text-teal-300/85 hover:text-teal-900 dark:hover:text-teal-50 hover:bg-teal-500/15 border border-transparent hover:border-teal-400/35 transition-colors"
              title="Replace player" aria-label="Replace ${nameHtml}">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>`
          : '';
      if (!levelForDisplay) {
        return `
          <div class="flex flex-row items-center justify-center gap-1">
            <span class="font-medium leading-tight">${nameHtml}</span>
            ${replaceIconBtn}
          </div>`;
      }
      const lv = levelForDisplay(rawName);
      return `
        <div class="flex flex-row items-center justify-center gap-1.5 flex-wrap">
          <span class="font-medium leading-tight">${nameHtml}</span>
          ${replaceIconBtn}
          <span class="inline-flex shrink-0 items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded-md text-[0.65rem] font-extrabold tabular-nums bg-teal-100 text-teal-900 dark:bg-teal-500/25 dark:text-teal-50 border border-teal-400/55 dark:border-teal-400/40 shadow-sm" title="Power level">L${lv}</span>
        </div>
      `;
    };

    const showTennisStrip = sProf.style === 'games';
    const tennisInteractive = showTennisStrip && !state.shareViewerMode;

    container.innerHTML = roundData.matches
      .map(
        (match, idx) => {
          const mg = match.mx_game || { i1: 0, i2: 0 };
          const l1 = TENNIS_PTS_LABEL[Math.min(mg.i1, 3)] ?? '0';
          const l2 = TENNIS_PTS_LABEL[Math.min(mg.i2, 3)] ?? '0';
          const g1n = Number(match.score1) || 0;
          const g2n = Number(match.score2) || 0;
          const mexMatchDone = showTennisStrip && isMexMatchComplete(g1n, g2n, sProf);
          const ptBtnClass =
            'text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-300/90 dark:border-white/20 text-emerald-900 dark:text-emerald-100';
          const ptBtnOn =
            'bg-slate-200/90 dark:bg-white/10 hover:bg-slate-300/90 dark:hover:bg-white/15';
          const ptBtnOff = 'bg-slate-100/80 dark:bg-white/5 opacity-50 cursor-not-allowed';
          const courtLabel = formatCourtLabel(match.court, state.currentTournament);
          return `
        <div class="bg-emerald-50/95 dark:bg-emerald-800/50 rounded-3xl p-4 border border-emerald-300/75 dark:border-emerald-600/45 shadow-cozy-sm">
          <div class="text-center text-sm text-emerald-700 dark:text-emerald-400 mb-1 font-medium">${escapeHtml(courtLabel)}</div>
          <div class="text-center text-[10px] text-emerald-700/95 dark:text-emerald-500/90 mb-3 leading-snug">${escapeHtml(scoreHint)}</div>

          <div class="flex items-center gap-4">
            <!-- Team 1 -->
            <div class="flex-1 text-center">
              <div class="text-sm mb-2 space-y-2">
                ${playerCourtLine(match.team1[0], idx, 'team1', 0)}
                ${playerCourtLine(match.team1[1], idx, 'team1', 1)}
              </div>
              <div class="flex items-center justify-center gap-2">
                <input type="number" id="score-input-${idx}-1" value="${match.score1 ?? ''}" min="0"
                  max="${numMax}"
                  onfocus="setEditingScore(true)"
                  oninput="updateScoreLive(${idx}, 1)"
                  onblur="commitScore(${idx}, 1)"
                  class="w-16 bg-emerald-100 dark:bg-emerald-700/90 border border-emerald-400/70 dark:border-emerald-500/50 rounded-xl text-center text-xl font-bold text-slate-900 dark:text-white focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-400/25">
              </div>
            </div>

            <div class="text-2xl text-emerald-700 dark:text-emerald-300 font-extrabold">vs</div>

            <!-- Team 2 -->
            <div class="flex-1 text-center">
              <div class="text-sm mb-2 space-y-2">
                ${playerCourtLine(match.team2[0], idx, 'team2', 0)}
                ${playerCourtLine(match.team2[1], idx, 'team2', 1)}
              </div>
              <div class="flex items-center justify-center gap-2">
                <input type="number" id="score-input-${idx}-2" value="${match.score2 ?? ''}" min="0"
                  max="${numMax}"
                  onfocus="setEditingScore(true)"
                  oninput="updateScoreLive(${idx}, 2)"
                  onblur="commitScore(${idx}, 2)"
                  class="w-16 bg-emerald-100 dark:bg-emerald-700/90 border border-emerald-400/70 dark:border-emerald-500/50 rounded-xl text-center text-xl font-bold text-slate-900 dark:text-white focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-400/25">
              </div>
            </div>
          </div>
          ${
            showTennisStrip
              ? `
          <div class="mt-4 pt-3 border-t border-emerald-200/80 dark:border-emerald-700/45 text-center">
            <div class="text-[10px] text-emerald-700/95 dark:text-emerald-300/90 uppercase tracking-wide mb-2">Current game (optional): 0 → 15 → 30 → 40 · deuce = next point wins</div>
            <div class="flex justify-center items-center gap-6 text-sm">
              <div class="flex flex-col items-center gap-1">
                <span class="tabular-nums text-lg font-bold text-emerald-900 dark:text-emerald-100">${l1}</span>
                ${
                  tennisInteractive
                    ? `<button type="button" ${mexMatchDone ? 'disabled' : ''} data-action="mex-point" data-idx="${idx}" data-side="1"
                  class="${ptBtnClass} ${mexMatchDone ? ptBtnOff : ptBtnOn}">
                  + Point
                </button>`
                    : ''
                }
              </div>
              <div class="flex flex-col items-center gap-1">
                <span class="tabular-nums text-lg font-bold text-emerald-900 dark:text-emerald-100">${l2}</span>
                ${
                  tennisInteractive
                    ? `<button type="button" ${mexMatchDone ? 'disabled' : ''} data-action="mex-point" data-idx="${idx}" data-side="2"
                  class="${ptBtnClass} ${mexMatchDone ? ptBtnOff : ptBtnOn}">
                  + Point
                </button>`
                    : ''
                }
              </div>
            </div>
          </div>`
              : ''
          }
        </div>
      `;
        }
      )
      .join('');
  };

  /**
   * Mexicano (Swiss-system): R1 by roster order; R2+ rank active players by global standings
   * (computeLeaderboardSorted) and assign top 4 -> court 1, next 4 -> court 2, etc.
   * Within each court, pick the best 2v2 split that minimizes repeat partners/opponents.
   */
  function buildMexicanoMatches (players, courts, rounds, roundNo, tournament) {
    const cap = computeMexicanoRoundCapacity(players.length, courts);
    if (cap.usedCourtsPerRound <= 0) return [];

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

    let bestMatches = null;
    let bestTuple = null;
    for (const active of candidates) {
      const { matches, roundScore } = buildNormalMexicanoRoundFromActive(
        players,
        active,
        cap.usedCourtsPerRound,
        rounds,
        roundNo,
        tournament
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
      const tuple = [fairnessPenalty, proj.gamesDiff, proj.byeDiff, exactPenalty, roundScore];
      if (!bestTuple || mexLexLess(tuple, bestTuple)) {
        bestTuple = tuple;
        bestMatches = matches;
      }
    }
    return bestMatches || [];
  }

  /**
   * Mix Mexicano (Swiss-system): equal M/F. R1 by roster order per gender; R2+ rank each gender by
   * individual standings (top M and top F together on court 1, etc.). Within each court, choose
   * parallel (M0+F0 vs M1+F1) or cross (M0+F1 vs M1+F0) pairing with lower penalty.
   */
  function buildMixMexicanoMatches (playersFull, courts, allRounds, roundNo, tournament) {
    const malesAll = playersFull.filter((p) => p.gender === 'M').map((p) => p.name);
    const femalesAll = playersFull.filter((p) => p.gender === 'F').map((p) => p.name);
    const cap = computeMixMexicanoRoundCapacity(malesAll.length, femalesAll.length, courts);
    if (cap.effectiveCourtsPerRound <= 0) return [];

    const need = cap.playingPerGender;
    const maleCandidates = enumerateMixMexicanoFairActiveSets(
      malesAll, need, allRounds, roundNo, 12
    );
    const femaleCandidates = enumerateMixMexicanoFairActiveSets(
      femalesAll, need, allRounds, roundNo, 12
    );

    const statsM = tallyMexicanoPlayerStats(malesAll, allRounds, roundNo);
    const statsF = tallyMexicanoPlayerStats(femalesAll, allRounds, roundNo);
    const targets = computeMixMexicanoSessionTargets(
      malesAll.length,
      femalesAll.length,
      courts,
      Math.max(roundNo, getPriorRoundsCompleted(allRounds, roundNo).length + 1)
    );
    const idealGamesMInt = Number.isInteger(targets.idealGamesPerMale);
    const idealGamesFInt = Number.isInteger(targets.idealGamesPerFemale);
    const idealByesMInt = Number.isInteger(targets.idealByesPerMale);
    const idealByesFInt = Number.isInteger(targets.idealByesPerFemale);
    const history = buildMexicanoHistoryFromRounds(allRounds);

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
        let partnerRepeats = 0;
        let oppRepeats = 0;
        for (const m of matches) {
          for (const team of [m.team1, m.team2]) {
            if ((history.partnerCount.get(pairKey(team[0], team[1])) || 0) > 0) partnerRepeats++;
          }
          const t1 = m.team1 || [];
          const t2 = m.team2 || [];
          t1.forEach((a) => {
            t2.forEach((b) => {
              if ((history.opposeCount.get(pairKey(a, b)) || 0) > 0) oppRepeats++;
            });
          });
        }
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

  /* ---------- Fixed Mexicano (fairness like Normal Mexicano; partners fixed) ---------- */
  const FXM_W_FAIRNESS_HARD = 1000000;

  const computeFixedMexicanoRoundCapacity = (pairCount, courts) => {
    const pairs = Math.max(0, Math.floor(Number(pairCount) || 0));
    const c = Math.max(0, Math.floor(Number(courts) || 0));
    const rawPlaying = Math.min(pairs, c * 2);
    const playingPairsPerRound = Math.floor(rawPlaying / 2) * 2;
    return {
      playingPairsPerRound,
      usedCourtsPerRound: playingPairsPerRound / 2,
      byePairsPerRound: pairs - playingPairsPerRound
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
    return { gamesPlayed, byeCount, mustPlay, lastRound };
  };

  const projectFixedMexicanoFairnessAfterRound = (allPairs, gamesPlayed, byeCount, activePairs, tKey) => {
    const activeKeys = new Set(activePairs.map(tKey));
    const gamesAfter = [];
    const byesAfter = [];
    for (const p of allPairs) {
      const k = tKey(p);
      const on = activeKeys.has(k);
      gamesAfter.push(
        (gamesPlayed.get(k) || 0) + (on ? 1 : 0),
        (gamesPlayed.get(k) || 0) + (on ? 1 : 0)
      );
      byesAfter.push(
        (byeCount.get(k) || 0) + (on ? 0 : 1),
        (byeCount.get(k) || 0) + (on ? 0 : 1)
      );
    }
    return {
      gamesDiff: gamesAfter.length ? Math.max(...gamesAfter) - Math.min(...gamesAfter) : 0,
      byeDiff: byesAfter.length ? Math.max(...byesAfter) - Math.min(...byesAfter) : 0,
      gamesAfter,
      byesAfter
    };
  };

  const enumerateFixedMexicanoFairActiveSets = (
    allPairs, courts, allRounds, roundNo, tKey, resolve, maxCandidates = 16
  ) => {
    const arr = Array.isArray(allPairs) ? allPairs : [];
    const want = computeFixedMexicanoRoundCapacity(arr.length, courts).playingPairsPerRound;
    if (want <= 0) return [[]];
    if (want >= arr.length) return [arr.slice()];

    const { gamesPlayed, byeCount, mustPlay, lastRound } =
      tallyFixedMexicanoPairStats(arr, allRounds, roundNo, tKey, resolve);
    const pos = new Map(arr.map((p, i) => [tKey(p), i]));

    if (!lastRound) {
      const pool = [...arr];
      const combos = [];
      const combo = [];
      const capN = Math.max(1, Math.floor(Number(maxCandidates) || 1));
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
      return combos.length ? combos : [pool.slice(0, want)];
    }

    if (mustPlay.length > want) {
      return [[...mustPlay].sort((a, b) =>
        (gamesPlayed.get(tKey(a)) || 0) - (gamesPlayed.get(tKey(b)) || 0) ||
        (byeCount.get(tKey(b)) || 0) - (byeCount.get(tKey(a)) || 0) ||
        (pos.get(tKey(a)) ?? 0) - (pos.get(tKey(b)) ?? 0)
      ).slice(0, want)];
    }

    const forced = mustPlay.slice();
    const forcedSet = new Set(forced.map(tKey));
    const remaining = want - forced.length;
    const keyed = arr
      .filter((p) => !forcedSet.has(tKey(p)))
      .map((p) => ({
        pair: p,
        games: gamesPlayed.get(tKey(p)) || 0,
        byes: byeCount.get(tKey(p)) || 0,
        idx: pos.get(tKey(p))
      }))
      .sort((a, b) => a.games - b.games || a.byes - b.byes || a.idx - b.idx);

    if (remaining >= keyed.length) return [[...forced, ...keyed.map((x) => x.pair)]];

    const combos = [];
    const combo = [];
    const capN = Math.max(1, Math.floor(Number(maxCandidates) || 1));
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
    return combos.length ? combos : [[...forced, ...keyed.slice(0, remaining).map((x) => x.pair)]];
  };

  const scoreFixedMexicanoPairMatch = (
    p1, p2, history, lastRoundMatchupSet, resolve, levelByName
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
    let s = scoreMexOpponentPairs(pairA, pairB, opposeCount);
    for (const [x, y] of [[a1, b1], [a1, b2], [a2, b1], [a2, b2]]) {
      const meetings =
        (history.partnerCount.get(pairKey(x, y)) || 0) +
        (opposeCount.get(pairKey(x, y)) || 0);
      if (meetings > 0) s += meetings * NM_W_MEETING;
      else s -= NM_B_NEW_MEETING;
    }
    s += (matchupCount.get(mk) || 0) * NM_W_EXACT_MATCH;
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
    selectedPairs, history, lastRoundMatchupSet, resolve, levelByName
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
    const greedy = buildBestFixedPairMatches(
      selectedPairs,
      history,
      lastRoundMatchupSet || new Set()
    );
    let roundScore = 0;
    if (greedy.length === numCourts) {
      for (const m of greedy) {
        roundScore += scoreFixedMexicanoPairMatch(
          { m: m.team1[0], f: m.team1[1] },
          { m: m.team2[0], f: m.team2[1] },
          history,
          lastRoundMatchupSet,
          resolve,
          levelByName
        );
      }
    }
    return { matches: greedy, roundScore };
  };

  const buildFixedMexicanoRoundFromActive = (
    allPairObjs, activePairs, allRounds, roundNo, tournament, playersFull
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
    const history = buildMexicanoHistoryFromRounds(allRounds);
    const prevRound = getPreviousRoundDatum(allRounds, roundNo);
    const lastRoundMatchupSet = getLastRoundMatchupSet(prevRound, resolve);
    const levelByName = makeLevelByNameMap(playersFull || getPlayersFull());
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

  const buildFixedPairsMexicanoMatches = (
    allPairObjs, courts, allRounds, roundNo, tournament, playersFull
  ) => {
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
        allPairObjs, active, cap.usedCourtsPerRound, allRounds, roundNo, tournament, playersFull
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

  const generateRound = async () => {
    syncCurrentTournament();
    if (!state.currentTournament) return;

    const mode = state.currentTournament.mode || 'normal';
    const courts = Number(state.currentTournament.courts) || 1;
    const rounds = getRounds();
    const roundNo = Number(state.currentTournament.current_round) || 1;

    let roundData = rounds.find((r) => Number(r.round) === roundNo);
    if (roundData) {
      renderCourts(roundData);
      return;
    }

    // ---------- MIX MODE (rotation + fairness) ----------
    if (mode === 'mix') {
      const playersFull = getPlayersFull();
      const rosterNames = playersFull.map((p) => p.name);
      const malesAll = playersFull.filter(p => p.gender === 'M').map(p => p.name);
      const femalesAll = playersFull.filter(p => p.gender === 'F').map(p => p.name);

      // how many courts can we actually fill in mix (needs 2M+2F per court)
      const maxCourtsByGender = Math.min(
        courts,
        Math.floor(malesAll.length / 2),
        Math.floor(femalesAll.length / 2)
      );

      if (maxCourtsByGender <= 0) {
        roundData = { round: roundNo, matches: [] };
        rounds.push(roundData);
        setRounds(rounds);
        await saveCurrentTournament();
        renderCourts(roundData);
        return;
      }

      // Mix Americano now uses the shared per-round fairness optimizer from
      // pairing.js: select active males/females (gender-balanced fairness),
      // enumerate every valid 2M+2F match candidate, branch-and-bound for the
      // lowest-penalty disjoint set, then re-rank by per-player partner /
      // opponent / meeting deficit balance. No pre-generated `mix_schedule_json`
      // is consulted; the generator module is kept only for backwards
      // compatibility but intentionally does NOT override dynamic selection.
      let matches = [];
      const mixBuilder = window.Padelio?.buildMixDynamicMatches;
      if (typeof mixBuilder === 'function') {
        const built = mixBuilder(malesAll, femalesAll, maxCourtsByGender, rounds, roundNo);
        matches = Array.isArray(built?.matches) ? built.matches : [];
      } else {
        // Defensive fallback: should not happen in production since pairing.js
        // loads before script.js. Mirrors the previous greedy behavior so we
        // still produce a playable round even if the shared module is missing.
        const mixActive = pickActivePlayersMixBalancedGender(
          malesAll,
          femalesAll,
          maxCourtsByGender,
          rounds,
          roundNo
        );
        const activeM = mixActive.activeM;
        const activeF = mixActive.activeF;
        const { partnerCount, opposeCount } = buildMixHistory();
        const pairs = [];
        const fPool = [...activeF];
        activeM.forEach((m) => {
          let bestIdx = -1;
          let bestScore = Infinity;
          for (let i = 0; i < fPool.length; i++) {
            const f = fPool[i];
            const s = (partnerCount.get(pairKey(m, f)) || 0);
            if (s < bestScore) { bestScore = s; bestIdx = i; }
            if (bestScore === 0) break;
          }
          if (bestIdx >= 0) {
            const f = fPool.splice(bestIdx, 1)[0];
            pairs.push({ m, f });
          }
        });
        const pool = shuffle([...pairs.slice(0, maxCourtsByGender * 2)]);
        for (let c = 0; c < maxCourtsByGender; c++) {
          if (pool.length < 2) break;
          const p1 = pool.shift();
          let bestIdxC = -1;
          let bestC = Infinity;
          for (let j = 0; j < pool.length; j++) {
            const s = pairCrossOpposeScore(p1, pool[j], opposeCount);
            if (s < bestC) { bestC = s; bestIdxC = j; }
          }
          const p2 = pool.splice(bestIdxC, 1)[0];
          matches.push({
            court: c + 1,
            team1: [p1.m, p1.f],
            team2: [p2.m, p2.f],
            score1: '',
            score2: ''
          });
        }
      }

      roundData = { round: roundNo, matches };
      rounds.push(roundData);
      setRounds(rounds);
      await saveCurrentTournament();
      renderCourts(roundData);
      return;
    }

    if (mode === 'mexicano') {
      const players = getPlayers();
      const maxCourts = Math.min(courts, Math.floor(players.length / 4));
      let matches = [];
      if (maxCourts > 0) {
        matches = buildMexicanoMatches(players, courts, rounds, roundNo, state.currentTournament);
      }
      roundData = { round: roundNo, matches };
      rounds.push(roundData);
      setRounds(rounds);
      await saveCurrentTournament();
      renderCourts(roundData);
      return;
    }

    if (mode === 'mixmex') {
      const playersFull = getPlayersFull();
      const malesN = playersFull.filter((p) => p.gender === 'M').length;
      const femN = playersFull.filter((p) => p.gender === 'F').length;
      const maxCourts = Math.min(
        courts,
        Math.floor(malesN / 2),
        Math.floor(femN / 2)
      );
      let matches = [];
      if (maxCourts > 0) {
        matches = buildMixMexicanoMatches(
          playersFull, courts, rounds, roundNo, state.currentTournament
        );
      }
      roundData = { round: roundNo, matches };
      rounds.push(roundData);
      setRounds(rounds);
      await saveCurrentTournament();
      renderCourts(roundData);
      return;
    }

    // ---------- FIXED PAIRS — Americano (shuffle attempts + opponent variety) or Mexicano (bench + standings) ----------
    if (mode === 'fixed' || mode === 'fixedmex') {
      const playersFull = getPlayersFull();
      if (playersFull.length % 2 !== 0) {
        roundData = { round: roundNo, matches: [] };
        rounds.push(roundData);
        setRounds(rounds);
        await saveCurrentTournament();
        renderCourts(roundData);
        return;
      }

      const allPairObjs = [];
      for (let i = 0; i + 1 < playersFull.length; i += 2) {
        allPairObjs.push({ m: playersFull[i].name, f: playersFull[i + 1].name });
      }
      const numPairs = allPairObjs.length;
      const maxCourts = Math.min(courts, Math.floor(numPairs / 2));
      let matches = [];
      if (maxCourts > 0) {
        const needPairs = maxCourts * 2;
        if (mode === 'fixedmex') {
          matches = buildFixedPairsMexicanoMatches(
            allPairObjs, courts, rounds, roundNo, state.currentTournament, playersFull
          );
        } else {
          const active = pickActiveFixedPairs(allPairObjs, needPairs, rounds, roundNo);
          const history = buildMixHistory();
          const lastRound = getPreviousRoundDatum(rounds, roundNo);
          const lastFixedMatchups = getLastRoundFixedMatchupSet(lastRound);
          matches = buildBestFixedPairMatches(active, history, lastFixedMatchups);
        }
      }
      roundData = { round: roundNo, matches };
      rounds.push(roundData);
      setRounds(rounds);
      await saveCurrentTournament();
      renderCourts(roundData);
      return;
    }

    // ---------- BALANCED AMERICANO (power levels; same bench/rotation as normal) ----------
    if (mode === 'balanced') {
      const players = getPlayers();
      const playersFull = getPlayersFull();
      const levelByName = makeLevelByNameMap(playersFull);
      const maxCourts = Math.min(courts, Math.floor(players.length / 4));
      let matches = [];

      if (maxCourts > 0) {
        const slots = maxCourts * 4;
        const active = pickActivePlayersNormal(players, slots, rounds, roundNo);

        await new Promise((resolveRaf) => {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolveRaf());
          } else {
            setTimeout(resolveRaf, 0);
          }
        });

        const g = typeof globalThis !== 'undefined' ? globalThis : window;

        let plannerAttempted = false;
        try {
          const plannerFn =
            typeof g.planAmericanoRound === 'function'
              ? g.planAmericanoRound
              : typeof g.PadelioAmericanoPlanner?.planAmericanoRound === 'function'
                ? g.PadelioAmericanoPlanner.planAmericanoRound
                : null;

          if (typeof plannerFn === 'function') {
            plannerAttempted = true;
            const out = plannerFn({
              players,
              courtCount: maxCourts,
              priorRounds: rounds,
              roundNo,
              levelByName,
              opts: { fixedActiveNames: active }
            });
            const ok =
              out &&
              !out.error &&
              Array.isArray(out.matches) &&
              out.matches.length === maxCourts;
            if (ok) {
              matches = out.matches;
            }
          }
        } catch (e) {
          console.warn('[Padelio] balanced round planner failed', e);
          plannerAttempted = true;
        }

        if (matches.length === 0) {
          const history = buildMixHistory();
          matches = buildBestNormalMatches(
            active, maxCourts, history, rounds, roundNo, players, levelByName
          );
          if (plannerAttempted) toast('Could not optimize round — using classic pairing.');
        }
      }

      roundData = { round: roundNo, matches };
      rounds.push(roundData);
      setRounds(rounds);
      await saveCurrentTournament();
      renderCourts(roundData);
      return;
    }

    // ---------- NORMAL MODE (dynamic fairness engine: bye + partner/opponent variety) ----------
    {
      const players = getPlayers();
      let matches = [];

      const g = typeof globalThis !== 'undefined' ? globalThis : window;
      const planner =
        (typeof g.planNormalAmericanoRound === 'function' && g.planNormalAmericanoRound) ||
        (g.PadelioNormalAmericano && typeof g.PadelioNormalAmericano.planNormalAmericanoRound === 'function'
          ? g.PadelioNormalAmericano.planNormalAmericanoRound
          : null);

      if (typeof planner === 'function' && players.length >= 4 && courts >= 1) {
        try {
          const out = planner({
            players,
            courts,
            priorRounds: rounds,
            roundNo
          });
          if (out && Array.isArray(out.matches) && !out.error) {
            matches = out.matches;
            if (Array.isArray(out.warnings) && out.warnings.length) {
              console.warn('[Padelio normal] planner warnings:', out.warnings);
            }
          } else if (out?.error) {
            console.warn('[Padelio normal] planner error:', out.error);
          }
        } catch (e) {
          console.warn('[Padelio normal] planner threw', e);
        }
      }

      // Legacy fallback (only used if the new planner is unavailable or failed).
      if (matches.length === 0) {
        const maxCourts = Math.min(courts, Math.floor(players.length / 4));
        if (maxCourts > 0) {
          const slots = maxCourts * 4;
          const active = pickActivePlayersNormal(players, slots, rounds, roundNo);
          const history = buildMixHistory();
          matches = buildBestNormalMatches(active, maxCourts, history, rounds, roundNo, players, null);
          if (matches.length !== maxCourts) {
            const forceActive = pickActivePlayersNormal(players, maxCourts * 4, rounds, roundNo);
            matches = buildBestNormalMatches(forceActive, maxCourts, history, rounds, roundNo, players, null);
          }
        }
      }

      roundData = { round: roundNo, matches };
      rounds.push(roundData);
      setRounds(rounds);
      await saveCurrentTournament();
      renderCourts(roundData);
    }
  };

  const updateRoundIndicator = () => {
    const ind = $('round-indicator');
    if (!ind || !state.currentTournament) return;
    const cr = Number(state.viewingRound ?? state.currentTournament.current_round) || 1;
    const c = Number(state.currentTournament.courts) || 1;
    ind.textContent = `Round ${cr} · ${c} court${c > 1 ? 's' : ''}`;
  };

  const renderRoundBenchPanel = (roundData, tournamentLike) => {
    const panel = $('round-bench-panel');
    const content = $('round-bench-content');
    if (!panel || !content) return;
    const t = tournamentLike || state.currentTournament;
    if (!roundData || !t) {
      panel.classList.add('hidden');
      return;
    }
    const bench = computeBenchForRound(roundData, t);
    if (bench.count === 0) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    content.innerHTML = renderBenchHtml(bench);
  };

  const updateRoundActionButtons = () => {
    const btn = $('btn-regenerate-round');
    if (!btn) return;
    if (state.shareViewerMode || !state.currentTournament) {
      btn.classList.add('hidden');
      return;
    }
    btn.classList.remove('hidden');
    const cr = Number(state.currentTournament.current_round) || 1;
    const viewing = Number(state.viewingRound ?? cr) || cr;
    const can = viewing === cr && canRegenerateRound(cr);
    btn.disabled = !can;
    btn.classList.toggle('opacity-40', !can);
    btn.classList.toggle('cursor-not-allowed', !can);
  };

  const regenerateCurrentRound = async () => {
    syncCurrentTournament();
    if (!state.currentTournament) return;
    const roundNo = Number(state.currentTournament.current_round) || 1;
    if (!canRegenerateRound(roundNo)) {
      toast('Cannot shuffle again — enter scores first or open the current round.');
      return;
    }
    if (
      !window.confirm(
        'Shuffle this round again? Matchups will change. Past rounds stay the same.'
      )
    ) {
      return;
    }
    const rounds = getRounds().filter((r) => Number(r.round) !== roundNo);
    setRounds(rounds);
    await generateRound();
    state.viewingRound = roundNo;
    renderSpecificRound(roundNo);
    toast('Round shuffled again.');
  };

  const renderSpecificRound = (roundNumber) => {
    syncCurrentTournament();
    if (!state.currentTournament) return;

    const rounds = getRounds();
    const rn = Number(roundNumber) || 1;
    const roundData = rounds.find((r) => Number(r.round) === rn);

    updateRoundIndicator();

    if (!roundData) {
      $('round-bench-panel')?.classList.add('hidden');
      const c = $('courts-container');
      if (c) {
        c.innerHTML = `
          <div class="bg-emerald-50/95 dark:bg-emerald-800/50 rounded-3xl p-6 border border-emerald-300/75 dark:border-emerald-600/45 text-center text-emerald-800 dark:text-emerald-200 shadow-cozy-sm">
            No data for Round ${rn} yet.
          </div>
        `;
      }
      updateRoundArrowState();
      updateRoundActionButtons();
      return;
    }

    renderRoundBenchPanel(roundData, state.currentTournament);
    renderCourts(roundData);
    updateRoundArrowState();
    updateRoundActionButtons();
  };

  /* ---------- Score editing ---------- */
  const setEditingScore = (v) => {
    state.isEditingScore = !!v;
  };

  const updateScoreLive = (matchIdx, team) => {
    syncCurrentTournament();
    if (!state.currentTournament) return;

    ensureViewingRoundValid();

    const rounds = getRounds();
    const activeRound = state.viewingRound ?? state.currentTournament.current_round;
    const roundData = rounds.find((r) => Number(r.round) === Number(activeRound));
    if (!roundData) return;

    const match = roundData.matches?.[matchIdx];
    if (!match) return;

    const prof = getTournamentScoringProfile(state.currentTournament);
    const maxPts =
      prof.style === 'games'
        ? prof.bestOf
        : Number(state.currentTournament.points_to_win) || 21;
    const input1 = $(`score-input-${matchIdx}-1`);
    const input2 = $(`score-input-${matchIdx}-2`);
    if (!input1 || !input2) return;

    if (prof.style === 'games') {
      const raw = (team === 1 ? input1.value : input2.value).trim();

      if (raw === '') {
        if (team === 1) {
          match.score1 = '';
          input1.value = '';
        } else {
          match.score2 = '';
          input2.value = '';
        }
        if (input1.value.trim() === '' && input2.value.trim() === '') {
          match.score1 = '';
          match.score2 = '';
          delete match.mx_game;
        }
        setRounds(rounds);
        debouncedSaveTournament();
        return;
      }

      let s = parseInt(raw, 10);
      if (!Number.isFinite(s) || s < 0) return;
      s = clamp(s, 0, maxPts);

      const opp = gamesOppFromEntered(s, prof);

      if (team === 1) {
        match.score1 = s;
        match.score2 = opp;
        input1.value = String(s);
        input2.value = String(opp);
      } else {
        match.score2 = s;
        match.score1 = opp;
        input2.value = String(s);
        input1.value = String(opp);
      }

      const norm = applyMexGamesScoresToMatch(match, prof, match.score1, match.score2);
      input1.value = String(norm.g1);
      input2.value = String(norm.g2);
      delete match.mx_game;
      setRounds(rounds);
      debouncedSaveTournament();
      return;
    }

    const raw = (team === 1 ? input1.value : input2.value).trim();

    // empty => clear both, debounce save
    if (raw === '') {
      match.score1 = '';
      match.score2 = '';
      if (team === 1) input2.value = '';
      else input1.value = '';

      setRounds(rounds);
      debouncedSaveTournament();
      return;
    }

    let s = parseInt(raw, 10);
    if (!Number.isFinite(s) || s < 0) return;
    s = clamp(s, 0, maxPts);

    const otherRaw = team === 1 ? input2.value.trim() : input1.value.trim();
    if (otherRaw !== '' && parseInt(otherRaw, 10) === s) {
      match.score1 = s;
      match.score2 = s;
      input1.value = String(s);
      input2.value = String(s);
    } else {
      const opp = Math.max(0, maxPts - s);
      if (team === 1) {
        match.score1 = s;
        match.score2 = opp;
        input2.value = String(opp);
      } else {
        match.score2 = s;
        match.score1 = opp;
        input1.value = String(opp);
      }
    }

    setRounds(rounds);
    debouncedSaveTournament();
    updateRoundActionButtons();
  };

  const commitScore = (matchIdx, team) => {
    state.isEditingScore = false;

    syncCurrentTournament();
    if (!state.currentTournament) return;

    ensureViewingRoundValid();

    const rounds = getRounds();
    const activeRound = state.viewingRound ?? state.currentTournament.current_round;
    const roundData = rounds.find((r) => Number(r.round) === Number(activeRound));
    if (!roundData) return;

    const match = roundData.matches?.[matchIdx];
    if (!match) return;

    const prof = getTournamentScoringProfile(state.currentTournament);
    const maxPts =
      prof.style === 'games'
        ? prof.bestOf
        : Number(state.currentTournament.points_to_win) || 21;
    const input1 = $(`score-input-${matchIdx}-1`);
    const input2 = $(`score-input-${matchIdx}-2`);
    if (!input1 || !input2) return;

    if (prof.style === 'games') {
      const r1 = input1.value.trim();
      const r2 = input2.value.trim();

      if (r1 === '' && r2 === '') {
        match.score1 = '';
        match.score2 = '';
        input1.value = '';
        input2.value = '';
        delete match.mx_game;
      } else {
        let g1 = r1 === '' ? 0 : clamp(parseInt(r1, 10) || 0, 0, maxPts);
        let g2 = r2 === '' ? 0 : clamp(parseInt(r2, 10) || 0, 0, maxPts);
        const norm = applyMexGamesScoresToMatch(match, prof, g1, g2);
        input1.value = String(norm.g1);
        input2.value = String(norm.g2);
        delete match.mx_game;
      }

      setRounds(rounds);
      saveCurrentTournament().catch(() => {});
      maybeRefreshDesktopLeaderboard();
      updateRoundActionButtons();
      return;
    }

    const raw = (team === 1 ? input1.value : input2.value).trim();

    if (raw === '') {
      match.score1 = '';
      match.score2 = '';
      input1.value = '';
      input2.value = '';
    } else {
      let s = parseInt(raw, 10);
      if (!Number.isFinite(s) || s < 0) s = 0;
      s = clamp(s, 0, maxPts);

      const otherRaw = team === 1 ? input2.value.trim() : input1.value.trim();
      if (otherRaw !== '' && parseInt(otherRaw, 10) === s) {
        match.score1 = s;
        match.score2 = s;
      } else {
        const opp = Math.max(0, maxPts - s);
        if (team === 1) {
          match.score1 = s;
          match.score2 = opp;
        } else {
          match.score2 = s;
          match.score1 = opp;
        }
      }

      input1.value = match.score1 === '' ? '' : String(match.score1);
      input2.value = match.score2 === '' ? '' : String(match.score2);
    }

    setRounds(rounds);
    saveCurrentTournament().catch(() => {});
    maybeRefreshDesktopLeaderboard();
    updateRoundActionButtons();
  };

  /* ---------- Round navigation ---------- */
  const updateRoundArrowState = () => {
    if (!state.currentTournament) return;

    const maxRound = getMaxRoundNumber();
    const activeRound = Number(state.viewingRound ?? state.currentTournament.current_round) || 1;

    const prevBtn = $('btn-prev-round');
    const nextBtn = $('btn-next-round');
    if (!prevBtn || !nextBtn) return;

    const prevDisabled = activeRound <= 1;
    const nextDisabled = activeRound >= maxRound;

    prevBtn.classList.toggle('opacity-30', prevDisabled);
    prevBtn.classList.toggle('cursor-not-allowed', prevDisabled);

    nextBtn.classList.toggle('opacity-30', nextDisabled);
    nextBtn.classList.toggle('cursor-not-allowed', nextDisabled);
  };

  const prevRoundView = () => {
    if (!state.currentTournament) return;
    syncCurrentTournament();

    const maxRound = getMaxRoundNumber();
    const activeRound = Number(state.viewingRound ?? maxRound) || 1;
    if (activeRound <= 1) return;

    state.viewingRound = activeRound - 1;
    renderSpecificRound(state.viewingRound);
  };

  const nextRoundView = () => {
    if (!state.currentTournament) return;
    syncCurrentTournament();

    const maxRound = getMaxRoundNumber();
    const activeRound = Number(state.viewingRound ?? maxRound) || 1;
    if (activeRound >= maxRound) return;

    state.viewingRound = activeRound + 1;
    renderSpecificRound(state.viewingRound);
  };

  const nextRound = async () => {
    syncCurrentTournament();
    if (!state.currentTournament) return;

    state.currentTournament.current_round = (Number(state.currentTournament.current_round) || 1) + 1;
    state.viewingRound = state.currentTournament.current_round;

    updateRoundIndicator();

    await saveCurrentTournament();
    await generateRound();

    state.viewingRound = state.currentTournament.current_round;
    renderSpecificRound(state.viewingRound);
  };

  /* ---------- Open tournament ---------- */
  const openTournament = async (id) => {
    state.currentTournament = state.tournaments.find((t) => t.__backendId === id) || null;
    if (!state.currentTournament) return;

    state.viewingRound = state.currentTournament.current_round;

    const title = $('round-title');
    const tm = state.currentTournament.title || '';
    const md = state.currentTournament.mode || 'normal';
    const modeSuffix =
      md === 'mexicano'
        ? ' · Mexicano'
        : md === 'mixmex'
          ? ' · Mix Mexicano'
          : md === 'mix'
            ? ' · Mix'
            : md === 'fixedmex'
              ? ' · Fixed Mexicano'
              : md === 'fixed'
                ? ' · Fixed Americano'
                : md === 'balanced'
                  ? ' · Balanced Americano'
                  : '';
    if (title) title.textContent = tm + modeSuffix;
    syncHostCourtsMenuVisibility();
    updateRoundIndicator();

    await generateRound();
    navigateTo('rounds');
    requestAnimationFrame(() => {
      scrollAppToTop();
    });
    ensureViewingRoundValid();
    updateRoundArrowState();
  };

  /* ---------- Menu ---------- */
  const toggleMenu = () => {
    const menu = $('dropdown-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
  };

  document.addEventListener('click', (e) => {
    const menu = $('dropdown-menu');
    if (!menu) return;
    if (!e.target.closest('#dropdown-menu') && !e.target.closest('[onclick="toggleMenu()"]')) {
      menu.classList.add('hidden');
    }
  });

  let courtsChangeDraft = 1;

  const hideCourtsChangePanel = () => {
    $('courts-change-panel')?.classList.add('hidden');
  };

  const syncHostCourtsMenuVisibility = () => {
    const btn = $('menu-change-courts-btn');
    if (!btn) return;
    const hide = state.shareViewerMode || !state.currentTournament;
    btn.classList.toggle('hidden', hide);
  };

  const refreshCourtsChangePanelUi = () => {
    const t = state.currentTournament;
    if (!t) return;
    const max = getMaxCourtsForTournament(t);
    const min = 1;
    courtsChangeDraft = clamp(courtsChangeDraft, min, max);

    const valEl = $('courts-change-value');
    const maxEl = $('courts-change-max-label');
    const minusBtn = $('courts-change-minus');
    const plusBtn = $('courts-change-plus');
    if (valEl) valEl.textContent = String(courtsChangeDraft);
    if (maxEl) {
      maxEl.textContent = `Max ${max} court${max > 1 ? 's' : ''} for current roster`;
    }
    if (minusBtn) minusBtn.disabled = courtsChangeDraft <= min;
    if (plusBtn) plusBtn.disabled = courtsChangeDraft >= max;

    $$('.courts-change-chip').forEach((chip) => {
      const n = Number(chip.dataset.courtsDraft) || 0;
      const inRange = n >= min && n <= max;
      chip.disabled = !inRange;
      chip.classList.toggle('opacity-40', !inRange);
      chip.classList.toggle('cursor-not-allowed', !inRange);
      chip.classList.toggle(
        'border-lime-500',
        inRange && n === courtsChangeDraft
      );
      chip.classList.toggle(
        'bg-lime-100/90',
        inRange && n === courtsChangeDraft
      );
      chip.classList.toggle(
        'dark:bg-lime-500/20',
        inRange && n === courtsChangeDraft
      );
    });
  };

  const showCourtsChangePanel = () => {
    if (state.shareViewerMode || !state.currentTournament) return;
    syncCurrentTournament();
    $('dropdown-menu')?.classList.add('hidden');
    $('delete-confirm')?.classList.add('hidden');
    courtsChangeDraft = Number(state.currentTournament.courts) || 1;
    refreshCourtsChangePanelUi();
    $('courts-change-panel')?.classList.remove('hidden');
  };

  const stepCourtsChangeDraft = (delta) => {
    if (!state.currentTournament) return;
    const max = getMaxCourtsForTournament(state.currentTournament);
    courtsChangeDraft = clamp(courtsChangeDraft + (Number(delta) || 0), 1, max);
    refreshCourtsChangePanelUi();
  };

  const setCourtsChangeDraft = (n) => {
    if (!state.currentTournament) return;
    const max = getMaxCourtsForTournament(state.currentTournament);
    courtsChangeDraft = clamp(Math.floor(Number(n) || 1), 1, max);
    refreshCourtsChangePanelUi();
  };

  const cancelCourtsChange = () => {
    hideCourtsChangePanel();
  };

  const invalidateTournamentScheduleCaches = (t) => {
    if (!t) return;
    if (t.social_schedule_json) delete t.social_schedule_json;
    if (t.mix_schedule_json) delete t.mix_schedule_json;
  };

  const changeTournamentCourts = async (newCount) => {
    if (state.shareViewerMode || !state.currentTournament) return false;
    syncCurrentTournament();
    const t = state.currentTournament;
    const current = Number(t.courts) || 1;
    const max = getMaxCourtsForTournament(t);
    const newN = clamp(Math.floor(Number(newCount) || 1), 1, max);

    if (newN === current) {
      hideCourtsChangePanel();
      return true;
    }

    const msg =
      `Change from ${current} to ${newN} court${newN > 1 ? 's' : ''}?\n\n` +
      'Current and past rounds stay as they are. Only the next round you generate will use the new court count.';
    if (!window.confirm(msg)) return false;

    t.courts = newN;
    invalidateTournamentScheduleCaches(t);
    await saveCurrentTournament();
    hideCourtsChangePanel();
    updateRoundIndicator();
    renderTournamentList();
    toast(
      `Courts set to ${newN}. Next round will use ${newN} court${newN > 1 ? 's' : ''}.`
    );
    return true;
  };

  const applyCourtsChange = async () => {
    await changeTournamentCourts(courtsChangeDraft);
  };

  let substituteModalKeyHandler = null;

  const closeSubstitutePlayerModal = () => {
    $('modal-player-substitute')?.classList.add('hidden');
    state.substituteContext = null;
    try {
      document.body.style.overflow = '';
    } catch {}
    if (substituteModalKeyHandler) {
      document.removeEventListener('keydown', substituteModalKeyHandler);
      substituteModalKeyHandler = null;
    }
  };

  const renderSubstituteModalContent = () => {
    const ctx = state.substituteContext;
    if (!ctx || !state.currentTournament) return;

    const mode = state.currentTournament.mode || 'normal';
    const subTitle = $('substitute-modal-subtitle');
    const list = $('substitute-modal-list');
    const empty = $('substitute-modal-empty');
    const fixedNote = $('substitute-modal-fixed-note');
    const genderRow = $('substitute-modal-gender-row');

    if (subTitle) {
      subTitle.textContent = `Replace ${ctx.outgoingName} (Round ${ctx.roundNo})`;
    }

    if (fixedNote) {
      fixedNote.classList.toggle('hidden', mode !== 'fixed' && mode !== 'fixedmex');
    }

    if (genderRow) {
      genderRow.classList.toggle('hidden', !isMixLikeMode(mode));
    }

    const eligible = getEligibleSubstitutes(ctx);
    if (list) {
      if (!eligible.length) {
        list.innerHTML = '';
        empty?.classList.remove('hidden');
      } else {
        empty?.classList.add('hidden');
        list.innerHTML = eligible
          .map((p) => {
            const attr = encodeLbPlayerAttr(p.name);
            const benchTag = p.isBench
              ? '<span class="ml-2 text-xs font-medium text-teal-700 dark:text-teal-300">bench</span>'
              : '';
            const genderTag = p.gender
              ? `<span class="ml-2 text-xs text-slate-500 dark:text-slate-400">${escapeHtml(p.gender)}</span>`
              : '';
            return `
              <button type="button" data-action="substitute-pick" data-player-name="${attr}"
                class="w-full text-left px-4 py-3 rounded-2xl border border-slate-200/90 dark:border-white/15 bg-white/80 dark:bg-slate-800/80 hover:bg-teal-50 dark:hover:bg-teal-900/30 transition-colors">
                <span class="font-semibold text-slate-900 dark:text-white">${escapeHtml(p.name)}</span>${benchTag}${genderTag}
              </button>`;
          })
          .join('');
      }
    }

    const guestInput = $('substitute-guest-name');
    if (guestInput) guestInput.value = '';

    const genderSelect = $('substitute-guest-gender');
    if (genderSelect && isMixLikeMode(mode)) {
      const matchCtx = getSubstituteMatchContext(
        ctx.roundNo, ctx.matchIdx, ctx.teamSide, ctx.slotIdx
      );
      if (matchCtx) {
        const playersFull = getPlayersFull();
        const partnerName = matchCtx.match[matchCtx.side][1 - matchCtx.slot];
        const req = getRequiredSubstituteGender(mode, playersFull, partnerName);
        if (req) genderSelect.value = req;
      }
    }
  };

  const openSubstitutePlayerModal = (matchIdx, teamSide, slotIdx) => {
    if (state.shareViewerMode || !state.currentTournament) return;
    syncCurrentTournament();

    const roundNo = Number(state.viewingRound ?? state.currentTournament.current_round) || 1;
    const ctx = getSubstituteMatchContext(roundNo, matchIdx, teamSide, slotIdx);
    if (!ctx?.outgoingName) {
      toast('Match not found');
      return;
    }

    state.substituteContext = {
      roundNo,
      matchIdx: Number(matchIdx),
      teamSide: ctx.side,
      slotIdx: ctx.slot,
      outgoingName: ctx.outgoingName
    };

    renderSubstituteModalContent();
    const modal = $('modal-player-substitute');
    if (!modal) return;
    modal.classList.remove('hidden');
    try {
      document.body.style.overflow = 'hidden';
    } catch {}

    substituteModalKeyHandler = (e) => {
      if (e.key === 'Escape') closeSubstitutePlayerModal();
    };
    document.addEventListener('keydown', substituteModalKeyHandler);
    guestInputFocus();
  };

  const guestInputFocus = () => {
    requestAnimationFrame(() => {
      $('substitute-guest-name')?.focus({ preventScroll: true });
    });
  };

  const commitSubstitutePick = async (playerName) => {
    const ctx = state.substituteContext;
    if (!ctx) return;
    const result = await substitutePlayerInMatch(
      ctx.roundNo,
      ctx.matchIdx,
      ctx.teamSide,
      ctx.slotIdx,
      playerName
    );
    if (!result.ok) {
      if (result.error !== 'cancelled') toast(result.error || 'Could not replace player');
      return;
    }
    closeSubstitutePlayerModal();
  };

  const addGuestAndSubstitute = async () => {
    const ctx = state.substituteContext;
    if (!ctx || !state.currentTournament) return;

    const nameInput = $('substitute-guest-name');
    const genderSelect = $('substitute-guest-gender');
    const mode = state.currentTournament.mode || 'normal';
    const gender = isMixLikeMode(mode) ? genderSelect?.value : null;

    const guestResult = addGuestPlayerToRoster(nameInput?.value ?? '', gender);
    if (!guestResult.ok) {
      toast(guestResult.error || 'Could not add guest');
      return;
    }

    try {
      await saveCurrentTournament();
    } catch {
      toast('Saved locally; sync may retry');
    }

    const result = await substitutePlayerInMatch(
      ctx.roundNo,
      ctx.matchIdx,
      ctx.teamSide,
      ctx.slotIdx,
      guestResult.name
    );
    if (!result.ok) {
      if (result.error !== 'cancelled') toast(result.error || 'Could not replace player');
      return;
    }
    closeSubstitutePlayerModal();
  };

  const confirmDelete = () => {
    $('dropdown-menu')?.classList.add('hidden');
    hideCourtsChangePanel();
    $('delete-confirm')?.classList.remove('hidden');
  };

  const cancelDelete = () => {
    $('delete-confirm')?.classList.add('hidden');
  };

  const deleteTournamentById = async (id) => {
    if (!window.dataSdk || !id) return false;
    const tournament = state.tournaments.find((t) => t.__backendId === id);
    if (!tournament) return false;

    const label = tournament.title || 'this tournament';
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return false;

    const result = await window.dataSdk.delete(tournament);
    if (result?.isOk) {
      if (state.currentTournament?.__backendId === id) {
        state.currentTournament = null;
        navigateTo('home');
      }
      return true;
    }
    toast('Failed to delete tournament');
    return false;
  };

  const deleteTournament = async () => {
    if (!state.currentTournament) return;
    await deleteTournamentById(state.currentTournament.__backendId);
    cancelDelete();
  };

  const installApp = async () => {
    const evt = state.deferredInstallPrompt;
    if (!evt) {
      const ua = navigator.userAgent || '';
      const isiOS = /iPhone|iPad|iPod/i.test(ua);
      if (isiOS) {
        window.alert(
          'Safari iPhone does not show an automatic install popup.\n\n' +
          'To install Padelio:\n' +
          '1) Tap Share (square + arrow)\n' +
          '2) Choose "Add to Home Screen"\n' +
          '3) Tap Add'
        );
      } else {
        window.alert('Install prompt unavailable. Use browser menu: Install app / Add to Home Screen.');
      }
      return;
    }
    try {
      evt.prompt();
      await evt.userChoice;
    } catch (err) {
      console.error('Install prompt failed', err);
      toast('Failed to show install prompt.');
    } finally {
      state.deferredInstallPrompt = null;
    }
  };

  const clearAppCacheOnly = async (opts = {}) => {
    if (state.shareViewerMode) return;
    const skipConfirm = opts && opts.skipConfirm;
    if (!skipConfirm) {
      const ok = window.confirm(
        'Clear app cache only? Tournament data will stay safe. App will reload after cache is cleared.'
      );
      if (!ok) return;
    }
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      queueToastAfterReload('Cache cleared. Running latest update.');
      setTimeout(() => window.location.reload(), 200);
    } catch (err) {
      console.error('Clear cache failed', err);
      window.alert('Failed to clear app cache on this browser.');
    }
  };

  const clearAllTournamentData = async () => {
    if (state.shareViewerMode) return;
    const ok1 = window.confirm(
      'WARNING: This will delete ALL tournaments and ALL match history on this device. Continue?'
    );
    if (!ok1) return;
    const ok2 = window.confirm(
      'Final confirm: this will clear ALL data and cache on this device. Continue?'
    );
    if (!ok2) return;

    try {
      let deletedCount = 0;
      let deleteFailed = 0;

      if (window.dataSdk) {
        for (const t of [...state.tournaments]) {
          try {
            const r = await window.dataSdk.delete(t);
            if (r?.isOk) deletedCount++;
            else deleteFailed++;
          } catch (err) {
            console.error('Failed deleting tournament', err);
            deleteFailed++;
          }
        }
      }

      state.tournaments = [];
      state.currentTournament = null;
      resetNewTournament();

      // Clear web storage keys.
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}

      // Clear cache entries and service workers.
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }

      if (deleteFailed > 0) {
        window.alert(
          `Data clear finished with ${deleteFailed} failed delete(s).\nPlease refresh and try again.`
        );
        return;
      }

      queueToastAfterReload(`Cleared ${deletedCount} tournament(s), cache, and app data.`);
      renderTournamentList();
      navigateTo('home');
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      console.error('Clear data failed', err);
      window.alert('Failed to clear tournament data on this browser.');
    }
  };

  /* ---------- Share link (spectator / view-only, data in URL hash) ---------- */
  const SHARE_PAYLOAD_VERSION = 1;
  /** Compact on-wire JSON (gzip); expands to canonical v1 for the viewer. */
  const SHARE_WIRE_COMPACT_VERSION = 2;
  const MAX_SHARE_URL_CHARS = 95000;
  /** Legacy plain base64url(JSON). New links use gzip (#p=z…); JSON still has v:1. */
  const SHARE_HASH_GZIP_PREFIX = 'z';
  /** LZ-String compressToEncodedURIComponent (#p=l…); same JSON as gzip path, lossless. */
  const SHARE_HASH_LZ_PREFIX = 'l';

  const canUseGzipSharePayload = () =>
    typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

  const canUseLzString = () =>
    typeof window.LZString !== 'undefined' &&
    typeof window.LZString.compressToEncodedURIComponent === 'function' &&
    typeof window.LZString.decompressFromEncodedURIComponent === 'function';

  const uint8ToBase64Url = (u8) => {
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const base64UrlToUint8 = (str) => {
    let b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  const encodeShareMode = (mode) => {
    const m = mode || 'normal';
    if (m === 'mexicano') return 'e';
    if (m === 'mixmex') return 'j';
    if (m === 'mix') return 'i';
    if (m === 'fixedmex') return 'u';
    if (m === 'fixed') return 'p';
    if (m === 'balanced') return 'b';
    return 'n';
  };

  const decodeShareMode = (c) => {
    if (c === 'e') return 'mexicano';
    if (c === 'j') return 'mixmex';
    if (c === 'i') return 'mix';
    if (c === 'u') return 'fixedmex';
    if (c === 'p') return 'fixed';
    if (c === 'b') return 'balanced';
    return 'normal';
  };

  const packShareScore = (s) => {
    if (s === '' || s == null) return '';
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  };

  const unpackShareScore = (s) => {
    if (s === '' || s == null) return '';
    if (typeof s === 'number') return s;
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  };

  /**
   * Compact share payload: short keys + player indices in matches (names once in P).
   * Loses nothing vs canonical; expands to same shape the app already expects.
   */
  const buildCompactSharePayload = (t) => {
    const playersArr = [];
    const nameToIdx = new Map();

    const idxForRaw = (raw) => {
      const display = fixCommonNameTypos(String(raw ?? ''));
      const k = normalizeNameKey(display);
      if (!k) return -1;
      if (nameToIdx.has(k)) return nameToIdx.get(k);
      const idx = playersArr.length;
      playersArr.push({ name: display, gender: null });
      nameToIdx.set(k, idx);
      return idx;
    };

    normalizePlayers(safeJsonParse(t.players, [])).forEach((p) => {
      const display = fixCommonNameTypos(String(p?.name ?? ''));
      const k = normalizeNameKey(display);
      if (!k) return;
      if (nameToIdx.has(k)) {
        const i = nameToIdx.get(k);
        if (p?.gender != null && p.gender !== '' && playersArr[i]) {
          playersArr[i].gender = p.gender;
        }
        return;
      }
      nameToIdx.set(k, playersArr.length);
      playersArr.push({
        name: display,
        gender: p?.gender != null && p.gender !== '' ? p.gender : null
      });
    });

    const roundsArr = safeJsonParse(t.rounds, []);
    const R = roundsArr.map((r) => {
      const matches = (r.matches || []).map((m) => {
        const t1 = m.team1 || [];
        const t2 = m.team2 || [];
        return [
          m.court,
          idxForRaw(t1[0]),
          idxForRaw(t1[1]),
          idxForRaw(t2[0]),
          idxForRaw(t2[1]),
          packShareScore(m.score1),
          packShareScore(m.score2)
        ];
      });
      return [Number(r.round) || 1, matches];
    });

    const hasGender = playersArr.some((p) => p.gender);
    const payload = {
      v: SHARE_WIRE_COMPACT_VERSION,
      t: t.title || 'Tournament',
      m: encodeShareMode(t.mode || 'normal'),
      c: t.courts,
      w: t.points_to_win,
      cr: t.current_round,
      P: playersArr.map((p) => p.name),
      R
    };
    if (hasGender) payload.G = playersArr.map((p) => p.gender);
    // Scoring kind is generic (every mode), not just Mexicano-family.
    const shareProf = getTournamentScoringProfile(t);
    payload.mk = shareProf.style === 'games' ? 'g' : 'r';
    if (shareProf.style === 'games') payload.mb = shareProf.bestOf;
    return payload;
  };

  const expandSharePayloadV2 = (w) => {
    const P = w.P;
    if (!Array.isArray(P)) throw new Error('bad P');
    const G = w.G;
    const names = P.map((n) => fixCommonNameTypos(String(n ?? '')));
    const idxToName = (idx) => {
      if (typeof idx !== 'number' || idx < 0 || idx >= names.length) return '';
      return names[idx] || '';
    };

    const playersExpanded = P.map((name, i) => ({
      name: fixCommonNameTypos(String(name ?? '')),
      gender:
        Array.isArray(G) && i < G.length && G[i] != null && G[i] !== ''
          ? G[i]
          : null
    }));

    const R = w.R;
    if (!Array.isArray(R)) throw new Error('bad R');
    const roundsExpanded = R.map((item) => {
      const rn = Number(item[0]) || 1;
      const mx = item[1];
      if (!Array.isArray(mx)) return { round: rn, matches: [] };
      return {
        round: rn,
        matches: mx.map((row) => {
          const [court, a, b, c, d, s1, s2] = row;
          return {
            court,
            team1: [idxToName(a), idxToName(b)],
            team2: [idxToName(c), idxToName(d)],
            score1: unpackShareScore(s1),
            score2: unpackShareScore(s2)
          };
        })
      };
    });

    const mode = decodeShareMode(w.m);
    // Scoring kind is generic (every mode). Legacy `mex_*` mirror fields are
    // kept only for Mexicano-family modes so older app code reading those
    // specific fields from a stored/cached payload still works.
    const scoreExtra =
      w.mk === 'g' || w.mk === 'r'
        ? {
            score_kind: w.mk === 'g' ? 'games' : 'rally',
            best_of_games: w.mk === 'g' ? Math.min(7, Math.max(3, Number(w.mb) || 3)) : null
          }
        : {};
    const mexExtra =
      isMexicanoFamilyMode(mode) && scoreExtra.score_kind
        ? { mex_score_kind: scoreExtra.score_kind, mex_best_of_games: scoreExtra.best_of_games }
        : {};

    return {
      v: SHARE_PAYLOAD_VERSION,
      title: String(w.t ?? 'Tournament'),
      mode,
      courts: w.c,
      points_to_win: w.w,
      current_round: w.cr,
      players: JSON.stringify(playersExpanded),
      rounds: JSON.stringify(roundsExpanded),
      ...scoreExtra,
      ...mexExtra
    };
  };

  const normalizeIncomingSharePayload = (obj) => {
    if (!obj || typeof obj !== 'object') throw new Error('bad payload');
    const ver = Number(obj.v);
    if (ver === SHARE_WIRE_COMPACT_VERSION) return expandSharePayloadV2(obj);
    if (ver === SHARE_PAYLOAD_VERSION) return obj;
    throw new Error('bad payload version');
  };

  /** Uncompressed base64url (UTF-8 JSON); kept for old links and fallback. */
  const encodeSharePayload = (obj) => {
    const json = JSON.stringify(obj);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const encodeSharePayloadGzip = async (obj) => {
    const json = JSON.stringify(obj);
    const input = new TextEncoder().encode(json);
    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return SHARE_HASH_GZIP_PREFIX + uint8ToBase64Url(new Uint8Array(buf));
  };

  const decodeSharePayload = (str) => {
    let b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  };

  const decodeSharePayloadGzip = async (b64urlBody) => {
    const bytes = base64UrlToUint8(b64urlBody);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const outBuf = await new Response(stream).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(outBuf));
  };

  const encodeSharePayloadLz = (obj) => {
    const json = JSON.stringify(obj);
    return SHARE_HASH_LZ_PREFIX + window.LZString.compressToEncodedURIComponent(json);
  };

  const decodeSharePayloadLz = (uriBody) => {
    const json = window.LZString.decompressFromEncodedURIComponent(uriBody);
    if (json == null || json === '') throw new Error('lz decompress failed');
    return JSON.parse(json);
  };

  const buildShareUrlFromTournament = async (t) => {
    // Scoring kind is generic (every mode). Legacy `mex_*` mirror fields are
    // kept only for Mexicano-family modes for backward compatibility.
    const shareProf = getTournamentScoringProfile(t);
    const canonical = {
      v: SHARE_PAYLOAD_VERSION,
      title: t.title || 'Tournament',
      mode: t.mode || 'normal',
      courts: t.courts,
      points_to_win: t.points_to_win,
      players: t.players,
      rounds: t.rounds,
      current_round: t.current_round,
      score_kind: shareProf.style === 'games' ? 'games' : 'rally',
      best_of_games: shareProf.style === 'games' ? shareProf.bestOf : null
    };
    if (isMexicanoFamilyMode(t.mode || 'normal')) {
      canonical.mex_score_kind = canonical.score_kind;
      canonical.mex_best_of_games = canonical.best_of_games;
    }
    const compact = buildCompactSharePayload(t);

    const plain = encodeSharePayload(canonical);
    let best = plain;

    const candidates = [];

    if (canUseLzString()) {
      try {
        candidates.push(encodeSharePayloadLz(canonical));
        candidates.push(encodeSharePayloadLz(compact));
      } catch {
        /* ignore */
      }
    }

    if (canUseGzipSharePayload()) {
      const tryGz = async (obj) => {
        try {
          return await encodeSharePayloadGzip(obj);
        } catch {
          return null;
        }
      };
      const gzCanon = await tryGz(canonical);
      const gzCompact = await tryGz(compact);
      if (gzCanon) candidates.push(gzCanon);
      if (gzCompact) candidates.push(gzCompact);
    }

    for (const cand of candidates) {
      if (cand && cand.length < best.length) best = cand;
    }

    const base = `${location.origin}${location.pathname}`;
    const url = `${base}#p=${best}`;
    if (url.length > MAX_SHARE_URL_CHARS) {
      const err = new Error('TOO_LARGE');
      throw err;
    }
    return url;
  };

  const formatLeaderboardDiff = (diff) => {
    const n = Number(diff) || 0;
    return n > 0 ? `+${n}` : String(n);
  };

  const MATCH_COMPENSATION_POINTS_PER_GAP =
    window.Padelio?.MATCH_COMPENSATION_POINTS_PER_GAP ?? 0;

  /**
   * Fallback +M compensation (mirrors scoring.js). Browser always prefers
   * the canonical impl exposed via `window.Padelio`; this copy keeps the UI
   * working if scoring.js fails to load.
   */
  const applyMatchCompensationToLeaderboardRows =
    window.Padelio?.applyMatchCompensationToLeaderboardRows ||
    ((rows) => {
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
    });

  const annotateLeaderboardRowsWithoutCompensation =
    window.Padelio?.annotateLeaderboardRowsWithoutCompensation ||
    ((rows) =>
      (rows || []).map((r) => ({
        ...r,
        pointsRaw: Number(r.points) || 0,
        matchComp: 0,
        matchCompGap: 0,
        matchCompAverage: 0
      })));

  /** Format leaderboard points / +M as whole numbers only. */
  const formatCompNumber = (n) => String(Math.round(Number(n) || 0));

  const formatMatchCompensationNote = (p) => {
    const comp = Number(p?.matchComp) || 0;
    if (comp <= 0) return '';
    const gap = Number(p?.matchCompGap) || 0;
    const matchWord = gap === 1 ? 'match' : 'matches';
    return `+M ${formatCompNumber(comp)} (${gap} fewer ${matchWord})`;
  };

  const matchCompensationTooltip = (p) => {
    const comp = Number(p?.matchComp) || 0;
    if (comp <= 0) {
      return '+M is compensation points for players with fewer matches played. ' +
        'It is calculated from the average points per player per completed match.';
    }
    const gap = Number(p?.matchCompGap) || 0;
    const avg = Number(p?.matchCompAverage) || 0;
    return (
      `+M ${formatCompNumber(comp)} = average ${formatCompNumber(avg)} pts × ${gap} missed match${gap === 1 ? '' : 'es'}. ` +
      '+M is compensation points for players with fewer matches played; it is calculated from the average points per player per completed match.'
    );
  };

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
   * @param {'points'|'winRate'} [sortMode] Points = Americano-style total; winRate = rank by W/M % (ties: wins, points, games).
   * @param {{ applyMatchCompensation?: boolean }} [opts] Default true (standings); false for round pairing order.
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

        const hasScore =
          (s1 !== '' && s1 != null) || (s2 !== '' && s2 != null);

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
          apply((p) => {
            scores[p].ties++;
          });
        }

        apply((p) => {
          scores[p].matches++;
        });
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

  /**
   * Pair-level leaderboard for fixed/fixedmex tournaments. Pairs come from roster index 0+1, 2+3, ...
   * Each pair plays as a unit, so wins/losses/ties/matches are counted at the team level
   * (not summed individuals — that would double-count). Points/conceded ARE summed from individuals,
   * since both partners get the team score per match in the individual leaderboard.
   */
  const computePairLeaderboardSorted = (tournamentLike, sortMode = 'points', opts = {}) => {
    const applyComp = opts.applyMatchCompensation !== false;
    const playersArr = normalizePlayers(safeJsonParse(tournamentLike?.players, []));
    const rounds = safeJsonParse(tournamentLike?.rounds, []);
    const rosterNames = playersArr.map((p) => p.name);
    const rosterResolve = makeRosterNameResolve(rosterNames);

    const pairs = [];
    for (let i = 0; i + 1 < playersArr.length; i += 2) {
      pairs.push({
        names: [playersArr[i].name, playersArr[i + 1].name],
        key: pairKey(rosterResolve(playersArr[i].name), rosterResolve(playersArr[i + 1].name))
      });
    }

    const stats = new Map();
    pairs.forEach((p) => {
      stats.set(p.key, {
        names: p.names,
        points: 0, conceded: 0,
        wins: 0, losses: 0, ties: 0, matches: 0
      });
    });

    rounds.forEach((round) => {
      (round.matches || []).forEach((match) => {
        const s1 = match.score1;
        const s2 = match.score2;
        const hasScore = (s1 !== '' && s1 != null) || (s2 !== '' && s2 != null);
        if (!hasScore) return;
        const score1 = Number(s1) || 0;
        const score2 = Number(s2) || 0;
        if (score1 === 0 && score2 === 0) return;

        const t1 = match.team1 || [];
        const t2 = match.team2 || [];
        if (t1.length !== 2 || t2.length !== 2) return;

        const k1 = pairKey(rosterResolve(t1[0]), rosterResolve(t1[1]));
        const k2 = pairKey(rosterResolve(t2[0]), rosterResolve(t2[1]));
        const r1 = stats.get(k1);
        const r2 = stats.get(k2);
        if (!r1 || !r2) return;

        r1.points += score1;
        r1.conceded += score2;
        r2.points += score2;
        r2.conceded += score1;
        r1.matches++;
        r2.matches++;
        if (score1 > score2) { r1.wins++; r2.losses++; }
        else if (score2 > score1) { r2.wins++; r1.losses++; }
        else { r1.ties++; r2.ties++; }
      });
    });

    const rows = [];
    stats.forEach((data) => {
      const winRate = data.matches > 0 ? (data.wins / data.matches) * 100 : 0;
      const diff = data.points - data.conceded;
      rows.push({
        name: data.names.map(fixCommonNameTypos).join(' & '),
        names: data.names,
        ...data,
        winRate,
        diff
      });
    });
    const enriched = applyComp
      ? applyMatchCompensationToLeaderboardRows(rows)
      : annotateLeaderboardRowsWithoutCompensation(rows);
    return sortLeaderboardRows(enriched, sortMode);
  };

  const renderLeaderboardPointsBlock = (p, byWinRate) => {
    const comp = Number(p.matchComp) || 0;
    const raw = p.pointsRaw != null ? p.pointsRaw : p.points;
    const adjusted = Number(p.points) || 0;
    const compTipAttr = comp
      ? ` title="${escapeHtml(matchCompensationTooltip(p))}"`
      : '';
    if (byWinRate) {
      return `
        <div class="lb-points-block">
          <div class="lb-points-block__value lb-points-block__value--winrate">${p.winRate.toFixed(0)}<span class="lb-points-block__suffix">%</span></div>
          <div class="lb-points-block__label">win rate</div>
          <div class="lb-points-block__sub tabular-nums"${compTipAttr}>${formatCompNumber(adjusted)} pts${
            comp ? ` <span class="lb-points-block__comp">incl. +M ${formatCompNumber(comp)}</span>` : ''
          }</div>
        </div>
      `;
    }
    return `
      <div class="lb-points-block">
        <div class="lb-points-block__value tabular-nums"${compTipAttr}>${formatCompNumber(adjusted)}</div>
        <div class="lb-points-block__label">points</div>
        ${
          comp
            ? `<div class="lb-points-block__sub tabular-nums"${compTipAttr}>
                 ${formatCompNumber(raw)} <span class="lb-points-block__plus">+</span>
                 <span class="lb-points-block__comp">${formatCompNumber(comp)} +M</span>
               </div>`
            : ''
        }
      </div>
    `;
  };

  const renderLeaderboardPlayerNameHtml = (canonicalName, editable) => {
    const display = fixCommonNameTypos(canonicalName);
    const attr = encodeLbPlayerAttr(display);
    const editing =
      editable &&
      state.lbRenamingFrom != null &&
      playerNamesMatch(state.lbRenamingFrom, display);

    if (editing) {
      return `
        <div class="lb-rename-row flex items-center gap-1.5 min-w-0 w-full">
          <input
            type="text"
            class="lb-player-rename-input flex-1 min-w-0 rounded-xl border border-teal-400/50 bg-white/95 dark:bg-slate-900/80 px-2.5 py-1.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-400/35"
            value="${escapeHtml(display)}"
            data-lb-player="${attr}"
            maxlength="48"
            autocomplete="off"
            spellcheck="false"
          />
          <button type="button" data-lb-action="save" data-lb-player="${attr}" class="lb-rename-btn lb-rename-btn--save" aria-label="Save name" title="Save">✓</button>
          <button type="button" data-lb-action="cancel" class="lb-rename-btn lb-rename-btn--cancel" aria-label="Cancel" title="Cancel">✕</button>
        </div>
      `;
    }

    if (!editable) {
      return `<div class="font-semibold truncate">${escapeHtml(display)}</div>`;
    }

    return `
      <div class="lb-name-row flex items-center gap-1 min-w-0 w-full">
        <span class="font-semibold truncate flex-1 min-w-0">${escapeHtml(display)}</span>
        <button
          type="button"
          data-lb-action="edit"
          data-lb-player="${attr}"
          class="lb-rename-edit shrink-0 p-1.5 rounded-lg border border-transparent text-slate-500 dark:text-slate-400 hover:text-teal-800 dark:hover:text-teal-200 hover:bg-teal-500/10 hover:border-teal-400/30 transition-colors"
          aria-label="Edit ${escapeHtml(display)}"
          title="Edit name"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828 9 16.5v-3.5z" />
          </svg>
        </button>
      </div>
    `;
  };

  const renderLeaderboardNamesBlock = (row, editable, isPairRow) => {
    if (isPairRow && Array.isArray(row.names) && row.names.length === 2) {
      return `
        <div class="space-y-1.5 min-w-0">
          ${row.names.map((n) => renderLeaderboardPlayerNameHtml(n, editable)).join('')}
        </div>
      `;
    }
    return renderLeaderboardPlayerNameHtml(row.name, editable);
  };

  const renderLeaderboardHtml = (sorted, sortMode = 'points', opts = {}) => {
    const byWinRate = sortMode === 'winRate';
    const editable = !!opts.editable;
    const isPairRow = !!opts.isPairRow;

    const rankClass = (i) => {
      if (i === 0) return 'lb-card--gold';
      if (i === 1) return 'lb-card--silver';
      if (i === 2) return 'lb-card--bronze';
      return 'lb-card--default';
    };
    const rankBadgeClass = (i) => {
      if (i === 0) return 'lb-rank--gold';
      if (i === 1) return 'lb-rank--silver';
      if (i === 2) return 'lb-rank--bronze';
      return 'lb-rank--default';
    };
    const diffClass = (n) => {
      if (n > 0) return 'lb-stat--pos';
      if (n < 0) return 'lb-stat--neg';
      return '';
    };

    return sorted
      .map((p, i) => {
        const diffText = formatLeaderboardDiff(p.diff);
        const matchWord = p.matches === 1 ? 'match' : 'matches';
        return `
          <div class="lb-card ${rankClass(i)}">
            <span class="lb-rank ${rankBadgeClass(i)}">${i + 1}</span>
            <div class="lb-card__main">
              <div class="lb-card__name">${renderLeaderboardNamesBlock(p, editable, isPairRow)}</div>
              <div class="lb-card__stats">
                <span class="lb-stat-pill">
                  <span class="lb-stat-pill__value tabular-nums">${p.matches}</span>
                  <span class="lb-stat-pill__label">${matchWord}</span>
                </span>
                <span class="lb-stat-record tabular-nums" title="Wins · Losses · Ties">
                  <span class="lb-stat-record__w">${p.wins}W</span>
                  <span class="lb-sep">·</span>
                  <span class="lb-stat-record__l">${p.losses}L</span>
                  <span class="lb-sep">·</span>
                  <span class="lb-stat-record__t">${p.ties}T</span>
                </span>
                <span class="lb-stat-text ${diffClass(p.diff)} tabular-nums" title="Point difference">${diffText} diff</span>
                ${
                  byWinRate
                    ? ''
                    : `<span class="lb-stat-text lb-stat-text--muted tabular-nums" title="Win rate">${p.winRate.toFixed(0)}% win</span>`
                }
              </div>
            </div>
            <div class="lb-card__points">
              ${renderLeaderboardPointsBlock(p, byWinRate)}
            </div>
          </div>
        `;
      })
      .join('');
  };

  const leaderboardShotRankClass = (i) => {
    if (i === 0) return 'lb-shot__rank--gold';
    if (i === 1) return 'lb-shot__rank--silver';
    if (i === 2) return 'lb-shot__rank--bronze';
    return 'lb-shot__rank--default';
  };

  const leaderboardShotTierClass = (i) => {
    if (i === 0) return 'lb-shot__tr--gold';
    if (i === 1) return 'lb-shot__tr--silver';
    if (i === 2) return 'lb-shot__tr--bronze';
    return '';
  };

  const leaderboardShotDiffClass = (diff) => {
    const n = Number(diff) || 0;
    if (n > 0) return 'lb-shot__diff--pos';
    if (n < 0) return 'lb-shot__diff--neg';
    return 'lb-shot__diff--zero';
  };

  const renderLeaderboardScreenshotPrimaryCell = (p, byWinRate) => {
    const comp = Number(p.matchComp) || 0;
    const adjusted = Number(p.points) || 0;
    const main = byWinRate
      ? `${p.winRate.toFixed(0)}%`
      : formatCompNumber(adjusted);
    const badge = comp > 0
      ? `<span class="lb-shot__primary-badge" aria-label="includes ${formatCompNumber(comp)} match compensation">+${formatCompNumber(comp)} M</span>`
      : '';
    return `<span class="lb-shot__primary-val">${main}</span>${badge}`;
  };

  /** Standings card for screenshots — single clean table. */
  const renderLeaderboardScreenshotHtml = (sorted, title, sortMode = 'points') => {
    const byWinRate = sortMode === 'winRate';
    const t = title != null && String(title).trim() ? escapeHtml(String(title).trim()) : '';
    const sub = byWinRate ? 'By win rate' : 'By total points';
    const primaryHdr = byWinRate ? 'WR' : 'Pts';

    const titleBlock = t ? `<h2 class="lb-shot__title">${t}</h2>` : '';
    const header = `<header class="lb-shot__head">
        ${titleBlock}
        <p class="lb-shot__label">Leaderboard</p>
        <p class="lb-shot__sub">${sub}</p>
      </header>`;

    const rows = sorted
      .map((p, i) => {
        const comp = Number(p.matchComp) || 0;
        const tier = leaderboardShotTierClass(i);
        const compTipAttr = comp
          ? ` title="${escapeHtml(matchCompensationTooltip(p))}"`
          : '';
        return `
        <div class="lb-shot__tr ${tier}" role="row">
          <span class="lb-shot__rank ${leaderboardShotRankClass(i)}" role="cell">${i + 1}</span>
          <span class="lb-shot__player" role="cell">
            <span class="lb-shot__name">${escapeHtml(fixCommonNameTypos(p.name))}</span>
            <span class="lb-shot__matches">${p.matches} match${p.matches === 1 ? '' : 'es'}</span>
          </span>
          <span class="lb-shot__record" role="cell">${p.wins}-${p.losses}-${p.ties}</span>
          <span class="lb-shot__primary" role="cell"${compTipAttr}>${renderLeaderboardScreenshotPrimaryCell(p, byWinRate)}</span>
          <span class="lb-shot__diff ${leaderboardShotDiffClass(p.diff)}" role="cell">${formatLeaderboardDiff(p.diff)}</span>
        </div>`;
      })
      .join('');

    return `<div class="lb-shot">
        ${header}
        <div class="lb-shot__table" role="table">
          <div class="lb-shot__tr lb-shot__tr--head" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">Player</span>
            <span role="columnheader">W-L-T</span>
            <span role="columnheader">${primaryHdr}</span>
            <span role="columnheader">Diff</span>
          </div>
          ${rows}
        </div>
        <footer class="lb-shot__foot">padelio.id</footer>
      </div>`;
  };

  const LB_TAB_ACTIVE =
    'flex-1 text-xs font-bold py-2.5 rounded-2xl border border-teal-500/45 dark:border-teal-400/40 bg-teal-500/15 text-teal-900 dark:text-teal-50';
  const LB_TAB_IDLE =
    'flex-1 text-xs font-bold py-2.5 rounded-2xl border border-slate-200/80 dark:border-white/10 bg-slate-100/90 dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-200/90 dark:hover:bg-white/10 transition-colors';

  const applyHostLeaderboardLayoutUi = () => {
    const layout = state.hostLeaderboardLayout === 'screenshot' ? 'screenshot' : 'standard';
    const std = $('leaderboard-panel-standard');
    const shot = $('leaderboard-panel-screenshot');
    const b1 = $('host-lb-tab-standard');
    const b2 = $('host-lb-tab-screenshot');
    const onShot = layout === 'screenshot';
    if (std) std.classList.toggle('hidden', onShot);
    if (shot) shot.classList.toggle('hidden', !onShot);
    if (b1) b1.className = !onShot ? LB_TAB_ACTIVE : LB_TAB_IDLE;
    if (b2) b2.className = onShot ? LB_TAB_ACTIVE : LB_TAB_IDLE;
  };

  const applyShareLeaderboardLayoutUi = () => {
    const layout = state.shareLeaderboardLayout === 'screenshot' ? 'screenshot' : 'standard';
    const std = $('share-leaderboard-standard-wrap');
    const shot = $('share-leaderboard-screenshot-wrap');
    const b1 = $('share-lb-sub-standard');
    const b2 = $('share-lb-sub-screenshot');
    const onShot = layout === 'screenshot';
    if (std) std.classList.toggle('hidden', onShot);
    if (shot) shot.classList.toggle('hidden', !onShot);
    if (b1) b1.className = !onShot ? LB_TAB_ACTIVE : LB_TAB_IDLE;
    if (b2) b2.className = onShot ? LB_TAB_ACTIVE : LB_TAB_IDLE;
  };

  const applyHostLeaderboardSortUi = () => {
    const mode = state.hostLeaderboardSort === 'winRate' ? 'winRate' : 'points';
    const b1 = $('host-lb-sort-points');
    const b2 = $('host-lb-sort-winrate');
    if (b1) b1.className = mode === 'points' ? LB_TAB_ACTIVE : LB_TAB_IDLE;
    if (b2) b2.className = mode === 'winRate' ? LB_TAB_ACTIVE : LB_TAB_IDLE;
  };

  const applyShareLeaderboardSortUi = () => {
    const mode = state.shareLeaderboardSort === 'winRate' ? 'winRate' : 'points';
    const b1 = $('share-lb-sort-points');
    const b2 = $('share-lb-sort-winrate');
    if (b1) b1.className = mode === 'points' ? LB_TAB_ACTIVE : LB_TAB_IDLE;
    if (b2) b2.className = mode === 'winRate' ? LB_TAB_ACTIVE : LB_TAB_IDLE;
  };

  /** Pair vs individual scope is only meaningful for fixed-pair modes. */
  const tournamentSupportsPairScope = (tournamentLike) => {
    const m = tournamentLike?.mode || 'normal';
    return m === 'fixed' || m === 'fixedmex';
  };

  const applyHostLeaderboardScopeUi = (tournamentLike) => {
    const wrap = $('host-lb-scope-row');
    const supports = tournamentSupportsPairScope(tournamentLike);
    if (wrap) wrap.classList.toggle('hidden', !supports);
    const scope = state.hostLeaderboardScope === 'pair' ? 'pair' : 'individual';
    const b1 = $('host-lb-scope-individual');
    const b2 = $('host-lb-scope-pair');
    if (b1) b1.className = scope === 'individual' ? LB_TAB_ACTIVE : LB_TAB_IDLE;
    if (b2) b2.className = scope === 'pair' ? LB_TAB_ACTIVE : LB_TAB_IDLE;
  };

  const applyShareLeaderboardScopeUi = (tournamentLike) => {
    const wrap = $('share-lb-scope-row');
    const supports = tournamentSupportsPairScope(tournamentLike);
    if (wrap) wrap.classList.toggle('hidden', !supports);
    const scope = state.shareLeaderboardScope === 'pair' ? 'pair' : 'individual';
    const b1 = $('share-lb-scope-individual');
    const b2 = $('share-lb-scope-pair');
    if (b1) b1.className = scope === 'individual' ? LB_TAB_ACTIVE : LB_TAB_IDLE;
    if (b2) b2.className = scope === 'pair' ? LB_TAB_ACTIVE : LB_TAB_IDLE;
  };

  const populateLeaderboardPanels = (tournamentLike, title) => {
    const hSort = state.hostLeaderboardSort === 'winRate' ? 'winRate' : 'points';
    const sSort = state.shareLeaderboardSort === 'winRate' ? 'winRate' : 'points';
    const supportsPair = tournamentSupportsPairScope(tournamentLike);
    const hostUsePair = supportsPair && state.hostLeaderboardScope === 'pair';
    const shareUsePair = supportsPair && state.shareLeaderboardScope === 'pair';

    const hostSorted = hostUsePair
      ? computePairLeaderboardSorted(tournamentLike, hSort)
      : computeLeaderboardSorted(tournamentLike, hSort);
    const shareSorted = shareUsePair
      ? computePairLeaderboardSorted(tournamentLike, sSort)
      : computeLeaderboardSorted(tournamentLike, sSort);

    const hostEditable =
      !state.shareViewerMode &&
      !!state.currentTournament &&
      state.currentTournament.__backendId === tournamentLike?.__backendId;

    const hostStd = $('leaderboard-list');
    const hostShot = $('leaderboard-screenshot-panel');
    if (hostStd) {
      hostStd.innerHTML = renderLeaderboardHtml(hostSorted, hSort, {
        editable: hostEditable,
        isPairRow: hostUsePair
      });
    }
    if (hostShot) hostShot.innerHTML = renderLeaderboardScreenshotHtml(hostSorted, title, hSort);

    const shareStd = $('share-leaderboard-list');
    const shareShot = $('share-leaderboard-screenshot-panel');
    if (shareStd) {
      shareStd.innerHTML = renderLeaderboardHtml(shareSorted, sSort, {
        editable: false,
        isPairRow: shareUsePair
      });
    }
    if (shareShot) shareShot.innerHTML = renderLeaderboardScreenshotHtml(shareSorted, title, sSort);

    const anyComp = hostSorted.some((r) => (Number(r.matchComp) || 0) > 0);
    const hostNote = $('host-leaderboard-comp-note');
    const shareNote = $('share-leaderboard-comp-note');
    if (hostNote) hostNote.classList.toggle('hidden', !anyComp);
    if (shareNote) shareNote.classList.toggle('hidden', !anyComp);

    applyHostLeaderboardLayoutUi();
    applyShareLeaderboardLayoutUi();
    applyHostLeaderboardSortUi();
    applyShareLeaderboardSortUi();
    applyHostLeaderboardScopeUi(tournamentLike);
    applyShareLeaderboardScopeUi(tournamentLike);

    if (hostEditable && state.lbRenamingFrom != null) {
      requestAnimationFrame(() => {
        const input = hostStd?.querySelector('.lb-player-rename-input');
        input?.focus();
        input?.select();
      });
    }
  };

  const startLeaderboardPlayerRename = (canonicalName) => {
    if (state.shareViewerMode || !state.currentTournament) return;
    state.lbRenamingFrom = fixCommonNameTypos(canonicalName);
    populateLeaderboardPanels(state.currentTournament, state.currentTournament.title || '');
  };

  const cancelLeaderboardPlayerRename = () => {
    if (state.lbRenamingFrom == null) return;
    state.lbRenamingFrom = null;
    if (state.currentTournament) {
      populateLeaderboardPanels(state.currentTournament, state.currentTournament.title || '');
    }
  };

  const commitLeaderboardPlayerRename = async (fromName) => {
    if (state.shareViewerMode || !state.currentTournament) return;
    const list = $('leaderboard-list');
    const attr = encodeLbPlayerAttr(fromName);
    const input =
      list?.querySelector(`.lb-player-rename-input[data-lb-player="${attr}"]`) ||
      list?.querySelector('.lb-player-rename-input');
    const result = renameTournamentPlayer(fromName, input?.value ?? '');
    if (!result.ok) {
      toast(result.error || 'Could not rename player');
      return;
    }
    state.lbRenamingFrom = null;
    try {
      await saveCurrentTournament();
    } catch {
      toast('Saved locally; sync may retry');
    }
    toast(`Name updated to ${result.name}`);
    populateLeaderboardPanels(state.currentTournament, state.currentTournament.title || '');
    if (!$('page-rounds')?.classList.contains('hidden')) {
      ensureViewingRoundValid();
      renderSpecificRound(state.viewingRound ?? state.currentTournament.current_round);
      updateRoundArrowState();
    }
  };

  const wireLeaderboardRenameEvents = () => {
    const panel = $('host-leaderboard-panel');
    if (!panel || panel.dataset.lbRenameDelegate) return;
    panel.dataset.lbRenameDelegate = '1';

    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-lb-action]');
      if (!btn || !panel.contains(btn)) return;
      e.preventDefault();
      const action = btn.dataset.lbAction;
      if (action === 'edit') {
        startLeaderboardPlayerRename(decodeLbPlayerAttr(btn.dataset.lbPlayer));
      } else if (action === 'cancel') {
        cancelLeaderboardPlayerRename();
      } else if (action === 'save') {
        void commitLeaderboardPlayerRename(decodeLbPlayerAttr(btn.dataset.lbPlayer));
      }
    });

    panel.addEventListener('keydown', (e) => {
      if (!e.target.classList?.contains('lb-player-rename-input')) return;
      const from = decodeLbPlayerAttr(e.target.dataset.lbPlayer);
      if (e.key === 'Enter') {
        e.preventDefault();
        void commitLeaderboardPlayerRename(from);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelLeaderboardPlayerRename();
      }
    });
  };

  const switchHostLeaderboardLayout = (layout) => {
    state.hostLeaderboardLayout = layout === 'screenshot' ? 'screenshot' : 'standard';
    applyHostLeaderboardLayoutUi();
  };

  const switchShareLeaderboardLayout = (layout) => {
    state.shareLeaderboardLayout = layout === 'screenshot' ? 'screenshot' : 'standard';
    applyShareLeaderboardLayoutUi();
  };

  const switchHostLeaderboardSort = (sort) => {
    state.hostLeaderboardSort = sort === 'winRate' ? 'winRate' : 'points';
    applyHostLeaderboardSortUi();
    if (state.currentTournament) {
      populateLeaderboardPanels(state.currentTournament, state.currentTournament.title || '');
    }
  };

  const switchShareLeaderboardSort = (sort) => {
    state.shareLeaderboardSort = sort === 'winRate' ? 'winRate' : 'points';
    applyShareLeaderboardSortUi();
    if (state.shareViewerData) {
      populateLeaderboardPanels(state.shareViewerData, state.shareViewerData.title || '');
    }
  };

  const switchHostLeaderboardScope = (scope) => {
    state.hostLeaderboardScope = scope === 'pair' ? 'pair' : 'individual';
    if (state.currentTournament) {
      populateLeaderboardPanels(state.currentTournament, state.currentTournament.title || '');
    } else {
      applyHostLeaderboardScopeUi(null);
    }
  };

  const switchShareLeaderboardScope = (scope) => {
    state.shareLeaderboardScope = scope === 'pair' ? 'pair' : 'individual';
    if (state.shareViewerData) {
      populateLeaderboardPanels(state.shareViewerData, state.shareViewerData.title || '');
    } else {
      applyShareLeaderboardScopeUi(null);
    }
  };

  /** Inline onclick looks up globals; assign early + use listeners so tabs always work. */
  window.switchHostLeaderboardLayout = switchHostLeaderboardLayout;
  window.switchShareLeaderboardLayout = switchShareLeaderboardLayout;
  window.switchHostLeaderboardSort = switchHostLeaderboardSort;
  window.switchShareLeaderboardSort = switchShareLeaderboardSort;
  window.switchHostLeaderboardScope = switchHostLeaderboardScope;
  window.switchShareLeaderboardScope = switchShareLeaderboardScope;

  /** Text nodes have no .closest — normalize target before delegating. */
  const clickTargetButton = (e) => {
    let n = e.target;
    if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    return n && typeof n.closest === 'function' ? n.closest('button') : null;
  };

  /**
   * Sort buttons: use document capture so clicks always reach us (some overlays / bubbling
   * edge cases prevented host-only delegation from firing reliably).
   */
  const wireLeaderboardSortClicks = () => {
    if (document.documentElement.dataset.padLbSortWired === '1') return;
    document.documentElement.dataset.padLbSortWired = '1';
    document.addEventListener(
      'click',
      (e) => {
        const id = clickTargetButton(e)?.id;
        if (id === 'host-lb-sort-points') {
          e.preventDefault();
          switchHostLeaderboardSort('points');
        } else if (id === 'host-lb-sort-winrate') {
          e.preventDefault();
          switchHostLeaderboardSort('winRate');
        } else if (id === 'share-lb-sort-points') {
          e.preventDefault();
          switchShareLeaderboardSort('points');
        } else if (id === 'share-lb-sort-winrate') {
          e.preventDefault();
          switchShareLeaderboardSort('winRate');
        } else if (id === 'host-lb-scope-individual') {
          e.preventDefault();
          switchHostLeaderboardScope('individual');
        } else if (id === 'host-lb-scope-pair') {
          e.preventDefault();
          switchHostLeaderboardScope('pair');
        } else if (id === 'share-lb-scope-individual') {
          e.preventDefault();
          switchShareLeaderboardScope('individual');
        } else if (id === 'share-lb-scope-pair') {
          e.preventDefault();
          switchShareLeaderboardScope('pair');
        }
      },
      true
    );
  };

  /** Delegation + tabs live outside scroll on host / share to avoid touch stacking bugs. */
  const wireLeaderboardLayoutTabs = () => {
    const hostPanel = $('host-leaderboard-panel');
    if (hostPanel && !hostPanel.dataset.lbTabDelegate) {
      hostPanel.dataset.lbTabDelegate = '1';
      hostPanel.addEventListener('click', (e) => {
        const id = clickTargetButton(e)?.id;
        if (id === 'host-lb-tab-standard') {
          e.preventDefault();
          switchHostLeaderboardLayout('standard');
        } else if (id === 'host-lb-tab-screenshot') {
          e.preventDefault();
          switchHostLeaderboardLayout('screenshot');
        }
      });
    }
    const shareLb = $('share-panel-leaderboard');
    if (shareLb && !shareLb.dataset.lbTabDelegate) {
      shareLb.dataset.lbTabDelegate = '1';
      shareLb.addEventListener('click', (e) => {
        const id = clickTargetButton(e)?.id;
        if (id === 'share-lb-sub-standard') {
          e.preventDefault();
          switchShareLeaderboardLayout('standard');
        } else if (id === 'share-lb-sub-screenshot') {
          e.preventDefault();
          switchShareLeaderboardLayout('screenshot');
        }
      });
    }
    const shareSubBar = $('share-lb-subtabs');
    if (shareSubBar && !shareSubBar.dataset.lbTabDelegate) {
      shareSubBar.dataset.lbTabDelegate = '1';
      shareSubBar.addEventListener('click', (e) => {
        const id = clickTargetButton(e)?.id;
        if (id === 'share-lb-sub-standard') {
          e.preventDefault();
          switchShareLeaderboardLayout('standard');
        } else if (id === 'share-lb-sub-screenshot') {
          e.preventDefault();
          switchShareLeaderboardLayout('screenshot');
        }
      });
    }
  };
  wireLeaderboardLayoutTabs();
  wireLeaderboardSortClicks();

  let spectatorQrKeyHandler = null;

  const closeSpectatorQrModal = () => {
    const modal = $('modal-spectator-qr');
    const img = $('spectator-qr-img');
    const hint = $('spectator-qr-offline-hint');
    if (modal) modal.classList.add('hidden');
    if (img) {
      img.onload = null;
      img.onerror = null;
      img.removeAttribute('src');
      img.classList.add('hidden');
    }
    if (hint) {
      hint.classList.add('hidden');
      hint.innerHTML =
        'You appear offline — use <strong>Copy link</strong> from the menu instead.';
    }
    if (spectatorQrKeyHandler) {
      document.removeEventListener('keydown', spectatorQrKeyHandler);
      spectatorQrKeyHandler = null;
    }
  };

  const showSpectatorQrModal = async () => {
    const menu = $('dropdown-menu');
    if (menu) menu.classList.add('hidden');

    syncCurrentTournament();
    if (!state.currentTournament) return;

    let url;
    try {
      url = await buildShareUrlFromTournament(state.currentTournament);
    } catch (e) {
      if (e && e.message === 'TOO_LARGE') {
        toast('Tournament is too large for one QR. Use Copy link or a screenshot.');
        return;
      }
      toast('Could not build share link.');
      return;
    }

    const modal = $('modal-spectator-qr');
    const img = $('spectator-qr-img');
    const hint = $('spectator-qr-offline-hint');
    const foot = $('spectator-qr-url-foot');
    if (!modal || !img) return;

    if (foot) {
      foot.textContent = url;
    }

    spectatorQrKeyHandler = (e) => {
      if (e.key === 'Escape') closeSpectatorQrModal();
    };
    document.addEventListener('keydown', spectatorQrKeyHandler);

    if (navigator.onLine) {
      if (hint) hint.classList.add('hidden');
      img.classList.add('hidden');
      img.onload = () => {
        img.classList.remove('hidden');
      };
      img.onerror = () => {
        img.classList.add('hidden');
        if (hint) {
          hint.innerHTML = 'Could not load QR image. Use <strong>Copy link</strong> below.';
          hint.classList.remove('hidden');
        }
        toast('QR image failed to load. Try Copy link.');
      };
      const enc = encodeURIComponent(url);
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${enc}`;
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
      if (hint) {
        hint.innerHTML =
          'You appear offline — use <strong>Copy link</strong> from the menu instead.';
        hint.classList.remove('hidden');
      }
      toast('Offline: QR needs internet. Use Copy link.');
    }

    modal.classList.remove('hidden');
  };

  const copySpectatorLinkForHost = async () => {
    syncCurrentTournament();
    if (!state.currentTournament) return;
    let url;
    try {
      url = await buildShareUrlFromTournament(state.currentTournament);
    } catch (e) {
      if (e && e.message === 'TOO_LARGE') {
        toast('Tournament is too large for one link. Share a screenshot or split sessions.');
        return;
      }
      toast('Could not build share link.');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Spectator link copied (read-only). Share again after you change scores for the latest standings.');
    } catch {
      window.prompt('Copy this spectator link:', url);
    }
  };

  const shareSpectatorLinkForHost = async () => {
    syncCurrentTournament();
    if (!state.currentTournament) return;
    let url;
    try {
      url = await buildShareUrlFromTournament(state.currentTournament);
    } catch (e) {
      if (e && e.message === 'TOO_LARGE') {
        toast('Tournament is too large for one link.');
        return;
      }
      toast('Could not build share link.');
      return;
    }
    const title = state.currentTournament.title || 'Padelio';
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${title} — Padelio`,
          text: 'View live standings (read-only)',
          url
        });
      } else {
        await copySpectatorLinkForHost();
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      await copySpectatorLinkForHost();
    }
  };

  /** Inline onclick on leaderboard header; assign early so globals exist even if later init throws. */
  window.copySpectatorLinkForHost = copySpectatorLinkForHost;
  window.shareSpectatorLinkForHost = shareSpectatorLinkForHost;
  window.showSpectatorQrModal = showSpectatorQrModal;
  window.closeSpectatorQrModal = closeSpectatorQrModal;

  const renderShareRoundsReadOnly = (rounds) => {
    const el = $('share-rounds-container');
    if (!el) return;
    const list = Array.isArray(rounds) ? rounds : [];
    if (list.length === 0) {
      el.innerHTML = '<p class="text-slate-400 text-sm text-center py-8">No rounds yet.</p>';
      return;
    }
    const shareData = state.shareViewerData || state.currentTournament;
    const sProf = getTournamentScoringProfile(shareData);
    const scoreHint =
      sProf.style === 'games' ? mexGamesScoreHint(sProf) : `Rally to ${sProf.rallyCap} (scores mirror)`;
    const showTennisStrip = sProf.style === 'games';
    el.innerHTML = list
      .sort((a, b) => Number(a.round) - Number(b.round))
      .map((round) => {
        const rn = Number(round.round) || '?';
        const matchCount = (round.matches || []).length;
        const matches = (round.matches || [])
          .map(
            (match) => {
              const courtLabel = formatCourtLabel(match.court, shareData);
              const s1Display = escapeHtml(String(match.score1 ?? ''));
              const s2Display = escapeHtml(String(match.score2 ?? ''));
              const mg = match.mx_game || { i1: 0, i2: 0 };
              const l1 = TENNIS_PTS_LABEL[Math.min(mg.i1, 3)] ?? '0';
              const l2 = TENNIS_PTS_LABEL[Math.min(mg.i2, 3)] ?? '0';
              const tennisStrip = showTennisStrip
                ? `
          <div class="mt-4 pt-3 border-t border-emerald-200/80 dark:border-emerald-700/45 text-center">
            <div class="text-[10px] text-emerald-700/95 dark:text-emerald-300/90 uppercase tracking-wide mb-2">Current game: 0 → 15 → 30 → 40 · deuce = next point wins</div>
            <div class="flex justify-center items-center gap-6 text-sm">
              <span class="tabular-nums text-lg font-bold text-emerald-900 dark:text-emerald-100">${l1}</span>
              <span class="text-emerald-700/70 dark:text-emerald-400/70 font-extrabold text-xs">:</span>
              <span class="tabular-nums text-lg font-bold text-emerald-900 dark:text-emerald-100">${l2}</span>
            </div>
          </div>`
                : '';
              return `
          <div class="bg-emerald-50/95 dark:bg-emerald-800/50 rounded-3xl p-4 border border-emerald-300/75 dark:border-emerald-600/45 shadow-cozy-sm">
            <div class="text-center text-sm text-emerald-700 dark:text-emerald-400 mb-1 font-medium">${escapeHtml(courtLabel)}</div>
            <div class="text-center text-[10px] text-emerald-700/95 dark:text-emerald-500/90 mb-3 leading-snug">${escapeHtml(scoreHint)}</div>
            <div class="flex items-center gap-4">
              <div class="flex-1 text-center">
                <div class="text-sm mb-2 space-y-2">
                  <div class="font-medium leading-tight">${escapeHtml(fixCommonNameTypos(match.team1?.[0]))}</div>
                  <div class="font-medium leading-tight">${escapeHtml(fixCommonNameTypos(match.team1?.[1]))}</div>
                </div>
                <div class="flex items-center justify-center">
                  <span class="inline-flex items-center justify-center w-16 bg-emerald-100 dark:bg-emerald-700/90 border border-emerald-400/70 dark:border-emerald-500/50 rounded-xl text-center text-xl font-bold text-slate-900 dark:text-white py-1.5 tabular-nums">${s1Display || '—'}</span>
                </div>
              </div>
              <div class="text-2xl text-emerald-700 dark:text-emerald-300 font-extrabold">vs</div>
              <div class="flex-1 text-center">
                <div class="text-sm mb-2 space-y-2">
                  <div class="font-medium leading-tight">${escapeHtml(fixCommonNameTypos(match.team2?.[0]))}</div>
                  <div class="font-medium leading-tight">${escapeHtml(fixCommonNameTypos(match.team2?.[1]))}</div>
                </div>
                <div class="flex items-center justify-center">
                  <span class="inline-flex items-center justify-center w-16 bg-emerald-100 dark:bg-emerald-700/90 border border-emerald-400/70 dark:border-emerald-500/50 rounded-xl text-center text-xl font-bold text-slate-900 dark:text-white py-1.5 tabular-nums">${s2Display || '—'}</span>
                </div>
              </div>
            </div>
            ${tennisStrip}
          </div>
        `;
            }
          )
          .join('');
        const bench = shareData ? computeBenchForRound(round, shareData) : { count: 0 };
        const benchBlock =
          bench.count > 0
            ? `<div class="mb-4 rounded-2xl border border-amber-200/80 dark:border-amber-700/45 bg-amber-50/90 dark:bg-amber-950/40 px-4 py-3">
                <p class="text-[10px] font-bold uppercase tracking-wide text-amber-800/90 dark:text-amber-200/90 mb-2">Waiting this round</p>
                ${renderBenchHtml(bench)}
              </div>`
            : '';
        const courtsContainerClass = matchCount >= 2
          ? 'share-round-courts host-courts-container--grid space-y-4'
          : 'share-round-courts space-y-4';
        return `
          <div class="share-round-section">
            <div class="flex items-center justify-center mb-4">
              <span class="bg-gradient-to-r from-pink-500/20 to-teal-500/20 border border-slate-200/90 dark:border-white/15 px-6 py-2 rounded-full text-sm font-bold shadow-cozy-sm">Round ${rn} · ${matchCount} court${matchCount > 1 ? 's' : ''}</span>
            </div>
            ${benchBlock}
            <div class="${courtsContainerClass}">
              ${matches}
            </div>
          </div>
        `;
      })
      .join('');
    el.className = 'share-rounds-container space-y-8';
  };

  const switchShareTab = (tab) => {
    const onLb = tab === 'leaderboard';
    state.shareMobileTab = onLb ? 'leaderboard' : 'rounds';
    const roundsCol = $('share-rounds-column');
    const lbCol = $('share-leaderboard-column');
    const t1 = $('share-tab-lb');
    const t2 = $('share-tab-rd');
    const subBar = $('share-lb-subtabs');
    const sortRow = $('share-lb-sort-row');
    const scopeRow = $('share-lb-scope-row');
    const desktop = isTournamentDesktopLayout();

    if (desktop) {
      roundsCol?.classList.remove('hidden');
      lbCol?.classList.remove('hidden');
      subBar?.classList.remove('hidden');
      sortRow?.classList.remove('hidden');
      if (scopeRow && state.shareViewerData && tournamentSupportsPairScope(state.shareViewerData)) {
        scopeRow.classList.remove('hidden');
      }
    } else {
      roundsCol?.classList.toggle('hidden', onLb);
      lbCol?.classList.toggle('hidden', !onLb);
      subBar?.classList.toggle('hidden', !onLb);
      sortRow?.classList.toggle('hidden', !onLb);
      if (scopeRow) {
        const showScope =
          onLb && state.shareViewerData && tournamentSupportsPairScope(state.shareViewerData);
        scopeRow.classList.toggle('hidden', !showScope);
      }
    }

    const active =
      'flex-1 text-xs font-bold py-2.5 rounded-2xl border border-teal-500/45 dark:border-teal-400/40 bg-teal-500/15 text-teal-900 dark:text-teal-50';
    const idle =
      'flex-1 text-xs font-bold py-2.5 rounded-2xl border border-slate-200/80 dark:border-white/10 bg-slate-100/90 dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-200/90 dark:hover:bg-white/10 transition-colors';
    if (t1) t1.className = onLb ? active : idle;
    if (t2) t2.className = !onLb ? active : idle;

    if (onLb) {
      applyShareLeaderboardLayoutUi();
      requestAnimationFrame(() => {
        $('share-leaderboard-scroll')?.focus({ preventScroll: true });
      });
    } else {
      requestAnimationFrame(() => {
        $('share-rounds-scroll')?.focus({ preventScroll: true });
      });
    }
  };

  const copyCurrentSpectatorUrl = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Page link copied — share to Instagram, TikTok, etc.');
    } catch {
      window.prompt('Copy this link:', location.href);
    }
  };

  const shareCurrentSpectatorUrl = async () => {
    const url = location.href;
    const title = state.shareViewerData?.title || 'Padelio';
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${title} — Padelio`,
          text: 'View tournament standings (read-only)',
          url
        });
      } else {
        await copyCurrentSpectatorUrl();
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      await copyCurrentSpectatorUrl();
    }
  };

  const renderShareViewer = () => {
    const data = state.shareViewerData;
    if (!data) return;

    const titleEl = $('share-view-title');
    if (titleEl) titleEl.textContent = data.title || 'Tournament';

    populateLeaderboardPanels(data, data.title || '');

    const rounds = safeJsonParse(data.rounds, []);
    renderShareRoundsReadOnly(rounds);

    switchShareTab('leaderboard');
    wireLeaderboardLayoutTabs();
    refreshShareTournamentDesktopUi();

    document.title = `${data.title || 'Padelio'} | Padelio (view)`;
  };

  const exitShareViewer = () => {
    state.shareViewerMode = false;
    state.shareViewerData = null;
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    } catch {}
    window.location.reload();
  };

  const tryOpenShareFromHash = async () => {
    const h = (location.hash || '').trim();
    if (!h.startsWith('#p=')) return false;
    const raw = h.slice(3);
    if (!raw) return false;
    let data;
    try {
      let parsed;
      if (raw[0] === SHARE_HASH_LZ_PREFIX) {
        if (!canUseLzString()) {
          toast('This share link needs LZ-String (reload the page or update the app).');
          return false;
        }
        parsed = decodeSharePayloadLz(raw.slice(1));
      } else if (raw[0] === SHARE_HASH_GZIP_PREFIX) {
        if (!canUseGzipSharePayload()) {
          toast('This share link needs a newer browser (gzip).');
          return false;
        }
        parsed = await decodeSharePayloadGzip(raw.slice(1));
      } else {
        parsed = decodeSharePayload(raw);
      }
      data = normalizeIncomingSharePayload(parsed);
    } catch (e) {
      console.error(e);
      toast('Invalid or broken share link.');
      return false;
    }
    if (Number(data.v) !== SHARE_PAYLOAD_VERSION || data.players == null || data.rounds == null) {
      toast('Invalid share link format.');
      return false;
    }
    state.shareViewerMode = true;
    state.shareViewerData = data;
    return true;
  };

  /* ---------- Leaderboard ---------- */
  const showLeaderboard = () => {
    syncCurrentTournament();
    if (!state.currentTournament) return;

    state.lastRoundsView = (state.viewingRound ?? state.currentTournament.current_round);
    $('dropdown-menu')?.classList.add('hidden');

    // ensure latest stored object
    const fresh = state.tournaments.find((t) => t.__backendId === state.currentTournament.__backendId);
    if (fresh) state.currentTournament = fresh;

    const title = state.currentTournament.title || '';
    populateLeaderboardPanels(state.currentTournament, title);
    wireLeaderboardLayoutTabs();

    if (isTournamentDesktopLayout()) {
      refreshHostTournamentDesktopUi();
      requestAnimationFrame(() => {
        $('host-leaderboard-aside')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        $('host-leaderboard-scroll')?.focus({ preventScroll: true });
      });
      return;
    }

    navigateTo('leaderboard');
    requestAnimationFrame(() => {
      $('host-leaderboard-scroll')?.focus({ preventScroll: true });
    });
  };

  const backToRounds = () => {
    syncCurrentTournament();
    if (!state.currentTournament) return;

    navigateTo('rounds');

    const maxRound = getMaxRoundNumber();
    state.viewingRound = state.lastRoundsView ?? state.viewingRound ?? state.currentTournament.current_round;
    state.viewingRound = clamp(Number(state.viewingRound) || 1, 1, maxRound);

    renderSpecificRound(state.viewingRound);
    updateRoundArrowState();
  };

  const ensureUpdateCacheReminderModal = () => {
    if ($('update-cache-reminder-modal')) return;

    const wrap = document.createElement('div');
    wrap.id = 'update-cache-reminder-modal';
    wrap.className =
      'hidden fixed inset-0 z-[210] flex items-center justify-center bg-black/40 dark:bg-black/75 p-4';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'update-cache-reminder-title');
    wrap.innerHTML = `
      <div class="max-w-md w-full max-h-[90vh] overflow-y-auto rounded-3xl border border-amber-400/35 bg-white/95 dark:bg-slate-900/95 p-6 shadow-cozy backdrop-blur-md" onclick="event.stopPropagation()">
        <h3 id="update-cache-reminder-title" class="text-lg font-extrabold text-amber-950 dark:text-amber-50 mb-3 leading-snug">
          Selamat datang di Padelio
        </h3>
        <p class="text-sm text-slate-700 dark:text-slate-200 mb-3 leading-relaxed">
          Setiap kali membuka Padelio, kosongkan <strong class="text-amber-950 dark:text-amber-100/95">cache aplikasi</strong> dulu supaya Anda mendapat versi terbaru (fitur &amp; perbaikan). Data turnamen di perangkat ini <span class="text-emerald-800 dark:text-emerald-200/90 font-semibold">tetap aman</span>.
        </p>
        <ul class="text-xs text-slate-600/95 dark:text-slate-300/95 space-y-2 mb-5 list-disc list-outside pl-4 leading-relaxed">
          <li>Disarankan: tap <strong>Clear cache &amp; reload</strong> di bawah.</li>
          <li>Alternatif: hard refresh
            <kbd class="px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 border border-slate-200/80 dark:border-white/10 font-mono text-[0.65rem]">Ctrl+Shift+R</kbd>
            /
            <kbd class="px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 border border-slate-200/80 dark:border-white/10 font-mono text-[0.65rem]">Cmd+Shift+R</kbd>
          </li>
        </ul>
        <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button type="button" data-testid="update-tip-dismiss" onclick="hideUpdateReminderModal()"
            class="order-2 sm:order-1 w-full sm:w-auto rounded-2xl border border-slate-200/90 dark:border-white/15 bg-slate-900/8 dark:bg-white/5 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200/90 dark:hover:bg-white/10">
            Mengerti, lanjut
          </button>
          <button type="button" onclick="clearAppCacheFromUpdateModal()"
            class="order-1 sm:order-2 w-full sm:w-auto rounded-2xl border border-amber-500/50 dark:border-amber-400/40 bg-amber-100 dark:bg-amber-500/20 px-4 py-3 text-sm font-bold text-amber-950 dark:text-amber-50 hover:bg-amber-200/90 dark:hover:bg-amber-400/30">
            Clear cache &amp; reload
          </button>
        </div>
      </div>`;

    document.body.appendChild(wrap);
  };

  const showUpdateReminderModal = () => {
    ensureUpdateCacheReminderModal();
    const m = $('update-cache-reminder-modal');
    if (!m) return;
    m.classList.remove('hidden');
    try {
      document.body.style.overflow = 'hidden';
    } catch {}
  };

  const hideUpdateReminderModal = () => {
    const m = $('update-cache-reminder-modal');
    if (!m) return;
    m.classList.add('hidden');
    try {
      document.body.style.overflow = '';
    } catch {}
  };

  /** Shown on every full page load (not share links); dismiss only for this visit. */
  const maybeShowUpdateReminderOnLoad = () => {
    if (state.shareViewerMode) return;
    ensureUpdateCacheReminderModal();
    setTimeout(() => {
      if (state.shareViewerMode) return;
      showUpdateReminderModal();
    }, 400);
  };

  const clearAppCacheFromUpdateModal = async () => {
    await clearAppCacheOnly({ skipConfirm: true });
  };

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const m = $('update-cache-reminder-modal');
    if (m && !m.classList.contains('hidden')) {
      e.preventDefault();
      hideUpdateReminderModal();
    }
  });

  /* ---------- Service Worker: reload once on update ---------- */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/service-worker.js?v=1.6.15');

        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;

          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              window.location.reload();
            }
          });
        });

        reg.update();
      } catch (err) {
        console.error('SW failed', err);
      }
    });
  }

  /* ---------- central click dispatcher (replaces onclick= in generated HTML) ---------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    switch (action) {
      case 'remove-player':
        removePlayer(Number(el.dataset.idx));
        break;
      case 'remove-fixed-pair':
        removeFixedPair(Number(el.dataset.idx));
        break;
      case 'toggle-gender':
        togglePlayerGender(Number(el.dataset.idx));
        break;
      case 'set-player-level':
        setPlayerLevel(Number(el.dataset.idx), el.dataset.level);
        break;
      case 'open-tournament':
        openTournament(el.dataset.id);
        break;
      case 'delete-tournament':
        e.preventDefault();
        e.stopPropagation();
        void deleteTournamentById(el.dataset.id);
        break;
      case 'mex-point':
        mexTennisPoint(Number(el.dataset.idx), Number(el.dataset.side));
        break;
      case 'substitute-player':
        openSubstitutePlayerModal(
          Number(el.dataset.matchIdx),
          el.dataset.teamSide,
          Number(el.dataset.slotIdx)
        );
        break;
      case 'substitute-pick':
        void commitSubstitutePick(decodeLbPlayerAttr(el.dataset.playerName));
        break;
    }
  }, true);

  /* ---------- expose globals (for inline handlers) ---------- */
  /** Bubble-phase fallback if inline onclick is stripped or blocked; idempotent. */
  const wireWizardChipClicks = () => {
    const courtsRoot = $('page-new-courts');
    if (courtsRoot && courtsRoot.dataset.padChipDlgt !== '1') {
      courtsRoot.dataset.padChipDlgt = '1';
      courtsRoot.addEventListener('click', (e) => {
        const btn = e.target.closest('.court-btn');
        if (!btn || !courtsRoot.contains(btn)) return;
        const n = Number(btn.getAttribute('data-courts'));
        if (Number.isFinite(n) && n > 0) selectCourts(n);
      });
    }
    const pointsRoot = $('page-new-points');
    if (pointsRoot && pointsRoot.dataset.padChipDlgt !== '1') {
      pointsRoot.dataset.padChipDlgt = '1';
      pointsRoot.addEventListener('click', (e) => {
        const btn = e.target.closest('.points-btn');
        if (!btn || !pointsRoot.contains(btn)) return;
        const n = Number(btn.getAttribute('data-points'));
        if (Number.isFinite(n) && n > 0) selectPoints(n);
      });
    }
  };
  wireWizardChipClicks();

  const courtsChangeRoot = $('courts-change-chips');
  if (courtsChangeRoot && courtsChangeRoot.dataset.padChipDlgt !== '1') {
    courtsChangeRoot.dataset.padChipDlgt = '1';
    courtsChangeRoot.addEventListener('click', (e) => {
      const chip = e.target.closest('.courts-change-chip');
      if (!chip || chip.disabled) return;
      const n = Number(chip.dataset.courtsDraft);
      if (Number.isFinite(n) && n > 0) setCourtsChangeDraft(n);
    });
  }

  window.escapeHtml = escapeHtml;

  window.setEditingScore = setEditingScore;

  window.navigateTo = navigateTo;

  window.resetNewTournament = resetNewTournament;
  window.goToCourts = goToCourts;
  window.selectCourts = selectCourts;
  window.selectCourtStyle = selectCourtStyle;
  window.goToPoints = goToPoints;
  window.selectPoints = selectPoints;
  window.selectScoreKind = selectScoreKind;
  window.selectBestOfGames = selectBestOfGames;
  window.goToPlayers = goToPlayers;

  window.selectMode = selectMode;
  window.setPlayerGender = setPlayerGender;
  window.toggleGenderDraft = toggleGenderDraft;

  window.addPlayer = addPlayer;
  window.addPlayersFromBulkPaste = addPlayersFromBulkPaste;
  window.removePlayer = removePlayer;
  window.removeFixedPair = removeFixedPair;
  window.startTournament = startTournament;

  window.openTournament = openTournament;

  window.updateScoreLive = updateScoreLive;
  window.commitScore = commitScore;
  window.mexTennisPoint = mexTennisPoint;

  window.prevRoundView = prevRoundView;
  window.nextRoundView = nextRoundView;
  window.nextRound = nextRound;

  window.toggleMenu = toggleMenu;
  window.installApp = installApp;
  window.clearAppCacheOnly = clearAppCacheOnly;
  window.clearAppCacheFromUpdateModal = clearAppCacheFromUpdateModal;
  window.showUpdateReminderModal = showUpdateReminderModal;
  window.hideUpdateReminderModal = hideUpdateReminderModal;
  window.clearAllTournamentData = clearAllTournamentData;
  window.confirmDelete = confirmDelete;
  window.cancelDelete = cancelDelete;
  window.deleteTournament = deleteTournament;
  window.deleteTournamentById = deleteTournamentById;

  window.showCourtsChangePanel = showCourtsChangePanel;
  window.cancelCourtsChange = cancelCourtsChange;
  window.applyCourtsChange = applyCourtsChange;
  window.stepCourtsChangeDraft = stepCourtsChangeDraft;
  window.changeTournamentCourts = changeTournamentCourts;

  window.regenerateCurrentRound = regenerateCurrentRound;

  window.openSubstitutePlayerModal = openSubstitutePlayerModal;
  window.closeSubstitutePlayerModal = closeSubstitutePlayerModal;
  window.addGuestAndSubstitute = addGuestAndSubstitute;

  window.showLeaderboard = showLeaderboard;
  window.backToRounds = backToRounds;
  window.togglePlayerGender = togglePlayerGender;
  window.setPlayerLevel = setPlayerLevel;
  window.setDraftPlayerLevel = setDraftPlayerLevel;
  window.updateGenderBalanceWarning = updateGenderBalanceWarning;

  /* After all handlers exist; safe for index.html #player-level-picker (no-op on other pages). */
  syncDraftLevelPicker();

  window.switchShareTab = switchShareTab;
  window.exitShareViewer = exitShareViewer;
  window.copyCurrentSpectatorUrl = copyCurrentSpectatorUrl;
  window.shareCurrentSpectatorUrl = shareCurrentSpectatorUrl;

  initTournamentDesktopLayout();
  wireLeaderboardRenameEvents();

  void (async () => {
    const hasShareHash = (location.hash || '').trim().startsWith('#p=');
    if (hasShareHash) {
      // Show the spectator shell immediately (synchronously, before the async
      // payload decode) so the home page never flashes for shared links.
      $$('.page').forEach((p) => p.classList.add('hidden'));
      const shEarly = $('page-share-view');
      if (shEarly) shEarly.classList.remove('hidden');
      updateAdVisibility('share-view');
    }
    if (await tryOpenShareFromHash()) {
      $$('.page').forEach((p) => p.classList.add('hidden'));
      const sh = $('page-share-view');
      if (sh) {
        sh.classList.remove('hidden');
        sh.classList.add('slide-in');
      }
      renderShareViewer();
      updateAdVisibility('share-view');
      document.documentElement.classList.remove('padel-share-boot');
    } else {
      if (hasShareHash) {
        // Decode failed/invalid link → fall back to home instead of an empty shell.
        document.documentElement.classList.remove('padel-share-boot');
        $$('.page').forEach((p) => p.classList.add('hidden'));
        $('page-home')?.classList.remove('hidden');
        updateAdVisibility('home');
      }
      maybeShowUpdateReminderOnLoad();
    }
  })();
})();