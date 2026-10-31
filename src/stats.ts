import { addDays, duration, mondayOf, plural, scoreLine, typeLabel } from './format';
import { allMovements, blocksOf, canonicalName, isRest } from './movements';
import { compareScores, repsPerRound, workKey } from './records';
import { activityName } from './sports';
import { plannedSets, restOf, volume } from './strength';
import type { Activity, Movement, PlanEntry, Result, Score, Sport, Wod } from './types';

/** RPE retenu pour la charge d'une séance qui n'en a pas. */
export const DEFAULT_RPE = 5;
/** Séances par semaine pour qu'une semaine compte dans la série. */
export const STREAK_MIN = 3;
const REPEATED_MAX = 5;
/** Semaines actives, sur les 4 d'avant, pour que la comparaison de charge ait un sens. */
const BASELINE_WEEKS = 3;
const SPARK_MAX = 8;

/** Une séance du tableau de bord : un WOD fait ou une activité d'un autre sport. */
export interface Session {
  date: string;
  durationSec?: number;
  rpe?: number;
}

/** Durée d'effort d'un WOD fait, en secondes, quand on peut la connaître. */
export function resultDuration({ wod, score }: Pick<Result, 'wod' | 'score'>): number | undefined {
  switch (wod.type) {
    case 'session': {
      // Somme des blocs faits ; les blocs passés ne comptent pas.
      const blocks = 'blocks' in score ? score.blocks : [];
      return wod.blocks.reduce((sum, block, i) => {
        const done = blocks[i];
        return done ? sum + (resultDuration({ wod: block, score: done }) ?? 0) : sum;
      }, 0);
    }
    case 'amrap':
      return wod.duration_sec;
    case 'emom':
      return wod.interval_sec * wod.intervals;
    case 'for_time':
      return 'time_sec' in score ? score.time_sec : wod.time_cap_sec;
    case 'hyrox': {
      if ('time_sec' in score) return score.time_sec;
      const splits = 'splits_sec' in score ? score.splits_sec : undefined;
      return splits && splits.length > 0 ? splits.reduce((sum, sec) => sum + sec, 0) : wod.time_cap_sec;
    }
    case 'strength': {
      if ('duration_sec' in score && score.duration_sec !== undefined) return score.duration_sec;
      // Saisi sans chrono : environ 40 s par série, plus le repos prévu.
      return wod.exercises.reduce((sum, exercise) => sum + plannedSets(exercise).length * (40 + restOf(exercise)), 0);
    }
  }
}

/**
 * Score en titre d'une séance. Pour une séance en blocs, le détail suit bloc par bloc : le titre
 * dit seulement combien de blocs sont faits, et la durée d'effort.
 */
export function scoreHeadline(result: Pick<Result, 'wod' | 'score'>): string {
  const { wod, score } = result;
  if (wod.type !== 'session' || !('blocks' in score)) return scoreLine(wod, score);
  const done = score.blocks.filter((block) => block !== null).length;
  const total = wod.blocks.length;
  const blocks = done === total ? `${plural(total, 'bloc')} faits` : `${plural(done, 'bloc')} sur ${total}`;
  const effort = resultDuration(result);
  return effort ? `${blocks} · ${duration(effort)}` : blocks;
}

export function sessionsOf(results: Result[], activities: Activity[]): Session[] {
  return [
    ...results.map((result) => ({ date: result.date, durationSec: resultDuration(result), rpe: result.score.rpe })),
    ...activities.map((activity) => ({ date: activity.date, durationSec: activity.duration_sec, rpe: activity.rpe })),
  ];
}

/** Charge d'une séance : minutes d'effort × RPE. */
export const sessionLoad = (session: Session) =>
  session.durationSec === undefined ? 0 : (session.durationSec / 60) * (session.rpe ?? DEFAULT_RPE);

/** 0 : rien ; 1 : séance facile ou sans RPE ; 2 : RPE 6 à 7 ; 3 : RPE 8 et plus. */
const levelOf = (rpe: number | undefined) => (rpe === undefined || rpe <= 5 ? 1 : rpe <= 7 ? 2 : 3);

export type Family = 'cardio' | 'gym' | 'charges' | 'autre';

const CARDIO = new Set(['Run', 'Rowing', 'SkiErg', 'BikeErg', 'Assault bike', 'Single under', 'Double under']);
const LOADED = new Set([
  'Wall ball',
  'Kettlebell swing',
  'Thruster',
  'Deadlift',
  'Clean',
  'Clean and jerk',
  'Snatch',
  'Strict press',
  'Bench press',
  'Front squat',
  'Back squat',
  'Sandbag lunges',
  'Farmers carry',
  'Sled push',
  'Sled pull',
]);

/** Famille d'un mouvement : avec une charge, c'est « charges » ; à la distance ou aux calories, « cardio ». */
export function familyOf(movement: Movement): Exclude<Family, 'autre'> {
  const name = canonicalName(movement.name);
  if (movement.load_kg !== undefined || LOADED.has(name)) return 'charges';
  if (CARDIO.has(name) || movement.distance_m !== undefined || movement.calories !== undefined) return 'cardio';
  return 'gym';
}

/** Valeur d'un score pour la mini-courbe : plus grand = meilleur. */
export function performance(wod: Wod, score: Score): number {
  // Une séance en blocs n'a pas de score unique : pas de courbe.
  if ('blocks' in score) return 0;
  if ('exercises' in score) return wod.type === 'strength' ? volume(wod, score) : 0;
  if ('rounds' in score) {
    const perRound = wod.type === 'amrap' ? repsPerRound(wod.movements) : undefined;
    return score.rounds * (perRound ?? 1000) + score.extra_reps;
  }
  if ('intervals_completed' in score) return score.intervals_completed;
  if ('time_sec' in score) return -score.time_sec;
  // Arrêté avant la fin : derrière tout temps réalisé.
  return ('reps_completed' in score ? score.reps_completed : score.segments_completed) - 1e6;
}

export interface Repeated {
  title: string;
  wodId?: string;
  count: number;
  first: Result;
  last: Result;
  /** Positif si la dernière séance est meilleure que la première. */
  trend: number;
  /** Hauteurs de 0 à 1 des dernières séances, de la plus ancienne à la plus récente. */
  spark: number[];
  record?: Result;
}

export interface Dashboard {
  from: string;
  week: { sessions: number; planned: number; plannedDone: number; effortSec: number; rpe?: number; streak: number };
  /** Une colonne par semaine, du lundi au dimanche ; null pour un jour à venir. */
  heatmap: { monday: string; days: (number | null)[] }[];
  loads: { monday: string; load: number }[];
  /** 7 derniers jours comparés à la moyenne hebdomadaire des 4 semaines d'avant, en %, si elles sont assez remplies. */
  loadChange?: number;
  kinds: { label: string; count: number; sport?: Sport }[];
  families: Record<Family, number>;
  repeated: Repeated[];
  hyrox?: { runPace?: number; previousRunPace?: number; slowest?: { name: string; sec: number } };
  sports: { sport: Sport; label: string; count: number; distanceM: number; durationSec: number; withDistance: { sec: number; m: number } }[];
  records: Result[];
  missingRpe: number;
}

export interface DashboardInput {
  results: Result[];
  activities: Activity[];
  plan: PlanEntry[];
  today: string;
  weeks: number;
  /** Séances qui détiennent un record. */
  records: Set<string>;
}

const average = (values: number[]) => (values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length);
const between = (date: string, from: string, to: string) => date >= from && date <= to;

/** Allure de course moyenne (s/km) et temps moyen par station, sur des Hyrox chronométrés segment par segment. */
function hyroxSplits(results: Result[]) {
  let runSec = 0;
  let runM = 0;
  const stations = new Map<string, number[]>();
  for (const { wod, score } of results) {
    if (wod.type !== 'hyrox' || !('splits_sec' in score) || !score.splits_sec) continue;
    score.splits_sec.forEach((sec, i) => {
      const segment = wod.segments[i];
      if (!segment || isRest(segment)) return;
      const name = canonicalName(segment.name);
      if (name === 'Run' && segment.distance_m) {
        runSec += sec;
        runM += segment.distance_m;
      } else if (name !== 'Run') {
        stations.set(name, [...(stations.get(name) ?? []), sec]);
      }
    });
  }
  return { pace: runM > 0 ? runSec / (runM / 1000) : undefined, stations };
}

export function dashboard({ results, activities, plan, today, weeks, records }: DashboardInput): Dashboard {
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  const from = addDays(monday, -7 * (weeks - 1));
  const all = sessionsOf(results, activities);
  const inPeriod = all.filter((session) => between(session.date, from, today));
  const periodResults = results.filter((result) => between(result.date, from, today));
  const periodActivities = activities.filter((activity) => between(activity.date, from, today));

  // Cette semaine et la série de semaines régulières.
  const thisWeek = all.filter((session) => between(session.date, monday, sunday));
  const weekPlan = plan.filter((entry) => between(entry.date, monday, sunday));
  const perWeek = new Map<string, number>();
  for (const session of all) perWeek.set(mondayOf(session.date), (perWeek.get(mondayOf(session.date)) ?? 0) + 1);
  // La semaine en cours ne casse pas la série tant qu'elle n'est pas finie.
  let cursor = (perWeek.get(monday) ?? 0) >= STREAK_MIN ? monday : addDays(monday, -7);
  let streak = 0;
  while ((perWeek.get(cursor) ?? 0) >= STREAK_MIN) {
    streak++;
    cursor = addDays(cursor, -7);
  }
  const rpes = thisWeek.flatMap((session) => (session.rpe === undefined ? [] : [session.rpe]));

  // Régularité : le niveau le plus dur de chaque jour.
  const levels = new Map<string, number>();
  for (const session of inPeriod) levels.set(session.date, Math.max(levels.get(session.date) ?? 0, levelOf(session.rpe)));
  const mondays = Array.from({ length: weeks }, (_, i) => addDays(from, 7 * i));
  const heatmap = mondays.map((start) => ({
    monday: start,
    days: Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, d);
      return date > today ? null : (levels.get(date) ?? 0);
    }),
  }));

  // Charge par semaine, et les 7 derniers jours face aux 4 semaines d'avant.
  const loadBetween = (start: string, end: string) =>
    all.filter((session) => between(session.date, start, end)).reduce((sum, session) => sum + sessionLoad(session), 0);
  const loads = mondays.map((start) => ({ monday: start, load: loadBetween(start, addDays(start, 6)) }));
  const recent = loadBetween(addDays(today, -6), today);
  const baseline = [1, 2, 3, 4].map((n) => loadBetween(addDays(today, -6 - 7 * n), addDays(today, -7 * n)));
  const before = baseline.reduce((sum, load) => sum + load, 0) / baseline.length;
  // Sans historique régulier (débuts dans l'appli, reprise), l'écart ne voudrait rien dire.
  const loadChange =
    baseline.filter((load) => load > 0).length >= BASELINE_WEEKS ? Math.round((recent / before - 1) * 100) : undefined;

  // Répartition : types de WOD et sports, puis familles de mouvements.
  const kinds = new Map<string, { label: string; count: number; sport?: Sport }>();
  for (const { wod } of periodResults) {
    // Une séance en blocs compte pour chacun de ses formats (force et AMRAP, par exemple).
    for (const type of new Set(blocksOf(wod).map((block) => block.type))) {
      const entry = kinds.get(type) ?? { label: typeLabel(type), count: 0 };
      kinds.set(type, { ...entry, count: entry.count + 1 });
    }
  }
  for (const activity of periodActivities) {
    const label = activityName(activity);
    const key = `${activity.sport}:${label}`;
    const entry = kinds.get(key) ?? { label, count: 0, sport: activity.sport };
    kinds.set(key, { ...entry, count: entry.count + 1 });
  }
  const families: Record<Family, number> = { cardio: 0, gym: 0, charges: 0, autre: 0 };
  let counted = 0;
  for (const { wod } of periodResults) {
    const movements = allMovements(wod).filter((movement) => !isRest(movement));
    if (movements.length === 0) continue;
    counted++;
    for (const movement of movements) families[familyOf(movement)] += 1 / movements.length;
  }
  for (const activity of periodActivities) {
    counted++;
    families[activity.sport === 'other' ? 'autre' : 'cardio'] += 1;
  }
  for (const key of Object.keys(families) as Family[]) families[key] = counted === 0 ? 0 : families[key] / counted;

  // WOD refaits : au moins deux séances, dont une sur la période.
  const groups = new Map<string, Result[]>();
  for (const result of [...results].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = workKey(result.wod);
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  const repeated: Repeated[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last || group.length < 2 || last.date < from) continue;
    const values = group.slice(-SPARK_MAX).map((result) => performance(result.wod, result.score));
    const low = Math.min(...values);
    const high = Math.max(...values);
    repeated.push({
      title: last.wod.title,
      wodId: last.wod_id,
      count: group.length,
      first,
      last,
      trend: compareScores(last.score, first.score, [last.wod, first.wod]),
      spark: values.map((value) => (high === low ? 0.5 : (value - low) / (high - low))),
      record: group.find((result) => records.has(result.id)),
    });
  }
  repeated.sort((a, b) => b.last.date.localeCompare(a.last.date));

  // Hyrox : allure de course sur la période, comparée à la période d'avant, et station la plus longue.
  const current = hyroxSplits(periodResults);
  const previous = hyroxSplits(results.filter((result) => between(result.date, addDays(from, -7 * weeks), addDays(from, -1))));
  const slowest = [...current.stations]
    .map(([name, splits]) => ({ name, sec: average(splits) ?? 0 }))
    .sort((a, b) => b.sec - a.sec)[0];
  const hyrox = current.pace !== undefined || slowest ? { runPace: current.pace, previousRunPace: previous.pace, slowest } : undefined;

  // Autres sports.
  const sports = new Map<string, Dashboard['sports'][number]>();
  for (const activity of periodActivities) {
    const label = activityName(activity);
    const key = `${activity.sport}:${label}`;
    const entry = sports.get(key) ?? { sport: activity.sport, label, count: 0, distanceM: 0, durationSec: 0, withDistance: { sec: 0, m: 0 } };
    entry.count++;
    entry.durationSec += activity.duration_sec;
    if (activity.distance_m) {
      entry.distanceM += activity.distance_m;
      entry.withDistance = { sec: entry.withDistance.sec + activity.duration_sec, m: entry.withDistance.m + activity.distance_m };
    }
    sports.set(key, entry);
  }

  return {
    from,
    week: {
      sessions: thisWeek.length,
      planned: weekPlan.length,
      plannedDone: weekPlan.filter((entry) => entry.result_id !== undefined).length,
      effortSec: thisWeek.reduce((sum, session) => sum + (session.durationSec ?? 0), 0),
      rpe: average(rpes),
      streak,
    },
    heatmap,
    loads,
    loadChange,
    kinds: [...kinds.values()].sort((a, b) => b.count - a.count),
    families,
    repeated: repeated.slice(0, REPEATED_MAX),
    hyrox,
    sports: [...sports.values()].sort((a, b) => b.count - a.count),
    records: periodResults.filter((result) => records.has(result.id)).sort((a, b) => b.date.localeCompare(a.date)),
    missingRpe: inPeriod.filter((session) => session.rpe === undefined && session.durationSec !== undefined).length,
  };
}
