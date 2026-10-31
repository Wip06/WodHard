import { canonicalName, isRest } from './movements';
import { distanceText, SPORT_INFO } from './sports';
import type { Division, EnduranceRace, Goal, HyroxRace, Movement, RaceGoal, RaceType, Sport, Wod } from './types';

/** Types de course, et le sport des activités qui s'y rapportent. */
export const RACE_TYPES: Record<RaceType, { label: string; sport?: Sport }> = {
  hyrox: { label: 'Hyrox' },
  run: { label: 'Course à pied', sport: 'run' },
  trail: { label: 'Trail', sport: 'run' },
  bike: { label: 'Vélo', sport: 'bike' },
  swim: { label: 'Natation', sport: 'swim' },
  triathlon: { label: 'Triathlon' },
  other: { label: 'Autre course' },
};

/** Distances classiques de course à pied, en mètres. */
export const RUN_DISTANCES: { label: string; meters: number }[] = [
  { label: '5 km', meters: 5000 },
  { label: '10 km', meters: 10_000 },
  { label: 'Semi', meters: 21_097.5 },
  { label: 'Marathon', meters: 42_195 },
];

/** Distance lisible : « 10 km », « 1 500 m » à la nage. */
const raceDistance = (goal: EnduranceRace) =>
  goal.distance_m === undefined ? '' : distanceText(goal.distance_m, RACE_TYPES[goal.race].sport ?? 'run');

/** Nom par défaut : « Course Hyrox », « Semi-marathon », « 10 km », « Trail 42 km », « Vélo 90 km ». */
export function raceName(goal: RaceGoal): string {
  if (goal.name) return goal.name;
  if (goal.race === 'hyrox') return 'Course Hyrox';
  if (goal.race === 'run' && goal.distance_m === 21_097.5) return 'Semi-marathon';
  if (goal.race === 'run' && goal.distance_m === 42_195) return 'Marathon';
  const distance = raceDistance(goal);
  if (goal.race === 'run') return distance || 'Course à pied';
  if (goal.race === 'triathlon' || goal.race === 'other') return RACE_TYPES[goal.race].label;
  return distance ? `${RACE_TYPES[goal.race].label} ${distance}` : RACE_TYPES[goal.race].label;
}

/** « Hyrox Open homme », « Course à pied · 21,1 km », « Trail · 42 km · 2 500 m D+ ». */
export function raceDetails(goal: RaceGoal): string {
  if (goal.race === 'hyrox') return `Hyrox ${DIVISIONS[goal.division]}`;
  const parts = [RACE_TYPES[goal.race].label, raceDistance(goal), goal.elevation_m !== undefined && `${Math.round(goal.elevation_m).toLocaleString('fr-FR')} m D+`];
  return parts.filter(Boolean).join(' · ');
}

/** Allure (ou vitesse) visée : « 4:58 /km », « 30 km/h ». */
export function racePace(goal: RaceGoal): string | null {
  if (goal.race === 'hyrox' || goal.distance_m === undefined || goal.target_sec === undefined) return null;
  const sport = RACE_TYPES[goal.race].sport;
  const pace = sport && SPORT_INFO[sport].pace;
  return pace ? pace(goal.target_sec, goal.distance_m) : null;
}

/** Temps prévu sur `toM` d'après un temps sur `fromM` (formule de Riegel). */
export const predictTime = (sec: number, fromM: number, toM: number) => sec * (toM / fromM) ** 1.06;


export const DIVISIONS: Record<Division, string> = {
  open_women: 'Open femme',
  open_men: 'Open homme',
  pro_women: 'Pro femme',
  pro_men: 'Pro homme',
  doubles_women: 'Doubles femmes',
  doubles_men: 'Doubles hommes',
  doubles_mixed: 'Doubles mixte',
};

/**
 * Les 8 stations d'une course Hyrox, dans l'ordre, avec leur distance (ou leurs reps) en course
 * et leur part habituelle du temps passé en stations. Les charges dépendent de la catégorie et
 * de la saison : elles ne servent pas au plan.
 */
export const STATIONS: { name: string; distance_m?: number; reps?: number; share: number }[] = [
  { name: 'SkiErg', distance_m: 1000, share: 280 },
  { name: 'Sled push', distance_m: 50, share: 200 },
  { name: 'Sled pull', distance_m: 50, share: 250 },
  { name: 'Burpee broad jumps', distance_m: 80, share: 280 },
  { name: 'Rowing', distance_m: 1000, share: 290 },
  { name: 'Farmers carry', distance_m: 200, share: 120 },
  { name: 'Sandbag lunges', distance_m: 100, share: 260 },
  { name: 'Wall ball', reps: 100, share: 330 },
];
const RUNS = 8;
/** Part de la course à pied dans le temps total, transitions (Roxzone) comprises. */
const RUN_SHARE = 0.55;

/** Temps visé pour 1 km de course (transition comprise) et pour chaque station, en secondes. */
export interface RacePlan {
  runPerKm: number;
  stations: Map<string, number>;
}

export function racePlan(targetSec: number): RacePlan {
  const totalShare = STATIONS.reduce((sum, station) => sum + station.share, 0);
  const stationTime = targetSec * (1 - RUN_SHARE);
  return {
    runPerKm: (targetSec * RUN_SHARE) / RUNS,
    stations: new Map(STATIONS.map((station) => [station.name, (stationTime * station.share) / totalShare])),
  };
}

/** Les 16 segments d'une course : 1 km de course, puis une station, huit fois. */
export const raceSegments = (): Movement[] =>
  STATIONS.flatMap(({ name, distance_m, reps }) => [
    { name: 'Run', distance_m: 1000 },
    { name, ...(distance_m !== undefined ? { distance_m } : { reps }) },
  ]);

/**
 * Temps visé sur chacun des 16 segments d'une course, en secondes entières dont la somme fait
 * exactement le temps visé : les secondes perdues à l'arrondi vont aux plus grands restes.
 */
export function raceTargets(targetSec: number): number[] {
  const plan = racePlan(targetSec);
  const exact = raceSegments().map((segment) => (segment.name === 'Run' ? plan.runPerKm : (plan.stations.get(segment.name) ?? 0)));
  const targets = exact.map(Math.floor);
  let missing = targetSec - targets.reduce((sum, sec) => sum + sec, 0);
  const byRemainder = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (const { i } of byRemainder) {
    if (missing <= 0) break;
    targets[i] = (targets[i] ?? 0) + 1;
    missing--;
  }
  return targets;
}

/**
 * Objectif de chaque segment d'un Hyrox, pour un temps visé : une course complète suit le plan
 * de course ; sinon, une course au prorata de sa distance, une station au prorata de sa distance
 * (ou de ses reps). Un repos vaut sa durée ; null pour un segment que le plan ne connaît pas.
 */
export function segmentTargets(segments: Movement[], targetSec: number): (number | null)[] {
  if (isFullRace({ schema_version: 1, type: 'hyrox', title: '', segments })) {
    const official = raceTargets(targetSec);
    let next = 0;
    return segments.map((segment) => (isRest(segment) ? (segment.duration_sec ?? null) : (official[next++] ?? null)));
  }
  const plan = racePlan(targetSec);
  return segments.map((segment) => {
    if (isRest(segment)) return segment.duration_sec ?? null;
    const name = canonicalName(segment.name);
    if (name === 'Run') return segment.distance_m === undefined ? null : Math.round((plan.runPerKm * segment.distance_m) / 1000);
    const station = STATIONS.find((candidate) => candidate.name === name);
    const sec = plan.stations.get(name);
    if (!station || sec === undefined) return null;
    const ratio =
      station.distance_m !== undefined && segment.distance_m !== undefined
        ? segment.distance_m / station.distance_m
        : station.reps !== undefined && segment.reps !== undefined
          ? segment.reps / station.reps
          : null;
    return ratio === null ? null : Math.round(sec * ratio);
  });
}

/** Une course complète : 8 × 1 km et les 8 stations aux distances officielles, repos à part. */
export function isFullRace(wod: Wod): boolean {
  if (wod.type !== 'hyrox') return false;
  const segments = wod.segments.filter((segment) => !isRest(segment));
  const official = raceSegments();
  return (
    segments.length === official.length &&
    official.every((expected, i) => {
      const segment = segments[i];
      return (
        segment !== undefined &&
        canonicalName(segment.name) === expected.name &&
        segment.distance_m === expected.distance_m &&
        segment.reps === expected.reps
      );
    })
  );
}

/** La prochaine course Hyrox prévue : c'est son plan qui guide le chrono des simulations. */
export function nextHyrox(goals: readonly Goal[], today: string): HyroxRace | undefined {
  return goals
    .filter((goal): goal is HyroxRace => goal.kind === 'race' && goal.race === 'hyrox' && goal.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}
