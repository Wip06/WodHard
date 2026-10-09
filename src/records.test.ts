import { describe, expect, it } from 'vitest';
import { compareScores, lastSplits, recordIds, scoreDelta, splitDeltas, workKey } from './records';
import type { AmrapWod, ForTimeWod, HyroxWod, Result, Score } from './types';

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

const hyrox: HyroxWod = {
  schema_version: 1,
  type: 'hyrox',
  title: 'Mini Hyrox',
  segments: [
    { name: 'Run', distance_m: 1000 },
    { name: 'Wall ball', reps: 50 },
  ],
};

const done = (id: string, date: string, score: Score, wod: Result['wod'] = fran): Result => ({ id, date, wod, score });
const time = (time_sec: number, rx = true): Score => ({ finished: true, time_sec, rx });

describe('workKey', () => {
  it('ignore le titre, la description, les notes et le time cap', () => {
    const renamed = { ...fran, title: 'Fran du lundi', description: 'Vite', time_cap_sec: 480 };
    const noted = { ...fran, movements: [{ name: ' thruster ', load_kg: 43, notes: 'Scaling : 30 kg' }, { name: 'Pull-up' }] };
    expect(workKey(renamed)).toBe(workKey(fran));
    expect(workKey(noted)).toBe(workKey(fran));
  });

  it('distingue une charge, un schéma ou un mouvement différent', () => {
    expect(workKey({ ...fran, movements: [{ name: 'Thruster', load_kg: 30 }, { name: 'Pull-up' }] })).not.toBe(workKey(fran));
    expect(workKey({ ...fran, rep_scheme: [15, 12, 9] })).not.toBe(workKey(fran));
    expect(workKey(cindy)).not.toBe(workKey(fran));
  });
});

describe('compareScores', () => {
  it('préfère le temps le plus court, et un WOD fini à un time cap', () => {
    expect(compareScores(time(300), time(320))).toBeGreaterThan(0);
    expect(compareScores(time(590), { finished: false, reps_completed: 89, rx: true })).toBeGreaterThan(0);
    expect(compareScores({ finished: false, reps_completed: 80, rx: true }, { finished: false, reps_completed: 60, rx: true })).toBeGreaterThan(0);
  });

  it('place toujours un score Rx devant un score scaled', () => {
    expect(compareScores(time(400, true), time(300, false))).toBeGreaterThan(0);
  });

  it('compare un AMRAP par tours puis par reps', () => {
    const a: Score = { rounds: 12, extra_reps: 3, rx: true };
    expect(compareScores(a, { rounds: 11, extra_reps: 29, rx: true })).toBeGreaterThan(0);
    expect(compareScores(a, { rounds: 12, extra_reps: 5, rx: true })).toBeLessThan(0);
    expect(compareScores(a, a)).toBe(0);
  });
});

describe('recordIds', () => {
  it('ne désigne un record qu’à partir de deux séances du même entraînement', () => {
    expect(recordIds([done('a', '2026-10-01', time(320))]).size).toBe(0);
    expect([...recordIds([done('a', '2026-10-01', time(320)), done('b', '2026-10-05', time(300))])]).toEqual(['b']);
  });

  it('garde le record à la première séance en cas d’égalité', () => {
    const results = [done('a', '2026-10-01', time(300)), done('b', '2026-10-05', time(300))];
    expect([...recordIds(results)]).toEqual(['a']);
  });

  it('tient un record par entraînement', () => {
    const results = [
      done('a', '2026-10-01', time(320)),
      done('c1', '2026-10-02', { rounds: 10, extra_reps: 0, rx: true }, cindy),
      done('b', '2026-10-05', time(330)),
      done('c2', '2026-10-06', { rounds: 11, extra_reps: 4, rx: true }, cindy),
    ];
    expect([...recordIds(results)].sort()).toEqual(['a', 'c2']);
  });
});

describe('scoreDelta', () => {
  it('donne l’écart de temps, meilleur quand il est négatif', () => {
    expect(scoreDelta(fran, time(308), time(320))).toEqual({ text: '−0:12', better: true });
    expect(scoreDelta(fran, time(325), time(320))).toEqual({ text: '+0:05', better: false });
    expect(scoreDelta(fran, time(320), time(320))).toEqual({ text: 'identique', better: null });
  });

  it('convertit un AMRAP en reps quand chaque mouvement se compte', () => {
    const before: Score = { rounds: 11, extra_reps: 20, rx: true };
    expect(scoreDelta(cindy, { rounds: 12, extra_reps: 3, rx: true }, before)).toEqual({ text: '+13 reps', better: true });
  });

  it('ne compare pas un temps à un time cap', () => {
    expect(scoreDelta(fran, time(320), { finished: false, reps_completed: 80, rx: true })).toBeNull();
  });
});

describe('temps par segment', () => {
  it('compare chaque segment à la séance précédente', () => {
    expect(splitDeltas([290, 610], [300, 600])).toEqual([-10, 10]);
    expect(splitDeltas([290, 610], [300])).toEqual([-10, null]);
    expect(splitDeltas([290], undefined)).toEqual([null]);
  });

  it('retrouve les derniers temps par segment connus', () => {
    const results = [
      done('a', '2026-10-01', { finished: true, time_sec: 900, splits_sec: [300, 600], rx: true }, hyrox),
      done('b', '2026-10-05', { finished: true, time_sec: 880, rx: true }, hyrox),
    ];
    expect(lastSplits(results)).toEqual([300, 600]);
    expect(lastSplits([])).toBeUndefined();
  });
});
