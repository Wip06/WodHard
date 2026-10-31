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

/** Une série de force : des répétitions (ou une durée, pour un gainage), avec ou sans charge. */
export interface StrengthSet {
  reps?: number;
  duration_sec?: number;
  load_kg?: number;
}

/**
 * Un exercice de force. Séries identiques : `sets` en donne le nombre, avec `reps` (ou
 * `duration_sec`) et `load_kg` ; séries différentes (pyramide, montée en charge) : `sets` les
 * détaille une par une.
 */
export interface Exercise {
  name: string;
  sets: number | StrengthSet[];
  reps?: number;
  duration_sec?: number;
  load_kg?: number;
  /** 2 pour une paire d'haltères ou de kettlebells : `load_kg` est la charge d'une main. */
  load_count?: number;
  /** Repos après chaque série, en secondes. */
  rest_sec?: number;
  notes?: string;
}

/** Séance de force ou de musculation : des exercices en séries, avec du repos entre elles. */
export interface StrengthWod extends WodBase {
  type: 'strength';
  exercises: Exercise[];
}

/** Un WOD d'un seul format. */
export type SingleWod = AmrapWod | EmomWod | ForTimeWod | HyroxWod | StrengthWod;

/**
 * Séance en plusieurs blocs, faits dans l'ordre : par exemple force, puis metcon. Chaque bloc est
 * un WOD d'un seul format, avec son titre (« Force », « Metcon »).
 */
export interface SessionWod extends WodBase {
  type: 'session';
  blocks: SingleWod[];
}

export type Wod = SingleWod | SessionWod;
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

/**
 * Séance de force : les séries réellement faites, exercice par exercice (même ordre que le WOD).
 * `duration_sec` : durée de la séance relevée au chrono.
 */
export interface StrengthScore extends ScoreBase {
  exercises: StrengthSet[][];
  duration_sec?: number;
}

export type SingleScore = AmrapScore | EmomScore | ForTimeScore | HyroxScore | StrengthScore;

/** Séance en blocs : le score de chaque bloc, dans l'ordre ; null pour un bloc passé. */
export interface SessionScore extends ScoreBase {
  blocks: (SingleScore | null)[];
}

export type Score = SingleScore | SessionScore;

export interface SavedWod {
  id: string;
  added_at: string;
  wod: Wod;
  /** WOD de référence (Fran, Cindy, un test maison) : à refaire toutes les tant de semaines pour mesurer sa progression. */
  reference_weeks?: number;
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

interface GoalBase {
  id: string;
  /** Jour où l'objectif a été fixé. */
  created: string;
  /** Échéance, facultative. */
  date?: string;
  notes?: string;
}

/** Soulever une charge : `reps` répétitions à `load_kg` (par main pour une paire) au moins. */
export interface LiftGoal extends GoalBase {
  kind: 'lift';
  exercise: string;
  load_kg: number;
  reps: number;
}

/**
 * Un score en Rx sur un WOD (copié, comme dans l'historique) : un temps à battre pour un For Time
 * ou un Hyrox, un nombre de tours (et de reps) à atteindre pour un AMRAP.
 */
export interface WodGoal extends GoalBase {
  kind: 'wod';
  wod: AmrapWod | ForTimeWod | HyroxWod;
  wod_id?: string;
  time_sec?: number;
  rounds?: number;
  extra_reps?: number;
}

/** Objectif libre (« 10 strict pull-ups »), coché à la main. */
export interface FreeGoal extends GoalBase {
  kind: 'free';
  title: string;
  done_on?: string;
}

export type Goal = LiftGoal | WodGoal | FreeGoal;

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
  goals: Goal[];
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
  /** Charges de référence par exercice de force, pour prescrire les charges. */
  lifts?: LiftSummary[];
  /** WOD de référence, à refaire régulièrement. */
  references?: ReferenceSummary[];
  /** Objectifs en cours et atteints récemment. */
  goals?: GoalSummary[];
}

/** Un objectif, envoyé au coach en clair. */
export interface GoalSummary {
  goal: string;
  deadline?: string;
  /** Où j'en suis (« 110 kg », « 5:18 »), et ce qu'il reste à faire. */
  current?: string;
  remaining?: string;
  achieved_on?: string;
  notes?: string;
}

/** Un WOD de référence, envoyé au coach : quand le refaire, et ce qu'il a donné. */
export interface ReferenceSummary {
  wod: Wod;
  retest_weeks: number;
  /** Dernière fois et meilleur score ; absents s'il n'a jamais été fait. */
  last?: { date: string; score: Score };
  best?: { date: string; score: Score };
  /** Date à partir de laquelle le refaire. */
  due_on?: string;
}

/** Repères d'un exercice de force, envoyés au coach. */
export interface LiftSummary {
  name: string;
  /** 1RM estimé (formule d'Epley) de la meilleure série. */
  one_rep_max_kg?: number;
  best_set?: StrengthSet & { date: string };
  last?: { date: string; sets: StrengthSet[] };
}
