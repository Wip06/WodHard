import { describe, expect, it } from 'vitest';
import { sessionCard, sessionFileName } from './sessionCard';
import type { AmrapWod, EmomWod, ForTimeWod, HyroxWod, Result, Score, Wod } from './types';

const cindy: AmrapWod = {
  schema_version: 1,
  type: 'amrap',
  title: 'Cindy',
  duration_sec: 1200,
  movements: [
    { name: 'Pull-up', reps: 5 },
    { name: 'Push-up', reps: 10 },
    { name: 'Air squat', reps: 15 },
    { name: 'Repos', duration_sec: 60 },
  ],
};
const fran: ForTimeWod = {
  schema_version: 1,
  type: 'for_time',
  title: 'Fran',
  time_cap_sec: 300,
  rounds: 3,
  rep_scheme: [21, 15, 9],
  movements: [{ name: 'Thruster', load_kg: 43 }, { name: 'Pull-up' }],
};
const hyrox: HyroxWod = {
  schema_version: 1,
  type: 'hyrox',
  title: 'Mini Hyrox',
  segments: [
    { name: 'Run', distance_m: 1000 },
    { name: 'Farmers carry', distance_m: 200, load_kg: 24, load_count: 2 },
  ],
};
const emom: EmomWod = {
  schema_version: 1,
  type: 'emom',
  title: 'EMOM duo',
  team_size: 2,
  interval_sec: 60,
  intervals: 10,
  slots: [[{ name: 'Kettlebell swing', reps: 15, load_kg: 24 }], []],
};

const done = (id: string, date: string, wod: Wod, score: Score): Result => ({ id, date, wod, score });

describe('image d’une séance', () => {
  it('AMRAP : score, RPE, progrès sur la fois d’avant, temps par tour et mouvements', () => {
    const previous = done('a', '2026-10-12', cindy, { rounds: 14, extra_reps: 7, rx: true });
    const card = sessionCard(done('b', '2026-10-31', cindy, { rounds: 15, extra_reps: 2, rx: true, rpe: 8, splits_sec: Array(15).fill(80) }), previous, true);
    expect(card.date).toBe('samedi 31 octobre 2026');
    expect(card.tags).toEqual([
      { text: 'AMRAP', tone: 'amrap' },
      { text: 'Rx', tone: 'good' },
      { text: 'Record', tone: 'accent' },
    ]);
    expect(card.title).toBe('Cindy');
    expect(card.format).toBe('AMRAP 20 min');
    expect(card.score).toBe('15 tours + 2 reps');
    expect(card.details).toEqual([
      { text: 'RPE 8/10', tone: 'muted' },
      { text: '+25 reps vs 12 oct. (14 tours + 7 reps)', tone: 'good' },
    ]);
    expect(card.sections[0]).toMatchObject({ title: 'Temps par tour' });
    expect(card.sections[0]?.rows[0]).toEqual({ text: 'Tour 1', value: '1:20' });
    expect(card.sections[1]).toEqual({
      title: 'Mouvements',
      rows: [{ text: '5 Pull-up' }, { text: '10 Push-up' }, { text: '15 Air squat' }, { text: 'Repos 1 min' }],
    });
  });

  it('For Time : schéma de reps, hors cap, scaled avec adaptations et notes', () => {
    const card = sessionCard(
      done('c', '2026-10-31', fran, {
        finished: true,
        time_sec: 320,
        rx: false,
        splits_sec: [150, 100, 70],
        adjustments: [{ index: 0, name: 'Thruster', load_kg: 30 }],
        notes: 'Épaules en feu.',
      }),
    );
    expect(card.tags).toEqual([
      { text: 'For Time', tone: 'for_time' },
      { text: 'Scaled', tone: 'muted' },
      { text: 'Hors cap', tone: 'warn' },
    ]);
    expect(card.score).toBe('5:20');
    expect(card.sections.map((section) => section.title)).toEqual(['Temps par tour', 'Mouvements', 'Adapté']);
    expect(card.sections[0]?.rows[0]).toEqual({ text: 'Tour 1 (21 reps)', value: '2:30' });
    expect(card.sections[1]?.rows).toEqual([{ text: '21-15-9 Thruster · 43 kg' }, { text: '21-15-9 Pull-up' }]);
    expect(card.sections[2]?.rows).toEqual([{ text: 'Thruster : 30 kg au lieu de 43 kg' }]);
    expect(card.notes).toBe('Épaules en feu.');
  });

  it('Hyrox : chaque segment avec son temps, sans liste de tours à part', () => {
    const card = sessionCard(done('d', '2026-10-31', hyrox, { finished: true, time_sec: 420, splits_sec: [300, 120], rx: true }));
    expect(card.sections).toEqual([
      { title: 'Segments', rows: [{ text: '1\u202f000 m Run', value: '5:00' }, { text: '200 m Farmers carry · 2 × 24 kg', value: '2:00' }] },
    ]);
  });

  it('EMOM en duo : minutes en alternance et repos', () => {
    const card = sessionCard(done('e', '2026-10-31', emom, { intervals_completed: 10, rx: true }));
    expect(card.tags.map((tag) => tag.text)).toEqual(['EMOM', 'Duo', 'Rx']);
    expect(card.sections).toEqual([
      { title: 'Mouvements', rows: [{ text: 'Minute 1 : 15 Kettlebell swing · 24 kg' }, { text: 'Minute 2 : Repos' }] },
    ]);
  });

  it('nomme le fichier d’après la date et le titre, sans accents', () => {
    expect(sessionFileName(done('f', '2026-10-31', { ...cindy, title: 'Séance « Été » n°2' }, { rounds: 1, extra_reps: 0, rx: true }))).toBe(
      'wodhard-2026-10-31-seance-ete-n-2.png',
    );
  });
});
