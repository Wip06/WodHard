import { describe, expect, it } from 'vitest';
import { aliasConflicts, allMovements, canonicalEquipment, canonicalName, isRest, knownNames, normalizeWod } from './movements';
import type { EmomWod, HyroxWod } from './types';

const hyrox: HyroxWod = {
  schema_version: 1,
  type: 'hyrox',
  title: 'Mini Hyrox',
  equipment: ['rameur', 'Rameur', 'médecine ball'],
  segments: [
    { name: 'course', distance_m: 1000 },
    { name: 'Row', distance_m: 1000 },
    { name: 'wall balls', reps: 50, load_kg: 6 },
  ],
};

describe('canonicalName', () => {
  it('ramène les variantes courantes au nom anglais', () => {
    expect(canonicalName('rameur')).toBe('Rowing');
    expect(canonicalName('Ski Erg')).toBe('SkiErg');
    expect(canonicalName('  Wall-Balls ')).toBe('Wall ball');
    expect(canonicalName('pompes')).toBe('Push-up');
    expect(canonicalName('Fentes sandbag')).toBe('Sandbag lunges');
    expect(canonicalName('Récupération')).toBe('Repos');
  });

  it('reprend sinon l’orthographe déjà utilisée, ou garde le nom nettoyé', () => {
    const known = knownNames([{ ...hyrox, segments: [{ name: 'Ring row', reps: 10 }] }]).movements;
    expect(canonicalName('ring rows', known)).toBe('Ring row');
    expect(canonicalName('devil   press')).toBe('Devil press');
  });

  it('fait de même pour le matériel', () => {
    expect(canonicalEquipment('haltères')).toBe('Dumbbell');
    expect(canonicalEquipment('Barre de traction')).toBe('Pull-up bar');
    expect(canonicalEquipment('élastique')).toBe('Élastique');
  });
});

describe('normalizeWod', () => {
  it('normalise les mouvements et le matériel sans doublon', () => {
    const wod = normalizeWod(hyrox);
    expect(wod.equipment).toEqual(['Rower', 'Wall ball']);
    expect(allMovements(wod).map((movement) => movement.name)).toEqual(['Run', 'Rowing', 'Wall ball']);
  });

  it('garde les slots de repos d’un EMOM', () => {
    const emom: EmomWod = { schema_version: 1, type: 'emom', title: 'E', interval_sec: 60, intervals: 2, slots: [[{ name: 'burpees', reps: 10 }], []] };
    expect(normalizeWod(emom)).toEqual({ ...emom, slots: [[{ name: 'Burpee', reps: 10 }], []] });
  });
});

describe('isRest', () => {
  it('reconnaît un repos chronométré, quel que soit son nom', () => {
    expect(isRest({ name: 'Repos', duration_sec: 60 })).toBe(true);
    expect(isRest({ name: 'rest', duration_sec: 90 })).toBe(true);
    expect(isRest({ name: 'Plank', duration_sec: 60 })).toBe(false);
  });
});

describe('noms retenus', () => {
  it('aucune variante ne désigne deux mouvements ou deux matériels différents', () => {
    expect(aliasConflicts()).toEqual([]);
  });

  it('reconnaît les exercices de musculation en français', () => {
    expect(canonicalName('développé incliné')).toBe('Incline bench press');
    expect(canonicalName('Tirage vertical')).toBe('Lat pulldown');
    expect(canonicalName('fentes bulgares')).toBe('Bulgarian split squat');
    expect(canonicalName('Rowing barre')).toBe('Barbell row');
    expect(canonicalName('rameur')).toBe('Rowing');
  });
});
