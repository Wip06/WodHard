import { describe, expect, it } from 'vitest';
import { scoreLine, wodSummary } from './format';
import { liftsOf, recordsBeaten } from './lifts';
import { allMovements, normalizeWod } from './movements';
import { beyondPrescribed, recordIds, workKey } from './records';
import { sessionCard } from './sessionCard';
import { resultDuration, scoreHeadline } from './stats';
import type { AmrapWod, Result, SessionScore, SessionWod, StrengthWod } from './types';
import { validateScore, validateWod } from './validate';

const force: StrengthWod = {
  schema_version: 1,
  type: 'strength',
  title: 'Force',
  exercises: [{ name: 'Back squat', sets: 3, reps: 5, load_kg: 100, rest_sec: 120 }],
};
const metcon: AmrapWod = {
  schema_version: 1,
  type: 'amrap',
  title: 'Metcon',
  duration_sec: 720,
  movements: [
    { name: 'Pull-up', reps: 5 },
    { name: 'Wall ball', reps: 10, load_kg: 9 },
  ],
};
const legs: SessionWod = { schema_version: 1, type: 'session', title: 'Jambes et cardio', blocks: [force, metcon] };

const squats = (load: number) => [1, 2, 3].map(() => ({ reps: 5, load_kg: load }));
const score = (load = 100, rounds = 8): SessionScore => ({
  blocks: [
    { exercises: [squats(load)], rx: true, duration_sec: 900 },
    { rounds, extra_reps: 4, rx: true },
  ],
  rx: true,
  rpe: 8,
});
const done = (id: string, date: string, value: SessionScore = score()): Result => ({ id, date, wod: legs, score: value });

describe('séance en blocs : format et validation', () => {
  it('accepte des blocs sans schema_version, et les enregistre complets', () => {
    const { schema_version: _, ...bare } = metcon;
    const checked = validateWod({ ...legs, blocks: [force, bare] });
    expect(checked).toEqual({ ok: true, value: legs });
  });

  it('refuse un bloc qui contient des blocs, une séance d’un seul bloc, et situe les erreurs', () => {
    expect(validateWod({ ...legs, blocks: [force, legs] })).toEqual({ ok: false, errors: ['blocks[1].type : un bloc ne peut pas contenir d’autres blocs'] });
    expect(validateWod({ ...legs, blocks: [force] })).toEqual({
      ok: false,
      errors: ['blocks : doit contenir de 2 à 8 blocs (un seul bloc : donne directement son WOD)'],
    });
    expect(validateWod({ ...legs, blocks: [force, { ...metcon, duration_sec: 0 }] })).toEqual({
      ok: false,
      errors: ['blocks[1].duration_sec : doit être un entier ≥ 1'],
    });
  });

  it('valide un score par bloc, un bloc passé valant null', () => {
    expect(validateScore(score(), legs)).toEqual({ ok: true, value: score() });
    const skipped = { blocks: [null, { rounds: 6, extra_reps: 0, rx: true }], rx: false };
    expect(validateScore(skipped, legs)).toEqual({ ok: true, value: skipped });
    expect(validateScore({ blocks: [null, null], rx: false }, legs)).toEqual({ ok: false, errors: ['blocks : au moins un bloc doit être fait'] });
    expect(validateScore({ blocks: [null], rx: false }, legs)).toEqual({ ok: false, errors: ['blocks : contient 1 scores pour 2 blocs'] });
    expect(validateScore({ blocks: [null, { rounds: -1, extra_reps: 0, rx: true }], rx: false }, legs)).toEqual({
      ok: false,
      errors: ['blocks[1].rounds : doit être un entier ≥ 0'],
    });
    expect(validateScore({ ...score(), adjustments: [] }, legs)).toEqual({ ok: false, errors: ['adjustments : à noter dans le score de chaque bloc'] });
  });

  it('résume la séance et son score bloc par bloc', () => {
    expect(wodSummary(legs)).toBe('2 blocs : Force + AMRAP');
    expect(scoreLine(legs, score())).toBe('Force 3/3 séries · 1 500 kg soulevés / Metcon 8 tours + 4 reps');
    expect(scoreLine(legs, { blocks: [null, { rounds: 6, extra_reps: 0, rx: true }], rx: false })).toBe('Force passé / Metcon 6 tours');
  });

  it('normalise les noms dans chaque bloc', () => {
    const french = normalizeWod({ ...legs, blocks: [force, { ...metcon, movements: [{ name: 'tractions', reps: 5 }] }] });
    expect(allMovements(french).map((movement) => movement.name)).toEqual(['Back squat', 'Pull-up']);
  });
});

describe('séance en blocs : calculs', () => {
  it('Rx+ quand un bloc va au-delà du prescrit, et durée = somme des blocs faits', () => {
    expect(beyondPrescribed(legs, score())).toBe(false);
    expect(beyondPrescribed(legs, score(105))).toBe(true);
    // Force chronométrée 15 min, plus les 12 min de l'AMRAP.
    expect(resultDuration({ wod: legs, score: score() })).toBe(900 + 720);
    expect(resultDuration({ wod: legs, score: { blocks: [null, { rounds: 6, extra_reps: 0, rx: true }], rx: false } })).toBe(720);
  });

  it('pas de record de séance, mais les charges de ses blocs de force comptent', () => {
    const first = done('a', '2026-10-01');
    const second = done('b', '2026-10-08', score(110, 9));
    expect(recordIds([first, second]).size).toBe(0);
    expect(workKey(legs)).not.toBe(workKey({ ...legs, blocks: [metcon, force] }));
    const squat = liftsOf([second, first]).find((lift) => lift.name === 'Back squat');
    expect(squat?.sessions.map((session) => session.resultId)).toEqual(['a', 'b']);
    expect(recordsBeaten([first], second)).toEqual([{ name: 'Back squat', set: { reps: 5, load_kg: 110 }, kind: 'oneRepMax' }]);
  });

  it('le récapitulatif montre chaque bloc avec son score', () => {
    const card = sessionCard(done('a', '2026-10-01', { ...score(), blocks: [null, score().blocks[1]!] }));
    expect(card.tags.map((tag) => tag.text)).toEqual(['Force', 'AMRAP', 'Rx']);
    expect(card.sections.map((section) => section.title)).toEqual(['Force', 'Metcon · 8 tours + 4 reps']);
    expect(card.sections[0]?.rows).toEqual([{ text: '1 exercice · 3 séries · bloc passé' }]);
    expect(card.score).toBe('1 bloc sur 2 · 12 min');
    expect(scoreHeadline(done('b', '2026-10-01'))).toBe('2 blocs faits · 27 min');
  });
});
