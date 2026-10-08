import { describe, expect, it } from 'vitest';
import { COUNTDOWN_MS, cuesBetween, elapsedMs, frame, newClock, pause, resume, splitsFromMarks } from './timer';
import type { AmrapWod, EmomWod, ForTimeWod, HyroxWod } from './types';

const amrap: AmrapWod = {
  schema_version: 1,
  type: 'amrap',
  title: 'AMRAP 1 min',
  duration_sec: 60,
  movements: [{ name: 'Burpee', reps: 10 }],
};

const emom: EmomWod = {
  schema_version: 1,
  type: 'emom',
  title: 'EMOM 3 × 30 s',
  interval_sec: 30,
  intervals: 3,
  slots: [[{ name: 'Burpee', reps: 5 }]],
};

const forTime: ForTimeWod = {
  schema_version: 1,
  type: 'for_time',
  title: 'For Time',
  time_cap_sec: 120,
  rounds: 1,
  movements: [{ name: 'Burpee', reps: 50 }],
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

describe('horloge', () => {
  it('démarre par le décompte et ne compte pas le temps passé en pause', () => {
    let clock = newClock(1_000);
    expect(elapsedMs(clock, 1_000)).toBe(-COUNTDOWN_MS);
    expect(elapsedMs(clock, 16_000)).toBe(5_000);

    clock = pause(clock, 16_000);
    expect(elapsedMs(clock, 99_000)).toBe(5_000);

    clock = resume(clock, 100_000);
    expect(elapsedMs(clock, 102_000)).toBe(7_000);
  });
});

describe('frame', () => {
  it('affiche le décompte de départ', () => {
    expect(frame(amrap, -10_000)).toMatchObject({ phase: 'countdown', seconds: 10 });
    expect(frame(amrap, -1)).toMatchObject({ phase: 'countdown', seconds: 1 });
  });

  it('décompte le temps restant d’un AMRAP', () => {
    expect(frame(amrap, 0)).toMatchObject({ phase: 'running', seconds: 60 });
    expect(frame(amrap, 59_001)).toMatchObject({ phase: 'running', seconds: 1 });
    expect(frame(amrap, 60_000)).toMatchObject({ phase: 'done', seconds: 0 });
  });

  it('décompte chaque intervalle d’un EMOM', () => {
    expect(frame(emom, 0)).toEqual({ phase: 'running', seconds: 30, interval: 0 });
    expect(frame(emom, 45_000)).toEqual({ phase: 'running', seconds: 15, interval: 1 });
    expect(frame(emom, 90_000)).toEqual({ phase: 'done', seconds: 0, interval: 2 });
  });

  it('compte le temps écoulé d’un For Time jusqu’au time cap', () => {
    expect(frame(forTime, 65_900)).toMatchObject({ phase: 'running', seconds: 65 });
    expect(frame(forTime, 500_000)).toMatchObject({ phase: 'done', seconds: 120 });
  });
});

describe('Hyrox', () => {
  it('compte le temps sans limite quand il n’y a pas de time cap', () => {
    expect(frame(hyrox, 5_400_500)).toMatchObject({ phase: 'running', seconds: 5400 });
    expect(cuesBetween(hyrox, -3_100, 0)).toEqual(['tick', 'tick', 'tick', 'go']);
    expect(cuesBetween(hyrox, 3_599_000, 3_600_000)).toEqual([]);
  });

  it('s’arrête au time cap quand il y en a un', () => {
    const capped = { ...hyrox, time_cap_sec: 1800 };
    expect(frame(capped, 1_800_000)).toMatchObject({ phase: 'done', seconds: 1800 });
    expect(cuesBetween(capped, 1_799_950, 1_800_050)).toEqual(['end']);
  });

  it('déduit la durée de chaque segment des temps de passage', () => {
    expect(splitsFromMarks([])).toEqual([]);
    expect(splitsFromMarks([300_400, 580_900, 901_200])).toEqual([300, 280, 321]);
  });
});

describe('cuesBetween', () => {
  it('bipe 3-2-1 puis donne le départ', () => {
    expect(cuesBetween(amrap, -10_000, -3_100)).toEqual([]);
    expect(cuesBetween(amrap, -3_100, 0)).toEqual(['tick', 'tick', 'tick', 'go']);
  });

  it('ne rejoue pas un signal déjà émis', () => {
    expect(cuesBetween(amrap, 0, 100)).toEqual([]);
    expect(cuesBetween(amrap, 900, 1_000)).toEqual([]);
  });

  it('annonce la fin', () => {
    expect(cuesBetween(amrap, 56_500, 60_050)).toEqual(['tick', 'tick', 'tick', 'end']);
    expect(cuesBetween(amrap, 60_050, 70_000)).toEqual([]);
  });

  it('signale chaque changement d’intervalle d’un EMOM', () => {
    expect(cuesBetween(emom, 26_500, 30_000)).toEqual(['tick', 'tick', 'tick', 'go']);
    expect(cuesBetween(emom, 59_950, 60_050)).toEqual(['go']);
    expect(cuesBetween(emom, 89_950, 90_050)).toEqual(['end']);
  });

  it('signale le time cap d’un For Time', () => {
    expect(cuesBetween(forTime, 60_000, 61_000)).toEqual([]);
    expect(cuesBetween(forTime, 119_950, 120_050)).toEqual(['end']);
  });
});
