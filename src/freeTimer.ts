import { COUNTDOWN_MS, cuesIn, type Clock, type Cue } from './timer';

export type FreeMode = 'stopwatch' | 'countdown' | 'intervals';

/** Réglages du chrono libre : un chrono sans WOD ni score. */
export interface FreeConfig {
  mode: FreeMode;
  /** Minuteur : durée totale. */
  durationSec: number;
  /** Intervalles : travail, repos (0 = enchaîné, comme un EMOM) et nombre de tours. */
  workSec: number;
  restSec: number;
  rounds: number;
  /** Décompte de 10 secondes avant le départ. */
  leadIn: boolean;
}

export interface FreeFrame {
  phase: 'countdown' | 'running' | 'done';
  seconds: number;
  /** Intervalles : tour en cours, à partir de 0. */
  round: number;
  resting: boolean;
}

export const DEFAULT_CONFIG: FreeConfig = {
  mode: 'intervals',
  durationSec: 300,
  workSec: 20,
  restSec: 10,
  rounds: 8,
  leadIn: true,
};

export const freeClock = (config: FreeConfig, now: number): Clock => ({
  accumMs: config.leadIn ? -COUNTDOWN_MS : 0,
  resumedAt: now,
});

export function freeTotalMs(config: FreeConfig): number {
  switch (config.mode) {
    case 'stopwatch':
      return Infinity;
    case 'countdown':
      return config.durationSec * 1000;
    case 'intervals':
      // Pas de repos après le dernier tour.
      return (config.rounds * config.workSec + (config.rounds - 1) * config.restSec) * 1000;
  }
}

export function freeFrame(config: FreeConfig, ms: number): FreeFrame {
  const total = freeTotalMs(config);
  if (ms < 0) return { phase: 'countdown', seconds: Math.ceil(-ms / 1000), round: 0, resting: false };
  if (ms >= total) return { phase: 'done', seconds: 0, round: Math.max(config.rounds - 1, 0), resting: false };
  switch (config.mode) {
    case 'stopwatch':
      return { phase: 'running', seconds: Math.floor(ms / 1000), round: 0, resting: false };
    case 'countdown':
      return { phase: 'running', seconds: Math.ceil((total - ms) / 1000), round: 0, resting: false };
    case 'intervals': {
      const work = config.workSec * 1000;
      const cycle = work + config.restSec * 1000;
      const round = Math.floor(ms / cycle);
      const inCycle = ms - round * cycle;
      const resting = inCycle >= work;
      return { phase: 'running', seconds: Math.ceil(((resting ? cycle : work) - inCycle) / 1000), round, resting };
    }
  }
}

/** Bip long à chaque reprise du travail, bip grave à chaque repos, 3-2-1 avant, signal de fin. */
export function freeCues(config: FreeConfig, fromMs: number, toMs: number): Cue[] {
  const total = freeTotalMs(config);
  const work = config.workSec * 1000;
  const cycle = work + config.restSec * 1000;
  return cuesIn(
    (t) => {
      if (t === 0) return 'go';
      if (t === total) return 'end';
      if (config.mode !== 'intervals' || t < 0 || t > total) return null;
      const inCycle = t % cycle;
      if (inCycle === 0) return 'go';
      return inCycle === work && config.restSec > 0 ? 'rest' : null;
    },
    fromMs,
    toMs,
  );
}
