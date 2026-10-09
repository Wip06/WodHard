import { describe, expect, it } from 'vitest';
import { matchesQuery, searchText } from './search';
import type { Wod } from './types';

const fran: Wod = {
  schema_version: 1,
  type: 'for_time',
  title: 'Fran',
  description: 'Sprint très court.',
  time_cap_sec: 600,
  rounds: 3,
  rep_scheme: [21, 15, 9],
  movements: [{ name: 'Thruster', load_kg: 43 }, { name: 'Pull-up', notes: 'Scaling : jumping pull-ups' }],
};

const emom: Wod = {
  schema_version: 1,
  type: 'emom',
  title: 'Séance du mardi',
  interval_sec: 60,
  intervals: 12,
  equipment: ['Kettlebell'],
  slots: [[{ name: 'Kettlebell swing', reps: 15 }], [{ name: 'Burpee', reps: 10 }]],
};

const hyrox: Wod = {
  schema_version: 1,
  type: 'hyrox',
  title: 'Simulation',
  segments: [
    { name: 'Run', distance_m: 1000 },
    { name: 'SkiErg', distance_m: 1000 },
  ],
};

const found = (query: string, wod: Wod) => matchesQuery(query, searchText(wod));

describe('recherche de WOD', () => {
  it('trouve par titre, sans tenir compte de la casse ni des accents', () => {
    expect(found('fran', fran)).toBe(true);
    expect(found('SEANCE', emom)).toBe(true);
    expect(found('séance', emom)).toBe(true);
    expect(found('tres court', fran)).toBe(true);
  });

  it('trouve par type', () => {
    expect(found('for time', fran)).toBe(true);
    expect(found('emom', emom)).toBe(true);
    expect(found('hyrox', hyrox)).toBe(true);
    expect(found('hyrox', fran)).toBe(false);
  });

  it('trouve par mouvement, note ou matériel, quel que soit le type', () => {
    expect(found('thruster', fran)).toBe(true);
    expect(found('jumping', fran)).toBe(true);
    expect(found('burpee', emom)).toBe(true);
    expect(found('kettlebell', emom)).toBe(true);
    expect(found('skierg', hyrox)).toBe(true);
  });

  it('exige tous les mots de la recherche', () => {
    expect(found('swing burpee', emom)).toBe(true);
    expect(found('swing thruster', emom)).toBe(false);
  });

  it('garde tout quand la recherche est vide', () => {
    expect(found('', fran)).toBe(true);
    expect(found('   ', fran)).toBe(true);
  });
});
