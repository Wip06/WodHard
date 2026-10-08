import { toast } from './dom';
import type { Clock } from './timer';
import type { AppData, Backup, HistoryExport, Result, SavedWod, Wod } from './types';
import { isObj, validateBackup, validateWod } from './validate';

export const DATA_KEY = 'wodhard:data';
const SESSION_KEY = 'wodhard:session';
const EXPORT_KEY = 'wodhard:last-export';

/**
 * WOD en cours. Il est enregistré à chaque changement : si l'appli est fermée ou tuée
 * en plein effort, le chrono (ou le score à saisir) est retrouvé à la réouverture.
 */
export type Session =
  | { stage: 'timer'; wod: Wod; wod_id?: string; clock: Clock; rounds: number }
  | {
      stage: 'score';
      wod: Wod;
      wod_id?: string;
      rounds: number;
      /** Temps au chrono à l'arrêt ; absent quand le score est saisi sans chrono. */
      elapsedMs?: number;
      /** For Time : fini avant le time cap. AMRAP et EMOM : chrono allé au bout. */
      completed: boolean;
    };

let data: AppData = { wods: [], results: [] };
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
  data = { wods: [], results: [] };
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
export const findWod = (id: string) => data.wods.find((saved) => saved.id === id);
export const findResult = (id: string) => data.results.find((result) => result.id === id);

/** Ajoute un WOD ; s'il est déjà enregistré à l'identique, renvoie l'existant. */
export function addWod(wod: Wod): { saved: SavedWod; duplicate: boolean } {
  const json = JSON.stringify(wod);
  const existing = data.wods.find((saved) => JSON.stringify(saved.wod) === json);
  if (existing) return { saved: existing, duplicate: true };
  const saved: SavedWod = { id: newId(), added_at: new Date().toISOString(), wod };
  data.wods.push(saved);
  saveData();
  return { saved, duplicate: false };
}

export function deleteWod(id: string): void {
  data.wods = data.wods.filter((saved) => saved.id !== id);
  saveData();
}

/** Séances de la plus récente à la plus ancienne. */
export function sortedResults(): Result[] {
  return data.results
    .map((result, index) => ({ result, index }))
    .sort((a, b) => b.result.date.localeCompare(a.result.date) || b.index - a.index)
    .map(({ result }) => result);
}

export const resultsFor = (wodId: string) => sortedResults().filter((result) => result.wod_id === wodId);

/** Ajoute la séance, ou la remplace si son identifiant existe déjà. */
export function saveResult(result: Result): void {
  const index = data.results.findIndex((existing) => existing.id === result.id);
  if (index === -1) data.results.push(result);
  else data.results[index] = result;
  saveData();
}

export function deleteResult(id: string): void {
  data.results = data.results.filter((result) => result.id !== id);
  saveData();
}

export function buildHistory(limit?: number): HistoryExport {
  const recent = sortedResults().slice(0, limit).reverse();
  return { wodhard_history: 1, entries: recent.map(({ date, wod, score }) => ({ date, wod, score })) };
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
  data =
    mode === 'replace'
      ? incoming
      : { wods: mergeById(data.wods, incoming.wods), results: mergeById(data.results, incoming.results) };
  saveData();
}

export const lastExport = () => localStorage.getItem(EXPORT_KEY);
export const markExported = () => write(EXPORT_KEY, new Date().toISOString());

export const getSession = () => session;

export function setSession(next: Session | null): void {
  session = next;
  write(SESSION_KEY, next ? JSON.stringify(next) : null);
}

function readSession(raw: unknown): Session | null {
  if (!isObj(raw)) return null;
  const wod = validateWod(raw.wod);
  const rounds = raw.rounds;
  if (!wod.ok || typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 0) return null;
  const base = { wod: wod.value, rounds, ...(typeof raw.wod_id === 'string' && { wod_id: raw.wod_id }) };

  if (raw.stage === 'timer') {
    const clock = raw.clock;
    if (!isObj(clock) || typeof clock.accumMs !== 'number') return null;
    if (clock.resumedAt !== null && typeof clock.resumedAt !== 'number') return null;
    return { stage: 'timer', ...base, clock: { accumMs: clock.accumMs, resumedAt: clock.resumedAt } };
  }
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
