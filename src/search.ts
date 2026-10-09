import { typeLabel, wodSummary } from './format';
import type { Movement, Wod } from './types';

/** Minuscules sans accents : « Échauffé » et « echauffe » se valent. */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

function movementsOf(wod: Wod): Movement[] {
  switch (wod.type) {
    case 'emom':
      return wod.slots.flat();
    case 'hyrox':
      return wod.segments;
    default:
      return wod.movements;
  }
}

/** Texte dans lequel un WOD est cherché : titre, type, résumé, description, matériel et mouvements. */
export function searchText(wod: Wod): string {
  const movements = movementsOf(wod).flatMap((movement) => [movement.name, movement.notes ?? '']);
  return normalize(
    [wod.title, typeLabel(wod.type), wodSummary(wod), wod.description ?? '', ...(wod.equipment ?? []), ...movements].join(' '),
  );
}

/** Vrai si chaque mot de la recherche figure dans le texte (déjà normalisé par searchText). */
export function matchesQuery(query: string, text: string): boolean {
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => text.includes(term));
}
