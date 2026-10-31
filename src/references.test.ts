import { describe, expect, it } from 'vitest';
import { agoText, referenceOf } from './references';
import type { ForTimeWod, Result, SavedWod } from './types';
import { validateBackup } from './validate';

const fran: ForTimeWod = {
  schema_version: 1,
  type: 'for_time',
  title: 'Fran',
  time_cap_sec: 600,
  rounds: 3,
  rep_scheme: [21, 15, 9],
  movements: [{ name: 'Thruster', load_kg: 43 }, { name: 'Pull-up' }],
};
const saved: SavedWod = { id: 'fran', added_at: '2026-01-01T00:00:00.000Z', wod: fran, reference_weeks: 8 };
const done = (id: string, date: string, time_sec: number, rx = true): Result => ({ id, wod_id: 'fran', date, wod: fran, score: { finished: true, time_sec, rx } });

describe('WOD de référence', () => {
  const history = [done('a', '2026-08-01', 372), done('b', '2026-09-12', 318), done('c', '2026-10-10', 330)];

  it('dernier score, record et date du prochain test', () => {
    const reference = referenceOf(saved, history, '2026-11-20');
    expect(reference?.last?.id).toBe('c');
    expect(reference?.best?.id).toBe('b');
    expect(reference?.dueOn).toBe('2026-12-05');
    expect(reference?.due).toBe(false);
    expect(referenceOf(saved, history, '2026-12-05')?.due).toBe(true);
  });

  it('pas encore fait : rien à refaire ; WOD ordinaire : pas une référence', () => {
    expect(referenceOf(saved, [], '2026-11-20')).toMatchObject({ due: false, dueOn: undefined, last: undefined });
    expect(referenceOf({ ...saved, reference_weeks: undefined }, history, '2026-11-20')).toBeNull();
  });

  it('un temps Rx bat un temps plus court en scaled', () => {
    const reference = referenceOf(saved, [...history, done('d', '2026-11-01', 290, false)], '2026-11-20');
    expect(reference?.best?.id).toBe('b');
  });

  it('dit depuis quand', () => {
    expect(agoText('2026-11-20', '2026-11-20')).toBe('aujourd’hui');
    expect(agoText('2026-11-19', '2026-11-20')).toBe('hier');
    expect(agoText('2026-11-10', '2026-11-20')).toBe('il y a 10 jours');
    expect(agoText('2026-09-20', '2026-11-20')).toBe('il y a 2 mois');
    expect(agoText('2026-10-01', '2026-11-20')).toBe('il y a 7 semaines');
  });

  it('le délai se garde dans une sauvegarde, entre 1 et 52 semaines', () => {
    const backup = (weeks: unknown) => validateBackup({ wodhard_backup: 1, wods: [{ ...saved, reference_weeks: weeks }], results: [], plan: [], activities: [] });
    expect(backup(8)).toMatchObject({ ok: true, value: { wods: [saved] } });
    expect(backup(60)).toEqual({ ok: false, errors: ['wods[0].reference_weeks : doit être compris entre 1 et 52'] });
  });
});
