import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addProgram,
  addWod,
  applyBackup,
  backupStatus,
  buildHistory,
  deleteActivity,
  deleteResult,
  getWods,
  pendingDates,
  planWods,
  previewPlanning,
  previewReschedule,
  removePlanEntries,
  removeWods,
  reschedulePlan,
  saveActivity,
  saveResult,
  visiblePlan,
} from './store';
import type { AmrapWod } from './types';

// Stockage en mémoire : le store n'y touche qu'à l'enregistrement.
const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
});

const wod = (title: string): AmrapWod => ({ schema_version: 1, type: 'amrap', title, duration_sec: 600, movements: [{ name: 'Burpee', reps: 10 }] });
const plan = () => visiblePlan().map(({ entry, saved }) => `${saved.wod.title}@${entry.date}`);
const entryOf = (title: string) => visiblePlan().find((row) => row.saved.wod.title === title)?.entry;

beforeEach(() => {
  memory.clear();
  applyBackup({ wods: [], results: [], plan: [], activities: [] }, 'replace');
  // Dates loin dans le futur : tout reste visible dans le programme.
  addProgram([
    { date: '2099-01-05', wod: wod('A') },
    { date: '2099-01-06', wod: wod('B') },
    { date: '2099-01-07', wod: wod('C') },
    { wod: wod('Libre') },
  ]);
  const b = entryOf('B');
  if (b) saveResult({ id: 'r1', wod_id: b.wod_id, date: '2099-01-06', wod: wod('B'), score: { rounds: 5, extra_reps: 0, rx: true } });
});

const ids = (...titles: string[]) => titles.map((title) => entryOf(title)?.id ?? '');

describe('reprogrammer plusieurs séances', () => {
  it('décale les séances non faites en gardant leurs écarts, et laisse les séances faites', () => {
    const selection = ids('A', 'B', 'C');
    expect(pendingDates(selection)).toEqual(['2099-01-05', '2099-01-07']);
    expect(previewReschedule(selection, 2)).toEqual({ moved: 2, skippedDone: 1, conflicts: [] });
    const undo = reschedulePlan(selection, 2);
    expect(plan()).toEqual(['B@2099-01-06', 'A@2099-01-07', 'C@2099-01-09']);
    undo();
    expect(plan()).toEqual(['A@2099-01-05', 'B@2099-01-06', 'C@2099-01-07']);
  });

  it('signale une date déjà prise par une séance qui ne bouge pas', () => {
    expect(previewReschedule(ids('A'), 1).conflicts).toEqual(['2099-01-06']);
    expect(previewReschedule(ids('A', 'B'), 1).conflicts).toEqual(['2099-01-06']);
    expect(previewReschedule(ids('A', 'C'), 1).conflicts).toEqual(['2099-01-06']);
    expect(previewReschedule(ids('C'), -1).conflicts).toEqual(['2099-01-06']);
    expect(previewReschedule(ids('A'), 5).conflicts).toEqual([]);
  });
});

describe('planifier plusieurs WOD de la bibliothèque', () => {
  it('les place dans l’ordre donné, avec l’espacement choisi, et sait annuler', () => {
    const libre = getWods().find((saved) => saved.wod.title === 'Libre')?.id ?? '';
    const c = entryOf('C')?.wod_id ?? '';
    expect(previewPlanning([libre, c], '2099-01-07', 2)).toEqual(['2099-01-07']);
    const undo = planWods([libre, c], '2099-01-08', 2);
    expect(plan()).toEqual(['A@2099-01-05', 'B@2099-01-06', 'C@2099-01-07', 'Libre@2099-01-08', 'C@2099-01-10']);
    undo();
    expect(plan()).toEqual(['A@2099-01-05', 'B@2099-01-06', 'C@2099-01-07']);
  });
});

describe('retirer et supprimer plusieurs WOD', () => {
  it('retire du programme sans toucher à la bibliothèque, et sait annuler', () => {
    const undo = removePlanEntries(ids('A', 'C'));
    expect(plan()).toEqual(['B@2099-01-06']);
    expect(getWods()).toHaveLength(4);
    undo();
    expect(plan()).toEqual(['A@2099-01-05', 'B@2099-01-06', 'C@2099-01-07']);
  });

  it('supprime de la bibliothèque et du programme, remet tout en place à l’annulation', () => {
    const order = () => getWods().map((saved) => saved.wod.title);
    const targets = [entryOf('A')?.wod_id ?? '', getWods().find((saved) => saved.wod.title === 'Libre')?.id ?? ''];
    const undo = removeWods(targets);
    expect(order()).toEqual(['B', 'C']);
    expect(plan()).toEqual(['B@2099-01-06', 'C@2099-01-07']);
    undo();
    expect(order()).toEqual(['A', 'B', 'C', 'Libre']);
    expect(plan()).toEqual(['A@2099-01-05', 'B@2099-01-06', 'C@2099-01-07']);
  });
});

describe('noms des mouvements', () => {
  it('enregistre les variantes sous le nom anglais et reprend l’orthographe déjà utilisée', () => {
    applyBackup(
      {
        wods: [{ id: 'old', added_at: '2026-10-01T10:00:00.000Z', wod: { ...wod('Ancien'), movements: [{ name: 'Ring row', reps: 10 }] } }],
        results: [],
        plan: [],
        activities: [],
      },
      'replace',
    );
    const { saved } = addWod({ ...wod('Nouveau'), equipment: ['rameur'], movements: [{ name: 'rameur', calories: 15 }, { name: 'ring rows', reps: 10 }] });
    expect(saved.wod.equipment).toEqual(['Rower']);
    expect(saved.wod.type === 'amrap' && saved.wod.movements.map((movement) => movement.name)).toEqual(['Rowing', 'Ring row']);
  });

  it('reconnaît comme doublon un WOD enregistré avec d’anciens noms', () => {
    applyBackup({ wods: [{ id: 'old', added_at: '2026-10-01T10:00:00.000Z', wod: { ...wod('X'), movements: [{ name: 'burpees', reps: 10 }] } }], results: [], plan: [], activities: [] }, 'replace');
    expect(addWod({ ...wod('X'), movements: [{ name: 'Burpee', reps: 10 }] })).toMatchObject({ duplicate: true, saved: { id: 'old' } });
  });
});

describe('séances à sauvegarder', () => {
  it('compte chaque nouvelle séance une seule fois, même sans compteur existant', () => {
    memory.delete('wodhard:unsaved');
    const a = entryOf('A');
    saveResult({ id: 'r2', wod_id: a?.wod_id, date: '2099-01-05', wod: wod('A'), score: { rounds: 3, extra_reps: 0, rx: true } });
    expect(backupStatus().unsaved).toBe(2);
  });

  it('ne compte plus une séance supprimée', () => {
    expect(backupStatus().unsaved).toBe(1);
    deleteResult('r1');
    expect(backupStatus().unsaved).toBe(0);
  });
});

describe('activités d’autres sports', () => {
  it('comptent comme des séances à sauvegarder et partent au coach sans leur identifiant', () => {
    saveActivity({ id: 'x1', date: '2099-01-07', sport: 'run', duration_sec: 3000, distance_m: 10_000, rpe: 6 });
    saveActivity({ id: 'x2', date: '2099-01-06', sport: 'bike', duration_sec: 5400 });
    expect(backupStatus().unsaved).toBe(3);
    expect(buildHistory(30).activities).toEqual([
      { date: '2099-01-06', sport: 'bike', duration_sec: 5400 },
      { date: '2099-01-07', sport: 'run', duration_sec: 3000, distance_m: 10_000, rpe: 6 },
    ]);
    expect(buildHistory(1).activities).toHaveLength(1);
    deleteActivity('x1');
    deleteActivity('x2');
    expect(buildHistory(30).activities).toBeUndefined();
  });
});
