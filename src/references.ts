import { addDays, daysBetween } from './format';
import { compareScores } from './records';
import type { Result, SavedWod } from './types';

/** Délai proposé pour refaire un WOD de référence, et les délais au choix, en semaines. */
export const REFERENCE_WEEKS = 8;
export const REFERENCE_CHOICES = [4, 6, 8, 12];

/** Où en est un WOD de référence. */
export interface Reference {
  saved: SavedWod;
  weeks: number;
  /** Séances du même entraînement, de la plus ancienne à la plus récente. */
  results: Result[];
  last?: Result;
  best?: Result;
  /** Date à partir de laquelle le refaire ; absente s'il n'a jamais été fait. */
  dueOn?: string;
  /** Fait au moins une fois, et le délai est écoulé. */
  due: boolean;
}

/** Une séance en blocs n'a pas de score unique : elle ne peut pas servir de référence. */
export const canBeReference = (saved: SavedWod) => saved.wod.type !== 'session';

/**
 * État d'un WOD de référence, ou null si ce n'en est pas un. `results` : les séances du même
 * entraînement, de la plus ancienne à la plus récente.
 */
export function referenceOf(saved: SavedWod, results: Result[], today: string): Reference | null {
  if (saved.reference_weeks === undefined || !canBeReference(saved)) return null;
  const weeks = saved.reference_weeks;
  const last = results.at(-1);
  // À égalité, la première séance garde le record, comme ailleurs dans l'appli.
  const best = results.reduce<Result | undefined>(
    (top, result) => (!top || compareScores(result.score, top.score, [result.wod, top.wod]) > 0 ? result : top),
    undefined,
  );
  const dueOn = last && addDays(last.date, weeks * 7);
  return { saved, weeks, results, last, best, dueOn, due: dueOn !== undefined && dueOn <= today };
}

/** « il y a 3 jours », « il y a 9 semaines », « il y a 4 mois ». */
export function agoText(date: string, today: string): string {
  const days = daysBetween(date, today);
  if (days <= 0) return 'aujourd’hui';
  if (days === 1) return 'hier';
  if (days < 14) return `il y a ${days} jours`;
  if (days < 60) return `il y a ${Math.floor(days / 7)} semaines`;
  return `il y a ${Math.floor(days / 30)} mois`;
}
