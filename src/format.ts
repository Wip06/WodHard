import { allMovements } from './movements';
import { doneCount, plannedCount, volume } from './strength';
import type { Adjustment, Exercise, Movement, Score, StrengthSet, Wod, WodType } from './types';

const TYPE_LABELS: Record<WodType, string> = { amrap: 'AMRAP', emom: 'EMOM', for_time: 'For Time', hyrox: 'Hyrox', strength: 'Force' };

const pad = (n: number) => String(n).padStart(2, '0');
export const decimal = (n: number, digits = 2) => n.toLocaleString('fr-FR', { maximumFractionDigits: digits });

export const typeLabel = (type: WodType) => TYPE_LABELS[type];
export const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
export const kg = (load: number) => `${decimal(load)} kg`;

/** Charge d'un mouvement : « 24 kg », ou « 2 × 24 kg » pour une paire. */
export function load(movement: { load_kg?: number; load_count?: number }): string | null {
  if (movement.load_kg === undefined) return null;
  return movement.load_count === 2 ? `2 × ${kg(movement.load_kg)}` : kg(movement.load_kg);
}

/** 2 → « Duo », 3 → « Équipe de 3 ». */
export const teamLabel = (size: number) => (size === 2 ? 'Duo' : `Équipe de ${size}`);

/** 754 → "12:34", 3725 → "1:02:05". */
export function clock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 1200 → "20 min", 90 → "1 min 30", 45 → "45 s". */
export function duration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return m > 0 ? `${h} h ${pad(m)}` : `${h} h`;
  if (m > 0) return s > 0 ? `${m} min ${pad(s)}` : `${m} min`;
  return `${s} s`;
}

export function quantity(movement: Movement, schemeReps?: number): string | null {
  if (movement.reps !== undefined) return String(movement.reps);
  if (movement.distance_m !== undefined) return `${decimal(movement.distance_m)} m`;
  if (movement.calories !== undefined) return `${movement.calories} cal`;
  if (movement.duration_sec !== undefined) return duration(movement.duration_sec);
  return schemeReps === undefined ? null : String(schemeReps);
}

export function movementText(movement: Movement, schemeReps?: number): string {
  const head = [quantity(movement, schemeReps), movement.name].filter(Boolean).join(' ');
  const weight = load(movement);
  return weight === null ? head : `${head} (${weight})`;
}

export function wodSummary(wod: Wod): string {
  switch (wod.type) {
    case 'amrap':
      return `AMRAP ${duration(wod.duration_sec)}`;
    case 'emom':
      return wod.interval_sec === 60
        ? `EMOM ${wod.intervals} min`
        : `EMOM ${wod.intervals} × ${duration(wod.interval_sec)}`;
    case 'for_time': {
      const volume = wod.rep_scheme ? wod.rep_scheme.join('-') : wod.rounds > 1 ? `${wod.rounds} tours` : '';
      return `${volume} For Time · cap ${duration(wod.time_cap_sec)}`.trim();
    }
    case 'hyrox': {
      const cap = wod.time_cap_sec === undefined ? '' : ` · cap ${duration(wod.time_cap_sec)}`;
      return `Enchaînement de ${plural(wod.segments.length, 'segment')}${cap}`;
    }
    case 'strength':
      return `${plural(wod.exercises.length, 'exercice')} · ${plural(plannedCount(wod), 'série')}`;
  }
}

/** Le résumé, précédé de l'équipe pour un WOD à plusieurs. */
export const wodHeadline = (wod: Wod) => (wod.team_size ? `${teamLabel(wod.team_size)} · ${wodSummary(wod)}` : wodSummary(wod));

export function scoreLine(wod: Wod, score: Score): string {
  if ('exercises' in score) {
    const planned = wod.type === 'strength' ? `/${plannedCount(wod)}` : '';
    const lifted = wod.type === 'strength' ? volume(wod, score) : 0;
    const total = lifted > 0 ? ` · ${Math.round(lifted).toLocaleString('fr-FR')} kg soulevés` : '';
    return `${doneCount(score)}${planned} séries${total}`;
  }
  if ('rounds' in score) {
    const rounds = plural(score.rounds, 'tour');
    return score.extra_reps > 0 ? `${rounds} + ${plural(score.extra_reps, 'rep')}` : rounds;
  }
  if ('intervals_completed' in score) {
    const total = wod.type === 'emom' ? `/${wod.intervals}` : '';
    return `${score.intervals_completed}${total} intervalles`;
  }
  if ('segments_completed' in score) {
    const total = wod.type === 'hyrox' ? `/${wod.segments.length}` : '';
    return `Arrêt après ${score.segments_completed}${total} segments`;
  }
  return score.finished ? clock(score.time_sec) : `Time cap · ${plural(score.reps_completed, 'rep')}`;
}

/** Date locale au format AAAA-MM-JJ (toISOString donnerait la date UTC). */
const toIso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function fromIso(isoDate: string): Date {
  const [year = 1970, month = 1, day = 1] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export const today = () => toIso(new Date());

export function addDays(isoDate: string, days: number): string {
  const date = fromIso(isoDate);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

/** Nombre de jours de `from` à `to`, négatif si `to` est avant. */
export function daysBetween(from: string, to: string): number {
  // Arrondi : un changement d'heure donne un jour de 23 ou 25 heures.
  return Math.round((fromIso(to).getTime() - fromIso(from).getTime()) / 86_400_000);
}

/** Lundi de la semaine qui contient la date. */
export const mondayOf = (isoDate: string) => addDays(isoDate, -((fromIso(isoDate).getDay() + 6) % 7));

/** "2026-10-09" → "ven. 9 oct." (avec l'année si ce n'est pas l'année en cours). */
export function dateLabel(isoDate: string): string {
  const date = fromIso(isoDate);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

/** Comme dateLabel, mais « Aujourd’hui », « Demain » et « Hier » pour les jours proches. */
export function dayLabel(isoDate: string): string {
  const now = today();
  if (isoDate === now) return 'Aujourd’hui';
  if (isoDate === addDays(now, 1)) return 'Demain';
  if (isoDate === addDays(now, -1)) return 'Hier';
  return dateLabel(isoDate);
}

/** Quantité avec son unité : « 5 reps », « 400 m ». */
function amount(movement: Movement): string | null {
  return movement.reps === undefined ? quantity(movement) : plural(movement.reps, 'rep');
}

/** « Ring row au lieu de Pull-up : 8 reps au lieu de 5 reps », « Thruster : 30 kg au lieu de 43 kg ». */
export function adjustmentText(wod: Wod, adjustment: Adjustment): string {
  const target = allMovements(wod)[adjustment.index];
  const what = adjustment.replaced_by ? `${adjustment.replaced_by} au lieu de ${adjustment.name}` : adjustment.name;
  const changes: string[] = [];
  const done = amount(adjustment);
  if (done !== null) {
    const planned = target && amount(target);
    changes.push(planned && planned !== done ? `${done} au lieu de ${planned}` : done);
  }
  if (adjustment.load_kg !== undefined || adjustment.load_count !== undefined) {
    const doneLoad = load({ load_kg: adjustment.load_kg ?? target?.load_kg, load_count: adjustment.load_count ?? target?.load_count });
    const plannedLoad = target ? load(target) : null;
    if (doneLoad !== null) changes.push(plannedLoad && plannedLoad !== doneLoad ? `${doneLoad} au lieu de ${plannedLoad}` : doneLoad);
  }
  return changes.length > 0 ? `${what} : ${changes.join(', ')}` : what;
}

/** Charge affichée : « 70 kg », ou « 2 × 24 kg » pour une paire. */
const loadText = (load: number, count?: number) => (count === 2 ? `2 × ${kg(load)}` : kg(load));

/** Une série : « 8 × 70 kg », « 8 reps », « 1 min ». */
export function setText(set: StrengthSet, loadCount?: number): string {
  const amount = set.reps !== undefined ? (set.load_kg === undefined ? plural(set.reps, 'rep') : String(set.reps)) : duration(set.duration_sec ?? 0);
  return set.load_kg === undefined ? amount : `${amount} × ${loadText(set.load_kg, loadCount)}`;
}

/** Séries sur une ligne : « 8×70 · 8×70 · 7×70 kg », « 10 · 10 · 8 reps ». */
export function setsLine(sets: StrengthSet[], loadCount?: number): string {
  if (sets.length === 0) return 'aucune série';
  const parts = sets.map((set) => {
    const amount = set.reps !== undefined ? String(set.reps) : duration(set.duration_sec ?? 0);
    return set.load_kg === undefined ? amount : `${amount}×${decimal(set.load_kg)}`;
  });
  const loaded = sets.some((set) => set.load_kg !== undefined);
  const unit = loaded ? (loadCount === 2 ? ' kg par main' : ' kg') : sets.every((set) => set.reps !== undefined) ? ' reps' : '';
  return parts.join(' · ') + unit;
}

/** Prescription d'un exercice : « 4 × 8 · 70 kg », « 3 × 1 min », ou le détail « 5×80 · 5×85 · 5×90 kg ». */
export function exerciseSummary(exercise: Exercise): string {
  if (Array.isArray(exercise.sets)) return setsLine(exercise.sets, exercise.load_count);
  const amount = exercise.reps !== undefined ? String(exercise.reps) : duration(exercise.duration_sec ?? 0);
  const head = `${exercise.sets} × ${amount}`;
  return exercise.load_kg === undefined ? head : `${head} · ${loadText(exercise.load_kg, exercise.load_count)}`;
}
