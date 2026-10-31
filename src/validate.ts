import { allMovements } from './movements';
import type {
  Activity,
  Adjustment,
  AmrapScore,
  AmrapWod,
  AppData,
  EmomScore,
  EmomWod,
  Exercise,
  ForTimeCapped,
  Goal,
  ForTimeFinished,
  ForTimeWod,
  HyroxFinished,
  HyroxStopped,
  HyroxWod,
  Movement,
  PlanEntry,
  ProgramItem,
  Result,
  SavedWod,
  Score,
  SessionScore,
  SessionWod,
  SingleScore,
  SingleWod,
  Sport,
  StrengthScore,
  StrengthSet,
  StrengthWod,
  Wod,
} from './types';

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
type NumberKind = 'integer' | 'count' | 'positive';

const QUANTITIES = ['reps', 'distance_m', 'calories', 'duration_sec'] as const;
const MOVEMENT_KEYS = ['name', ...QUANTITIES, 'load_kg', 'load_count', 'notes'];
const ADJUSTMENT_KEYS = ['index', 'name', 'replaced_by', ...QUANTITIES, 'load_kg', 'load_count'];
const TEAM_MAX = 4;
const WOD_KEYS = ['schema_version', 'type', 'title', 'description', 'warmup', 'equipment', 'team_size'];
const SCORE_KEYS = ['rx', 'rpe', 'notes', 'adjustments'];
const EXERCISE_KEYS = ['name', 'sets', 'reps', 'duration_sec', 'load_kg', 'load_count', 'rest_sec', 'notes'];
const SET_KEYS = ['reps', 'duration_sec', 'load_kg'];
/** Séries au plus par exercice, et exercices au plus par séance. */
const MAX_SETS = 30;
const MAX_EXERCISES = 30;
/** Blocs d'une séance : au moins deux (un seul bloc, c'est un WOD de son format). */
const MIN_BLOCKS = 2;
const MAX_BLOCKS = 8;
/** Délai maximal pour refaire un WOD de référence, en semaines. */
const REFERENCE_MAX_WEEKS = 52;
const TITLE_MAX = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\w-]{1,64}$/;

const NUMBER_RULES: Record<NumberKind, string> = {
  integer: 'doit être un entier ≥ 1',
  count: 'doit être un entier ≥ 0',
  positive: 'doit être un nombre > 0',
};

export function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDate(value: unknown): value is string {
  return typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(value));
}

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;
const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

function fail(errors: string[], path: string, message: string): undefined {
  errors.push(path ? `${path} : ${message}` : message);
  return undefined;
}

function result<T>(value: T | undefined, errors: string[]): Validation<T> {
  if (value !== undefined && errors.length === 0) return { ok: true, value };
  return { ok: false, errors: errors.length > 0 ? errors : ['Contenu invalide.'] };
}

/** Retire les clés à `undefined` pour que l'objet enregistré soit identique à son JSON. */
function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function unknownKeys(raw: Obj, allowed: readonly string[], path: string, errors: string[]): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) fail(errors, join(path, key), 'champ inconnu');
  }
}

function checkNumber(value: unknown, path: string, errors: string[], kind: NumberKind): number | undefined {
  if (value === undefined) return fail(errors, path, 'champ manquant');
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(errors, path, NUMBER_RULES[kind]);
  const min = kind === 'count' ? 0 : 1;
  if (kind === 'positive' ? value <= 0 : !Number.isInteger(value) || value < min) {
    return fail(errors, path, NUMBER_RULES[kind]);
  }
  return value;
}

function checkText(value: unknown, path: string, errors: string[], max?: number): string | undefined {
  if (value === undefined) return fail(errors, path, 'champ manquant');
  if (typeof value !== 'string' || value.trim() === '') return fail(errors, path, 'doit être un texte non vide');
  const text = value.trim();
  if (max !== undefined && text.length > max) {
    return fail(errors, path, `${max} caractères maximum (${text.length} ici)`);
  }
  return text;
}

const optionalText = (value: unknown, path: string, errors: string[]) =>
  value === undefined ? undefined : checkText(value, path, errors);

/**
 * `exact` : exactement une quantité. `free` : au plus une, pour un For Time avec `rep_scheme`, où
 * un mouvement sans quantité suit le schéma et un mouvement avec quantité la garde à chaque tour.
 */
type QuantityRule = 'exact' | 'free';

function checkLoadCount(value: unknown, hasLoad: boolean, path: string, errors: string[]): number | undefined {
  if (value === undefined) return undefined;
  if (value !== 1 && value !== 2) return fail(errors, path, 'doit valoir 1 ou 2');
  if (!hasLoad) return fail(errors, path, 'demande aussi load_kg');
  return value;
}

function checkMovement(raw: unknown, path: string, errors: string[], rule: QuantityRule): Movement | undefined {
  if (!isObj(raw)) return fail(errors, path, 'doit être un objet { "name": … }');
  const before = errors.length;
  unknownKeys(raw, MOVEMENT_KEYS, path, errors);

  const movement: Movement = { name: checkText(raw.name, join(path, 'name'), errors) ?? '' };
  const present = QUANTITIES.filter((key) => raw[key] !== undefined);
  const received = present.length > 0 ? ` (reçu : ${present.join(', ')})` : '';
  if (rule === 'exact' && present.length !== 1) {
    fail(errors, path, `il faut exactement un champ parmi ${QUANTITIES.join(', ')}${received}`);
  } else if (rule === 'free' && present.length > 1) {
    fail(errors, path, `au plus un champ parmi ${QUANTITIES.join(', ')}${received}`);
  }
  for (const key of present) {
    const kind = key === 'distance_m' ? 'positive' : 'integer';
    const value = checkNumber(raw[key], join(path, key), errors, kind);
    if (value !== undefined) movement[key] = value;
  }
  if (raw.load_kg !== undefined) {
    const load = checkNumber(raw.load_kg, join(path, 'load_kg'), errors, 'positive');
    if (load !== undefined) movement.load_kg = load;
  }
  const count = checkLoadCount(raw.load_count, raw.load_kg !== undefined, join(path, 'load_count'), errors);
  if (count !== undefined) movement.load_count = count;
  const notes = optionalText(raw.notes, join(path, 'notes'), errors);
  if (notes !== undefined) movement.notes = notes;

  return errors.length === before ? movement : undefined;
}

/**
 * Une série de force : des répétitions ou une durée (exactement l'un des deux), et une charge
 * facultative. Avec `done`, c'est une série faite : 0 répétition (série ratée) est accepté.
 */
function checkSet(raw: unknown, path: string, errors: string[], done = false): StrengthSet | undefined {
  if (!isObj(raw)) return fail(errors, path, 'doit être un objet { "reps": …, "load_kg": … }');
  const before = errors.length;
  unknownKeys(raw, SET_KEYS, path, errors);
  const set: StrengthSet = {};
  const present = (['reps', 'duration_sec'] as const).filter((key) => raw[key] !== undefined);
  if (present.length !== 1) fail(errors, path, 'il faut exactement un champ parmi reps, duration_sec');
  for (const key of present) {
    const value = checkNumber(raw[key], join(path, key), errors, done ? 'count' : 'integer');
    if (value !== undefined) set[key] = value;
  }
  if (raw.load_kg !== undefined) {
    // Une charge peut être décimale (62,5 kg), faite ou prévue.
    const load = checkNumber(raw.load_kg, join(path, 'load_kg'), errors, 'positive');
    if (load !== undefined) set.load_kg = load;
  }
  return errors.length === before ? set : undefined;
}

/** Un exercice de force, en séries identiques (`sets` = leur nombre) ou détaillées (`sets` = la liste). */
function checkExercise(raw: unknown, path: string, errors: string[]): Exercise | undefined {
  if (!isObj(raw)) return fail(errors, path, 'doit être un objet { "name": …, "sets": … }');
  const before = errors.length;
  const at = (key: string) => join(path, key);
  unknownKeys(raw, EXERCISE_KEYS, path, errors);
  const exercise: Exercise = { name: checkText(raw.name, at('name'), errors) ?? '', sets: 0 };
  let hasLoad = false;
  if (Array.isArray(raw.sets)) {
    if (raw.sets.length === 0 || raw.sets.length > MAX_SETS) fail(errors, at('sets'), `doit contenir de 1 à ${MAX_SETS} séries`);
    for (const key of ['reps', 'duration_sec', 'load_kg']) {
      if (raw[key] !== undefined) fail(errors, at(key), 'à indiquer dans chaque série quand les séries sont détaillées');
    }
    const sets = raw.sets.map((set, i) => checkSet(set, `${at('sets')}[${i}]`, errors)).filter(isDefined);
    exercise.sets = sets;
    hasLoad = sets.some((set) => set.load_kg !== undefined);
  } else if (raw.sets === undefined) {
    fail(errors, at('sets'), 'champ manquant');
  } else {
    const count = checkNumber(raw.sets, at('sets'), errors, 'integer');
    if (count !== undefined && count > MAX_SETS) fail(errors, at('sets'), `${MAX_SETS} séries au plus`);
    const uniform = checkSet({ reps: raw.reps, duration_sec: raw.duration_sec, load_kg: raw.load_kg }, path, errors);
    exercise.sets = count ?? 0;
    if (uniform) Object.assign(exercise, uniform);
    hasLoad = raw.load_kg !== undefined;
  }
  const count = checkLoadCount(raw.load_count, hasLoad, at('load_count'), errors);
  if (count !== undefined) exercise.load_count = count;
  if (raw.rest_sec !== undefined) {
    const rest = checkNumber(raw.rest_sec, at('rest_sec'), errors, 'count');
    if (rest !== undefined) exercise.rest_sec = rest;
  }
  const notes = optionalText(raw.notes, at('notes'), errors);
  if (notes !== undefined) exercise.notes = notes;
  return errors.length === before ? exercise : undefined;
}

/** Séries réellement faites, une liste par exercice du WOD, dans le même ordre. */
function checkDoneSets(raw: unknown, wod: StrengthWod, path: string, errors: string[]): StrengthSet[][] | undefined {
  if (!Array.isArray(raw)) return fail(errors, path, 'doit être une liste, une par exercice');
  if (raw.length !== wod.exercises.length) {
    return fail(errors, path, `contient ${raw.length} exercices pour ${wod.exercises.length} dans le WOD`);
  }
  const before = errors.length;
  const lists = raw.map((sets, i) => {
    const at = `${path}[${i}]`;
    if (!Array.isArray(sets)) return fail(errors, at, 'doit être la liste des séries faites');
    if (sets.length > MAX_SETS) return fail(errors, at, `${MAX_SETS} séries au plus`);
    return sets.map((set, j) => checkSet(set, `${at}[${j}]`, errors, true)).filter(isDefined);
  });
  return errors.length === before ? lists.filter(isDefined) : undefined;
}

function checkMovements(
  raw: unknown,
  path: string,
  errors: string[],
  rule: QuantityRule,
  allowEmpty = false,
): Movement[] | undefined {
  if (raw === undefined) return fail(errors, path, 'champ manquant');
  if (!Array.isArray(raw)) return fail(errors, path, 'doit être une liste de mouvements');
  if (raw.length === 0 && !allowEmpty) return fail(errors, path, 'doit contenir au moins un mouvement');
  const before = errors.length;
  const movements = raw.map((item, i) => checkMovement(item, `${path}[${i}]`, errors, rule));
  return errors.length === before ? movements.filter(isDefined) : undefined;
}

function checkSlots(raw: unknown, path: string, errors: string[], intervals?: number): Movement[][] | undefined {
  if (raw === undefined) return fail(errors, path, 'champ manquant');
  if (!Array.isArray(raw) || raw.length === 0) {
    return fail(errors, path, 'doit être une liste non vide de listes de mouvements');
  }
  const before = errors.length;
  const slots = raw.map((slot, i) => checkMovements(slot, `${path}[${i}]`, errors, 'exact', true));
  if (intervals !== undefined && raw.length > intervals) {
    fail(errors, path, `${raw.length} slots pour seulement ${intervals} intervalles`);
  }
  if (errors.length > before) return undefined;
  const checked = slots.filter(isDefined);
  if (checked.every((slot) => slot.length === 0)) return fail(errors, path, 'aucun mouvement dans les slots');
  return checked;
}

function checkRepScheme(raw: unknown, path: string, errors: string[], rounds?: number): number[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return fail(errors, path, 'doit être une liste d’entiers, par exemple [21, 15, 9]');
  }
  const before = errors.length;
  const scheme = raw.map((reps, i) => checkNumber(reps, `${path}[${i}]`, errors, 'integer'));
  if (rounds !== undefined && raw.length !== rounds) {
    fail(errors, path, `contient ${raw.length} valeurs alors que rounds vaut ${rounds}`);
  }
  return errors.length === before ? scheme.filter(isDefined) : undefined;
}

/** Un WOD ; `inBlock` : c'est un bloc d'une séance, dont `schema_version` peut être omis. */
function checkWod(raw: unknown, path: string, errors: string[], inBlock = false): Wod | undefined {
  if (!isObj(raw)) return fail(errors, path, inBlock ? 'le bloc doit être un objet JSON { … }' : 'le WOD doit être un objet JSON { … }');
  const before = errors.length;
  const at = (key: string) => join(path, key);

  if (raw.schema_version !== 1 && !(inBlock && raw.schema_version === undefined)) fail(errors, at('schema_version'), 'doit valoir 1');
  const title = checkText(raw.title, at('title'), errors, TITLE_MAX);
  const description = optionalText(raw.description, at('description'), errors);
  const warmup = optionalText(raw.warmup, at('warmup'), errors);
  let equipment: string[] | undefined;
  if (raw.equipment !== undefined) {
    if (!Array.isArray(raw.equipment)) fail(errors, at('equipment'), 'doit être une liste de textes');
    else {
      equipment = raw.equipment
        .map((item, i) => checkText(item, `${at('equipment')}[${i}]`, errors))
        .filter(isDefined);
    }
  }
  let team_size: number | undefined;
  if (raw.team_size !== undefined) {
    team_size = checkNumber(raw.team_size, at('team_size'), errors, 'integer');
    if (team_size !== undefined && (team_size < 2 || team_size > TEAM_MAX)) {
      team_size = fail(errors, at('team_size'), `doit être compris entre 2 et ${TEAM_MAX} (à omettre pour un WOD en solo)`);
    }
  }
  const base = { title: title ?? '', description, warmup, equipment, team_size };

  switch (raw.type) {
    case 'amrap': {
      unknownKeys(raw, [...WOD_KEYS, 'duration_sec', 'movements'], path, errors);
      const duration_sec = checkNumber(raw.duration_sec, at('duration_sec'), errors, 'integer');
      const movements = checkMovements(raw.movements, at('movements'), errors, 'exact');
      if (errors.length > before || duration_sec === undefined || movements === undefined) return undefined;
      return compact<AmrapWod>({ schema_version: 1, type: 'amrap', ...base, duration_sec, movements });
    }
    case 'emom': {
      unknownKeys(raw, [...WOD_KEYS, 'interval_sec', 'intervals', 'slots'], path, errors);
      const interval_sec = checkNumber(raw.interval_sec, at('interval_sec'), errors, 'integer');
      const intervals = checkNumber(raw.intervals, at('intervals'), errors, 'integer');
      const slots = checkSlots(raw.slots, at('slots'), errors, intervals);
      if (errors.length > before || interval_sec === undefined || intervals === undefined || slots === undefined) {
        return undefined;
      }
      return compact<EmomWod>({ schema_version: 1, type: 'emom', ...base, interval_sec, intervals, slots });
    }
    case 'for_time': {
      unknownKeys(raw, [...WOD_KEYS, 'time_cap_sec', 'rounds', 'rep_scheme', 'movements'], path, errors);
      const time_cap_sec = checkNumber(raw.time_cap_sec, at('time_cap_sec'), errors, 'integer');
      const rounds = checkNumber(raw.rounds, at('rounds'), errors, 'integer');
      const hasScheme = raw.rep_scheme !== undefined;
      const rep_scheme = hasScheme ? checkRepScheme(raw.rep_scheme, at('rep_scheme'), errors, rounds) : undefined;
      const movements = checkMovements(raw.movements, at('movements'), errors, hasScheme ? 'free' : 'exact');
      if (errors.length > before || time_cap_sec === undefined || rounds === undefined || movements === undefined) {
        return undefined;
      }
      return compact<ForTimeWod>({ schema_version: 1, type: 'for_time', ...base, time_cap_sec, rounds, rep_scheme, movements });
    }
    case 'hyrox': {
      unknownKeys(raw, [...WOD_KEYS, 'segments', 'time_cap_sec'], path, errors);
      const segments = checkMovements(raw.segments, at('segments'), errors, 'exact');
      const time_cap_sec =
        raw.time_cap_sec === undefined
          ? undefined
          : checkNumber(raw.time_cap_sec, at('time_cap_sec'), errors, 'integer');
      if (errors.length > before || segments === undefined) return undefined;
      return compact<HyroxWod>({ schema_version: 1, type: 'hyrox', ...base, time_cap_sec, segments });
    }
    case 'strength': {
      unknownKeys(raw, [...WOD_KEYS, 'exercises'], path, errors);
      let exercises: Exercise[] | undefined;
      if (!Array.isArray(raw.exercises)) fail(errors, at('exercises'), 'doit être une liste d’exercices');
      else if (raw.exercises.length === 0 || raw.exercises.length > MAX_EXERCISES) {
        fail(errors, at('exercises'), `doit contenir de 1 à ${MAX_EXERCISES} exercices`);
      } else exercises = raw.exercises.map((item, i) => checkExercise(item, `${at('exercises')}[${i}]`, errors)).filter(isDefined);
      if (errors.length > before || exercises === undefined) return undefined;
      return compact<StrengthWod>({ schema_version: 1, type: 'strength', ...base, exercises });
    }
    case 'session': {
      if (inBlock) return fail(errors, at('type'), 'un bloc ne peut pas contenir d’autres blocs');
      unknownKeys(raw, [...WOD_KEYS, 'blocks'], path, errors);
      let blocks: SingleWod[] | undefined;
      if (!Array.isArray(raw.blocks)) fail(errors, at('blocks'), 'doit être une liste de WOD');
      else if (raw.blocks.length < MIN_BLOCKS || raw.blocks.length > MAX_BLOCKS) {
        fail(errors, at('blocks'), `doit contenir de ${MIN_BLOCKS} à ${MAX_BLOCKS} blocs (un seul bloc : donne directement son WOD)`);
      } else {
        blocks = raw.blocks
          .map((item, i) => checkWod(item, `${at('blocks')}[${i}]`, errors, true))
          .filter((block): block is SingleWod => block !== undefined && block.type !== 'session');
      }
      if (errors.length > before || blocks === undefined) return undefined;
      return compact<SessionWod>({ schema_version: 1, type: 'session', ...base, blocks });
    }
    default:
      return fail(
        errors,
        at('type'),
        inBlock ? 'doit valoir "amrap", "emom", "for_time", "hyrox" ou "strength"' : 'doit valoir "amrap", "emom", "for_time", "hyrox", "strength" ou "session"',
      );
  }
}

function checkScore(raw: unknown, wod: Wod, path: string, errors: string[]): Score | undefined {
  if (!isObj(raw)) return fail(errors, path, 'doit être un objet');
  const before = errors.length;
  const at = (key: string) => join(path, key);

  if (typeof raw.rx !== 'boolean') fail(errors, at('rx'), 'doit valoir true ou false');
  let rpe: number | undefined;
  if (raw.rpe !== undefined) {
    rpe = checkNumber(raw.rpe, at('rpe'), errors, 'integer');
    if (rpe !== undefined && rpe > 10) fail(errors, at('rpe'), 'doit être compris entre 1 et 10');
  }
  // Une séance en blocs note ses adaptations dans le score de chaque bloc.
  const adjustments =
    raw.adjustments === undefined
      ? undefined
      : wod.type === 'session'
        ? fail(errors, at('adjustments'), 'à noter dans le score de chaque bloc')
        : checkAdjustments(raw.adjustments, wod, at('adjustments'), errors);
  const common = { rx: raw.rx === true, rpe, notes: optionalText(raw.notes, at('notes'), errors), adjustments };

  switch (wod.type) {
    case 'session': {
      unknownKeys(raw, [...SCORE_KEYS, 'blocks'], path, errors);
      let blocks: (SingleScore | null)[] | undefined;
      if (!Array.isArray(raw.blocks)) fail(errors, at('blocks'), 'doit être une liste de scores, un par bloc');
      else if (raw.blocks.length !== wod.blocks.length) {
        fail(errors, at('blocks'), `contient ${raw.blocks.length} scores pour ${wod.blocks.length} blocs`);
      } else if (raw.blocks.every((item) => item === null)) {
        fail(errors, at('blocks'), 'au moins un bloc doit être fait');
      } else {
        blocks = raw.blocks.map((item, i) => {
          const block = wod.blocks[i];
          if (item === null || !block) return null;
          return (checkScore(item, block, `${at('blocks')}[${i}]`, errors) as SingleScore | undefined) ?? null;
        });
      }
      if (errors.length > before || blocks === undefined) return undefined;
      return compact<SessionScore>({ blocks, ...common });
    }
    case 'amrap': {
      unknownKeys(raw, [...SCORE_KEYS, 'rounds', 'extra_reps', 'splits_sec'], path, errors);
      const rounds = checkNumber(raw.rounds, at('rounds'), errors, 'count');
      const extra_reps = checkNumber(raw.extra_reps, at('extra_reps'), errors, 'count');
      const splits_sec = checkSplits(raw.splits_sec, at('splits_sec'), errors, { exact: rounds, unit: 'tours' });
      if (errors.length > before || rounds === undefined || extra_reps === undefined) return undefined;
      return compact<AmrapScore>({ rounds, extra_reps, splits_sec, ...common });
    }
    case 'emom': {
      unknownKeys(raw, [...SCORE_KEYS, 'intervals_completed'], path, errors);
      const intervals_completed = checkNumber(raw.intervals_completed, at('intervals_completed'), errors, 'count');
      if (intervals_completed !== undefined && intervals_completed > wod.intervals) {
        fail(errors, at('intervals_completed'), `ne peut pas dépasser ${wod.intervals}`);
      }
      if (errors.length > before || intervals_completed === undefined) return undefined;
      return compact<EmomScore>({ intervals_completed, ...common });
    }
    case 'for_time': {
      if (raw.finished === true) {
        unknownKeys(raw, [...SCORE_KEYS, 'finished', 'time_sec', 'splits_sec'], path, errors);
        const time_sec = checkNumber(raw.time_sec, at('time_sec'), errors, 'integer');
        const splits_sec = checkSplits(raw.splits_sec, at('splits_sec'), errors, { exact: wod.rounds, unit: 'tours' });
        if (errors.length > before || time_sec === undefined) return undefined;
        return compact<ForTimeFinished>({ finished: true, time_sec, splits_sec, ...common });
      }
      if (raw.finished === false) {
        unknownKeys(raw, [...SCORE_KEYS, 'finished', 'reps_completed', 'splits_sec'], path, errors);
        const reps_completed = checkNumber(raw.reps_completed, at('reps_completed'), errors, 'count');
        const splits_sec = checkSplits(raw.splits_sec, at('splits_sec'), errors, { max: wod.rounds, unit: 'tours' });
        if (errors.length > before || reps_completed === undefined) return undefined;
        return compact<ForTimeCapped>({ finished: false, reps_completed, splits_sec, ...common });
      }
      return fail(errors, at('finished'), 'doit valoir true ou false');
    }
    case 'strength': {
      unknownKeys(raw, [...SCORE_KEYS, 'exercises', 'duration_sec'], path, errors);
      const exercises = checkDoneSets(raw.exercises, wod, at('exercises'), errors);
      const duration_sec = raw.duration_sec === undefined ? undefined : checkNumber(raw.duration_sec, at('duration_sec'), errors, 'integer');
      if (errors.length > before || exercises === undefined) return undefined;
      return compact<StrengthScore>({ exercises, duration_sec, ...common });
    }
    case 'hyrox': {
      const total = wod.segments.length;
      if (raw.finished === true) {
        unknownKeys(raw, [...SCORE_KEYS, 'finished', 'time_sec', 'splits_sec'], path, errors);
        const time_sec = checkNumber(raw.time_sec, at('time_sec'), errors, 'integer');
        const splits_sec = checkSplits(raw.splits_sec, at('splits_sec'), errors, { exact: total, unit: SEGMENTS });
        if (errors.length > before || time_sec === undefined) return undefined;
        return compact<HyroxFinished>({ finished: true, time_sec, splits_sec, ...common });
      }
      if (raw.finished === false) {
        unknownKeys(raw, [...SCORE_KEYS, 'finished', 'segments_completed', 'splits_sec'], path, errors);
        const segments_completed = checkNumber(raw.segments_completed, at('segments_completed'), errors, 'count');
        if (segments_completed !== undefined && segments_completed > total) {
          fail(errors, at('segments_completed'), `ne peut pas dépasser ${total}`);
        }
        const splits_sec = checkSplits(raw.splits_sec, at('splits_sec'), errors, { exact: segments_completed, unit: SEGMENTS });
        if (errors.length > before || segments_completed === undefined) return undefined;
        return compact<HyroxStopped>({ finished: false, segments_completed, splits_sec, ...common });
      }
      return fail(errors, at('finished'), 'doit valoir true ou false');
    }
  }
}

const SEGMENTS = 'segments terminés';

/** Temps par tour ou par segment : il doit y en avoir exactement `exact`, ou au plus `max`. */
/** Adaptations d'une séance : chacune vise un mouvement du WOD, par son rang et son nom. */
function checkAdjustments(raw: unknown, wod: Wod, path: string, errors: string[]): Adjustment[] | undefined {
  if (!Array.isArray(raw)) return fail(errors, path, 'doit être une liste');
  const movements = allMovements(wod);
  const before = errors.length;
  const list = raw.map((item, i): Adjustment | undefined => {
    const at = `${path}[${i}]`;
    if (!isObj(item)) return fail(errors, at, 'doit être un objet');
    unknownKeys(item, ADJUSTMENT_KEYS, at, errors);
    const index = checkNumber(item.index, join(at, 'index'), errors, 'count');
    const target = index === undefined ? undefined : movements[index];
    if (index !== undefined && !target) return fail(errors, join(at, 'index'), `aucun mouvement n° ${index} dans ce WOD`);
    const name = checkText(item.name, join(at, 'name'), errors);
    if (target && name !== undefined && name !== target.name) {
      fail(errors, join(at, 'name'), `le mouvement n° ${index} est « ${target.name} »`);
    }
    const adjustment: Adjustment = { index: index ?? 0, name: name ?? '' };
    const replaced_by = optionalText(item.replaced_by, join(at, 'replaced_by'), errors);
    if (replaced_by !== undefined) adjustment.replaced_by = replaced_by;
    const expected = target ? QUANTITIES.find((key) => target[key] !== undefined) : undefined;
    const present = QUANTITIES.filter((key) => item[key] !== undefined);
    // Un mouvement remplacé peut se mesurer autrement (rameur en calories au lieu d'une course en mètres).
    if (replaced_by !== undefined && present.length > 1) fail(errors, at, `au plus un champ parmi ${QUANTITIES.join(', ')}`);
    for (const key of present) {
      if (target && replaced_by === undefined && key !== expected) {
        fail(errors, join(at, key), expected ? `ce mouvement se mesure en ${expected}` : 'ce mouvement suit le schéma de reps : seule la charge change');
      }
      const value = checkNumber(item[key], join(at, key), errors, key === 'distance_m' ? 'positive' : 'integer');
      if (value !== undefined) adjustment[key] = value;
    }
    if (item.load_kg !== undefined) {
      const load = checkNumber(item.load_kg, join(at, 'load_kg'), errors, 'positive');
      if (load !== undefined) adjustment.load_kg = load;
    }
    const count = checkLoadCount(item.load_count, true, join(at, 'load_count'), errors);
    if (count !== undefined) adjustment.load_count = count;
    if (present.length === 0 && replaced_by === undefined && item.load_kg === undefined && item.load_count === undefined) {
      fail(errors, at, 'aucune valeur réalisée');
    }
    return adjustment;
  });
  return errors.length === before ? list.filter(isDefined) : undefined;
}

function checkSplits(
  raw: unknown,
  path: string,
  errors: string[],
  rule: { exact?: number; max?: number; unit: string },
): number[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return fail(errors, path, 'doit être une liste de durées en secondes');
  const before = errors.length;
  const splits = raw.map((sec, i) => checkNumber(sec, `${path}[${i}]`, errors, 'count'));
  if (rule.exact !== undefined && raw.length !== rule.exact) {
    fail(errors, path, `contient ${raw.length} temps pour ${rule.exact} ${rule.unit}`);
  } else if (rule.max !== undefined && raw.length > rule.max) {
    fail(errors, path, `contient ${raw.length} temps pour ${rule.max} ${rule.unit} au plus`);
  }
  return errors.length === before ? splits.filter(isDefined) : undefined;
}

function checkId(value: unknown, path: string, errors: string[]): string | undefined {
  return typeof value === 'string' && ID.test(value) ? value : fail(errors, path, 'identifiant invalide');
}

function checkSavedWod(raw: unknown, path: string, errors: string[]): SavedWod | undefined {
  if (!isObj(raw)) return fail(errors, path, 'doit être un objet');
  const id = checkId(raw.id, join(path, 'id'), errors);
  const added_at = checkText(raw.added_at, join(path, 'added_at'), errors);
  const wod = checkWod(raw.wod, join(path, 'wod'), errors);
  let reference_weeks: number | undefined;
  if (raw.reference_weeks !== undefined) {
    reference_weeks = checkNumber(raw.reference_weeks, join(path, 'reference_weeks'), errors, 'integer');
    if (reference_weeks !== undefined && reference_weeks > REFERENCE_MAX_WEEKS) {
      reference_weeks = fail(errors, join(path, 'reference_weeks'), `doit être compris entre 1 et ${REFERENCE_MAX_WEEKS}`);
    }
  }
  if (id === undefined || added_at === undefined || !wod) return undefined;
  return reference_weeks === undefined ? { id, added_at, wod } : { id, added_at, wod, reference_weeks };
}

function checkResult(raw: unknown, path: string, errors: string[]): Result | undefined {
  if (!isObj(raw)) return fail(errors, path, 'doit être un objet');
  const id = checkId(raw.id, join(path, 'id'), errors);
  const wod_id = raw.wod_id === undefined ? undefined : checkId(raw.wod_id, join(path, 'wod_id'), errors);
  const date = isDate(raw.date) ? raw.date : fail(errors, join(path, 'date'), 'date attendue au format AAAA-MM-JJ');
  const wod = checkWod(raw.wod, join(path, 'wod'), errors);
  const score = wod ? checkScore(raw.score, wod, join(path, 'score'), errors) : undefined;
  if (id === undefined || date === undefined || !wod || !score) return undefined;
  return compact<Result>({ id, wod_id, date, wod, score });
}

function checkPlanEntry(raw: unknown, path: string, errors: string[]): PlanEntry | undefined {
  if (!isObj(raw)) return fail(errors, path, 'doit être un objet');
  const id = checkId(raw.id, join(path, 'id'), errors);
  const wod_id = checkId(raw.wod_id, join(path, 'wod_id'), errors);
  const result_id = raw.result_id === undefined ? undefined : checkId(raw.result_id, join(path, 'result_id'), errors);
  const date = isDate(raw.date) ? raw.date : fail(errors, join(path, 'date'), 'date attendue au format AAAA-MM-JJ');
  if (id === undefined || wod_id === undefined || date === undefined) return undefined;
  return compact<PlanEntry>({ id, date, wod_id, result_id });
}

export const SPORTS: Sport[] = ['run', 'bike', 'swim', 'row', 'walk', 'other'];
const ACTIVITY_KEYS = ['id', 'date', 'sport', 'title', 'duration_sec', 'distance_m', 'rpe', 'notes'];

function checkActivity(raw: unknown, path: string, errors: string[]): Activity | undefined {
  if (!isObj(raw)) return fail(errors, path, 'doit être un objet');
  const before = errors.length;
  const at = (key: string) => join(path, key);
  unknownKeys(raw, ACTIVITY_KEYS, path, errors);
  const id = checkId(raw.id, at('id'), errors);
  const date = isDate(raw.date) ? raw.date : fail(errors, at('date'), 'date attendue au format AAAA-MM-JJ');
  const sport = SPORTS.find((name) => name === raw.sport);
  if (!sport) fail(errors, at('sport'), `doit valoir ${SPORTS.map((name) => `"${name}"`).join(', ')}`);
  const title =
    raw.title !== undefined
      ? checkText(raw.title, at('title'), errors, TITLE_MAX)
      : sport === 'other'
        ? fail(errors, at('title'), 'champ manquant : quel sport ?')
        : undefined;
  const duration_sec = checkNumber(raw.duration_sec, at('duration_sec'), errors, 'integer');
  const distance_m = raw.distance_m === undefined ? undefined : checkNumber(raw.distance_m, at('distance_m'), errors, 'positive');
  let rpe: number | undefined;
  if (raw.rpe !== undefined) {
    rpe = checkNumber(raw.rpe, at('rpe'), errors, 'integer');
    if (rpe !== undefined && rpe > 10) rpe = fail(errors, at('rpe'), 'doit être compris entre 1 et 10');
  }
  const notes = optionalText(raw.notes, at('notes'), errors);
  if (errors.length > before || id === undefined || date === undefined || !sport || duration_sec === undefined) return undefined;
  return compact<Activity>({ id, date, sport, title, duration_sec, distance_m, rpe, notes });
}

/** Valide une activité saisie dans le formulaire. */
const GOAL_KEYS: Record<Goal['kind'], string[]> = {
  lift: ['exercise', 'load_kg', 'reps'],
  wod: ['wod', 'wod_id', 'time_sec', 'rounds', 'extra_reps'],
  free: ['title', 'done_on'],
};

function checkGoal(raw: unknown, path: string, errors: string[]): Goal | undefined {
  if (!isObj(raw)) return fail(errors, path, 'doit être un objet');
  const before = errors.length;
  const at = (key: string) => join(path, key);
  const id = checkId(raw.id, at('id'), errors);
  const created = isDate(raw.created) ? raw.created : fail(errors, at('created'), 'date attendue au format AAAA-MM-JJ');
  const date = raw.date === undefined ? undefined : isDate(raw.date) ? raw.date : fail(errors, at('date'), 'date attendue au format AAAA-MM-JJ');
  const notes = optionalText(raw.notes, at('notes'), errors);
  const kind = (['lift', 'wod', 'free'] as const).find((name) => name === raw.kind);
  if (!kind) return fail(errors, at('kind'), 'doit valoir "lift", "wod" ou "free"');
  unknownKeys(raw, ['id', 'kind', 'created', 'date', 'notes', ...GOAL_KEYS[kind]], path, errors);
  const base = { id: id ?? '', created: created ?? '', date, notes };

  switch (kind) {
    case 'lift': {
      const exercise = checkText(raw.exercise, at('exercise'), errors, TITLE_MAX);
      const load_kg = checkNumber(raw.load_kg, at('load_kg'), errors, 'positive');
      const reps = checkNumber(raw.reps, at('reps'), errors, 'integer');
      if (errors.length > before || exercise === undefined || load_kg === undefined || reps === undefined) return undefined;
      return compact<Goal>({ kind, ...base, exercise, load_kg, reps });
    }
    case 'wod': {
      const wod = checkWod(raw.wod, at('wod'), errors);
      if (wod && wod.type !== 'amrap' && wod.type !== 'for_time' && wod.type !== 'hyrox') {
        return fail(errors, at('wod'), 'un objectif se fixe sur un AMRAP, un For Time ou un Hyrox');
      }
      const wod_id = raw.wod_id === undefined ? undefined : checkId(raw.wod_id, at('wod_id'), errors);
      const timed = wod?.type !== 'amrap';
      const time_sec = timed ? checkNumber(raw.time_sec, at('time_sec'), errors, 'integer') : undefined;
      const rounds = timed ? undefined : checkNumber(raw.rounds, at('rounds'), errors, 'count');
      const extra_reps = timed || raw.extra_reps === undefined ? undefined : checkNumber(raw.extra_reps, at('extra_reps'), errors, 'count');
      if (timed && raw.rounds !== undefined) fail(errors, at('rounds'), 'seulement pour un AMRAP');
      if (!timed && raw.time_sec !== undefined) fail(errors, at('time_sec'), 'pas pour un AMRAP : donne rounds');
      if (!timed && rounds === 0 && !extra_reps) fail(errors, at('rounds'), 'objectif vide');
      if (errors.length > before || !wod) return undefined;
      return compact<Goal>({ kind, ...base, wod, wod_id, time_sec, rounds, extra_reps });
    }
    case 'free': {
      const title = checkText(raw.title, at('title'), errors, TITLE_MAX);
      const done_on = raw.done_on === undefined ? undefined : isDate(raw.done_on) ? raw.done_on : fail(errors, at('done_on'), 'date attendue au format AAAA-MM-JJ');
      if (errors.length > before || title === undefined) return undefined;
      return compact<Goal>({ kind, ...base, title, done_on });
    }
  }
}

export function validateGoal(raw: unknown): Validation<Goal> {
  const errors: string[] = [];
  return result(checkGoal(raw, '', errors), errors);
}

export function validateActivity(raw: unknown): Validation<Activity> {
  const errors: string[] = [];
  return result(checkActivity(raw, '', errors), errors);
}

function checkProgramItem(raw: unknown, path: string, errors: string[]): ProgramItem | undefined {
  if (!isObj(raw)) return fail(errors, path, 'doit être un objet { "date": …, "wod": … }');
  const before = errors.length;
  unknownKeys(raw, ['date', 'wod'], path, errors);
  if (raw.date !== undefined && !isDate(raw.date)) {
    fail(errors, join(path, 'date'), 'date attendue au format AAAA-MM-JJ');
  }
  const wod = checkWod(raw.wod, join(path, 'wod'), errors);
  if (errors.length > before || !wod) return undefined;
  return compact<ProgramItem>({ date: isDate(raw.date) ? raw.date : undefined, wod });
}

/** Isole le JSON d'une réponse copiée en entier (bloc ```json, phrase autour…). */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start !== -1 && end > start ? body.slice(start, end + 1) : body;
}

function parseJson(text: string): Validation<unknown> {
  try {
    return { ok: true, value: JSON.parse(extractJson(text)) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'erreur de lecture';
    return { ok: false, errors: [`Ce texte n’est pas du JSON valide (${detail}).`] };
  }
}

export function validateWod(raw: unknown): Validation<Wod> {
  const errors: string[] = [];
  return result(checkWod(raw, '', errors), errors);
}

export function parseWod(text: string): Validation<Wod> {
  const json = parseJson(text);
  return json.ok ? validateWod(json.value) : json;
}

export function validateProgram(raw: unknown): Validation<ProgramItem[]> {
  if (!isObj(raw) || raw.wodhard_program !== 1) {
    return { ok: false, errors: ['Ce JSON n’est pas un programme WODHARD ("wodhard_program": 1 absent).'] };
  }
  const errors: string[] = [];
  unknownKeys(raw, ['wodhard_program', 'wods'], '', errors);
  if (!Array.isArray(raw.wods) || raw.wods.length === 0) {
    fail(errors, 'wods', 'doit être une liste non vide de { "date": …, "wod": … }');
    return { ok: false, errors };
  }
  const items = raw.wods.map((item, i) => checkProgramItem(item, `wods[${i}]`, errors)).filter(isDefined);
  return result(items, errors);
}

export type Import = { kind: 'wod'; wod: Wod } | { kind: 'program'; items: ProgramItem[] };

/** Lit ce qui est collé dans l'appli : un WOD seul ou un programme de plusieurs WOD. */
export function parseImport(text: string): Validation<Import> {
  const json = parseJson(text);
  if (!json.ok) return json;
  if (isObj(json.value) && 'wodhard_program' in json.value) {
    const program = validateProgram(json.value);
    return program.ok ? { ok: true, value: { kind: 'program', items: program.value } } : program;
  }
  const wod = validateWod(json.value);
  return wod.ok ? { ok: true, value: { kind: 'wod', wod: wod.value } } : wod;
}

export function validateScore(raw: unknown, wod: Wod): Validation<Score> {
  const errors: string[] = [];
  return result(checkScore(raw, wod, '', errors), errors);
}

export function validateBackup(raw: unknown): Validation<AppData> {
  if (!isObj(raw) || raw.wodhard_backup !== 1) {
    return { ok: false, errors: ['Ce fichier n’est pas une sauvegarde WODHARD ("wodhard_backup": 1 absent).'] };
  }
  const errors: string[] = [];
  if (!Array.isArray(raw.wods)) fail(errors, 'wods', 'doit être une liste');
  if (!Array.isArray(raw.results)) fail(errors, 'results', 'doit être une liste');
  // `plan` est absent des sauvegardes faites avant l'ajout du programme.
  const rawPlan = raw.plan ?? [];
  if (!Array.isArray(rawPlan)) fail(errors, 'plan', 'doit être une liste');
  // `activities` est absent des sauvegardes faites avant l'ajout des autres sports, `goals` avant les objectifs.
  const rawActivities = raw.activities ?? [];
  if (!Array.isArray(rawActivities)) fail(errors, 'activities', 'doit être une liste');
  const rawGoals = raw.goals ?? [];
  if (!Array.isArray(rawGoals)) fail(errors, 'goals', 'doit être une liste');
  if (!Array.isArray(raw.wods) || !Array.isArray(raw.results) || !Array.isArray(rawPlan) || !Array.isArray(rawActivities) || !Array.isArray(rawGoals)) {
    return { ok: false, errors };
  }

  const wods = raw.wods.map((item, i) => checkSavedWod(item, `wods[${i}]`, errors)).filter(isDefined);
  const results = raw.results.map((item, i) => checkResult(item, `results[${i}]`, errors)).filter(isDefined);
  const wodIds = new Set(wods.map((saved) => saved.id));
  const resultIds = new Set(results.map((done) => done.id));
  // Une entrée de programme dont le WOD ou la séance n'existe plus est remise en cohérence, pas refusée.
  const plan = rawPlan
    .map((item, i) => checkPlanEntry(item, `plan[${i}]`, errors))
    .filter(isDefined)
    .filter((entry) => wodIds.has(entry.wod_id))
    .map((entry) => {
      if (entry.result_id !== undefined && !resultIds.has(entry.result_id)) delete entry.result_id;
      return entry;
    });
  const activities = rawActivities.map((item, i) => checkActivity(item, `activities[${i}]`, errors)).filter(isDefined);
  const goals = rawGoals.map((item, i) => checkGoal(item, `goals[${i}]`, errors)).filter(isDefined);
  return result({ wods, results, plan, activities, goals }, errors);
}

export function parseBackup(text: string): Validation<AppData> {
  const json = parseJson(text);
  return json.ok ? validateBackup(json.value) : json;
}
