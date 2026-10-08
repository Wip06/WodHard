import { describe, expect, it } from 'vitest';
import instructions from '../docs/instructions-projet-claude.md?raw';
import type { Wod } from './types';
import { parseImport, parseWod, validateBackup, validateScore, validateWod } from './validate';

// Les exemples donnés dans les instructions du projet Claude.
const cindy = {
  schema_version: 1,
  type: 'amrap',
  title: 'Cindy',
  description: 'Rythme régulier, ne pas partir trop vite.',
  duration_sec: 1200,
  movements: [
    { name: 'Pull-up', reps: 5, notes: 'Scaling : ring rows' },
    { name: 'Push-up', reps: 10 },
    { name: 'Air squat', reps: 15 },
  ],
};

const emom = {
  schema_version: 1,
  type: 'emom',
  title: 'EMOM 12 swing et burpees',
  interval_sec: 60,
  intervals: 12,
  equipment: ['kettlebell'],
  slots: [[{ name: 'Kettlebell swing', reps: 15, load_kg: 24 }], [{ name: 'Burpee', reps: 10 }]],
};

const fran = {
  schema_version: 1,
  type: 'for_time',
  title: 'Fran',
  time_cap_sec: 600,
  rounds: 3,
  rep_scheme: [21, 15, 9],
  movements: [{ name: 'Thruster', load_kg: 43 }, { name: 'Pull-up' }],
};

const fiveRounds = {
  schema_version: 1,
  type: 'for_time',
  title: '5 tours course et squats',
  time_cap_sec: 1500,
  rounds: 5,
  movements: [
    { name: 'Run', distance_m: 400 },
    { name: 'Air squat', reps: 30 },
  ],
};

const hyrox = {
  schema_version: 1,
  type: 'hyrox',
  title: 'Mini Hyrox',
  description: 'Allure course soutenable, stations sans pause.',
  segments: [
    { name: 'Run', distance_m: 1000 },
    { name: 'SkiErg', distance_m: 1000 },
    { name: 'Run', distance_m: 1000 },
    { name: 'Wall ball', reps: 50, load_kg: 6 },
  ],
};

function valid(raw: unknown): Wod {
  const checked = validateWod(raw);
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  return checked.value;
}

function errorsOf(raw: unknown): string[] {
  const checked = validateWod(raw);
  return checked.ok ? [] : checked.errors;
}

describe('validateWod', () => {
  it.each([cindy, emom, fran, fiveRounds, hyrox])('accepte l’exemple « $title » sans le modifier', (example) => {
    expect(valid(example)).toEqual(example);
  });

  it('exige exactement une quantité par mouvement', () => {
    expect(errorsOf({ ...cindy, movements: [{ name: 'Pull-up' }] })).toEqual([
      'movements[0] : il faut exactement un champ parmi reps, distance_m, calories, duration_sec',
    ]);
    expect(errorsOf({ ...cindy, movements: [{ name: 'Row', reps: 5, calories: 10 }] })[0]).toContain(
      '(reçu : reps, calories)',
    );
  });

  it('interdit les quantités quand rep_scheme est défini', () => {
    expect(errorsOf({ ...fran, movements: [{ name: 'Thruster', reps: 21 }] })).toEqual([
      'movements[0] : reps interdit quand rep_scheme est défini',
    ]);
  });

  it('vérifie que rep_scheme a autant de valeurs que de tours', () => {
    expect(errorsOf({ ...fran, rounds: 2 })).toEqual(['rep_scheme : contient 3 valeurs alors que rounds vaut 2']);
  });

  it('refuse les champs inconnus plutôt que de les perdre en silence', () => {
    expect(errorsOf({ ...cindy, rest_sec: 60 })).toEqual(['rest_sec : champ inconnu']);
    expect(errorsOf({ ...cindy, time_cap_sec: 600 })).toEqual(['time_cap_sec : champ inconnu']);
  });

  it('refuse les nombres donnés en texte, décimaux ou négatifs', () => {
    expect(errorsOf({ ...cindy, duration_sec: '1200' })).toEqual(['duration_sec : doit être un entier ≥ 1']);
    expect(errorsOf({ ...cindy, duration_sec: 0 })).toEqual(['duration_sec : doit être un entier ≥ 1']);
    expect(errorsOf({ ...cindy, movements: [{ name: 'Pull-up', reps: 2.5 }] })).toEqual([
      'movements[0].reps : doit être un entier ≥ 1',
    ]);
  });

  it('accepte une charge et une distance décimales', () => {
    const wod = valid({ ...cindy, movements: [{ name: 'Carry', distance_m: 22.5, load_kg: 32.5 }] });
    expect(wod.type === 'amrap' && wod.movements[0]).toEqual({ name: 'Carry', distance_m: 22.5, load_kg: 32.5 });
  });

  it('signale toutes les erreurs d’un coup', () => {
    expect(errorsOf({ type: 'amrap', title: 'x'.repeat(61), movements: [] })).toEqual([
      'schema_version : doit valoir 1',
      'title : 60 caractères maximum (61 ici)',
      'duration_sec : champ manquant',
      'movements : doit contenir au moins un mouvement',
    ]);
  });

  it('refuse un type inconnu', () => {
    expect(errorsOf({ ...cindy, type: 'tabata' })).toEqual([
      'type : doit valoir "amrap", "emom", "for_time" ou "hyrox"',
    ]);
  });

  it('valide les segments d’un Hyrox comme des mouvements, avec un time cap facultatif', () => {
    expect(validateWod({ ...hyrox, time_cap_sec: 3600 }).ok).toBe(true);
    expect(errorsOf({ ...hyrox, segments: [{ name: 'Run' }] })).toEqual([
      'segments[0] : il faut exactement un champ parmi reps, distance_m, calories, duration_sec',
    ]);
    expect(errorsOf({ ...hyrox, segments: [] })).toEqual(['segments : doit contenir au moins un mouvement']);
    expect(errorsOf({ ...hyrox, rounds: 2 })).toEqual(['rounds : champ inconnu']);
  });

  it('accepte un slot EMOM vide (repos) mais pas plus de slots que d’intervalles', () => {
    expect(validateWod({ ...emom, slots: [emom.slots[0], []] }).ok).toBe(true);
    expect(errorsOf({ ...emom, intervals: 1 })).toEqual(['slots : 2 slots pour seulement 1 intervalles']);
  });
});

describe('parseWod', () => {
  it('lit une réponse copiée en entier, avec bloc de code et phrase autour', () => {
    const text = `Voici ton WOD :\n\n\`\`\`json\n${JSON.stringify(cindy, null, 2)}\n\`\`\`\n\nBon courage !`;
    expect(parseWod(text)).toEqual({ ok: true, value: cindy });
  });

  it('explique qu’un texte quelconque n’est pas du JSON', () => {
    const checked = parseWod('{ "schema_version": 1, ');
    expect(checked.ok).toBe(false);
    expect(!checked.ok && checked.errors[0]).toMatch(/^Ce texte n’est pas du JSON valide/);
  });
});

describe('parseImport', () => {
  it('reconnaît un WOD seul', () => {
    expect(parseImport(JSON.stringify(cindy))).toEqual({ ok: true, value: { kind: 'wod', wod: cindy } });
  });

  it('reconnaît un programme, avec ou sans date par WOD', () => {
    const program = { wodhard_program: 1, wods: [{ date: '2026-10-12', wod: fran }, { wod: hyrox }] };
    expect(parseImport(JSON.stringify(program))).toEqual({
      ok: true,
      value: { kind: 'program', items: [{ date: '2026-10-12', wod: fran }, { wod: hyrox }] },
    });
  });

  it('localise les erreurs dans le programme et refuse le tout', () => {
    const program = {
      wodhard_program: 1,
      wods: [
        { date: '12/10/2026', wod: fran },
        { date: '2026-10-14', wod: { ...cindy, duration_sec: 0 }, note: 'x' },
      ],
    };
    expect(parseImport(JSON.stringify(program))).toEqual({
      ok: false,
      errors: [
        'wods[0].date : date attendue au format AAAA-MM-JJ',
        'wods[1].note : champ inconnu',
        'wods[1].wod.duration_sec : doit être un entier ≥ 1',
      ],
    });
  });

  it('refuse un programme vide', () => {
    expect(parseImport('{"wodhard_program":1,"wods":[]}').ok).toBe(false);
  });
});

describe('validateScore', () => {
  it('valide le score propre à chaque type', () => {
    expect(validateScore({ rounds: 12, extra_reps: 5, rx: true, rpe: 8 }, valid(cindy)).ok).toBe(true);
    expect(validateScore({ intervals_completed: 10, rx: false }, valid(emom)).ok).toBe(true);
    expect(validateScore({ finished: true, time_sec: 332, rx: true }, valid(fran)).ok).toBe(true);
    expect(validateScore({ finished: false, reps_completed: 72, rx: true }, valid(fran)).ok).toBe(true);
  });

  it('refuse un score qui ne correspond pas au type du WOD', () => {
    expect(validateScore({ finished: true, time_sec: 332, rx: true }, valid(cindy))).toMatchObject({ ok: false });
    expect(validateScore({ finished: true, reps_completed: 72, rx: true }, valid(fran))).toMatchObject({ ok: false });
  });

  it('valide un score Hyrox et ses temps par segment', () => {
    const wod = valid(hyrox);
    expect(validateScore({ finished: true, time_sec: 1500, splits_sec: [300, 280, 320, 600], rx: true }, wod).ok).toBe(true);
    expect(validateScore({ finished: true, time_sec: 1500, rx: true }, wod).ok).toBe(true);
    expect(validateScore({ finished: false, segments_completed: 2, splits_sec: [300, 280], rx: true }, wod).ok).toBe(true);
    expect(validateScore({ finished: true, time_sec: 1500, splits_sec: [300, 280], rx: true }, wod)).toEqual({
      ok: false,
      errors: ['splits_sec : contient 2 temps pour 4 segments terminés'],
    });
    expect(validateScore({ finished: false, segments_completed: 5, rx: true }, wod)).toEqual({
      ok: false,
      errors: ['segments_completed : ne peut pas dépasser 4'],
    });
  });

  it('borne les intervalles tenus et le RPE', () => {
    expect(validateScore({ intervals_completed: 13, rx: true }, valid(emom))).toEqual({
      ok: false,
      errors: ['intervals_completed : ne peut pas dépasser 12'],
    });
    expect(validateScore({ rounds: 1, extra_reps: 0, rx: true, rpe: 11 }, valid(cindy))).toEqual({
      ok: false,
      errors: ['rpe : doit être compris entre 1 et 10'],
    });
  });
});

describe('validateBackup', () => {
  const backup = {
    wodhard_backup: 1,
    exported_at: '2026-10-09T10:00:00.000Z',
    wods: [{ id: 'a1', added_at: '2026-10-08T18:00:00.000Z', wod: fran }],
    results: [{ id: 'r1', wod_id: 'a1', date: '2026-10-08', wod: fran, score: { finished: true, time_sec: 332, rx: true } }],
  };

  it('relit une sauvegarde faite avant l’ajout du programme', () => {
    expect(validateBackup(backup)).toEqual({
      ok: true,
      value: { wods: backup.wods, results: backup.results, plan: [] },
    });
  });

  it('relit le programme et écarte ce qui ne pointe plus sur rien', () => {
    const plan = [
      { id: 'p1', date: '2026-10-08', wod_id: 'a1', result_id: 'r1' },
      { id: 'p2', date: '2026-10-12', wod_id: 'a1', result_id: 'disparu' },
      { id: 'p3', date: '2026-10-13', wod_id: 'disparu' },
    ];
    const checked = validateBackup({ ...backup, plan });
    expect(checked.ok && checked.value.plan).toEqual([
      { id: 'p1', date: '2026-10-08', wod_id: 'a1', result_id: 'r1' },
      { id: 'p2', date: '2026-10-12', wod_id: 'a1' },
    ]);
  });

  it('refuse un fichier qui n’est pas une sauvegarde', () => {
    expect(validateBackup(fran).ok).toBe(false);
  });

  it('localise l’erreur dans le fichier', () => {
    const broken = { ...backup, results: [{ ...backup.results[0], date: '08/10/2026' }] };
    expect(validateBackup(broken)).toEqual({
      ok: false,
      errors: ['results[0].date : date attendue au format AAAA-MM-JJ'],
    });
  });
});

describe('instructions du projet Claude', () => {
  it('ne donnent que des exemples acceptés par l’application', () => {
    const blocks = [...instructions.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
    expect(blocks).toHaveLength(6);
    for (const block of blocks) expect(parseImport(block)).toMatchObject({ ok: true });
  });
});
