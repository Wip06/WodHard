import { clock, daysBetween, kg, plural, scoreLine } from './format';
import { liftFor } from './lifts';
import { repsPerRound, workKey } from './records';
import type { Goal, GoalSummary, Result, WodGoal } from './types';

const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const round = (value: number) => Math.round(value * 2) / 2;

/** Où en est un objectif. */
export interface GoalStatus {
  goal: Goal;
  title: string;
  /** De 0 à 1 ; absent pour un objectif libre. */
  progress?: number;
  /** Ce qui est fait (« 110 kg », « 5:18 »), ce qu'il reste à faire, et un repère de plus. */
  current?: string;
  remaining?: string;
  hint?: string;
  achievedOn?: string;
}

/** « Back squat 120 kg », « Fran sous 5:00 », « Cindy : 20 tours ». */
export function goalTitle(goal: Goal): string {
  switch (goal.kind) {
    case 'lift':
      return goal.reps === 1 ? `${goal.exercise} ${kg(goal.load_kg)}` : `${goal.exercise} ${goal.reps} × ${kg(goal.load_kg)}`;
    case 'wod':
      if (goal.time_sec !== undefined) return `${goal.wod.title} sous ${clock(goal.time_sec)}`;
      return `${goal.wod.title} : ${plural(goal.rounds ?? 0, 'tour')}${goal.extra_reps ? ` + ${plural(goal.extra_reps, 'rep')}` : ''}`;
    case 'free':
      return goal.title;
  }
}

/** « échéance le 15 déc., dans 42 jours », « échéance demain », « échéance aujourd'hui », « échéance dépassée ». */
export function deadlineText(date: string, today: string): string {
  const days = daysBetween(today, date);
  // Espaces insécables : « 42 jours » ne se coupe pas en fin de ligne.
  if (days > 1) return `échéance le ${shortDate(date)}, dans ${days}\u00a0jours`;
  if (days === 1) return 'échéance demain';
  return days === 0 ? 'échéance aujourd’hui' : `échéance dépassée (${shortDate(date)})`;
}

function liftStatus(goal: Extract<Goal, { kind: 'lift' }>, results: Result[]): Omit<GoalStatus, 'goal' | 'title'> {
  const lift = liftFor(results, goal.exercise);
  if (!lift) return { progress: 0, current: 'pas encore fait' };
  let best: number | undefined;
  let achievedOn: string | undefined;
  for (const session of lift.sessions) {
    for (const set of session.sets) {
      // Seules comptent les séries d'au moins autant de répétitions que visé.
      if (set.load_kg === undefined || (set.reps ?? 0) < goal.reps) continue;
      best = Math.max(best ?? 0, set.load_kg);
      if (achievedOn === undefined && set.load_kg >= goal.load_kg) achievedOn = session.date;
    }
  }
  const hint = goal.reps === 1 && lift.best ? `1RM estimé ${kg(round(lift.best.oneRepMax))}` : undefined;
  return {
    progress: best === undefined ? 0 : Math.min(1, best / goal.load_kg),
    current: best === undefined ? `aucune série de ${plural(goal.reps, 'rep')}` : goal.reps === 1 ? kg(best) : `${goal.reps} × ${kg(best)}`,
    ...(best !== undefined && best < goal.load_kg && { remaining: `encore ${kg(round(goal.load_kg - best))}` }),
    ...(hint && { hint }),
    ...(achievedOn && { achievedOn }),
  };
}

function wodStatus(goal: WodGoal, results: Result[]): Omit<GoalStatus, 'goal' | 'title'> {
  const key = workKey(goal.wod);
  // Un objectif se gagne en Rx, sur le même entraînement.
  const done = [...results].reverse().filter((result) => result.score.rx && workKey(result.wod) === key);
  if (goal.time_sec !== undefined) {
    const target = goal.time_sec;
    const times = done.flatMap((result) => ('finished' in result.score && result.score.finished ? [{ date: result.date, sec: result.score.time_sec }] : []));
    if (times.length === 0) return { progress: 0, current: done.length > 0 ? 'pas encore fini en Rx' : 'pas encore fait en Rx' };
    const best = Math.min(...times.map((time) => time.sec));
    const achievedOn = times.find((time) => time.sec <= target)?.date;
    return {
      progress: Math.min(1, target / best),
      current: clock(best),
      ...(best > target && { remaining: `encore ${clock(best - target)} à gagner` }),
      ...(achievedOn && { achievedOn }),
    };
  }
  // AMRAP : en reps quand chaque tour se compte en reps, sinon en tours puis en reps.
  const perRound = goal.wod.type === 'amrap' ? repsPerRound(goal.wod.movements) : undefined;
  const value = (rounds: number, extra: number) => (perRound !== undefined ? rounds * perRound + extra : rounds + extra / 1000);
  const target = value(goal.rounds ?? 0, goal.extra_reps ?? 0);
  const scores = done.flatMap((result) => ('rounds' in result.score ? [{ result, value: value(result.score.rounds, result.score.extra_reps) }] : []));
  if (scores.length === 0) return { progress: 0, current: 'pas encore fait en Rx' };
  const best = scores.reduce((top, score) => (score.value > top.value ? score : top));
  const achievedOn = scores.find((score) => score.value >= target)?.result.date;
  let remaining: string | undefined;
  if (best.value < target && 'rounds' in best.result.score) {
    if (perRound !== undefined) remaining = `encore ${plural(Math.round(target - best.value), 'rep')}`;
    else {
      const rounds = (goal.rounds ?? 0) - best.result.score.rounds;
      remaining = rounds > 0 ? `encore ${plural(rounds, 'tour')}` : `encore ${plural((goal.extra_reps ?? 0) - best.result.score.extra_reps, 'rep')}`;
    }
  }
  return {
    progress: Math.min(1, best.value / target),
    current: scoreLine(best.result.wod, best.result.score),
    ...(remaining && { remaining }),
    ...(achievedOn && { achievedOn }),
  };
}

/** Avancement d'un objectif, d'après les séances (de la plus récente à la plus ancienne). */
export function goalStatus(goal: Goal, results: Result[]): GoalStatus {
  const title = goalTitle(goal);
  switch (goal.kind) {
    case 'lift':
      return { goal, title, ...liftStatus(goal, results) };
    case 'wod':
      return { goal, title, ...wodStatus(goal, results) };
    case 'free':
      return { goal, title, ...(goal.done_on && { achievedOn: goal.done_on }) };
  }
}

/** En cours d'abord, par échéance (sans échéance à la fin) ; puis atteints, du plus récent au plus ancien. */
export function sortGoals(statuses: GoalStatus[]): GoalStatus[] {
  return [...statuses].sort((a, b) => {
    if (!a.achievedOn !== !b.achievedOn) return a.achievedOn ? 1 : -1;
    if (a.achievedOn && b.achievedOn) return b.achievedOn.localeCompare(a.achievedOn);
    return (a.goal.date ?? '9999').localeCompare(b.goal.date ?? '9999');
  });
}

/** Objectifs atteints par une nouvelle séance : ceux qui ne l'étaient pas avec les séances d'avant. */
export function newlyAchieved(goals: readonly Goal[], before: Result[], after: Result[]): GoalStatus[] {
  return goals.flatMap((goal) => {
    if (goal.kind === 'free' || goalStatus(goal, before).achievedOn) return [];
    const now = goalStatus(goal, after);
    return now.achievedOn ? [now] : [];
  });
}

/** Un objectif pour le coach, en clair. */
export function goalSummary(status: GoalStatus): GoalSummary {
  const { goal } = status;
  return {
    goal: status.title,
    ...(goal.date && { deadline: goal.date }),
    ...(status.current && { current: status.current }),
    ...(status.remaining && { remaining: status.remaining }),
    ...(status.achievedOn && { achieved_on: status.achievedOn }),
    ...(goal.notes && { notes: goal.notes }),
  };
}
