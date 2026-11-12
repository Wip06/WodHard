import { describe, expect, it } from 'vitest';
import { achievements, milestones, type AchievementGroup } from '../src/achievements';
import { clock } from '../src/format';
import { predictTime, raceSegments } from '../src/race';
import type { Activity, AmrapWod, ForTimeWod, HyroxWod, Result, StrengthWod } from '../src/types';

const run = (id: string, date: string, km: number, sec: number): Activity => ({ id, date, sport: 'run', distance_m: km * 1000, duration_sec: sec });
const bike = (id: string, date: string, km: number, sec: number): Activity => ({ id, date, sport: 'bike', distance_m: km * 1000, duration_sec: sec });
const group = (groups: AchievementGroup[], title: string) => groups.find((candidate) => candidate.title === title);
const item = (groups: AchievementGroup[], title: string, label: string) => group(groups, title)?.items.find((candidate) => candidate.label === label);

const fran: ForTimeWod = { schema_version: 1, type: 'for_time', title: 'Fran', time_cap_sec: 600, rounds: 3, rep_scheme: [21, 15, 9], movements: [{ name: 'Thruster', load_kg: 43 }, { name: 'Pull-up' }] };
const cindy: AmrapWod = { schema_version: 1, type: 'amrap', title: 'Cindy', duration_sec: 1200, movements: [{ name: 'Pull-up', reps: 5 }, { name: 'Push-up', reps: 10 }, { name: 'Air squat', reps: 15 }] };
const squat: StrengthWod = { schema_version: 1, type: 'strength', title: 'Squat', exercises: [{ name: 'Back squat', sets: 1, reps: 5, load_kg: 100 }] };
const race: HyroxWod = { schema_version: 1, type: 'hyrox', title: 'Simulation', segments: raceSegments() };
const short: HyroxWod = { schema_version: 1, type: 'hyrox', title: 'Mini', segments: [{ name: 'Run', distance_m: 1000 }, { name: 'SkiErg', distance_m: 1000 }] };

// Séances de la plus récente à la plus ancienne, comme `sortedResults`.
const results: Result[] = [
  { id: 'mini', date: '2026-11-10', wod: short, score: { rx: true, finished: true, time_sec: 480, splits_sec: [250, 230] } },
  {
    id: 'race',
    date: '2026-11-05',
    wod: race,
    // 8 × (1 km en 300 s, puis la station) : SkiErg en 260 s.
    score: { rx: true, finished: true, time_sec: 5400, splits_sec: raceSegments().map((segment, i) => (segment.name === 'Run' ? 300 + i : segment.name === 'SkiErg' ? 260 : 200)) },
  },
  { id: 'fran2', date: '2026-11-04', wod: fran, score: { rx: true, finished: true, time_sec: 290 } },
  { id: 'squat', date: '2026-11-03', wod: squat, score: { rx: true, exercises: [[{ reps: 5, load_kg: 100 }]] } },
  { id: 'cindy', date: '2026-11-03', wod: cindy, score: { rx: true, rounds: 18, extra_reps: 0 } },
  { id: 'fran1', date: '2026-10-28', wod: fran, score: { rx: true, finished: true, time_sec: 320 } },
];

const activities: Activity[] = [
  run('r5', '2026-11-02', 5, 25 * 60),
  run('r5b', '2026-11-09', 5.1, 24 * 60 + 30),
  run('r53', '2026-11-11', 5.3, 24 * 60),
  run('r10', '2026-10-20', 10, 50 * 60),
  bike('b30', '2026-11-01', 30, 3600),
  bike('b15', '2026-11-08', 15, 20 * 60),
];

describe('exploits', () => {
  const today = '2026-11-12';
  const groups = achievements({ results, activities, today });

  it('range les thèmes dans l’ordre : course, vélo, Hyrox, prédictions, puis charges, WOD et régularité', () => {
    expect(groups.map((candidate) => candidate.title)).toEqual(['Course à pied', 'Vélo', 'Hyrox', 'Prédictions', 'Charges', 'WOD', 'Régularité']);
  });

  it('course : distance classique à 3 % près, plus longue sortie, meilleure allure sur 3 km ou plus', () => {
    // 5,1 km compte pour le 5 km, pas 5,3 km (6 % de plus).
    expect(item(groups, 'Course à pied', '5 km')).toMatchObject({ value: '24:30', detail: '4:48 /km · sortie de 5,1 km', date: '2026-11-09', href: '#/activity/r5b' });
    expect(item(groups, 'Course à pied', '10 km')).toMatchObject({ value: '50:00', detail: '5:00 /km' });
    expect(item(groups, 'Course à pied', 'Semi')).toBeUndefined();
    expect(item(groups, 'Course à pied', 'Plus longue sortie')).toMatchObject({ value: '10 km', detail: '50:00' });
    expect(item(groups, 'Course à pied', 'Meilleure allure au km')).toMatchObject({ value: '4:32 /km', detail: 'Sortie de 5,3 km' });
  });

  it('vélo : la vitesse moyenne ne compte que sur 20 km ou plus', () => {
    expect(item(groups, 'Vélo', 'Meilleure vitesse moyenne')).toMatchObject({ value: '30 km/h', href: '#/activity/b30' });
    expect(item(groups, 'Vélo', 'Plus longue sortie')).toMatchObject({ value: '30 km' });
  });

  it('Hyrox : course complète, meilleur km et meilleure station aux distances officielles', () => {
    expect(item(groups, 'Hyrox', 'Course complète')).toMatchObject({ value: '1:30:00', href: '#/history/race' });
    expect(item(groups, 'Hyrox', 'Meilleur km de course')).toMatchObject({ value: '4:10', date: '2026-11-10' });
    expect(item(groups, 'Hyrox', 'SkiErg')).toMatchObject({ value: '3:50', detail: '1\u202f000 m', href: '#/history/mini' });
    expect(item(groups, 'Hyrox', 'Wall ball')).toMatchObject({ value: '3:20', detail: '100 reps' });
  });

  it('charges : la série la plus lourde, avec le 1RM estimé', () => {
    expect(item(groups, 'Charges', 'Back squat')).toMatchObject({ value: '5 × 100 kg', detail: '1RM estimé 117 kg', date: '2026-11-03' });
  });

  it('WOD : le record des seuls WOD faits au moins deux fois', () => {
    expect(group(groups, 'WOD')?.items).toEqual([{ label: 'Fran', value: '4:50', detail: '2 fois', date: '2026-11-04', href: '#/history/fran2', isNew: true }]);
  });

  it('régularité : meilleure série de semaines à 3 séances ou plus, et semaine la plus remplie', () => {
    // Semaine du 2 nov. : 6 séances ; du 9 nov. : 3 ; du 26 oct. : 2 (le 1er nov. est un dimanche).
    expect(item(groups, 'Régularité', 'Meilleure série')).toMatchObject({ value: '2 semaines', date: '2026-11-09' });
    expect(item(groups, 'Régularité', 'Semaine la plus remplie')).toMatchObject({ value: '6 séances', date: '2026-11-02' });
  });

  it('« Nouveau » : un record battu ces 30 derniers jours, meilleur qu’un résultat plus ancien', () => {
    // Le 5 km du 9 nov. bat celui du 2 nov. ; le 10 km du 20 oct. est le seul, et il a plus de 30 jours.
    expect(item(groups, 'Course à pied', '5 km')?.isNew).toBe(true);
    expect(item(groups, 'Course à pied', '10 km')?.isNew).toBe(false);
    // Le premier back squat n'a rien battu.
    expect(item(groups, 'Charges', 'Back squat')?.isNew).toBe(false);
  });

  it('prédictions : distances classiques d’après la sortie la plus performante, sans aller au-delà de 4,5 fois sa distance', () => {
    // La sortie de 5,3 km en 24:00 annonce le meilleur 10 km ; 4,5 × 5,3 km couvre le semi, pas le marathon.
    const predicted = (meters: number) => clock(Math.round(predictTime(24 * 60, 5300, meters)));
    expect(item(groups, 'Prédictions', '10 km')).toMatchObject({ value: predicted(10_000), detail: 'D’après ta sortie de 5,3 km', href: '#/activity/r53' });
    expect(item(groups, 'Prédictions', 'Semi')).toMatchObject({ value: predicted(21_097.5) });
    expect(item(groups, 'Prédictions', 'Marathon')).toBeUndefined();
  });

  it('prédictions : l’Hyrox idéal additionne le meilleur km × 8 et le record de chaque station', () => {
    // 8 × 250 s, SkiErg en 230 s, les 7 autres stations en 200 s.
    expect(item(groups, 'Prédictions', 'Hyrox idéal')).toMatchObject({ value: clock(8 * 250 + 230 + 7 * 200), detail: 'Tes meilleurs segments additionnés · record 1:30:00' });
  });

  it('jalons : total, dernier palier franchi avec sa date, et le suivant', () => {
    const all = milestones({ results, activities, today }, 'all');
    // 12 séances : la 10ᵉ, le 9 nov., franchit le palier de 10.
    expect(all?.items.find((candidate) => candidate.label === 'Séances')).toEqual({
      label: 'Séances',
      value: '12 séances',
      detail: 'palier de 10 séances franchi · prochain : 25 séances',
      date: '2026-11-09',
      isNew: true,
    });
    // 25,4 km courus : pas encore de palier.
    expect(all?.items.find((candidate) => candidate.label === 'Course à pied')).toMatchObject({ value: '25 km', detail: 'premier palier : 50 km', date: undefined });
    // 500 kg soulevés au back squat.
    expect(all?.items.find((candidate) => candidate.label === 'Tonnage en force')).toMatchObject({ value: '0,5 t' });
  });

  it('jalons de l’année : seules les séances de l’année comptent', () => {
    expect(milestones({ results, activities, today: '2027-01-05' }, 'year')).toBeNull();
  });

  it('sans séance ni activité, aucun thème', () => {
    expect(achievements({ results: [], activities: [], today: '2026-11-12' })).toEqual([]);
    expect(milestones({ results: [], activities: [], today: '2026-11-12' }, 'all')).toBeNull();
  });
});
