import { describe, expect, it } from 'vitest';
import { exerciseSummary, scoreLine, setsLine, setText, wodSummary } from './format';
import { liftsOf, recordsBeaten } from './lifts';
import { adjustmentDirection, beyondPrescribed, compareScores, scalesDown, scoreDelta, workKey } from './records';
import { sessionCard } from './sessionCard';
import { asPrescribed, oneRepMax, plannedSets, volume } from './strength';
import type { AmrapWod, Result, StrengthScore, StrengthSet, StrengthWod } from './types';
import { validateScore, validateWod } from './validate';

const upper: StrengthWod = {
  schema_version: 1,
  type: 'strength',
  title: 'Haut du corps',
  exercises: [
    { name: 'Bench press', sets: 3, reps: 8, load_kg: 60, rest_sec: 120 },
    {
      name: 'Barbell row',
      sets: [
        { reps: 10, load_kg: 50 },
        { reps: 8, load_kg: 55 },
      ],
    },
    { name: 'Plank', sets: 2, duration_sec: 45 },
    { name: 'Dumbbell curl', sets: 2, reps: 12, load_kg: 10, load_count: 2 },
  ],
};

const asPlanned = (): StrengthSet[][] => upper.exercises.map((exercise) => plannedSets(exercise).map((set) => ({ ...set })));
const score = (exercises: StrengthSet[][], rx = true): StrengthScore => ({ exercises, rx });
const done = (id: string, date: string, exercises: StrengthSet[][], wod: StrengthWod = upper): Result => ({ id, date, wod, score: score(exercises) });

describe('WOD de force : format et validation', () => {
  it('accepte des séries identiques, détaillées, chronométrées et une paire', () => {
    const checked = validateWod(upper);
    expect(checked).toEqual({ ok: true, value: upper });
  });

  it('refuse un exercice mal décrit, avec le chemin de l’erreur', () => {
    const wod = (exercise: Record<string, unknown>) => validateWod({ ...upper, exercises: [exercise] });
    expect(wod({ name: 'Squat', sets: 3 })).toEqual({ ok: false, errors: ['exercises[0] : il faut exactement un champ parmi reps, duration_sec'] });
    expect(wod({ name: 'Squat', sets: [{ reps: 5, load_kg: 80 }], reps: 5 })).toEqual({
      ok: false,
      errors: ['exercises[0].reps : à indiquer dans chaque série quand les séries sont détaillées'],
    });
    expect(wod({ name: 'Squat', sets: 40, reps: 5 })).toEqual({ ok: false, errors: ['exercises[0].sets : 30 séries au plus'] });
    expect(wod({ name: 'Curl', sets: 3, reps: 10, load_count: 2 })).toEqual({ ok: false, errors: ['exercises[0].load_count : demande aussi load_kg'] });
    expect(validateWod({ ...upper, exercises: [] })).toEqual({ ok: false, errors: ['exercises : doit contenir de 1 à 30 exercices'] });
  });

  it('valide les séries faites, une liste par exercice, séries ratées comprises', () => {
    const sets = asPlanned();
    sets[0] = [{ reps: 8, load_kg: 62.5 }, { reps: 0, load_kg: 60 }];
    expect(validateScore({ exercises: sets, rx: false, duration_sec: 2400 }, upper).ok).toBe(true);
    expect(validateScore({ exercises: sets.slice(1), rx: true }, upper)).toEqual({ ok: false, errors: ['exercises : contient 3 exercices pour 4 dans le WOD'] });
  });

  it('résume la séance, le score et les séries', () => {
    expect(wodSummary(upper)).toBe('4 exercices · 9 séries');
    expect(scoreLine(upper, score(asPlanned()))).toBe('9/9 séries · 2\u202f860 kg soulevés');
    expect(exerciseSummary(upper.exercises[0]!)).toBe('3 × 8 · 60 kg');
    expect(exerciseSummary(upper.exercises[1]!)).toBe('10×50 · 8×55 kg');
    expect(exerciseSummary(upper.exercises[3]!)).toBe('2 × 12 · 2 × 10 kg');
    expect(setText({ reps: 8, load_kg: 62.5 })).toBe('8 × 62,5 kg');
    expect(setText({ reps: 12 })).toBe('12 reps');
    expect(setText({ duration_sec: 45 })).toBe('45 s');
    expect(setsLine([{ reps: 10 }, { reps: 8 }])).toBe('10 · 8 reps');
  });
});

describe('calculs de force', () => {
  it('tonnage, avec les deux mains pour une paire', () => {
    // 3×8×60 + 10×50 + 8×55 + 2×12×10×2 = 1440 + 500 + 440 + 480.
    expect(volume(upper, score(asPlanned()))).toBe(2860);
  });

  it('1RM estimé (Epley), sans charge ou au-delà de 12 reps : pas d’estimation', () => {
    expect(oneRepMax({ reps: 1, load_kg: 100 })).toBe(100);
    expect(oneRepMax({ reps: 5, load_kg: 90 })).toBe(105);
    expect(oneRepMax({ reps: 15, load_kg: 40 })).toBeUndefined();
    expect(oneRepMax({ reps: 10 })).toBeUndefined();
  });

  it('fait comme prescrit, et au-delà (Rx+)', () => {
    const planned = asPlanned();
    expect(asPrescribed(upper, score(planned))).toBe(true);
    expect(beyondPrescribed(upper, score(planned))).toBe(false);
    const more = asPlanned();
    more[0] = [...(more[0] ?? []), { reps: 6, load_kg: 60 }];
    expect(beyondPrescribed(upper, score(more))).toBe(true);
    const heavier = asPlanned();
    heavier[0] = [{ reps: 8, load_kg: 62.5 }, { reps: 8, load_kg: 60 }, { reps: 8, load_kg: 60 }];
    expect(beyondPrescribed(upper, score(heavier))).toBe(true);
    const less = asPlanned();
    less[0] = [{ reps: 8, load_kg: 60 }, { reps: 7, load_kg: 60 }, { reps: 9, load_kg: 60 }];
    expect(asPrescribed(upper, score(less))).toBe(false);
    expect(beyondPrescribed(upper, score(less))).toBe(false);
  });

  it('compare deux séances du même entraînement au tonnage', () => {
    const lighter = score(asPlanned());
    const heavier = score(asPlanned().map((sets) => sets.map((set) => ({ ...set, load_kg: set.load_kg === undefined ? undefined : set.load_kg + 5 }))));
    expect(compareScores(heavier, lighter, [upper, upper])).toBeGreaterThan(0);
    // +5 kg sur chaque série chargée : 3×8×5 + (10+8)×5 + 2×12×5 × 2 mains = 120 + 90 + 240.
    expect(scoreDelta(upper, heavier, lighter)).toEqual({ text: '+450 kg', better: true });
    expect(workKey({ ...upper, title: 'Autre nom' })).toBe(workKey(upper));
    expect(workKey({ ...upper, exercises: [{ ...upper.exercises[0]!, load_kg: 65 }, ...upper.exercises.slice(1)] })).not.toBe(workKey(upper));
  });
});

describe('Rx+ sur un metcon', () => {
  const cindy: AmrapWod = {
    schema_version: 1,
    type: 'amrap',
    title: 'Cindy',
    duration_sec: 1200,
    movements: [
      { name: 'Pull-up', reps: 5 },
      { name: 'Wall ball', reps: 10, load_kg: 9 },
    ],
  };

  it('une adaptation à la hausse garde Rx et donne Rx+, à la baisse elle passe en scaled', () => {
    const up = { index: 1, name: 'Wall ball', load_kg: 12 };
    const down = { index: 0, name: 'Pull-up', reps: 3 };
    expect(adjustmentDirection(cindy, up)).toBe('up');
    expect(adjustmentDirection(cindy, down)).toBe('down');
    expect(adjustmentDirection(cindy, { index: 0, name: 'Pull-up', replaced_by: 'Ring row' })).toBe('replaced');
    expect(scalesDown(cindy, [up])).toBe(false);
    expect(scalesDown(cindy, [up, down])).toBe(true);
    expect(beyondPrescribed(cindy, { rounds: 10, extra_reps: 0, rx: true, adjustments: [up] })).toBe(true);
    expect(beyondPrescribed(cindy, { rounds: 10, extra_reps: 0, rx: true })).toBe(false);
    expect(beyondPrescribed(cindy, { rounds: 10, extra_reps: 0, rx: false, adjustments: [up, down] })).toBe(false);
  });

  it('le récapitulatif affiche Rx+', () => {
    const card = sessionCard({ id: 'r', date: '2026-10-31', wod: cindy, score: { rounds: 10, extra_reps: 0, rx: true, adjustments: [{ index: 1, name: 'Wall ball', load_kg: 12 }] } });
    expect(card.tags.map((tag) => tag.text)).toContain('Rx+');
  });
});

describe('charges et records par exercice', () => {
  const october = done('a', '2026-10-01', asPlanned());
  const better = asPlanned();
  better[0] = [{ reps: 8, load_kg: 65 }, { reps: 8, load_kg: 65 }, { reps: 6, load_kg: 65 }];
  const november = done('b', '2026-11-01', better);
  // Même exercice écrit en français dans une autre séance : il est regroupé.
  const french: StrengthWod = { ...upper, exercises: [{ name: 'développé couché', sets: 1, reps: 3, load_kg: 70 }] };
  const single = done('c', '2026-11-05', [[{ reps: 3, load_kg: 70 }]], french);

  it('regroupe les séances par exercice, avec 1RM estimé, charge la plus lourde et reps sans charge', () => {
    const lifts = liftsOf([october, november, single]);
    const bench = lifts.find((lift) => lift.name === 'Bench press');
    expect(bench?.sessions.map((session) => session.date)).toEqual(['2026-10-01', '2026-11-01', '2026-11-05']);
    expect(bench?.best?.oneRepMax).toBeCloseTo(65 * (1 + 8 / 30));
    expect(bench?.heaviest).toEqual({ load: 70, reps: 3, date: '2026-11-05' });
    expect(lifts[0]?.name).toBe('Bench press');
    expect(lifts.find((lift) => lift.name === 'Plank')?.mostReps).toBeUndefined();
  });

  it('garde l’ordre de deux séances faites le même jour (résultats du plus récent au plus ancien)', () => {
    const morning = done('m', '2026-11-20', asPlanned());
    const evening = done('e', '2026-11-20', better);
    const bench = liftsOf([evening, morning]).find((lift) => lift.name === 'Bench press');
    expect(bench?.sessions.map((session) => session.resultId)).toEqual(['m', 'e']);
  });

  it('repère les records battus par une nouvelle séance', () => {
    expect(recordsBeaten([october], november)).toEqual([{ name: 'Bench press', set: { reps: 8, load_kg: 65 }, kind: 'oneRepMax' }]);
    expect(recordsBeaten([october, november], done('d', '2026-11-10', asPlanned()))).toEqual([]);
    expect(recordsBeaten([], october)).toEqual([]);
  });
});
