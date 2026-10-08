import type { Movement, Score, Wod, WodType } from './types';

const TYPE_LABELS: Record<WodType, string> = { amrap: 'AMRAP', emom: 'EMOM', for_time: 'For Time' };

const pad = (n: number) => String(n).padStart(2, '0');
const decimal = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

export const typeLabel = (type: WodType) => TYPE_LABELS[type];
export const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
export const kg = (load: number) => `${decimal(load)} kg`;

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

export function movementText(movement: Movement): string {
  const head = [quantity(movement), movement.name].filter(Boolean).join(' ');
  return movement.load_kg === undefined ? head : `${head} (${kg(movement.load_kg)})`;
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
  }
}

export function scoreLine(wod: Wod, score: Score): string {
  if ('rounds' in score) {
    const rounds = plural(score.rounds, 'tour');
    return score.extra_reps > 0 ? `${rounds} + ${plural(score.extra_reps, 'rep')}` : rounds;
  }
  if ('intervals_completed' in score) {
    const total = wod.type === 'emom' ? `/${wod.intervals}` : '';
    return `${score.intervals_completed}${total} intervalles`;
  }
  return score.finished ? clock(score.time_sec) : `Time cap · ${plural(score.reps_completed, 'rep')}`;
}

/** Date locale au format AAAA-MM-JJ (toISOString donnerait la date UTC). */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "2026-10-09" → "ven. 9 oct." (avec l'année si ce n'est pas l'année en cours). */
export function dateLabel(isoDate: string): string {
  const [year = 1970, month = 1, day = 1] = isoDate.split('-').map(Number);
  const sameYear = year === new Date().getFullYear();
  return new Date(year, month - 1, day).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}
