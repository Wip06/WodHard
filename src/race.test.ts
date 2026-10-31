import { describe, expect, it } from 'vitest';
import { goalStatus, goalSummary } from './goals';
import { isFullRace, nextRace, racePlan, raceSegments, raceTargets, segmentTargets } from './race';
import type { Goal, HyroxWod, RaceGoal, Result } from './types';
import { validateGoal } from './validate';

const race: RaceGoal = { id: 'paris', kind: 'race', created: '2026-10-01', date: '2027-03-14', name: 'Hyrox Paris', division: 'open_men', target_sec: 5400 };
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

  it('prochaine course : la plus proche à venir', () => {
    const past: Goal = { ...race, id: 'old', date: '2026-09-01' };
    const later: Goal = { ...race, id: 'later', date: '2027-06-01' };
    expect(nextRace([later, past, race], '2026-10-31')?.id).toBe('paris');
    expect(nextRace([past], '2026-10-31')).toBeUndefined();
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
