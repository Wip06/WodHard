import { describe, expect, it } from 'vitest';
import { BENCHMARKS } from '../src/benchmarks';
import { decodeShared, SHARE_PATH, shareUrl, unwrapSharedLink } from '../src/share';
import type { Wod } from '../src/types';
import { parseImport, parseWod, validateWod } from '../src/validate';

const BASE = 'https://wip06.github.io/WodHard/';
const wod: Wod = {
  schema_version: 1,
  type: 'amrap',
  title: 'Échauffement « spécial » 💪',
  description: 'Accents, guillemets et emoji : tout doit survivre au lien.',
  duration_sec: 600,
  movements: [{ name: 'Burpee', reps: 10, notes: 'Scaling : sans saut' }],
};
const dataOf = (url: string) => url.split(`#${SHARE_PATH}`)[1] ?? '';

describe('partage d’un WOD par lien', () => {
  it('met le WOD dans le lien, et le relit à l’identique', () => {
    const url = shareUrl(wod, BASE);
    expect(url.startsWith(`${BASE}#/partage/`)).toBe(true);
    // Rien qui doive être échappé dans une adresse.
    expect(dataOf(url)).toMatch(/^[A-Za-z0-9_-]+$/);
    const text = decodeShared(dataOf(url));
    expect(text === null ? null : parseWod(text)).toEqual({ ok: true, value: wod });
  });

  it('refuse un lien abîmé ou démesuré', () => {
    expect(decodeShared('pas+du/base64=')).toBeNull();
    expect(decodeShared('A'.repeat(20_001))).toBeNull();
    // Lisible, mais pas un WOD : la vérification habituelle le refuse.
    const text = decodeShared(dataOf(shareUrl({ ...wod, type: 'yoga' } as unknown as Wod, BASE)));
    expect(text === null ? null : parseWod(text).ok).toBe(false);
  });

  it('accepte le lien collé dans « Coller un WOD », avec le texte du message autour', () => {
    const message = `Regarde ce WOD : ${shareUrl(wod, BASE)} à faire samedi !`;
    expect(parseImport(unwrapSharedLink(message))).toEqual({ ok: true, value: { kind: 'wod', wod } });
    // Un JSON collé normalement passe sans changement.
    expect(unwrapSharedLink('{"a": 1}')).toBe('{"a": 1}');
  });
});

describe('bibliothèque de WOD', () => {
  it('sont tous acceptés par l’appli, et peuvent servir de référence', () => {
    for (const benchmark of BENCHMARKS) {
      expect(validateWod(benchmark), benchmark.title).toMatchObject({ ok: true });
      expect(benchmark.type, benchmark.title).not.toBe('session');
    }
  });

  it('ont chacun un nom différent, et la charge des femmes pour chaque mouvement chargé', () => {
    expect(new Set(BENCHMARKS.map((benchmark) => benchmark.title)).size).toBe(BENCHMARKS.length);
    for (const benchmark of BENCHMARKS) {
      const movements = benchmark.type === 'amrap' || benchmark.type === 'for_time' ? benchmark.movements : benchmark.type === 'emom' ? benchmark.slots.flat() : [];
      for (const movement of movements.filter((candidate) => candidate.load_kg !== undefined)) {
        expect(movement.notes, `${benchmark.title} : ${movement.name}`).toMatch(/^Rx femmes : \d+ kg$/);
      }
    }
  });
});
