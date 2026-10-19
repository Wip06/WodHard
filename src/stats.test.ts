import { describe, expect, it } from 'vitest';
import { dashboard, familyOf, resultDuration, sessionLoad, type DashboardInput } from './stats';
import type { Activity, AmrapWod, EmomWod, ForTimeWod, HyroxWod, Result, Score, Wod } from './types';

const fran: ForTimeWod = {
  schema_version: 1,
  type: 'for_time',
  title: 'Fran',
  time_cap_sec: 600,
  rounds: 3,
  rep_scheme: [21, 15, 9],
  movements: [{ name: 'Thruster', load_kg: 43 }, { name: 'Pull-up' }],
};
const cindy: AmrapWod = {
  schema_version: 1,
  type: 'amrap',
  title: 'Cindy',
  duration_sec: 1200,
  movements: [
    { name: 'Pull-up', reps: 5 },
    { name: 'Push-up', reps: 10 },
    { name: 'Air squat', reps: 15 },
  ],
};
const emom: EmomWod = { schema_version: 1, type: 'emom', title: 'EMOM', interval_sec: 60, intervals: 10, slots: [[{ name: 'Burpee', reps: 10 }]] };
const hyrox: HyroxWod = {
  schema_version: 1,
  type: 'hyrox',
  title: 'Mini Hyrox',
  time_cap_sec: 3600,
  segments: [
    { name: 'Run', distance_m: 1000 },
    { name: 'SkiErg', distance_m: 1000 },
    { name: 'Run', distance_m: 1000 },
    { name: 'Wall ball', reps: 100, load_kg: 6 },
  ],
};

let seq = 0;
const done = (date: string, wod: Wod, score: Score): Result => ({ id: `r${++seq}`, wod_id: wod.title, date, wod, score });
const time = (time_sec: number, rpe?: number): Score => ({ finished: true, time_sec, rx: true, ...(rpe && { rpe }) });
const run = (date: string, duration_sec: number, distance_m?: number, rpe?: number): Activity => ({
  id: `a${++seq}`,
  date,
  sport: 'run',
  duration_sec,
  ...(distance_m && { distance_m }),
  ...(rpe && { rpe }),
});

// Mercredi 21 octobre 2026 : la semaine commence le lundi 19.
const TODAY = '2026-10-21';
const input = (over: Partial<DashboardInput>): DashboardInput => ({
  results: [],
  activities: [],
  plan: [],
  today: TODAY,
  weeks: 4,
  records: new Set(),
  ...over,
});

describe('durée et charge', () => {
  it('prend la durée réelle, ou celle prévue par le WOD', () => {
    expect(resultDuration(done(TODAY, cindy, { rounds: 10, extra_reps: 0, rx: true }))).toBe(1200);
    expect(resultDuration(done(TODAY, emom, { intervals_completed: 8, rx: true }))).toBe(600);
    expect(resultDuration(done(TODAY, fran, time(300)))).toBe(300);
    expect(resultDuration(done(TODAY, fran, { finished: false, reps_completed: 80, rx: true }))).toBe(600);
    expect(resultDuration(done(TODAY, hyrox, { finished: false, segments_completed: 2, splits_sec: [300, 330], rx: true }))).toBe(630);
  });

  it('charge = minutes × RPE, avec un RPE de 5 quand il manque', () => {
    expect(sessionLoad({ date: TODAY, durationSec: 1200, rpe: 8 })).toBe(160);
    expect(sessionLoad({ date: TODAY, durationSec: 1200 })).toBe(100);
    expect(sessionLoad({ date: TODAY })).toBe(0);
  });
});

describe('tableau de bord', () => {
  it('résume la semaine : séances, programme, temps d’effort, RPE moyen', () => {
    const d = dashboard(
      input({
        results: [done('2026-10-19', fran, time(300, 8)), done('2026-10-18', cindy, { rounds: 10, extra_reps: 0, rx: true })],
        activities: [run('2026-10-20', 3000, 10_000, 6)],
        plan: [
          { id: 'p1', date: '2026-10-19', wod_id: 'Fran', result_id: 'r1' },
          { id: 'p2', date: '2026-10-23', wod_id: 'Cindy' },
        ],
      }),
    );
    expect(d.week).toMatchObject({ sessions: 2, planned: 2, plannedDone: 1, effortSec: 3300, rpe: 7 });
  });

  it('compte la série de semaines à 3 séances, sans que la semaine en cours la casse', () => {
    const three = (monday: string) => [0, 2, 4].map((d) => run(addDay(monday, d), 1800));
    const activities = [...three('2026-10-05'), ...three('2026-10-12'), run('2026-10-19', 1800)];
    expect(dashboard(input({ activities })).week.streak).toBe(2);
    expect(dashboard(input({ activities: [...activities, run('2026-10-20', 1800), run('2026-10-21', 1800)] })).week.streak).toBe(3);
  });

  it('dessine la régularité semaine par semaine, sans les jours à venir', () => {
    const d = dashboard(input({ activities: [run('2026-10-20', 1800, undefined, 9), run('2026-10-20', 600, undefined, 4)] }));
    expect(d.heatmap).toHaveLength(4);
    expect(d.heatmap[0]?.monday).toBe('2026-09-28');
    expect(d.heatmap[3]?.days).toEqual([0, 3, 0, null, null, null, null]);
  });

  it('compare la charge des 7 derniers jours aux 4 semaines d’avant', () => {
    const before = ['2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11'].map((date) => run(date, 3600, undefined, 5));
    const d = dashboard(input({ activities: [...before, run('2026-10-19', 3600, undefined, 5), run('2026-10-20', 1800, undefined, 5)] }));
    expect(d.loadChange).toBe(50);
    expect(d.loads.map((week) => week.load)).toEqual([300, 300, 0, 450]);
    // Moins de 3 semaines actives avant : pas de comparaison.
    const sparse = dashboard(input({ activities: [run('2026-10-11', 600, undefined, 5), run('2026-10-20', 3600, undefined, 9)] }));
    expect(sparse.loadChange).toBeUndefined();
  });

  it('répartit les types, les sports et les familles de mouvements', () => {
    const d = dashboard(input({ results: [done('2026-10-19', fran, time(300)), done('2026-10-20', cindy, { rounds: 5, extra_reps: 0, rx: true })], activities: [run('2026-10-21', 1800)] }));
    expect(d.kinds).toEqual([
      { label: 'For Time', count: 1 },
      { label: 'AMRAP', count: 1 },
      { label: 'Course à pied', count: 1, sport: 'run' },
    ]);
    // Fran : moitié charges, moitié gym ; Cindy : gym ; la course : cardio.
    expect(d.families.cardio).toBeCloseTo(1 / 3);
    expect(d.families.gym).toBeCloseTo(0.5);
    expect(d.families.charges).toBeCloseTo(1 / 6);
    expect(d.families.autre).toBe(0);
  });

  it('suit les WOD refaits : premier et dernier score, tendance, courbe et record', () => {
    const first = done('2026-09-01', fran, time(309));
    const middle = done('2026-10-01', fran, time(330));
    const last = done('2026-10-20', fran, time(288));
    const d = dashboard(input({ results: [last, first, middle, done('2026-10-20', cindy, { rounds: 5, extra_reps: 0, rx: true })], records: new Set([last.id]) }));
    expect(d.repeated).toHaveLength(1);
    expect(d.repeated[0]).toMatchObject({ title: 'Fran', count: 3, first, last, record: last });
    expect(d.repeated[0]?.trend).toBeGreaterThan(0);
    expect(d.repeated[0]?.spark).toEqual([0.5, 0, 1]);
    expect(d.records).toEqual([last]);
  });

  it('calcule l’allure de course Hyrox et la station la plus longue', () => {
    const now = done('2026-10-20', hyrox, { finished: true, time_sec: 1500, splits_sec: [290, 260, 310, 640], rx: true });
    const old = done('2026-09-10', hyrox, { finished: true, time_sec: 1600, splits_sec: [320, 270, 330, 680], rx: true });
    const d = dashboard(input({ results: [now, old] }));
    expect(d.hyrox).toEqual({ runPace: 300, previousRunPace: 325, slowest: { name: 'Wall ball', sec: 640 } });
  });

  it('additionne les autres sports, avec leur allure', () => {
    const d = dashboard(input({ activities: [run('2026-10-19', 3000, 10_000), run('2026-10-20', 1500, 5_000), run('2026-10-21', 1200)] }));
    expect(d.sports).toEqual([{ sport: 'run', label: 'Course à pied', count: 3, distanceM: 15_000, durationSec: 5700, withDistance: { sec: 4500, m: 15_000 } }]);
    expect(d.missingRpe).toBe(3);
  });
});

describe('familles de mouvements', () => {
  it('charge, cardio ou gym', () => {
    expect(familyOf({ name: 'Wall ball', reps: 20 })).toBe('charges');
    expect(familyOf({ name: 'Pull-up', reps: 5, load_kg: 10 })).toBe('charges');
    expect(familyOf({ name: 'rameur', calories: 15 })).toBe('cardio');
    expect(familyOf({ name: 'Burpee broad jumps', distance_m: 80 })).toBe('cardio');
    expect(familyOf({ name: 'Toes to bar', reps: 10 })).toBe('gym');
  });
});

function addDay(iso: string, days: number): string {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
