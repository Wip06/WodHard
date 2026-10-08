// Unités fixes : secondes, kilogrammes, mètres.

export interface Movement {
  name: string;
  reps?: number;
  distance_m?: number;
  calories?: number;
  duration_sec?: number;
  load_kg?: number;
  notes?: string;
}

interface WodBase {
  schema_version: 1;
  title: string;
  description?: string;
  warmup?: string;
  equipment?: string[];
}

export interface AmrapWod extends WodBase {
  type: 'amrap';
  duration_sec: number;
  movements: Movement[];
}

export interface EmomWod extends WodBase {
  type: 'emom';
  interval_sec: number;
  intervals: number;
  /** slots[i] = travail de l'intervalle i, répété en boucle. Un slot vide est un repos. */
  slots: Movement[][];
}

export interface ForTimeWod extends WodBase {
  type: 'for_time';
  time_cap_sec: number;
  rounds: number;
  /** Ex. [21, 15, 9] : les mouvements n'ont alors pas de quantité propre. */
  rep_scheme?: number[];
  movements: Movement[];
}

export type Wod = AmrapWod | EmomWod | ForTimeWod;
export type WodType = Wod['type'];

interface ScoreBase {
  rx: boolean;
  rpe?: number;
  notes?: string;
}

export interface AmrapScore extends ScoreBase {
  rounds: number;
  extra_reps: number;
}

export interface EmomScore extends ScoreBase {
  intervals_completed: number;
}

export interface ForTimeFinished extends ScoreBase {
  finished: true;
  time_sec: number;
}

export interface ForTimeCapped extends ScoreBase {
  finished: false;
  reps_completed: number;
}

export type ForTimeScore = ForTimeFinished | ForTimeCapped;
export type Score = AmrapScore | EmomScore | ForTimeScore;

export interface SavedWod {
  id: string;
  added_at: string;
  wod: Wod;
}

/** Une séance faite. Le WOD est copié : supprimer un WOD ne touche pas l'historique. */
export interface Result {
  id: string;
  wod_id?: string;
  date: string;
  wod: Wod;
  score: Score;
}

export interface AppData {
  wods: SavedWod[];
  results: Result[];
}

export interface Backup extends AppData {
  wodhard_backup: 1;
  exported_at?: string;
}

/** Format du bouton « Copier mon historique », décrit dans les instructions du projet Claude. */
export interface HistoryExport {
  wodhard_history: 1;
  entries: { date: string; wod: Wod; score: Score }[];
}
