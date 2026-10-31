import { clock, plural } from './format';
import { allMovements, canonicalName, isRest } from './movements';
import { asPrescribed, plannedSets } from './strength';
import type { Adjustment, ForTimeWod, Movement, Result, Score, StrengthScore, Wod } from './types';

/** Écart entre deux scores. `better` vaut null quand ils sont identiques. */
export interface Delta {
  text: string;
  better: boolean | null;
}

/**
 * Identifie un entraînement par le travail demandé : mouvements, quantités, charges, durées, et
 * taille de l'équipe. Le titre, la description ou le time cap peuvent changer sans casser la
 * comparaison, et les variantes d'un même nom (« rameur », « Rowing ») se retrouvent.
 */
export function workKey(wod: Wod): string {
  const work = (m: Movement) => [
    canonicalName(m.name).toLowerCase(),
    m.reps,
    m.distance_m,
    m.calories,
    m.duration_sec,
    m.load_kg,
    m.load_count === 2 ? 2 : undefined,
  ];
  const team = wod.team_size ?? 1;
  switch (wod.type) {
    case 'amrap':
      return JSON.stringify(['amrap', team, wod.duration_sec, wod.movements.map(work)]);
    case 'emom':
      return JSON.stringify(['emom', team, wod.interval_sec, wod.intervals, wod.slots.map((slot) => slot.map(work))]);
    case 'for_time':
      return JSON.stringify(['for_time', team, wod.rounds, wod.rep_scheme, wod.movements.map(work)]);
    case 'hyrox':
      return JSON.stringify(['hyrox', team, wod.segments.map(work)]);
    case 'strength':
      return JSON.stringify([
        'strength',
        team,
        wod.exercises.map((exercise) => [
          canonicalName(exercise.name).toLowerCase(),
          plannedSets(exercise).map((set) => [set.reps, set.duration_sec, set.load_kg]),
          exercise.load_count === 2 ? 2 : undefined,
        ]),
      ]);
  }
}

/** Tonnage d'une séance de force : répétitions × charge (les deux mains pour une paire, si le WOD est connu). */
function liftedVolume(score: StrengthScore, wod?: Wod): number {
  return score.exercises.reduce((total, sets, i) => {
    const hands = wod?.type === 'strength' && wod.exercises[i]?.load_count === 2 ? 2 : 1;
    return total + sets.reduce((sum, set) => sum + (set.reps ?? 0) * (set.load_kg ?? 0) * hands, 0);
  }, 0);
}

/**
 * Sens d'une adaptation par rapport au prescrit : plus (charge, reps, distance ou durée au-dessus),
 * moins, identique, ou mouvement remplacé (dont on ne peut pas dire s'il est plus dur).
 */
export function adjustmentDirection(wod: Wod, adjustment: Adjustment): 'up' | 'down' | 'same' | 'replaced' {
  if (adjustment.replaced_by) return 'replaced';
  const target = allMovements(wod)[adjustment.index];
  if (!target) return 'same';
  const compared: [number | undefined, number | undefined][] = [
    [adjustment.reps, target.reps],
    [adjustment.distance_m, target.distance_m],
    [adjustment.calories, target.calories],
    [adjustment.duration_sec, target.duration_sec],
    [adjustment.load_kg, target.load_kg ?? 0],
    [adjustment.load_count, target.load_count ?? 1],
  ];
  const diffs = compared.flatMap(([done, planned]) => (done === undefined || planned === undefined ? [] : [done - planned]));
  if (diffs.some((diff) => diff < 0)) return 'down';
  return diffs.some((diff) => diff > 0) ? 'up' : 'same';
}

/** Une adaptation à la baisse fait passer la séance en scaled ; à la hausse, elle reste Rx. */
export const scalesDown = (wod: Wod, adjustments: Adjustment[] = []) =>
  adjustments.some((adjustment) => adjustmentDirection(wod, adjustment) === 'down');

/**
 * Rx+ : la séance est Rx et va au-delà du prescrit (plus lourd, plus de reps, une série de plus…),
 * sans rien en dessous. Elle est valorisée, pas classée en scaled.
 */
export function beyondPrescribed(wod: Wod, score: Score): boolean {
  if (!score.rx) return false;
  if ('exercises' in score) {
    if (wod.type !== 'strength' || !asPrescribed(wod, score)) return false;
    return wod.exercises.some((exercise, i) => {
      const planned = plannedSets(exercise);
      const done = score.exercises[i] ?? [];
      return (
        done.length > planned.length ||
        done.some((set, j) => {
          const target = planned[j];
          return (
            target !== undefined &&
            ((set.reps ?? 0) > (target.reps ?? 0) || (set.duration_sec ?? 0) > (target.duration_sec ?? 0) || (set.load_kg ?? 0) > (target.load_kg ?? 0))
          );
        })
      );
    });
  }
  const directions = (score.adjustments ?? []).map((adjustment) => adjustmentDirection(wod, adjustment));
  return directions.includes('up') && !directions.includes('down');
}

/** Reps d'un tour, quand tous les mouvements se comptent en reps ou en calories ; les repos ne comptent pas. */
export function repsPerRound(movements: Movement[]): number | undefined {
  let total = 0;
  for (const movement of movements) {
    if (isRest(movement)) continue;
    const reps = movement.reps ?? movement.calories;
    if (reps === undefined) return undefined;
    total += reps;
  }
  return total;
}

const followsScheme = (m: Movement) =>
  m.reps === undefined && m.distance_m === undefined && m.calories === undefined && m.duration_sec === undefined;

/**
 * Reps cumulées sur les premiers tours d'un For Time, quand tout se compte en reps ou en calories.
 * Avec un rep_scheme, un mouvement sans quantité fait les reps du tour, les autres gardent la leur.
 */
export function repsInRounds(wod: ForTimeWod, rounds: number): number | undefined {
  if (rounds === 0) return undefined;
  let total = 0;
  for (let i = 0; i < Math.min(rounds, wod.rounds); i++) {
    const schemeReps = wod.rep_scheme?.[i];
    const round = wod.movements.map((m) => (schemeReps !== undefined && followsScheme(m) ? { ...m, reps: schemeReps } : m));
    const reps = repsPerRound(round);
    if (reps === undefined) return undefined;
    total += reps;
  }
  return total;
}

/** Vrai pour un For Time ou un Hyrox terminé après son time cap. */
export function isOverCap(wod: Wod, score: Score): boolean {
  const cap = wod.type === 'for_time' || wod.type === 'hyrox' ? wod.time_cap_sec : undefined;
  return cap !== undefined && 'time_sec' in score && score.finished && score.time_sec > cap;
}

/** Critères de classement, du plus important au moins important ; plus grand = meilleur. */
function rank(score: Score, wod?: Wod): number[] {
  const rx = score.rx ? 1 : 0;
  if ('exercises' in score) return [rx, liftedVolume(score, wod), score.exercises.reduce((sum, sets) => sum + sets.length, 0)];
  if ('rounds' in score) return [rx, score.rounds, score.extra_reps];
  if ('intervals_completed' in score) return [rx, score.intervals_completed];
  // Fini dans le cap, puis fini hors cap, puis arrêté avant la fin.
  if (score.finished) return [rx, wod && isOverCap(wod, score) ? 1 : 2, -score.time_sec];
  return [rx, 0, 'segments_completed' in score ? score.segments_completed : score.reps_completed];
}

/**
 * Positif si `a` est meilleur que `b`. Un score Rx passe toujours devant un score scaled.
 * Avec les WOD des deux séances, un temps hors cap passe derrière tout temps fait dans le cap.
 */
export function compareScores(a: Score, b: Score, wods?: [Wod, Wod]): number {
  const ra = rank(a, wods?.[0]);
  const rb = rank(b, wods?.[1]);
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    const diff = (ra[i] ?? 0) - (rb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Séances qui détiennent le record de leur entraînement, parmi des séances données dans
 * l'ordre chronologique. Il faut au moins deux séances, et à égalité la première garde le record.
 */
export function recordIds(chronological: Result[]): Set<string> {
  const groups = new Map<string, Result[]>();
  for (const result of chronological) {
    const key = workKey(result.wod);
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  const ids = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const best = group.reduce((top, result) =>
      compareScores(result.score, top.score, [result.wod, top.wod]) > 0 ? result : top,
    );
    ids.add(best.id);
  }
  return ids;
}

/** Écart entre deux scores du même entraînement, ou null s'ils ne se mesurent pas dans la même unité. */
export function scoreDelta(wod: Wod, current: Score, previous: Score): Delta | null {
  const signed = (diff: number, unit: (abs: number) => string, higherIsBetter: boolean): Delta =>
    diff === 0
      ? { text: 'identique', better: null }
      : { text: `${diff > 0 ? '+' : '−'}${unit(Math.abs(diff))}`, better: diff > 0 === higherIsBetter };
  const count = (word: string) => (n: number) => plural(n, word);

  if ('exercises' in current && 'exercises' in previous) {
    const lifted = liftedVolume(current, wod) - liftedVolume(previous, wod);
    if (lifted !== 0) return signed(Math.round(lifted), (n) => `${n.toLocaleString('fr-FR')} kg`, true);
    const sets = (score: StrengthScore) => score.exercises.flat().reduce((sum, set) => sum + (set.reps ?? 0), 0);
    return signed(sets(current) - sets(previous), count('rep'), true);
  }
  if ('rounds' in current && 'rounds' in previous) {
    const perRound = wod.type === 'amrap' ? repsPerRound(wod.movements) : undefined;
    const rounds = current.rounds - previous.rounds;
    const extra = current.extra_reps - previous.extra_reps;
    if (perRound !== undefined) return signed(rounds * perRound + extra, count('rep'), true);
    return rounds !== 0 ? signed(rounds, count('tour'), true) : signed(extra, count('rep'), true);
  }
  if ('intervals_completed' in current && 'intervals_completed' in previous) {
    return signed(current.intervals_completed - previous.intervals_completed, count('intervalle'), true);
  }
  if ('segments_completed' in current && 'segments_completed' in previous) {
    return signed(current.segments_completed - previous.segments_completed, count('segment'), true);
  }
  if ('reps_completed' in current && 'reps_completed' in previous) {
    return signed(current.reps_completed - previous.reps_completed, count('rep'), true);
  }
  if ('time_sec' in current && 'time_sec' in previous) {
    return signed(current.time_sec - previous.time_sec, clock, false);
  }
  return null;
}

/** Écart de chaque segment avec la séance précédente ; null là où il n'y a rien à comparer. */
export function splitDeltas(current: number[], previous: number[] | undefined): (number | null)[] {
  return current.map((sec, i) => {
    const before = previous?.[i];
    return before === undefined ? null : sec - before;
  });
}

/** Temps par segment de la séance la plus récente qui en a, parmi des séances en ordre chronologique. */
export function lastSplits(chronological: Result[]): number[] | undefined {
  for (let i = chronological.length - 1; i >= 0; i--) {
    const score = chronological[i]?.score;
    if (score && 'splits_sec' in score && score.splits_sec) return score.splits_sec;
  }
  return undefined;
}
