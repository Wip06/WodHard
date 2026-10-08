import type { Cue } from './timer';

let context: AudioContext | null = null;

/** À appeler depuis un geste de l'utilisateur : les navigateurs bloquent le son sinon. */
export function unlockAudio(): void {
  try {
    context ??= new AudioContext();
    if (context.state !== 'running') void context.resume();
  } catch {
    context = null;
  }
}

function tone(frequency: number, delay: number, length: number): void {
  if (!context) return;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.3, start + 0.01);
  gain.gain.setValueAtTime(0.3, start + length - 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

export function playCue(cue: Cue): void {
  if (cue === 'tick') {
    tone(880, 0, 0.12);
  } else if (cue === 'go') {
    tone(1320, 0, 0.6);
  } else {
    tone(1320, 0, 0.25);
    tone(1320, 0.35, 0.25);
    tone(1320, 0.7, 0.8);
  }
  // Absent sur iOS, utile sur Android quand le son est coupé.
  navigator.vibrate?.(cue === 'tick' ? 60 : cue === 'go' ? 300 : [250, 100, 250, 100, 600]);
}
