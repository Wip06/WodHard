import { toast } from './dom';
import { addDays, mondayOf, today } from './format';
import { liftsOf } from './lifts';
import { knownNames, normalizeWod } from './movements';
import { recordIds, workKey } from './records';
import type { Clock } from './timer';
import type { Activity, AppData, Backup, HistoryExport, PlanEntry, ProgramItem, Result, SavedWod, SessionWod, SingleWod, StrengthSet, Wod } from './types';
import { isDate, isObj, validateBackup, validateWod } from './validate';

export const DATA_KEY = 'wodhard:data';
const SESSION_KEY = 'wodhard:session';
const EXPORT_KEY = 'wodhard:last-export';
const UNSAVED_KEY = 'wodhard:unsaved';
const SNOOZE_KEY = 'wodhard:backup-snooze';

/** Rappel de sauvegarde : à partir de tant de séances non exportées, ou d'une séance non exportée depuis tant de jours. */
const BACKUP_MAX_SESSIONS = 5;
const BACKUP_MAX_DAYS = 14;
const BACKUP_SNOOZE_DAYS = 3;
/** Exercices de force dont les repères partent au coach. */
const LIFTS_SENT = 20;

/** Séance de force en cours : séries faites, exercice en cours, repos en cours. */
export interface StrengthProgress {
  /** Séries faites, une liste par exercice du WOD. */
  done: StrengthSet[][];
  /** Exercice en cours, à partir de 0. */
  exercise: number;
  /** Fin du repos en cours (Date.now()), ou null hors repos. Le repos continue appli fermée. */
  restUntil: number | null;
}

/** Ce qu'un WOD a donné au chrono, de quoi pré-remplir son score. */
export interface Run {
  /** Tours complets comptés pendant un AMRAP ou un For Time. */
  rounds: number;
  /** Temps de passage (ms depuis le départ) à la fin de chaque tour ou segment validé au chrono. */
  marks: number[];
  /** Séance de force : séries notées au chrono. */
  strength?: StrengthProgress;
  /** Temps au chrono à l'arrêt ; absent quand le score est saisi sans chrono. */
  elapsedMs?: number;
  /** For Time et Hyrox : fini avant le time cap. AMRAP et EMOM : chrono allé au bout. */
  completed: boolean;
}

/** Séance en blocs en cours : les blocs déjà faits, et celui en cours (ou le suivant, entre deux blocs). */
export interface BlocksProgress {
  wod: SessionWod;
  index: number;
  /** Un par bloc terminé, dans l'ordre ; null pour un bloc passé. */
  runs: (Run | null)[];
  /** Entre deux blocs : fin du bloc précédent (Date.now()), pour afficher la pause. */
  endedAt?: number;
}

interface SessionBase {
  /** Au chrono d'une séance en blocs : le bloc en cours. Sinon, le WOD entier. */
  wod: Wod;
  wod_id?: string;
  rounds: number;
  marks: number[];
  strength?: StrengthProgress;
  blocks?: BlocksProgress;
}

/**
 * WOD en cours. Il est enregistré à chaque changement : si l'appli est fermée ou tuée
 * en plein effort, le chrono (ou le score à saisir) est retrouvé à la réouverture.
 */
export type Session =
  | (SessionBase & { stage: 'timer'; clock: Clock })
  /** Séance en blocs, entre deux blocs : `blocks.index` est le bloc suivant. */
  | (SessionBase & { stage: 'next'; blocks: BlocksProgress })
  | (SessionBase & Pick<Run, 'elapsedMs' | 'completed'> & { stage: 'score' });

/** Une ligne du programme, avec son WOD et, si elle est faite, la séance correspondante. */
export interface PlannedWod {
  entry: PlanEntry;
  saved: SavedWod;
  done?: Result;
}

const emptyData = (): AppData => ({ wods: [], results: [], plan: [], activities: [] });

let data: AppData = emptyData();
let session: Session | null = null;

export function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Charge les données. Renvoie un message si le contenu enregistré était illisible. */
export function loadData(): string | null {
  const raw = localStorage.getItem(DATA_KEY);
  if (raw === null) return null;
  try {
    const checked = validateBackup(JSON.parse(raw));
    if (checked.ok) {
      data = checked.value;
      return null;
    }
  } catch {
    // JSON illisible : traité comme un contenu invalide ci-dessous.
  }
  // On ne jette rien : le contenu brut est mis de côté avant de repartir à vide.
  localStorage.setItem(`${DATA_KEY}:illisible-${Date.now()}`, raw);
  localStorage.removeItem(DATA_KEY);
  data = emptyData();
  return 'Données enregistrées illisibles : une copie brute a été conservée dans le navigateur.';
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    toast('Enregistrement impossible : stockage plein ou bloqué');
  }
}

function saveData(): void {
  const backup: Backup = { wodhard_backup: 1, ...data };
  write(DATA_KEY, JSON.stringify(backup));
}

export const getWods = (): readonly SavedWod[] => data.wods;
export const getPlan = (): PlanEntry[] => [...data.plan];
export const findWod = (id: string) => data.wods.find((saved) => saved.id === id);
export const findResult = (id: string) => data.results.find((result) => result.id === id);
export const findActivity = (id: string) => data.activities.find((activity) => activity.id === id);

/** Orthographes déjà utilisées dans l'appli, reprises pour les noms qui n'ont pas de nom retenu. */
const known = () => knownNames([...data.wods.map((saved) => saved.wod), ...data.results.map((result) => result.wod)]);

function insertWod(raw: Wod): { saved: SavedWod; duplicate: boolean } {
  const names = known();
  const wod = normalizeWod(raw, names);
  const json = JSON.stringify(wod);
  // Un WOD enregistré avant la normalisation des noms reste reconnu comme doublon.
  const existing = data.wods.find((saved) => JSON.stringify(normalizeWod(saved.wod, names)) === json);
  if (existing) return { saved: existing, duplicate: true };
  const saved: SavedWod = { id: newId(), added_at: new Date().toISOString(), wod };
  data.wods.push(saved);
  return { saved, duplicate: false };
}

/** Ajoute une séance au programme ; null si ce WOD est déjà prévu ce jour-là. */
function insertPlan(wodId: string, date: string): PlanEntry | null {
  if (data.plan.some((entry) => entry.wod_id === wodId && entry.date === date)) return null;
  const entry: PlanEntry = { id: newId(), date, wod_id: wodId };
  data.plan.push(entry);
  return entry;
}

/** Ajoute un WOD ; s'il est déjà enregistré à l'identique, renvoie l'existant. */
export function addWod(wod: Wod): { saved: SavedWod; duplicate: boolean } {
  const added = insertWod(wod);
  if (!added.duplicate) saveData();
  return added;
}

/** Ajoute les WOD d'un programme collé et planifie ceux qui ont une date. */
export function addProgram(items: ProgramItem[]): { added: number; planned: number } {
  let added = 0;
  let planned = 0;
  for (const { date, wod } of items) {
    const { saved, duplicate } = insertWod(wod);
    if (!duplicate) added++;
    if (date !== undefined && insertPlan(saved.id, date) !== null) planned++;
  }
  saveData();
  return { added, planned };
}

/** Remplace le contenu d'un WOD. Les séances déjà faites gardent leur propre copie. */
export function updateWod(id: string, wod: Wod): void {
  const saved = findWod(id);
  if (!saved) return;
  saved.wod = normalizeWod(wod, known());
  saveData();
}

export function deleteWod(id: string): void {
  data.wods = data.wods.filter((saved) => saved.id !== id);
  data.plan = data.plan.filter((entry) => entry.wod_id !== id);
  saveData();
}

/** Planifie un WOD. Renvoie false s'il était déjà prévu ce jour-là. */
export function addPlan(wodId: string, date: string): boolean {
  const planned = insertPlan(wodId, date) !== null;
  if (planned) saveData();
  return planned;
}

/** Éléments retirés d'une liste, avec leur place, pour pouvoir les y remettre. */
type Removed<T> = { item: T; index: number }[];

function takeOut<T>(list: T[], remove: (item: T) => boolean): { kept: T[]; removed: Removed<T> } {
  const removed = list.map((item, index) => ({ item, index })).filter(({ item }) => remove(item));
  return { kept: list.filter((item) => !remove(item)), removed };
}

/** Remet des éléments retirés à leur place d'origine, sauf ceux qui y sont déjà revenus. */
function putBack<T extends { id: string }>(list: T[], removed: Removed<T>): void {
  for (const { item, index } of removed) {
    if (!list.some((other) => other.id === item.id)) list.splice(Math.min(index, list.length), 0, item);
  }
}

/**
 * Supprime des WOD de la bibliothèque, et donc du programme. Les séances faites gardent leur copie
 * du WOD. Renvoie de quoi annuler la suppression.
 */
export function removeWods(ids: string[]): () => void {
  const targets = new Set(ids);
  const wods = takeOut(data.wods, (saved) => targets.has(saved.id));
  const plan = takeOut(data.plan, (entry) => targets.has(entry.wod_id));
  data.wods = wods.kept;
  data.plan = plan.kept;
  saveData();
  return () => {
    putBack(data.wods, wods.removed);
    putBack(data.plan, plan.removed);
    saveData();
  };
}

/** Retire des séances du programme ; les WOD restent dans la bibliothèque. Renvoie de quoi annuler. */
export function removePlanEntries(ids: string[]): () => void {
  const targets = new Set(ids);
  const plan = takeOut(data.plan, (entry) => targets.has(entry.id));
  data.plan = plan.kept;
  saveData();
  return () => {
    putBack(data.plan, plan.removed);
    saveData();
  };
}

export interface ReschedulePreview {
  /** Séances qui bougeront : celles qui ne sont pas encore faites. */
  moved: number;
  /** Séances sélectionnées mais déjà faites : elles restent à leur date. */
  skippedDone: number;
  /** Nouvelles dates qui tomberaient un jour déjà pris par une autre séance. */
  conflicts: string[];
}

const pendingAmong = (ids: Set<string>) => data.plan.filter((entry) => ids.has(entry.id) && entry.result_id === undefined);

/** Dates actuelles des séances à reprogrammer, de la plus proche à la plus lointaine. */
export const pendingDates = (ids: string[]) =>
  pendingAmong(new Set(ids))
    .map((entry) => entry.date)
    .sort();

/** Ce que donnerait un décalage de `offset` jours, sans rien modifier. */
export function previewReschedule(ids: string[], offset: number): ReschedulePreview {
  const targets = new Set(ids);
  const selected = data.plan.filter((entry) => targets.has(entry.id));
  const pending = pendingAmong(targets);
  const staying = new Set(
    data.plan.filter((entry) => !targets.has(entry.id) || entry.result_id !== undefined).map((entry) => entry.date),
  );
  const conflicts = [...new Set(pending.map((entry) => addDays(entry.date, offset)).filter((date) => staying.has(date)))].sort();
  return { moved: pending.length, skippedDone: selected.length - pending.length, conflicts };
}

/** Dates données aux WOD planifiés en série : le premier à `start`, puis un tous les `every` jours. */
const seriesDates = (count: number, start: string, every: number) =>
  Array.from({ length: count }, (_, i) => addDays(start, i * every));

/** Dates de la série qui tomberaient un jour où une séance est déjà prévue. */
export function previewPlanning(wodIds: string[], start: string, every: number): string[] {
  const taken = new Set(data.plan.map((entry) => entry.date));
  return seriesDates(wodIds.length, start, every).filter((date) => taken.has(date));
}

/** Planifie des WOD de la bibliothèque dans l'ordre donné. Renvoie de quoi annuler. */
export function planWods(wodIds: string[], start: string, every: number): () => void {
  const dates = seriesDates(wodIds.length, start, every);
  const created = wodIds
    .map((id, i) => insertPlan(id, dates[i] ?? start))
    .filter((entry): entry is PlanEntry => entry !== null)
    .map((entry) => entry.id);
  saveData();
  return () => {
    data.plan = data.plan.filter((entry) => !created.includes(entry.id));
    saveData();
  };
}

/** Décale de `offset` jours les séances non faites, en gardant leurs écarts. Renvoie de quoi annuler. */
export function reschedulePlan(ids: string[], offset: number): () => void {
  const moved = pendingAmong(new Set(ids)).map((entry) => ({ entry, date: entry.date }));
  for (const { entry } of moved) entry.date = addDays(entry.date, offset);
  saveData();
  return () => {
    for (const { entry, date } of moved) entry.date = date;
    saveData();
  };
}

export function removePlan(id: string): void {
  data.plan = data.plan.filter((entry) => entry.id !== id);
  saveData();
}

const byDate = (a: PlanEntry, b: PlanEntry) => a.date.localeCompare(b.date);

/** Programme affiché : tout ce qui reste à faire, plus ce qui a été fait cette semaine. */
export function visiblePlan(): PlannedWod[] {
  const monday = mondayOf(today());
  const rows: PlannedWod[] = [];
  for (const entry of [...data.plan].sort(byDate)) {
    const saved = findWod(entry.wod_id);
    const done = entry.result_id === undefined ? undefined : findResult(entry.result_id);
    if (saved && (!done || entry.date >= monday)) rows.push({ entry, saved, done });
  }
  return rows;
}

/** Séances de la plus récente à la plus ancienne. */
export function sortedResults(): Result[] {
  return data.results
    .map((result, index) => ({ result, index }))
    .sort((a, b) => b.result.date.localeCompare(a.result.date) || b.index - a.index)
    .map(({ result }) => result);
}

export const resultsFor = (wodId: string) => sortedResults().filter((result) => result.wod_id === wodId);

/** Séances du même entraînement (même travail demandé), de la plus ancienne à la plus récente. */
export function sameWorkout(wod: Wod): Result[] {
  const key = workKey(wod);
  return sortedResults()
    .reverse()
    .filter((result) => workKey(result.wod) === key);
}

/** Identifiants des séances qui détiennent un record. */
export const currentRecords = () => recordIds(sortedResults().reverse());

/** Ajoute la séance, ou la remplace si son identifiant existe déjà. */
export function saveResult(result: Result): void {
  const index = data.results.findIndex((existing) => existing.id === result.id);
  if (index !== -1) {
    data.results[index] = result;
  } else {
    countUnsaved();
    data.results.push(result);
    // Une nouvelle séance coche la plus ancienne date encore prévue pour ce WOD.
    const pending = data.plan
      .filter((entry) => entry.wod_id === result.wod_id && entry.result_id === undefined)
      .sort(byDate)[0];
    if (pending) pending.result_id = result.id;
  }
  saveData();
}

/** Une séance de plus hors de toute sauvegarde. Compteur lu avant l'ajout : sans compteur, il part des séances déjà là. */
function countUnsaved(): void {
  const unsaved = readUnsaved();
  write(UNSAVED_KEY, JSON.stringify({ count: unsaved.count + 1, since: unsaved.since ?? today() }));
}

/** Activités d'autres sports, de la plus récente à la plus ancienne. */
export function sortedActivities(): Activity[] {
  return data.activities
    .map((activity, index) => ({ activity, index }))
    .sort((a, b) => b.activity.date.localeCompare(a.activity.date) || b.index - a.index)
    .map(({ activity }) => activity);
}

/** Ajoute l'activité, ou la remplace si son identifiant existe déjà. */
export function saveActivity(activity: Activity): void {
  const index = data.activities.findIndex((existing) => existing.id === activity.id);
  if (index !== -1) data.activities[index] = activity;
  else {
    countUnsaved();
    data.activities.push(activity);
  }
  saveData();
}

export function deleteActivity(id: string): void {
  data.activities = data.activities.filter((activity) => activity.id !== id);
  saveData();
}

export function deleteResult(id: string): void {
  data.results = data.results.filter((result) => result.id !== id);
  for (const entry of data.plan) {
    if (entry.result_id === id) delete entry.result_id;
  }
  saveData();
}

export function buildHistory(limit?: number): HistoryExport {
  const recent = sortedResults().slice(0, limit).reverse();
  const history: HistoryExport = {
    wodhard_history: 1,
    entries: recent.map(({ date, wod, score }) => ({ date, wod, score })),
  };
  const planned = visiblePlan().filter((row) => !row.done);
  if (planned.length > 0) history.planned = planned.map(({ entry, saved }) => ({ date: entry.date, wod: saved.wod }));
  const activities = sortedActivities().slice(0, limit).reverse();
  if (activities.length > 0) history.activities = activities.map(({ id: _id, ...activity }) => activity);
  // Repères de charge sur tout l'historique, pas seulement les séances envoyées.
  const lifts = liftsOf(sortedResults()).slice(0, LIFTS_SENT);
  if (lifts.length > 0) {
    history.lifts = lifts.map((lift) => {
      const last = lift.sessions.at(-1);
      return {
        name: lift.name,
        ...(lift.best && { one_rep_max_kg: Math.round(lift.best.oneRepMax * 2) / 2, best_set: { ...lift.best.set, date: lift.best.date } }),
        ...(last && { last: { date: last.date, sets: last.sets } }),
      };
    });
  }
  return history;
}

export function buildBackup(): Backup {
  return { wodhard_backup: 1, exported_at: new Date().toISOString(), ...data };
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) merged.set(item.id, item);
  return [...merged.values()];
}

export function applyBackup(incoming: AppData, mode: 'merge' | 'replace'): void {
  // Après un remplacement, les données sont exactement celles d'un fichier que l'on possède.
  if (mode === 'replace') clearUnsaved();
  data =
    mode === 'replace'
      ? incoming
      : {
          wods: mergeById(data.wods, incoming.wods),
          results: mergeById(data.results, incoming.results),
          plan: mergeById(data.plan, incoming.plan),
          activities: mergeById(data.activities, incoming.activities),
        };
  saveData();
}

export const lastExport = () => localStorage.getItem(EXPORT_KEY);

export function markExported(): void {
  write(EXPORT_KEY, new Date().toISOString());
  clearUnsaved();
}

/** Séances enregistrées depuis le dernier export, et date de la première d'entre elles. */
/** Séances enregistrées : WOD faits et activités d'autres sports. */
const sessionCount = () => data.results.length + data.activities.length;

function readUnsaved(): { count: number; since: string | null } {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(UNSAVED_KEY) ?? 'null');
    if (isObj(raw) && typeof raw.count === 'number') {
      return { count: raw.count, since: isDate(raw.since) ? raw.since : null };
    }
  } catch {
    // Compteur illisible : on repart du cas « jamais compté » ci-dessous.
  }
  // Avant l'existence de ce compteur : tout compte tant qu'aucun export n'a été fait.
  return { count: lastExport() ? 0 : sessionCount(), since: null };
}

function clearUnsaved(): void {
  write(UNSAVED_KEY, JSON.stringify({ count: 0, since: null }));
  write(SNOOZE_KEY, null);
}

/** Nombre de séances absentes de toute sauvegarde, et s'il est temps de le rappeler. */
export function backupStatus(): { unsaved: number; due: boolean } {
  const unsaved = readUnsaved();
  const { since } = unsaved;
  // Une séance supprimée ne compte plus : jamais plus de séances à sauvegarder qu'il n'en existe.
  const count = Math.min(unsaved.count, sessionCount());
  const snoozedUntil = localStorage.getItem(SNOOZE_KEY);
  const old = since !== null && since <= addDays(today(), -BACKUP_MAX_DAYS);
  const snoozed = snoozedUntil !== null && today() < snoozedUntil;
  return { unsaved: count, due: count > 0 && (count >= BACKUP_MAX_SESSIONS || old) && !snoozed };
}

export const snoozeBackup = () => write(SNOOZE_KEY, addDays(today(), BACKUP_SNOOZE_DAYS));

export const getSession = () => session;

export function setSession(next: Session | null): void {
  session = next;
  write(SESSION_KEY, next ? JSON.stringify(next) : null);
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const readMarks = (raw: unknown): number[] => (Array.isArray(raw) && raw.every((mark) => typeof mark === 'number') ? raw : []);

/** Relit ce qu'a donné un bloc terminé ; un bloc passé (ou illisible) vaut null. */
function readRun(raw: unknown, wod: SingleWod): Run | null {
  if (!isObj(raw)) return null;
  const strength = readStrength(raw.strength, wod);
  return {
    rounds: isCount(raw.rounds) ? Math.floor(raw.rounds) : 0,
    marks: readMarks(raw.marks),
    completed: raw.completed === true,
    ...(typeof raw.elapsedMs === 'number' && { elapsedMs: raw.elapsedMs }),
    ...(strength && { strength }),
  };
}

function readBlocks(raw: unknown): BlocksProgress | undefined {
  if (!isObj(raw) || !Array.isArray(raw.runs)) return undefined;
  const checked = validateWod(raw.wod);
  if (!checked.ok || checked.value.type !== 'session') return undefined;
  const wod = checked.value;
  const runs = raw.runs.slice(0, wod.blocks.length).map((run, i) => readRun(run, wod.blocks[i]!));
  const index = isCount(raw.index) ? Math.min(Math.floor(raw.index), wod.blocks.length - 1) : Math.min(runs.length, wod.blocks.length - 1);
  return { wod, index, runs, ...(typeof raw.endedAt === 'number' && { endedAt: raw.endedAt }) };
}

/** Relit la progression d'une séance de force enregistrée ; ce qui ne colle pas au WOD est écarté. */
function readStrength(raw: unknown, wod: Wod): StrengthProgress | undefined {
  if (!isObj(raw) || wod.type !== 'strength' || !Array.isArray(raw.done) || raw.done.length !== wod.exercises.length) return undefined;
  const done = raw.done.map((sets) =>
    (Array.isArray(sets) ? sets : []).filter(isObj).map((set) => {
      const kept: StrengthSet = {};
      if (isCount(set.reps)) kept.reps = set.reps;
      if (isCount(set.duration_sec)) kept.duration_sec = set.duration_sec;
      if (isCount(set.load_kg)) kept.load_kg = set.load_kg;
      return kept;
    }),
  );
  const exercise = isCount(raw.exercise) ? Math.min(Math.floor(raw.exercise), wod.exercises.length - 1) : 0;
  return { done, exercise, restUntil: typeof raw.restUntil === 'number' ? raw.restUntil : null };
}

function readSession(raw: unknown): Session | null {
  if (!isObj(raw)) return null;
  const wod = validateWod(raw.wod);
  const rounds = raw.rounds;
  if (!wod.ok || typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 0) return null;
  const marks = readMarks(raw.marks);
  const strength = readStrength(raw.strength, wod.value);
  const blocks = raw.blocks === undefined ? undefined : readBlocks(raw.blocks);
  if (raw.blocks !== undefined && !blocks) return null;
  const base = {
    wod: wod.value,
    rounds,
    marks,
    ...(typeof raw.wod_id === 'string' && { wod_id: raw.wod_id }),
    ...(strength && { strength }),
    ...(blocks && { blocks }),
  };

  if (raw.stage === 'timer') {
    const clock = raw.clock;
    if (!isObj(clock) || typeof clock.accumMs !== 'number') return null;
    if (clock.resumedAt !== null && typeof clock.resumedAt !== 'number') return null;
    return { stage: 'timer', ...base, clock: { accumMs: clock.accumMs, resumedAt: clock.resumedAt } };
  }
  if (raw.stage === 'next') return blocks ? { stage: 'next', ...base, blocks } : null;
  if (raw.stage === 'score') {
    const elapsed = typeof raw.elapsedMs === 'number' ? { elapsedMs: raw.elapsedMs } : {};
    return { stage: 'score', ...base, ...elapsed, completed: raw.completed === true };
  }
  return null;
}

export function loadSession(): void {
  try {
    session = readSession(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'));
  } catch {
    session = null;
  }
}
