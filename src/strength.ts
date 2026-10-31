import type { Exercise, StrengthScore, StrengthSet, StrengthWod } from './types';

/** Repos entre deux séries quand le WOD ne le précise pas, en secondes. */
export const DEFAULT_REST_SEC = 90;

/** Séries prévues d'un exercice, une par une, qu'elles soient identiques ou détaillées. */
export function plannedSets(exercise: Exercise): StrengthSet[] {
  if (Array.isArray(exercise.sets)) return exercise.sets;
  const set: StrengthSet = {};
  if (exercise.reps !== undefined) set.reps = exercise.reps;
  if (exercise.duration_sec !== undefined) set.duration_sec = exercise.duration_sec;
  if (exercise.load_kg !== undefined) set.load_kg = exercise.load_kg;
  return Array.from({ length: exercise.sets }, () => ({ ...set }));
}

export const restOf = (exercise: Exercise) => exercise.rest_sec ?? DEFAULT_REST_SEC;

export const plannedCount = (wod: StrengthWod) => wod.exercises.reduce((sum, exercise) => sum + plannedSets(exercise).length, 0);
export const doneCount = (score: StrengthScore) => score.exercises.reduce((sum, sets) => sum + sets.length, 0);

/** Tonnage : répétitions × charge, sur toutes les séries (les deux mains pour une paire). */
export function volume(wod: StrengthWod, score: StrengthScore): number {
  return score.exercises.reduce((total, sets, i) => {
    const hands = wod.exercises[i]?.load_count === 2 ? 2 : 1;
    return total + sets.reduce((sum, set) => sum + (set.reps ?? 0) * (set.load_kg ?? 0) * hands, 0);
  }, 0);
}

/** Toutes les séries prévues faites, avec au moins les reps (ou la durée) et la charge prévues. */
export function asPrescribed(wod: StrengthWod, score: StrengthScore): boolean {
  return wod.exercises.every((exercise, i) => {
    const planned = plannedSets(exercise);
    const done = score.exercises[i] ?? [];
    return (
      done.length >= planned.length &&
      planned.every((set, j) => {
        const actual = done[j];
        return (
          actual !== undefined &&
          (actual.reps ?? 0) >= (set.reps ?? 0) &&
          (actual.duration_sec ?? 0) >= (set.duration_sec ?? 0) &&
          (actual.load_kg ?? 0) >= (set.load_kg ?? 0)
        );
      })
    );
  });
}

/**
 * 1RM estimé d'une série (formule d'Epley) : la charge qu'on soulèverait une fois. Au-delà de
 * 12 répétitions l'estimation n'a plus de sens ; une série sans charge n'en a pas.
 */
export function oneRepMax(set: StrengthSet): number | undefined {
  if (set.load_kg === undefined || set.reps === undefined || set.reps < 1 || set.reps > 12) return undefined;
  return set.reps === 1 ? set.load_kg : set.load_kg * (1 + set.reps / 30);
}
