import type { Wod } from './types';

export const COUNTDOWN_MS = 10_000;

/**
 * Chrono calculé sur l'horloge système : il reste juste même si l'onglet est gelé
 * ou l'appli relancée. Le temps écoulé est négatif pendant le décompte de départ.
 */
export interface Clock {
  accumMs: number;
  /** Date.now() de la dernière reprise, ou null en pause. */
  resumedAt: number | null;
}

export type Cue = 'tick' | 'go' | 'end';

export interface Frame {
  phase: 'countdown' | 'running' | 'done';
  /** Valeur affichée : compte à rebours (décompte, AMRAP, EMOM) ou temps écoulé (For Time). */
  seconds: number;
  /** Intervalle EMOM en cours, à partir de 0. */
  interval: number;
}

export const newClock = (now: number): Clock => ({ accumMs: -COUNTDOWN_MS, resumedAt: now });

export const elapsedMs = (clock: Clock, now: number): number =>
  clock.accumMs + (clock.resumedAt === null ? 0 : now - clock.resumedAt);

export const pause = (clock: Clock, now: number): Clock => ({ accumMs: elapsedMs(clock, now), resumedAt: null });

export const resume = (clock: Clock, now: number): Clock =>
  clock.resumedAt === null ? { ...clock, resumedAt: now } : clock;

export function totalMs(wod: Wod): number {
  switch (wod.type) {
    case 'amrap':
      return wod.duration_sec * 1000;
    case 'emom':
      return wod.interval_sec * wod.intervals * 1000;
    case 'for_time':
      return wod.time_cap_sec * 1000;
  }
}

export function frame(wod: Wod, ms: number): Frame {
  const total = totalMs(wod);
  if (ms < 0) return { phase: 'countdown', seconds: Math.ceil(-ms / 1000), interval: 0 };
  if (ms >= total) {
    return {
      phase: 'done',
      seconds: wod.type === 'for_time' ? wod.time_cap_sec : 0,
      interval: wod.type === 'emom' ? wod.intervals - 1 : 0,
    };
  }
  switch (wod.type) {
    case 'amrap':
      return { phase: 'running', seconds: Math.ceil((total - ms) / 1000), interval: 0 };
    case 'emom': {
      const span = wod.interval_sec * 1000;
      return { phase: 'running', seconds: Math.ceil((span - (ms % span)) / 1000), interval: Math.floor(ms / span) };
    }
    case 'for_time':
      return { phase: 'running', seconds: Math.floor(ms / 1000), interval: 0 };
  }
}

/**
 * Signaux sonores dus dans la fenêtre ]fromMs, toMs] : un bip long au départ et à chaque
 * changement d'intervalle, 3-2-1 juste avant, et un signal de fin.
 */
export function cuesBetween(wod: Wod, fromMs: number, toMs: number): Cue[] {
  const total = totalMs(wod);
  const span = wod.type === 'emom' ? wod.interval_sec * 1000 : total;
  const isBoundary = (t: number) => t === 0 || t === total || (t > 0 && t < total && t % span === 0);

  const cues: Cue[] = [];
  for (let s = Math.floor(fromMs / 1000) + 1; s * 1000 <= toMs; s++) {
    const t = s * 1000;
    if (t > total) break;
    if (t === total) cues.push('end');
    else if (isBoundary(t)) cues.push('go');
    else if (isBoundary(t + 1000) || isBoundary(t + 2000) || isBoundary(t + 3000)) cues.push('tick');
  }
  return cues;
}
