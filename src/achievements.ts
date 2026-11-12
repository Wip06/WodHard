import { addDays, clock, decimal, kg, mondayOf, plural, scoreLine, setText } from './format';
import { liftsOf, strengthParts } from './lifts';
import { canonicalName, isRest } from './movements';
import { isFullRace, predictTime, RUN_DISTANCES, STATIONS } from './race';
import { recordIds, workKey } from './records';
import { distanceText, SPORT_INFO } from './sports';
import { resultDuration, STREAK_MIN } from './stats';
import type { Activity, HyroxWod, Result, SingleScore, Sport } from './types';

/** Un record de la page Exploits : « 10 km — 47:12 », avec son détail, sa date et la page d'où il vient. */
export interface Achievement {
  label: string;
  value: string;
  detail?: string;
  date?: string;
  href?: string;
  /** Record battu (ou palier franchi) depuis moins de `NEW_DAYS` jours. */
  isNew?: boolean;
}

export interface AchievementGroup {
  title: string;
  items: Achievement[];
}

export interface AchievementInput {
  /** Séances, de la plus récente à la plus ancienne, comme `sortedResults`. */
  results: Result[];
  activities: Activity[];
  /** Jour de référence, pour le badge « Nouveau ». */
  today: string;
}

/** Un record ou un palier est « Nouveau » pendant ce nombre de jours. */
export const NEW_DAYS = 30;

/**
 * Une sortie compte pour une distance classique si elle la couvre, à 1 % près en dessous (arrondi de
 * la montre) et 3 % au plus au-dessus : au-delà, ce n'est plus le même effort.
 */
const CLASSIC_MIN = 0.99;
const CLASSIC_MAX = 1.03;
/** Une prédiction de course ne va pas au-delà de 4,5 fois la distance de la sortie dont elle part. */
const PREDICTION_REACH = 4.5;

/**
 * Distance minimale pour qu'une allure compte : sur une sortie trop courte, elle ne dit rien. La règle
 * n'est pas affichée, seule la sortie retenue l'est.
 */
const PACE_MIN_M: Partial<Record<Sport, number>> = { run: 3000, bike: 20_000, swim: 400, row: 2000, walk: 5000 };
/** Le nom du record d'allure porte son unité, celle de la valeur affichée. */
const PACE_LABEL: Partial<Record<Sport, string>> = {
  run: 'Meilleure allure au km',
  bike: 'Meilleure vitesse moyenne',
  swim: 'Meilleure allure aux 100 m',
  row: 'Meilleure allure aux 500 m',
  walk: 'Meilleure allure au km',
};
/** « Sortie » en course, à vélo et à pied ; « Séance » dans l'eau et au rameur. */
const outing = (sport: Sport) => (sport === 'swim' || sport === 'row' ? 'Séance' : 'Sortie');
/** Sports suivis, dans l'ordre des exploits ; l'Hyrox et les prédictions viennent après le vélo. */
const ACTIVITY_SPORTS: Sport[] = ['run', 'bike', 'swim', 'row', 'walk'];

const lowest = <T>(items: T[], value: (item: T) => number): T | undefined =>
  items.reduce<T | undefined>((best, item) => (best === undefined || value(item) < value(best) ? item : best), undefined);

const activityHref = (activity: Activity) => `#/activity/${activity.id}`;
const resultHref = (result: Result) => `#/history/${result.id}`;

/** « Nouveau » : établi dans les derniers jours, et meilleur qu'un résultat plus ancien. */
const freshness = (today: string) => (date: string, earlier: { date: string }[]) =>
  date >= addDays(today, -NEW_DAYS) && earlier.some((candidate) => candidate.date < date);

type Fresh = ReturnType<typeof freshness>;
type Distanced = Activity & { distance_m: number };

const withDistance = (activities: Activity[], sport: Sport) =>
  activities.filter((activity): activity is Distanced => activity.sport === sport && activity.distance_m !== undefined && activity.distance_m > 0);

/** Records d'un sport d'endurance : distances classiques (course), plus longue sortie, meilleure allure. */
function sportGroup(sport: Sport, activities: Activity[], fresh: Fresh): AchievementGroup | null {
  const done = withDistance(activities, sport);
  if (done.length === 0) return null;
  const info = SPORT_INFO[sport];
  const items: Achievement[] = [];

  if (sport === 'run') {
    for (const { label, meters } of RUN_DISTANCES) {
      const covering = done.filter((activity) => activity.distance_m >= meters * CLASSIC_MIN && activity.distance_m <= meters * CLASSIC_MAX);
      const best = lowest(covering, (activity) => activity.duration_sec);
      if (!best) continue;
      const pace = info.pace?.(best.duration_sec, best.distance_m);
      items.push({
        label,
        value: clock(best.duration_sec),
        detail: [pace, Math.abs(best.distance_m - meters) >= 50 ? `sortie de ${distanceText(best.distance_m, sport)}` : null].filter(Boolean).join(' · '),
        date: best.date,
        href: activityHref(best),
        isNew: fresh(best.date, covering),
      });
    }
  }

  const longest = lowest(done, (activity) => -activity.distance_m);
  if (longest) {
    items.push({
      label: `Plus longue ${outing(sport).toLowerCase()}`,
      value: distanceText(longest.distance_m, sport),
      detail: clock(longest.duration_sec),
      date: longest.date,
      href: activityHref(longest),
      isNew: fresh(longest.date, done),
    });
  }

  const minPace = PACE_MIN_M[sport];
  const paced = done.filter((activity) => minPace !== undefined && activity.distance_m >= minPace);
  const fastest = lowest(paced, (activity) => activity.duration_sec / activity.distance_m);
  if (fastest && info.pace) {
    items.push({
      label: PACE_LABEL[sport] ?? 'Meilleure allure',
      value: info.pace(fastest.duration_sec, fastest.distance_m),
      detail: `${outing(sport)} de ${distanceText(fastest.distance_m, sport)}`,
      date: fastest.date,
      href: activityHref(fastest),
      isNew: fresh(fastest.date, paced),
    });
  }
  return { title: info.label, items };
}

/** Les Hyrox d'une séance : le WOD lui-même, ou ses blocs Hyrox. */
function hyroxParts(results: Result[]): { result: Result; wod: HyroxWod; score: SingleScore }[] {
  return results.flatMap((result) => {
    const { wod, score } = result;
    if (wod.type === 'hyrox' && !('blocks' in score)) return [{ result, wod, score }];
    if (wod.type !== 'session' || !('blocks' in score)) return [];
    return wod.blocks.flatMap((block, i) => {
      const done = score.blocks[i];
      return block.type === 'hyrox' && done ? [{ result, wod: block, score: done }] : [];
    });
  });
}

interface Timed {
  result: Result;
  sec: number;
  date: string;
}

/** Meilleurs temps Hyrox : course complète, kilomètre, et chaque station à sa distance officielle. */
function hyroxBests(results: Result[]) {
  const parts = hyroxParts(results);
  const races: Timed[] = parts.flatMap(({ result, wod, score }) =>
    isFullRace(wod) && 'finished' in score && score.finished && 'time_sec' in score ? [{ result, sec: score.time_sec, date: result.date }] : [],
  );
  // Temps de chaque segment, relevés au chrono : un par segment fait, repos compris.
  const splits = parts.flatMap(({ result, wod, score }) => {
    const times = 'splits_sec' in score ? score.splits_sec : undefined;
    if (!times) return [];
    return times.flatMap((sec, i) => {
      const segment = wod.segments[i];
      return segment && !isRest(segment) ? [{ result, segment, name: canonicalName(segment.name), sec, date: result.date }] : [];
    });
  });
  const kms = splits.filter((split) => split.name === 'Run' && split.segment.distance_m === 1000);
  const stations = STATIONS.map((station) => {
    const times = splits.filter((split) => split.name === station.name && split.segment.distance_m === station.distance_m && split.segment.reps === station.reps);
    return { station, times, best: lowest(times, (split) => split.sec) };
  });
  return { races, race: lowest(races, (race) => race.sec), kms, km: lowest(kms, (split) => split.sec), stations };
}

function hyroxGroup(results: Result[], fresh: Fresh): AchievementGroup | null {
  const bests = hyroxBests(results);
  const items: Achievement[] = [];
  if (bests.race) {
    items.push({ label: 'Course complète', value: clock(bests.race.sec), date: bests.race.date, href: resultHref(bests.race.result), isNew: fresh(bests.race.date, bests.races) });
  }
  if (bests.km) {
    items.push({ label: 'Meilleur km de course', value: clock(bests.km.sec), date: bests.km.date, href: resultHref(bests.km.result), isNew: fresh(bests.km.date, bests.kms) });
  }
  for (const { station, times, best } of bests.stations) {
    if (!best) continue;
    items.push({
      label: station.name,
      value: clock(best.sec),
      detail: station.distance_m !== undefined ? distanceText(station.distance_m, 'row') : plural(station.reps ?? 0, 'rep'),
      date: best.date,
      href: resultHref(best.result),
      isNew: fresh(best.date, times),
    });
  }
  return items.length > 0 ? { title: 'Hyrox', items } : null;
}

/**
 * Prédictions : en course, les distances classiques d'après la sortie la plus performante ; en Hyrox,
 * la course idéale, somme du meilleur km × 8 et du record de chaque station.
 */
function predictionsGroup(results: Result[], activities: Activity[]): AchievementGroup | null {
  const items: Achievement[] = [];
  const runs = withDistance(activities, 'run').filter((activity) => activity.distance_m >= (PACE_MIN_M.run ?? 0));
  // La sortie la plus performante : celle qui annonce le meilleur temps sur 10 km.
  const reference = lowest(runs, (activity) => predictTime(activity.duration_sec, activity.distance_m, 10_000));
  if (reference) {
    for (const { label, meters } of RUN_DISTANCES) {
      if (meters > reference.distance_m * PREDICTION_REACH) continue;
      items.push({
        label,
        value: clock(Math.round(predictTime(reference.duration_sec, reference.distance_m, meters))),
        detail: `D’après ta sortie de ${distanceText(reference.distance_m, 'run')}`,
        date: reference.date,
        href: activityHref(reference),
      });
    }
  }

  const hyrox = hyroxBests(results);
  if (hyrox.km && hyrox.stations.every(({ best }) => best)) {
    const ideal = hyrox.km.sec * 8 + hyrox.stations.reduce((sum, { best }) => sum + (best?.sec ?? 0), 0);
    items.push({
      label: 'Hyrox idéal',
      value: clock(ideal),
      detail: ['Tes meilleurs segments additionnés', hyrox.race ? `record ${clock(hyrox.race.sec)}` : null].filter(Boolean).join(' · '),
    });
  }
  return items.length > 0 ? { title: 'Prédictions', items } : null;
}

/** La série la plus lourde de chaque exercice de force, avec le 1RM estimé. */
function liftsGroup(results: Result[], fresh: Fresh): AchievementGroup | null {
  const items = liftsOf(results).flatMap((lift): Achievement[] => {
    const href = `#/lift/${encodeURIComponent(lift.key)}`;
    const pair = lift.sessions.some((session) => session.loadCount === 2) ? 2 : undefined;
    const isNew = (date: string) => fresh(date, lift.sessions);
    if (lift.heaviest) {
      const { load, reps, date } = lift.heaviest;
      const estimate = lift.best && lift.best.oneRepMax > load ? `1RM estimé ${kg(Math.round(lift.best.oneRepMax))}` : undefined;
      return [{ label: lift.name, value: setText({ reps, load_kg: load }, pair), detail: estimate, date, href, isNew: isNew(date) }];
    }
    if (lift.mostReps) return [{ label: lift.name, value: plural(lift.mostReps.reps, 'rep'), date: lift.mostReps.date, href, isNew: isNew(lift.mostReps.date) }];
    if (lift.longestHold) return [{ label: lift.name, value: clock(lift.longestHold.seconds), date: lift.longestHold.date, href, isNew: isNew(lift.longestHold.date) }];
    return [];
  });
  return items.length > 0 ? { title: 'Charges', items } : null;
}

/** Le record de chaque WOD fait au moins deux fois, du plus récent au plus ancien. */
function wodGroup(results: Result[], fresh: Fresh): AchievementGroup | null {
  const records = recordIds([...results].reverse());
  const byWork = new Map<string, Result[]>();
  for (const result of results) byWork.set(workKey(result.wod), [...(byWork.get(workKey(result.wod)) ?? []), result]);
  const items = results
    .filter((result) => records.has(result.id))
    .map((result) => {
      const same = byWork.get(workKey(result.wod)) ?? [];
      return {
        label: result.wod.title,
        value: scoreLine(result.wod, result.score),
        detail: `${same.length} fois`,
        date: result.date,
        href: resultHref(result),
        isNew: fresh(result.date, same),
      };
    });
  return items.length > 0 ? { title: 'WOD', items } : null;
}

/** Meilleure série de semaines régulières, et semaine la plus remplie, WOD et autres sports confondus. */
function regularityGroup(results: Result[], activities: Activity[], fresh: Fresh): AchievementGroup | null {
  const perWeek = new Map<string, number>();
  for (const { date } of [...results, ...activities]) perWeek.set(mondayOf(date), (perWeek.get(mondayOf(date)) ?? 0) + 1);
  if (perWeek.size === 0) return null;
  const weeks = [...perWeek.keys()].sort();

  let best = { length: 0, end: '' };
  let run = 0;
  let previous = '';
  for (const monday of weeks) {
    const regular = (perWeek.get(monday) ?? 0) >= STREAK_MIN;
    const following = previous !== '' && addDays(previous, 7) === monday;
    run = regular ? (following && run > 0 ? run + 1 : 1) : 0;
    if (run > best.length) best = { length: run, end: monday };
    previous = monday;
  }
  const busiest = weeks.reduce((top, monday) => ((perWeek.get(monday) ?? 0) > (perWeek.get(top) ?? 0) ? monday : top));
  const earlierWeeks = weeks.map((date) => ({ date }));

  const items: Achievement[] = [];
  if (best.length > 0) {
    items.push({ label: 'Meilleure série', value: plural(best.length, 'semaine'), detail: `à ${STREAK_MIN} séances ou plus`, date: best.end, isNew: best.length > 1 && fresh(best.end, earlierWeeks) });
  }
  items.push({ label: 'Semaine la plus remplie', value: plural(perWeek.get(busiest) ?? 0, 'séance'), date: busiest, isNew: fresh(busiest, earlierWeeks) });
  return { title: 'Régularité', items };
}

/**
 * Les records de la page Exploits, groupés par thème : course, vélo, Hyrox, prédictions, puis les
 * autres sports, les charges, les WOD et la régularité. Un thème sans données n'apparaît pas. Les
 * objectifs et les jalons ont leur propre bloc sur la page.
 */
export function achievements({ results, activities, today }: AchievementInput): AchievementGroup[] {
  const fresh = freshness(today);
  const [run, bike, ...otherSports] = ACTIVITY_SPORTS.map((sport) => sportGroup(sport, activities, fresh));
  return [
    run,
    bike,
    hyroxGroup(results, fresh),
    predictionsGroup(results, activities),
    ...otherSports,
    liftsGroup(results, fresh),
    wodGroup(results, fresh),
    regularityGroup(results, activities, fresh),
  ].filter((group): group is AchievementGroup => group != null && group.items.length > 0);
}

/** Jalons : totaux cumulés, et paliers à franchir. */
export type MilestoneScope = 'year' | 'all';

interface Metric {
  label: string;
  steps: number[];
  format: (amount: number) => string;
  /** Ce que chaque séance ou activité ajoute au total, avec sa date. */
  events: { date: string; amount: number }[];
}

/** Tonnage d'une séance de force : charge × répétitions de chaque série, les deux mains d'une paire comptées. */
function tonnage(result: Result): number {
  return strengthParts(result).reduce(
    (sum, [wod, score]) =>
      sum +
      score.exercises.reduce(
        (total, sets, i) => total + sets.reduce((setSum, set) => setSum + (set.reps ?? 0) * (set.load_kg ?? 0) * (wod.exercises[i]?.load_count ?? 1), 0),
        0,
      ),
    0,
  );
}

const km = (amount: number) => `${decimal(Math.floor(amount))} km`;

/**
 * Jalons : séances, kilomètres par sport, heures d'effort et tonnage, depuis le début ou cette année.
 * Pour chacun, le total, le dernier palier franchi (avec sa date) et le suivant. Un total nul
 * n'apparaît pas.
 */
export function milestones({ results, activities, today }: AchievementInput, scope: MilestoneScope): AchievementGroup | null {
  const since = scope === 'year' ? `${today.slice(0, 4)}-01-01` : '';
  const inScope = <T extends { date: string }>(items: T[]) => items.filter((item) => item.date >= since);
  const scopedResults = inScope(results);
  const scopedActivities = inScope(activities);
  const distance = (sport: Sport) => scopedActivities.filter((activity) => activity.sport === sport).map((activity) => ({ date: activity.date, amount: (activity.distance_m ?? 0) / 1000 }));
  const metrics: Metric[] = [
    {
      label: 'Séances',
      steps: [10, 25, 50, 100, 250, 500, 1000],
      format: (amount) => plural(amount, 'séance'),
      events: [...scopedResults, ...scopedActivities].map(({ date }) => ({ date, amount: 1 })),
    },
    { label: 'Course à pied', steps: [50, 100, 250, 500, 1000, 2500, 5000], format: km, events: distance('run') },
    { label: 'Vélo', steps: [100, 250, 500, 1000, 2500, 5000, 10_000], format: km, events: distance('bike') },
    { label: 'Natation', steps: [5, 10, 25, 50, 100, 250], format: km, events: distance('swim') },
    {
      label: 'Heures d’effort',
      steps: [10, 25, 50, 100, 250, 500, 1000],
      format: (amount) => `${decimal(Math.floor(amount))} h`,
      events: [
        ...scopedResults.map((result) => ({ date: result.date, amount: (resultDuration(result) ?? 0) / 3600 })),
        ...scopedActivities.map((activity) => ({ date: activity.date, amount: activity.duration_sec / 3600 })),
      ],
    },
    {
      label: 'Tonnage en force',
      steps: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
      format: (amount) => `${decimal(amount, 1)} t`,
      events: scopedResults.map((result) => ({ date: result.date, amount: tonnage(result) / 1000 })),
    },
  ];

  const recent = addDays(today, -NEW_DAYS);
  const items = metrics.flatMap((metric): Achievement[] => {
    const events = metric.events.filter((event) => event.amount > 0).sort((a, b) => a.date.localeCompare(b.date));
    let total = 0;
    let reached: { step: number; date: string } | undefined;
    for (const event of events) {
      total += event.amount;
      for (const step of metric.steps) if (total >= step && (!reached || step > reached.step)) reached = { step, date: event.date };
    }
    if (total <= 0) return [];
    const next = metric.steps.find((step) => step > total);
    const nextText = next === undefined ? null : `prochain : ${metric.format(next)}`;
    return [
      {
        label: metric.label,
        value: metric.format(total),
        detail: reached ? [`palier de ${metric.format(reached.step)} franchi`, nextText].filter(Boolean).join(' · ') : `premier palier : ${metric.format(metric.steps[0] ?? 0)}`,
        date: reached?.date,
        isNew: reached !== undefined && reached.date >= recent,
      },
    ];
  });
  return items.length > 0 ? { title: 'Jalons', items } : null;
}
