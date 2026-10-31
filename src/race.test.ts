import { describe, expect, it } from 'vitest';
import { clock } from './format';
import { goalStatus, goalSummary } from './goals';
import { isFullRace, nextHyrox, predictTime, raceDetails, raceName, racePace, racePlan, raceSegments, raceTargets, segmentTargets } from './race';
import type { Activity, EnduranceRace, Goal, HyroxRace, HyroxWod, Result } from './types';
import { validateGoal } from './validate';

const race: HyroxRace = { id: 'paris', kind: 'race', race: 'hyrox', created: '2026-10-01', date: '2027-03-14', name: 'Hyrox Paris', division: 'open_men', target_sec: 5400 };
const full: HyroxWod = { schema_version: 1, type: 'hyrox', title: 'Simulation', segments: raceSegments() };

describe('plan de course Hyrox', () => {
  it('répartit le temps visé : la somme des segments refait exactement le total', () => {
    expect(Math.round(racePlan(5400).runPerKm)).toBe(371);
    for (const total of [5400, 4987, 7213]) expect(raceTargets(total).reduce((sum, sec) => sum + sec, 0)).toBe(total);
    // Une course complète suit le plan, même avec un repos au milieu.
    const withRest = [...raceSegments().slice(0, 2), { name: 'Repos', duration_sec: 60 }, ...raceSegments().slice(2)];
    expect(segmentTargets(withRest, 5400)).toEqual([...raceTargets(5400).slice(0, 2), 60, ...raceTargets(5400).slice(2)]);
  });

  it('demi-simulation : au prorata des distances et des reps ; segment inconnu sans objectif', () => {
    const plan = racePlan(5400);
    const targets = segmentTargets(
      [
        { name: 'course', distance_m: 500 },
        { name: 'sled push', distance_m: 25, load_kg: 152 },
        { name: 'Repos', duration_sec: 60 },
        { name: 'Wall ball', reps: 50, load_kg: 6 },
        { name: 'Burpee', reps: 20 },
      ],
      5400,
    );
    const half = (station: string) => Math.round((plan.stations.get(station) ?? 0) / 2);
    expect(targets).toEqual([Math.round(plan.runPerKm / 2), half('Sled push'), 60, half('Wall ball'), null]);
  });

  it('reconnaît une course complète, repos compris, et pas une demi', () => {
    expect(isFullRace(full)).toBe(true);
    expect(isFullRace({ ...full, segments: [...full.segments.slice(0, 4), { name: 'Repos', duration_sec: 60 }, ...full.segments.slice(4)] })).toBe(true);
    expect(isFullRace({ ...full, segments: full.segments.slice(0, 8) })).toBe(false);
  });

  it('prochaine course Hyrox : la plus proche à venir', () => {
    const past: Goal = { ...race, id: 'old', date: '2026-09-01' };
    const later: Goal = { ...race, id: 'later', date: '2027-06-01' };
    const semi: Goal = { id: 'semi', kind: 'race', race: 'run', created: '2026-10-01', date: '2026-12-01', distance_m: 21_097.5 };
    expect(nextHyrox([later, past, semi, race], '2026-10-31')?.id).toBe('paris');
    expect(nextHyrox([past, semi], '2026-10-31')).toBeUndefined();
  });
});

describe('objectif de course', () => {
  const done = (id: string, date: string, time_sec: number, wod: HyroxWod = full, rx = true): Result => ({ id, date, wod, score: { finished: true, time_sec, rx } });

  it('meilleur temps sur une course complète en Rx, et la dernière', () => {
    const history = [done('b', '2026-11-20', 5600), done('half', '2026-11-10', 2500, { ...full, segments: full.segments.slice(0, 8) }), done('a', '2026-10-20', 5520)];
    expect(goalStatus(race, history)).toMatchObject({
      title: 'Hyrox Paris sous 1:30:00',
      current: 'meilleure course complète 1:32:00',
      remaining: 'encore 2:00 à gagner',
      hint: 'dernière : 1:33:20 le 20 nov.',
    });
    expect(goalStatus(race, [done('c', '2027-03-14', 5380), ...history]).achievedOn).toBe('2027-03-14');
    expect(goalStatus(race, [])).toMatchObject({ progress: 0, current: 'pas encore de course complète' });
    expect(goalSummary(goalStatus(race, history)).goal).toBe('Hyrox Paris sous 1:30:00 (Hyrox Open homme)');
  });

  it('une course demande sa date, sa catégorie et un temps', () => {
    const { date: _, ...undated } = race;
    expect(validateGoal(undated)).toEqual({ ok: false, errors: ['date : champ manquant : la date de la course'] });
    expect(validateGoal({ ...race, division: 'elite' }).ok).toBe(false);
    expect(validateGoal(race)).toEqual({ ok: true, value: race });
  });
});

describe('courses d’endurance', () => {
  const semi: Goal = { id: 'semi', kind: 'race', race: 'run', created: '2026-10-01', date: '2027-04-05', distance_m: 21_097.5, target_sec: 6300 };
  const run = (id: string, date: string, km: number, duration_sec: number): Activity => ({ id, date, sport: 'run', distance_m: km * 1000, duration_sec });
  const today = '2026-11-15';

  it('nom, détails et allure visée', () => {
    expect(goalStatus(semi, [], [], today).title).toBe('Semi-marathon sous 1:45:00');
    expect(raceDetails(semi as EnduranceRace)).toBe('Course à pied · 21,1 km');
    expect(racePace(semi as EnduranceRace)).toBe('4:59 /km');
    const trail: EnduranceRace = { id: 't', kind: 'race', race: 'trail', created: '2026-10-01', date: '2027-06-01', distance_m: 42_000, elevation_m: 2500 };
    expect(raceName(trail)).toBe('Trail 42 km');
    expect(raceDetails(trail)).toBe('Trail · 42 km · 2 500 m D+');
    expect(raceName({ ...trail, race: 'run', distance_m: 10_000 })).toBe('10 km');
  });

  it('meilleur temps sur la distance, et prédiction d’après les sorties récentes', () => {
    const activities = [run('long', '2026-09-01', 21.3, 6480), run('ten', '2026-11-08', 10, 2880), run('short', '2026-11-10', 2, 500)];
    const status = goalStatus(semi, [], activities, today);
    // 1:48:00 sur 21,3 km, ramené à 21,1 km ; la prédiction part du 10 km (le 2 km est trop court).
    expect(status.current).toBe('meilleur temps sur la distance 1:46:58');
    expect(status.remaining).toBe('encore 1:58 à gagner');
    expect(status.hint).toBe(`prédiction d’après tes sorties récentes : ${clock(Math.round(predictTime(2880, 10_000, 21_097.5)))}`);
    expect(status.achievedOn).toBeUndefined();
  });

  it('sans temps sur la distance : la prédiction sert de repère', () => {
    const status = goalStatus(semi, [], [run('ten', '2026-11-08', 10, 2880)], today);
    expect(status.current).toBe(`prédiction ${clock(Math.round(predictTime(2880, 10_000, 21_097.5)))}`);
    expect(status.progress).toBeCloseTo(6300 / predictTime(2880, 10_000, 21_097.5));
  });

  it('atteinte par la course elle-même, pas par un entraînement d’avant', () => {
    const training = run('train', '2027-03-01', 21.1, 6200);
    expect(goalStatus(semi, [], [training], today).achievedOn).toBeUndefined();
    expect(goalStatus(semi, [], [training, run('race', '2027-04-05', 21.2, 6290)], today).achievedOn).toBe('2027-04-05');
    expect(goalStatus(semi, [], [run('race', '2027-04-05', 21.2, 6400)], today).achievedOn).toBeUndefined();
  });

  it('finir un trail : la préparation se lit à la plus longue sortie récente', () => {
    const trail: Goal = { id: 't', kind: 'race', race: 'trail', created: '2026-10-01', date: '2027-06-01', distance_m: 42_000 };
    const status = goalStatus(trail, [], [run('a', '2026-11-01', 18, 7200), run('b', '2026-08-01', 30, 12000)], today);
    expect(status).toMatchObject({ title: 'Trail 42 km', current: 'plus longue sortie sur 8 semaines : 18 km', progress: 18 / 42 });
    expect(goalStatus(trail, [], [run('race', '2027-06-01', 42.5, 30000)], today).achievedOn).toBe('2027-06-01');
  });

  it('un triathlon se coche à la main', () => {
    const tri: Goal = { id: 'tri', kind: 'race', race: 'triathlon', created: '2026-10-01', date: '2027-06-20' };
    expect(goalStatus(tri, [], [], today)).toEqual({ goal: tri, title: 'Triathlon' });
    expect(goalStatus({ ...tri, done_on: '2027-06-20' }, [], [], today).achievedOn).toBe('2027-06-20');
  });

  it('validation : type et champs propres à chaque course ; une ancienne course sans type est un Hyrox', () => {
    const { race: _, ...old } = race;
    expect(validateGoal(old)).toEqual({ ok: true, value: race });
    expect(validateGoal({ ...semi, division: 'open_men' })).toEqual({ ok: false, errors: ['division : seulement pour une course Hyrox'] });
    expect(validateGoal({ ...race, distance_m: 8000 })).toEqual({ ok: false, errors: ['distance_m : pas pour une course Hyrox'] });
    expect(validateGoal({ ...semi, race: 'ultra' }).ok).toBe(false);
    expect(validateGoal({ id: 'x', kind: 'race', race: 'other', created: '2026-10-01', date: '2027-01-01' })).toMatchObject({ ok: true });
    expect(goalSummary(goalStatus(semi, [], [], today)).goal).toBe('Semi-marathon sous 1:45:00 (Course à pied · 21,1 km)');
  });
});
