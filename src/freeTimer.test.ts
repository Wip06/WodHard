import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, freeClock, freeCues, freeFrame, freeTotalMs, type FreeConfig } from './freeTimer';
import { COUNTDOWN_MS, elapsedMs } from './timer';

const tabata: FreeConfig = { ...DEFAULT_CONFIG, mode: 'intervals', workSec: 20, restSec: 10, rounds: 8 };
const emom: FreeConfig = { ...DEFAULT_CONFIG, mode: 'intervals', workSec: 60, restSec: 0, rounds: 3 };
const countdown: FreeConfig = { ...DEFAULT_CONFIG, mode: 'countdown', durationSec: 90 };
const stopwatch: FreeConfig = { ...DEFAULT_CONFIG, mode: 'stopwatch' };

describe('chrono libre', () => {
  it('démarre avec ou sans décompte', () => {
    expect(elapsedMs(freeClock({ ...tabata, leadIn: true }, 5_000), 5_000)).toBe(-COUNTDOWN_MS);
    expect(elapsedMs(freeClock({ ...tabata, leadIn: false }, 5_000), 5_000)).toBe(0);
  });

  it('ne compte pas de repos après le dernier tour', () => {
    expect(freeTotalMs(tabata)).toBe(230_000);
    expect(freeTotalMs(emom)).toBe(180_000);
    expect(freeTotalMs(stopwatch)).toBe(Infinity);
  });

  it('alterne travail et repos', () => {
    expect(freeFrame(tabata, 0)).toEqual({ phase: 'running', seconds: 20, round: 0, resting: false });
    expect(freeFrame(tabata, 19_500)).toEqual({ phase: 'running', seconds: 1, round: 0, resting: false });
    expect(freeFrame(tabata, 20_000)).toEqual({ phase: 'running', seconds: 10, round: 0, resting: true });
    expect(freeFrame(tabata, 30_000)).toEqual({ phase: 'running', seconds: 20, round: 1, resting: false });
    expect(freeFrame(tabata, 229_999)).toMatchObject({ phase: 'running', round: 7, resting: false });
    expect(freeFrame(tabata, 230_000)).toMatchObject({ phase: 'done', round: 7 });
  });

  it('enchaîne les tours sans repos comme un EMOM', () => {
    expect(freeFrame(emom, 61_000)).toEqual({ phase: 'running', seconds: 59, round: 1, resting: false });
  });

  it('décompte un minuteur et compte un chronomètre', () => {
    expect(freeFrame(countdown, 30_500)).toMatchObject({ phase: 'running', seconds: 60 });
    expect(freeFrame(countdown, 90_000)).toMatchObject({ phase: 'done', seconds: 0 });
    expect(freeFrame(stopwatch, 7_200_900)).toMatchObject({ phase: 'running', seconds: 7200 });
  });

  it('signale le travail, le repos et la fin', () => {
    expect(freeCues(tabata, -3_100, 0)).toEqual(['tick', 'tick', 'tick', 'go']);
    expect(freeCues(tabata, 16_500, 20_000)).toEqual(['tick', 'tick', 'tick', 'rest']);
    expect(freeCues(tabata, 29_950, 30_050)).toEqual(['go']);
    expect(freeCues(tabata, 229_950, 230_050)).toEqual(['end']);
    expect(freeCues(emom, 59_950, 60_050)).toEqual(['go']);
    expect(freeCues(countdown, 86_500, 90_000)).toEqual(['tick', 'tick', 'tick', 'end']);
    expect(freeCues(stopwatch, 59_000, 61_000)).toEqual([]);
  });
});
