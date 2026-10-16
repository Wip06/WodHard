import { typeLabel, wodHeadline } from './format';
import { allMovements, nameVariants } from './movements';
import type { Wod } from './types';

/** Minuscules sans accents : « Échauffé » et « echauffe » se valent. */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Texte dans lequel un WOD est cherché : titre, type, résumé (avec « Duo »), description, matériel
 * et mouvements, avec leurs variantes connues (« rameur » retrouve « Rowing »).
 */
export function searchText(wod: Wod): string {
  const movements = allMovements(wod).flatMap((movement) => [movement.name, ...nameVariants(movement.name), movement.notes ?? '']);
  const equipment = (wod.equipment ?? []).flatMap((item) => [item, ...nameVariants(item)]);
  return normalize([wod.title, typeLabel(wod.type), wodHeadline(wod), wod.description ?? '', ...equipment, ...movements].join(' '));
}

/** Vrai si chaque mot de la recherche figure dans le texte (déjà normalisé par searchText). */
export function matchesQuery(query: string, text: string): boolean {
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => text.includes(term));
}
