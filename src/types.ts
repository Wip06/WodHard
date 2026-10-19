// Unités fixes : secondes, kilogrammes, mètres.

export interface Movement {
  name: string;
  reps?: number;
  distance_m?: number;
  calories?: number;
  duration_sec?: number;
  load_kg?: number;
  /** 2 pour une paire de charges (deux haltères, farmers carry) : `load_kg` est alors la charge d'une main. */
  load_count?: number;
  notes?: string;
}

/**
 * Mouvement fait autrement que prescrit. `index` le repère dans l'ordre des mouvements du WOD
 * (voir allMovements) ; seules les valeurs qui ont changé sont présentes.
 */
export interface Adjustment {
  index: number;
  name: string;
  /** Mouvement fait à la place de celui prescrit (ex. « Ring row » pour « Pull-up »). */
  replaced_by?: string;
  reps?: number;
  distance_m?: number;
  calories?: number;
  duration_sec?: number;
  load_kg?: number;
  load_count?: number;
}

interface WodBase {
  schema_version: 1;
  title: string;
  description?: string;
  warmup?: string;
  equipment?: string[];
  /** WOD à plusieurs (2 = duo) : les quantités sont celles de toute l'équipe, les charges celles d'un athlète. */
  team_size?: number;
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
  /** Ex. [21, 15, 9] : reps de chaque tour pour les mouvements sans quantité ; un mouvement avec quantité la garde à chaque tour. */
  rep_scheme?: number[];
  movements: Movement[];
}

export interface HyroxWod extends WodBase {
  type: 'hyrox';
  /** Segments enchaînés une seule fois, dans l'ordre : course, station, course… */
  segments: Movement[];
  time_cap_sec?: number;
}

export type Wod = AmrapWod | EmomWod | ForTimeWod | HyroxWod;
export type WodType = Wod['type'];

interface ScoreBase {
  rx: boolean;
  rpe?: number;
  notes?: string;
  /** Ce qui a été réellement fait quand ce n'est pas le prescrit ; la séance est alors scaled. */
  adjustments?: Adjustment[];
}

/**
 * `splits_sec`, quand il est présent : temps relevés au chrono, dans l'ordre. Un par tour terminé
 * (AMRAP, For Time) ou par segment terminé (Hyrox). Absent si le score est saisi à la main.
 */
export interface AmrapScore extends ScoreBase {
  rounds: number;
  extra_reps: number;
  splits_sec?: number[];
}

export interface EmomScore extends ScoreBase {
  intervals_completed: number;
}

export interface ForTimeFinished extends ScoreBase {
  finished: true;
  time_sec: number;
  splits_sec?: number[];
}

export interface ForTimeCapped extends ScoreBase {
  finished: false;
  reps_completed: number;
  splits_sec?: number[];
}

export type ForTimeScore = ForTimeFinished | ForTimeCapped;

export interface HyroxFinished extends ScoreBase {
  finished: true;
  time_sec: number;
  splits_sec?: number[];
}

export interface HyroxStopped extends ScoreBase {
  finished: false;
  segments_completed: number;
  splits_sec?: number[];
}

export type HyroxScore = HyroxFinished | HyroxStopped;
export type Score = AmrapScore | EmomScore | ForTimeScore | HyroxScore;

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

/** Un WOD prévu à une date. `result_id` est renseigné une fois la séance faite. */
export interface PlanEntry {
  id: string;
  date: string;
  wod_id: string;
  result_id?: string;
}

export type Sport = 'run' | 'bike' | 'swim' | 'row' | 'walk' | 'other';

/** Une séance d'un autre sport, saisie à la main : sortie course, vélo, natation… */
export interface Activity {
  id: string;
  date: string;
  sport: Sport;
  /** Précision libre (« Fractionné ») ; obligatoire pour « other » (« Padel »). */
  title?: string;
  duration_sec: number;
  distance_m?: number;
  rpe?: number;
  notes?: string;
}

/** Un élément d'un programme collé : un WOD, éventuellement daté. */
export interface ProgramItem {
  date?: string;
  wod: Wod;
}

export interface AppData {
  wods: SavedWod[];
  results: Result[];
  plan: PlanEntry[];
  activities: Activity[];
}

export interface Backup extends AppData {
  wodhard_backup: 1;
  exported_at?: string;
}

/** Format du bouton « Copier mon historique », décrit dans les instructions du projet Claude. */
export interface HistoryExport {
  wodhard_history: 1;
  entries: { date: string; wod: Wod; score: Score }[];
  /** WOD du programme qui restent à faire. */
  planned?: { date: string; wod: Wod }[];
  /** Séances d'autres sports (course, vélo…), sans leur identifiant. */
  activities?: Omit<Activity, 'id'>[];
}
