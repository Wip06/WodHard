import { canonicalName, nameKey } from './movements';
import { oneRepMax } from './strength';
import type { Result, StrengthSet } from './types';

/** Un exercice tel qu'il a été fait lors d'une séance. */
export interface LiftSession {
  date: string;
  resultId: string;
  sets: StrengthSet[];
  /** 2 pour une paire : les charges sont celles d'une main. */
  loadCount?: number;
  /** Meilleur 1RM estimé des séries de cette séance. */
  oneRepMax?: number;
}

/** Charges et records d'un exercice, sur toutes les séances de force. */
export interface Lift {
  key: string;
  name: string;
  /** Séances, de la plus ancienne à la plus récente. */
  sessions: LiftSession[];
  /** Meilleure série au 1RM estimé : la référence pour prescrire une charge. */
  best?: { set: StrengthSet; date: string; oneRepMax: number };
  /** Charge la plus lourde soulevée, avec ses répétitions. */
  heaviest?: { load: number; reps: number; date: string };
  /** Exercice sans charge : le plus de répétitions en une série. */
  mostReps?: { reps: number; date: string };
  /** Exercice tenu (gainage) : la plus longue série. */
  longestHold?: { seconds: number; date: string };
}

const sessionMax = (sets: StrengthSet[]) => {
  const values = sets.flatMap((set) => {
    const max = oneRepMax(set);
    return max === undefined ? [] : [max];
  });
  return values.length > 0 ? Math.max(...values) : undefined;
};

/**
 * Charges et records de chaque exercice, tirés des séances de force. `results` va de la plus récente
 * à la plus ancienne, comme `sortedResults` : deux séances du même jour restent ainsi dans l'ordre
 * où elles ont été faites. Les variantes d'un nom (« développé couché », « Bench press ») sont
 * regroupées. Les exercices les plus récemment faits viennent en premier.
 */
export function liftsOf(results: Result[]): Lift[] {
  const lifts = new Map<string, Lift>();
  // Tri stable : à date égale, l'ordre inverse de `results` (donc chronologique) est gardé.
  const chronological = [...results].reverse().sort((a, b) => a.date.localeCompare(b.date));
  for (const result of chronological) {
    if (result.wod.type !== 'strength' || !('exercises' in result.score)) continue;
    const done = result.score.exercises;
    result.wod.exercises.forEach((exercise, i) => {
      const sets = done[i] ?? [];
      if (sets.length === 0) return;
      const name = canonicalName(exercise.name);
      const key = nameKey(name);
      const lift = lifts.get(key) ?? { key, name, sessions: [] };
      const session: LiftSession = { date: result.date, resultId: result.id, sets };
      if (exercise.load_count !== undefined) session.loadCount = exercise.load_count;
      const max = sessionMax(sets);
      if (max !== undefined) session.oneRepMax = max;
      lift.sessions.push(session);
      for (const set of sets) {
        const estimate = oneRepMax(set);
        if (estimate !== undefined && (!lift.best || estimate > lift.best.oneRepMax)) {
          lift.best = { set, date: result.date, oneRepMax: estimate };
        }
        if (set.load_kg !== undefined && set.load_kg > 0 && (set.reps ?? 0) > 0) {
          const heavier = !lift.heaviest || set.load_kg > lift.heaviest.load;
          const sameButMore = lift.heaviest && set.load_kg === lift.heaviest.load && (set.reps ?? 0) > lift.heaviest.reps;
          if (heavier || sameButMore) lift.heaviest = { load: set.load_kg, reps: set.reps ?? 0, date: result.date };
        }
        if (set.load_kg === undefined && set.reps !== undefined && (!lift.mostReps || set.reps > lift.mostReps.reps)) {
          lift.mostReps = { reps: set.reps, date: result.date };
        }
        if (set.duration_sec !== undefined && (!lift.longestHold || set.duration_sec > lift.longestHold.seconds)) {
          lift.longestHold = { seconds: set.duration_sec, date: result.date };
        }
      }
      lifts.set(key, lift);
    });
  }
  return [...lifts.values()].sort((a, b) => (b.sessions.at(-1)?.date ?? '').localeCompare(a.sessions.at(-1)?.date ?? ''));
}

/** Charges et records d'un exercice, par son nom (ou une de ses variantes). */
export function liftFor(results: Result[], name: string): Lift | undefined {
  const key = nameKey(canonicalName(name));
  return liftsOf(results).find((lift) => lift.key === key);
}

/**
 * Records battus par une séance de force : pour chaque exercice déjà fait avant, un 1RM estimé
 * plus haut, une charge plus lourde, ou plus de répétitions sans charge.
 */
export function recordsBeaten(before: Result[], result: Result): { name: string; set: StrengthSet; kind: 'oneRepMax' | 'heaviest' | 'reps' }[] {
  const previous = new Map(liftsOf(before).map((lift) => [lift.key, lift]));
  const now = liftsOf([result]);
  const beaten: { name: string; set: StrengthSet; kind: 'oneRepMax' | 'heaviest' | 'reps' }[] = [];
  for (const lift of now) {
    const old = previous.get(lift.key);
    if (!old) continue;
    if (lift.best && old.best && lift.best.oneRepMax > old.best.oneRepMax + 1e-9) {
      beaten.push({ name: lift.name, set: lift.best.set, kind: 'oneRepMax' });
    } else if (lift.heaviest && old.heaviest && lift.heaviest.load > old.heaviest.load) {
      beaten.push({ name: lift.name, set: { reps: lift.heaviest.reps, load_kg: lift.heaviest.load }, kind: 'heaviest' });
    } else if (lift.mostReps && old.mostReps && lift.mostReps.reps > old.mostReps.reps) {
      beaten.push({ name: lift.name, set: { reps: lift.mostReps.reps }, kind: 'reps' });
    }
  }
  return beaten;
}
