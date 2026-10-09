import type {
  AmrapScore,
  AmrapWod,
  AppData,
  EmomScore,
  EmomWod,
  ForTimeCapped,
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
  Wod,
} from './types';

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
type NumberKind = 'integer' | 'count' | 'positive';

const QUANTITIES = ['reps', 'distance_m', 'calories', 'duration_sec'] as const;
const MOVEMENT_KEYS = ['name', ...QUANTITIES, 'load_kg', 'notes'];
const WOD_KEYS = ['schema_version', 'type', 'title', 'description', 'warmup', 'equipment'];
const SCORE_KEYS = ['rx', 'rpe', 'notes'];
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

function checkMovement(raw: unknown, path: string, errors: string[], withQuantity: boolean): Movement | undefined {
  if (!isObj(raw)) return fail(errors, path, 'doit être un objet { "name": … }');
  const before = errors.length;
  unknownKeys(raw, MOVEMENT_KEYS, path, errors);

  const movement: Movement = { name: checkText(raw.name, join(path, 'name'), errors) ?? '' };
  const present = QUANTITIES.filter((key) => raw[key] !== undefined);
  if (withQuantity && present.length !== 1) {
    const received = present.length > 0 ? ` (reçu : ${present.join(', ')})` : '';
    fail(errors, path, `il faut exactement un champ parmi ${QUANTITIES.join(', ')}${received}`);
  } else if (!withQuantity && present.length > 0) {
    fail(errors, path, `${present.join(', ')} interdit quand rep_scheme est défini`);
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
  const notes = optionalText(raw.notes, join(path, 'notes'), errors);
  if (notes !== undefined) movement.notes = notes;

  return errors.length === before ? movement : undefined;
}

function checkMovements(
  raw: unknown,
  path: string,
  errors: string[],
  withQuantity: boolean,
  allowEmpty = false,
): Movement[] | undefined {
  if (raw === undefined) return fail(errors, path, 'champ manquant');
  if (!Array.isArray(raw)) return fail(errors, path, 'doit être une liste de mouvements');
  if (raw.length === 0 && !allowEmpty) return fail(errors, path, 'doit contenir au moins un mouvement');
  const before = errors.length;
  const movements = raw.map((item, i) => checkMovement(item, `${path}[${i}]`, errors, withQuantity));
  return errors.length === before ? movements.filter(isDefined) : undefined;
}

function checkSlots(raw: unknown, path: string, errors: string[], intervals?: number): Movement[][] | undefined {
  if (raw === undefined) return fail(errors, path, 'champ manquant');
  if (!Array.isArray(raw) || raw.length === 0) {
    return fail(errors, path, 'doit être une liste non vide de listes de mouvements');
  }
  const before = errors.length;
  const slots = raw.map((slot, i) => checkMovements(slot, `${path}[${i}]`, errors, true, true));
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

function checkWod(raw: unknown, path: string, errors: string[]): Wod | undefined {
  if (!isObj(raw)) return fail(errors, path, 'le WOD doit être un objet JSON { … }');
  const before = errors.length;
  const at = (key: string) => join(path, key);

  if (raw.schema_version !== 1) fail(errors, at('schema_version'), 'doit valoir 1');
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
  const base = { title: title ?? '', description, warmup, equipment };

  switch (raw.type) {
    case 'amrap': {
      unknownKeys(raw, [...WOD_KEYS, 'duration_sec', 'movements'], path, errors);
      const duration_sec = checkNumber(raw.duration_sec, at('duration_sec'), errors, 'integer');
      const movements = checkMovements(raw.movements, at('movements'), errors, true);
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
      const movements = checkMovements(raw.movements, at('movements'), errors, !hasScheme);
      if (errors.length > before || time_cap_sec === undefined || rounds === undefined || movements === undefined) {
        return undefined;
      }
      return compact<ForTimeWod>({ schema_version: 1, type: 'for_time', ...base, time_cap_sec, rounds, rep_scheme, movements });
    }
    case 'hyrox': {
      unknownKeys(raw, [...WOD_KEYS, 'segments', 'time_cap_sec'], path, errors);
      const segments = checkMovements(raw.segments, at('segments'), errors, true);
      const time_cap_sec =
        raw.time_cap_sec === undefined
          ? undefined
          : checkNumber(raw.time_cap_sec, at('time_cap_sec'), errors, 'integer');
      if (errors.length > before || segments === undefined) return undefined;
      return compact<HyroxWod>({ schema_version: 1, type: 'hyrox', ...base, time_cap_sec, segments });
    }
    default:
      return fail(errors, at('type'), 'doit valoir "amrap", "emom", "for_time" ou "hyrox"');
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
  const common = { rx: raw.rx === true, rpe, notes: optionalText(raw.notes, at('notes'), errors) };

  switch (wod.type) {
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
  return id !== undefined && added_at !== undefined && wod ? { id, added_at, wod } : undefined;
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
  if (!Array.isArray(raw.wods) || !Array.isArray(raw.results) || !Array.isArray(rawPlan)) {
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
  return result({ wods, results, plan }, errors);
}

export function parseBackup(text: string): Validation<AppData> {
  const json = parseJson(text);
  return json.ok ? validateBackup(json.value) : json;
}
