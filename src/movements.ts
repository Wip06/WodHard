import type { Movement, Wod } from './types';

/** Tous les mouvements d'un WOD dans l'ordre : c'est la numérotation des adaptations (`index`). */
export function allMovements(wod: Wod): Movement[] {
  switch (wod.type) {
    case 'emom':
      return wod.slots.flat();
    case 'hyrox':
      return wod.segments;
    default:
      return wod.movements;
  }
}

/** Clé de comparaison : minuscules, sans accents ni ponctuation, sans « s » final. */
export const nameKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/s$/, '');

/**
 * Nom retenu pour chaque mouvement, en anglais comme en box, et ses variantes courantes, en
 * anglais ou en français. Pas de « squat » seul : il peut s'agir d'un air squat comme d'un back squat.
 */
const MOVEMENTS: Record<string, string[]> = {
  Run: ['running', 'jog', 'course', 'course à pied', 'footing', 'courir'],
  Rowing: ['row', 'rower', 'rameur'],
  SkiErg: ['ski erg', 'ski'],
  BikeErg: ['bike erg'],
  'Assault bike': ['air bike', 'echo bike', 'airbike'],
  'Wall ball': ['wallball', 'wall ball shot', 'lancer de médecine ball'],
  'Sled push': ['push sled', 'poussée de traîneau', 'poussée traîneau', 'traîneau poussé'],
  'Sled pull': ['pull sled', 'traction de traîneau', 'tirage de traîneau', 'traîneau tiré'],
  'Farmers carry': ['farmer carry', "farmer's carry", 'farmers walk', 'farmer walk', 'marche du fermier'],
  'Sandbag lunges': ['sandbag lunge', 'fentes sandbag', 'fentes avec sandbag', 'fentes au sandbag'],
  'Burpee broad jumps': ['burpee broad jump', 'bbj'],
  Burpee: [],
  Lunges: ['lunge', 'fente', 'fentes'],
  'Walking lunges': ['walking lunge', 'fentes marchées', 'fentes avant marchées'],
  'Pull-up': ['traction', 'tractions'],
  'Push-up': ['pompe', 'pompes'],
  'Air squat': ['squat au poids du corps', 'squat poids du corps'],
  'Front squat': ['squat avant'],
  'Back squat': ['squat arrière'],
  Deadlift: ['soulevé de terre'],
  Clean: ['épaulé'],
  'Clean and jerk': ['clean & jerk', 'épaulé-jeté', 'épaulé jeté'],
  Snatch: ['arraché'],
  'Strict press': ['développé militaire', 'shoulder press'],
  'Bench press': ['développé couché'],
  'Kettlebell swing': ['kb swing', 'swing kettlebell', 'swing'],
  'Box jump': ['saut sur box', 'saut sur boîte'],
  'Single under': ['corde à sauter', 'sauts à la corde', 'jump rope'],
  'Double under': ['du', 'double saut à la corde'],
  'Rope climb': ['montée de corde', 'grimper de corde'],
  'Toes to bar': ['t2b', 'ttb'],
  'Handstand push-up': ['hspu', 'pompe en équilibre', 'pompes en équilibre'],
  'Muscle-up': [],
  'Sit-up': ['abdos', 'relevé de buste', 'relevés de buste'],
  Plank: ['gainage', 'planche'],
  Repos: ['rest', 'récupération', 'récup', 'pause'],
};

/** Même chose pour le matériel. */
const EQUIPMENT: Record<string, string[]> = {
  Rower: ['rowing', 'rameur', 'row erg', 'concept2'],
  SkiErg: ['ski erg'],
  BikeErg: ['bike erg'],
  'Assault bike': ['air bike', 'echo bike', 'airbike'],
  Treadmill: ['tapis de course'],
  Barbell: ['barre', 'barre olympique', 'barre de musculation'],
  Plates: ['disques', 'disques de musculation'],
  Dumbbell: ['db', 'haltère', 'haltères', 'paire d’haltères', "paire d'haltères"],
  Kettlebell: ['kb'],
  'Wall ball': ['médecine ball', 'medicine ball', 'med ball', 'medball'],
  Sandbag: ['sac de sable'],
  Sled: ['traîneau'],
  Box: ['boîte', 'caisse', 'plyo box', 'box de saut'],
  'Jump rope': ['corde à sauter', 'speed rope'],
  'Climbing rope': ['corde à grimper', 'corde lisse'],
  'Pull-up bar': ['barre de traction', 'barre fixe', 'barre de tractions'],
  Rings: ['anneaux', 'gym rings'],
  Bench: ['banc'],
};

function index(table: Record<string, string[]>): Map<string, string> {
  return new Map(
    Object.entries(table).flatMap(([canonical, variants]) => [canonical, ...variants].map((variant) => [nameKey(variant), canonical])),
  );
}

const MOVEMENT_INDEX = index(MOVEMENTS);
const EQUIPMENT_INDEX = index(EQUIPMENT);

/** Espaces superflus retirés, première lettre en majuscule. */
export function tidyName(name: string): string {
  const text = name.trim().replace(/\s+/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Nom à enregistrer pour un mouvement : le nom anglais retenu s'il s'agit d'une variante connue,
 * sinon l'orthographe déjà utilisée dans l'appli (`known`, par clé), sinon le nom tel quel, nettoyé.
 */
export function canonicalName(name: string, known: ReadonlyMap<string, string> = new Map()): string {
  const key = nameKey(name);
  return MOVEMENT_INDEX.get(key) ?? known.get(key) ?? tidyName(name);
}

/** Pareil pour un élément de matériel. */
export function canonicalEquipment(item: string, known: ReadonlyMap<string, string> = new Map()): string {
  const key = nameKey(item);
  return EQUIPMENT_INDEX.get(key) ?? known.get(key) ?? tidyName(item);
}

/** Variantes connues d'un mouvement ou d'un matériel, pour le retrouver en cherchant « rameur ». */
export function nameVariants(name: string): string[] {
  const movement = canonicalName(name);
  const item = canonicalEquipment(name);
  return [...new Set([movement, ...(MOVEMENTS[movement] ?? []), item, ...(EQUIPMENT[item] ?? [])])];
}

/** Un repos s'écrit comme un mouvement « Repos » avec une durée. */
export const isRest = (movement: Movement) => movement.duration_sec !== undefined && canonicalName(movement.name) === 'Repos';

/** Orthographes déjà utilisées, par clé : la première rencontrée l'emporte. */
export interface KnownNames {
  movements: ReadonlyMap<string, string>;
  equipment: ReadonlyMap<string, string>;
}

export function knownNames(wods: Iterable<Wod>): KnownNames {
  const movements = new Map<string, string>();
  const equipment = new Map<string, string>();
  for (const wod of wods) {
    for (const movement of allMovements(wod)) {
      if (!movements.has(nameKey(movement.name))) movements.set(nameKey(movement.name), movement.name);
    }
    for (const item of wod.equipment ?? []) {
      if (!equipment.has(nameKey(item))) equipment.set(nameKey(item), item);
    }
  }
  return { movements, equipment };
}

/**
 * Le même WOD avec des noms réguliers : un mouvement écrit « rameur », « row » ou « Rowing » est
 * enregistré « Rowing », pour que l'historique et les records le retrouvent sous un seul nom.
 */
export function normalizeWod(wod: Wod, known?: KnownNames): Wod {
  const fix = (movement: Movement): Movement => ({ ...movement, name: canonicalName(movement.name, known?.movements) });
  const equipment = wod.equipment && [...new Set(wod.equipment.map((item) => canonicalEquipment(item, known?.equipment)))];
  const base = equipment ? { ...wod, equipment } : wod;
  switch (base.type) {
    case 'emom':
      return { ...base, slots: base.slots.map((slot) => slot.map(fix)) };
    case 'hyrox':
      return { ...base, segments: base.segments.map(fix) };
    default:
      return { ...base, movements: base.movements.map(fix) };
  }
}
