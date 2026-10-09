import { clock, plural } from './format';
import type { Movement, Result, Score, Wod } from './types';

/** Écart entre deux scores. `better` vaut null quand ils sont identiques. */
export interface Delta {
  text: string;
  better: boolean | null;
}

/**
 * Identifie un entraînement par le travail demandé : mouvements, quantités, charges, durées.
 * Le titre, la description ou le time cap peuvent changer sans casser la comparaison.
 */
export function workKey(wod: Wod): string {
  const work = (m: Movement) => [m.name.trim().toLowerCase(), m.reps, m.distance_m, m.calories, m.duration_sec, m.load_kg];
  switch (wod.type) {
    case 'amrap':
      return JSON.stringify(['amrap', wod.duration_sec, wod.movements.map(work)]);
    case 'emom':
      return JSON.stringify(['emom', wod.interval_sec, wod.intervals, wod.slots.map((slot) => slot.map(work))]);
    case 'for_time':
      return JSON.stringify(['for_time', wod.rounds, wod.rep_scheme, wod.movements.map(work)]);
    case 'hyrox':
      return JSON.stringify(['hyrox', wod.segments.map(work)]);
  }
}

/** Reps d'un tour, quand tous les mouvements se comptent en reps ou en calories. */
export function repsPerRound(movements: Movement[]): number | undefined {
  let total = 0;
  for (const movement of movements) {
    const reps = movement.reps ?? movement.calories;
    if (reps === undefined) return undefined;
    total += reps;
  }
  return total;
}

/** Critères de classement, du plus important au moins important ; plus grand = meilleur. */
function rank(score: Score): number[] {
  const rx = score.rx ? 1 : 0;
  if ('rounds' in score) return [rx, score.rounds, score.extra_reps];
  if ('intervals_completed' in score) return [rx, score.intervals_completed];
  if (score.finished) return [rx, 1, -score.time_sec];
  return [rx, 0, 'segments_completed' in score ? score.segments_completed : score.reps_completed];
}

/** Positif si `a` est meilleur que `b`. Un score Rx passe toujours devant un score scaled. */
export function compareScores(a: Score, b: Score): number {
  const ra = rank(a);
  const rb = rank(b);
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
    const best = group.reduce((top, result) => (compareScores(result.score, top.score) > 0 ? result : top));
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
