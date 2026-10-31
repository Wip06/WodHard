import { describe, expect, it } from 'vitest';
import { deadlineText, goalStatus, goalSummary, goalTitle, newlyAchieved, sortGoals } from './goals';
import type { AmrapWod, ForTimeWod, Goal, LiftGoal, Result, StrengthWod } from './types';
import { validateBackup, validateGoal } from './validate';

const squat: StrengthWod = { schema_version: 1, type: 'strength', title: 'Squat', exercises: [{ name: 'Back squat', sets: 3, reps: 5, load_kg: 100 }] };
const fran: ForTimeWod = { schema_version: 1, type: 'for_time', title: 'Fran', time_cap_sec: 600, rounds: 3, rep_scheme: [21, 15, 9], movements: [{ name: 'Thruster', load_kg: 43 }, { name: 'Pull-up' }] };
const cindy: AmrapWod = { schema_version: 1, type: 'amrap', title: 'Cindy', duration_sec: 1200, movements: [{ name: 'Pull-up', reps: 5 }, { name: 'Push-up', reps: 10 }, { name: 'Air squat', reps: 15 }] };

/** Séances de la plus récente à la plus ancienne, comme `sortedResults`. */
const history: Result[] = [
  { id: 'c2', date: '2026-10-20', wod: cindy, score: { rounds: 18, extra_reps: 10, rx: true } },
  { id: 'f3', date: '2026-10-10', wod: fran, score: { finished: true, time_sec: 290, rx: false } },
  { id: 'f2', date: '2026-09-12', wod: fran, score: { finished: true, time_sec: 318, rx: true } },
  { id: 's2', date: '2026-09-05', wod: squat, score: { exercises: [[{ reps: 5, load_kg: 110 }, { reps: 3, load_kg: 120 }, { reps: 1, load_kg: 125 }]], rx: true } },
  { id: 's1', date: '2026-08-01', wod: squat, score: { exercises: [[{ reps: 5, load_kg: 100 }, { reps: 5, load_kg: 100 }, { reps: 5, load_kg: 100 }]], rx: true } },
];
const base = { id: 'g', created: '2026-10-01' };
const lift = (load_kg: number, reps: number): LiftGoal => ({ ...base, kind: 'lift', exercise: 'Back squat', load_kg, reps });

describe('objectifs : avancement', () => {
  it('charge : la meilleure série d’au moins autant de reps, et le jour où elle a été atteinte', () => {
    expect(goalStatus(lift(120, 5), history)).toMatchObject({ title: 'Back squat 5 × 120 kg', current: '5 × 110 kg', remaining: 'encore 10 kg', progress: 110 / 120 });
    expect(goalStatus(lift(120, 3), history)).toMatchObject({ achievedOn: '2026-09-05', progress: 1 });
    expect(goalStatus(lift(130, 1), history)).toMatchObject({ title: 'Back squat 130 kg', current: '125 kg', remaining: 'encore 5 kg' });
    expect(goalStatus({ ...lift(60, 1), exercise: 'Deadlift' }, history)).toMatchObject({ progress: 0, current: 'pas encore fait' });
  });

  it('temps à battre : seul le Rx compte', () => {
    const goal: Goal = { ...base, kind: 'wod', wod: fran, time_sec: 300 };
    // Le 4:50 était en scaled : le record Rx reste 5:18.
    expect(goalStatus(goal, history)).toMatchObject({ title: 'Fran sous 5:00', current: '5:18', remaining: 'encore 0:18 à gagner', progress: 300 / 318 });
    expect(goalStatus({ ...goal, time_sec: 320 }, history).achievedOn).toBe('2026-09-12');
  });

  it('AMRAP : compté en reps quand chaque tour se compte en reps', () => {
    const goal: Goal = { ...base, kind: 'wod', wod: cindy, rounds: 20 };
    expect(goalStatus(goal, history)).toMatchObject({ title: 'Cindy : 20 tours', current: '18 tours + 10 reps', remaining: 'encore 50 reps' });
  });

  it('libre : atteint quand il est coché', () => {
    const goal: Goal = { ...base, kind: 'free', title: '10 strict pull-ups' };
    expect(goalStatus(goal, history)).toEqual({ goal, title: '10 strict pull-ups' });
    expect(goalStatus({ ...goal, done_on: '2026-10-30' }, history).achievedOn).toBe('2026-10-30');
  });

  it('repère les objectifs atteints par une nouvelle séance', () => {
    const goals = [lift(120, 5), { ...lift(100, 5), id: 'easy' }];
    const after: Result[] = [{ id: 's3', date: '2026-10-25', wod: squat, score: { exercises: [[{ reps: 5, load_kg: 120 }]], rx: true } }, ...history];
    expect(newlyAchieved(goals, history, after).map((status) => status.goal.id)).toEqual(['g']);
  });

  it('trie : en cours par échéance, puis atteints', () => {
    const statuses = [
      goalStatus({ ...lift(120, 3), id: 'done' }, history),
      goalStatus({ ...lift(200, 1), id: 'far' }, history),
      goalStatus({ ...lift(130, 1), id: 'soon', date: '2026-12-01' }, history),
    ];
    expect(sortGoals(statuses).map((status) => status.goal.id)).toEqual(['soon', 'far', 'done']);
  });

  it('échéance, résumé pour le coach', () => {
    expect(deadlineText('2026-12-12', '2026-10-31')).toBe('échéance le 12 déc., dans 42\u00a0jours');
    expect(deadlineText('2026-11-01', '2026-10-31')).toBe('échéance demain');
    expect(deadlineText('2026-10-31', '2026-10-31')).toBe('échéance aujourd’hui');
    expect(deadlineText('2026-10-01', '2026-10-31')).toBe('échéance dépassée (1 oct.)');
    expect(goalSummary(goalStatus({ ...lift(120, 5), date: '2026-12-12', notes: 'Pour la compétition' }, history))).toEqual({
      goal: 'Back squat 5 × 120 kg',
      deadline: '2026-12-12',
      current: '5 × 110 kg',
      remaining: 'encore 10 kg',
      notes: 'Pour la compétition',
    });
    expect(goalTitle({ ...base, kind: 'wod', wod: cindy, rounds: 20, extra_reps: 5 })).toBe('Cindy : 20 tours + 5 reps');
  });
});

describe('objectifs : validation', () => {
  it('refuse un objectif incomplet ou sur un WOD sans score comparable', () => {
    expect(validateGoal({ ...base, kind: 'lift', exercise: 'Back squat', reps: 5 })).toEqual({ ok: false, errors: ['load_kg : champ manquant'] });
    expect(validateGoal({ ...base, kind: 'wod', wod: squat, time_sec: 60 })).toEqual({ ok: false, errors: ['wod : un objectif se fixe sur un AMRAP, un For Time ou un Hyrox'] });
    expect(validateGoal({ ...base, kind: 'wod', wod: cindy, time_sec: 60 })).toEqual({ ok: false, errors: ['rounds : champ manquant', 'time_sec : pas pour un AMRAP : donne rounds'] });
    expect(validateGoal({ ...base, kind: 'free', title: 'Muscle-up', done_on: 'hier' })).toEqual({ ok: false, errors: ['done_on : date attendue au format AAAA-MM-JJ'] });
  });

  it('se garde dans une sauvegarde ; une ancienne sauvegarde sans objectifs reste valable', () => {
    const goal: Goal = { ...base, kind: 'wod', wod: fran, wod_id: 'fran', time_sec: 300, date: '2026-12-12' };
    expect(validateBackup({ wodhard_backup: 1, wods: [], results: [], plan: [], activities: [], goals: [goal] })).toMatchObject({ ok: true, value: { goals: [goal] } });
    expect(validateBackup({ wodhard_backup: 1, wods: [], results: [] })).toMatchObject({ ok: true, value: { goals: [] } });
  });
});
