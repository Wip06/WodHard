import { playCue, unlockAudio } from '../audio';
import { choose, h } from '../dom';
import { clock as clockText, duration, movementText, plural, wodSummary } from '../format';
import { navigate, type View } from '../router';
import { getSession, setSession } from '../store';
import { cuesBetween, elapsedMs, frame, pause, resume, totalMs, type Frame } from '../timer';
import type { Movement } from '../types';
import { movementList } from './parts';

const TICK_MS = 100;
/** Au-delà de cet écart entre deux rafraîchissements (appli en arrière-plan), les bips manqués sont ignorés. */
const MAX_CUE_GAP_MS = 1500;
const URGENT_SEC = 3;

export function timerView(): View | null {
  const initial = getSession();
  if (!initial || initial.stage !== 'timer') return null;
  const { wod, wod_id } = initial;
  let clock = initial.clock;
  let rounds = initial.rounds;

  const total = totalMs(wod);
  const counted = wod.type === 'amrap' || (wod.type === 'for_time' && wod.rounds > 1);
  const maxRounds = wod.type === 'for_time' ? wod.rounds - 1 : Infinity;
  const now = () => elapsedMs(clock, Date.now());
  const save = () => setSession({ stage: 'timer', wod, wod_id, clock, rounds });

  const phaseEl = h('p', { class: 'timer-phase' });
  const clockEl = h('p', { class: 'timer-clock', role: 'timer' });
  const subEl = h('p', { class: 'timer-sub' });
  const planEl = h('div', { class: 'timer-plan' });
  const roundLabel = h('span', { class: 'round-label' });
  const minusBtn = h('button', { class: 'btn', 'aria-label': 'Retirer un tour', onclick: () => changeRounds(-1) }, '−');
  const plusBtn = h(
    'button',
    { class: 'btn grow', onclick: () => changeRounds(1) },
    wod.type === 'amrap' ? '+ 1 tour' : 'Tour suivant',
  );
  const roundBar = h('div', { class: 'round-bar' }, minusBtn, roundLabel, plusBtn);
  const finishBtn = h('button', { class: 'btn primary big block', onclick: () => finish(true) }, 'Terminé !');
  const pauseBtn = h('button', { class: 'btn grow', onclick: togglePause });
  const runBar = h(
    'div',
    { class: 'row' },
    pauseBtn,
    h('button', { class: 'btn grow', onclick: () => void stop() }, 'Arrêter'),
  );
  const scoreBtn = h(
    'button',
    { class: 'btn primary big block', onclick: () => finish(wod.type !== 'for_time') },
    'Saisir mon score',
  );
  const discardBtn = h('button', { class: 'btn ghost block', onclick: discard }, 'Ne pas enregistrer');

  const el = h(
    'section',
    { class: 'timer' },
    h('header', { class: 'timer-head' }, h('strong', null, wod.title), h('span', null, wodSummary(wod))),
    h('div', { class: 'timer-face' }, phaseEl, clockEl, subEl),
    planEl,
    h(
      'div',
      { class: 'timer-controls' },
      counted && roundBar,
      wod.type === 'for_time' && finishBtn,
      runBar,
      scoreBtn,
      discardBtn,
    ),
  );

  const slotAt = (interval: number): Movement[] =>
    wod.type === 'emom' ? (wod.slots[interval % wod.slots.length] ?? []) : [];

  function phaseText(f: Frame, paused: boolean): string {
    if (paused) return 'En pause';
    if (f.phase === 'countdown') return 'Prêt ?';
    if (f.phase === 'done') return wod.type === 'for_time' ? 'Time cap !' : 'Terminé !';
    if (wod.type === 'emom') return `Intervalle ${f.interval + 1} / ${wod.intervals}`;
    return wod.type === 'amrap' ? 'Temps restant' : 'Temps écoulé';
  }

  function subText(f: Frame): string {
    if (f.phase === 'done') return '';
    switch (wod.type) {
      case 'amrap':
        return f.phase === 'countdown' ? `AMRAP ${duration(wod.duration_sec)}` : '';
      case 'for_time':
        return `Time cap ${clockText(wod.time_cap_sec)}`;
      case 'emom': {
        if (f.phase === 'countdown') return `${wod.intervals} × ${duration(wod.interval_sec)}`;
        if (f.interval >= wod.intervals - 1) return 'Dernier intervalle';
        const next = slotAt(f.interval + 1);
        return `Ensuite : ${next.length > 0 ? next.map(movementText).join(' + ') : 'repos'}`;
      }
    }
  }

  function planFor(f: Frame): HTMLElement[] {
    switch (wod.type) {
      case 'amrap':
        return [movementList(wod.movements)];
      case 'emom':
        return [movementList(slotAt(f.interval))];
      case 'for_time': {
        const round = Math.min(rounds, wod.rounds - 1);
        const scheme = wod.rep_scheme;
        return [
          ...(scheme
            ? [
                h(
                  'p',
                  { class: 'scheme' },
                  scheme.map((reps, i) => h('span', { class: i === round ? 'current' : i < round ? 'past' : '' }, reps)),
                ),
              ]
            : []),
          movementList(wod.movements, scheme?.[round]),
        ];
      }
    }
  }

  let planKey = '';

  function paint(): void {
    const ms = now();
    const f = frame(wod, ms);
    const done = f.phase === 'done';
    const running = f.phase === 'running';
    const paused = clock.resumedAt === null && !done;
    const left = wod.type === 'for_time' ? Math.ceil((total - ms) / 1000) : f.seconds;

    el.dataset.phase = paused ? 'paused' : f.phase;
    el.toggleAttribute('data-urgent', running && left <= URGENT_SEC);

    const text = f.phase === 'countdown' ? String(f.seconds) : clockText(f.seconds);
    if (clockEl.textContent !== text) clockEl.textContent = text;
    phaseEl.textContent = phaseText(f, paused);
    subEl.textContent = subText(f);

    const key = `${f.interval}:${rounds}`;
    if (key !== planKey) {
      planKey = key;
      planEl.replaceChildren(...planFor(f));
    }

    roundLabel.textContent =
      wod.type === 'for_time' ? `Tour ${Math.min(rounds + 1, wod.rounds)} / ${wod.rounds}` : plural(rounds, 'tour');
    minusBtn.disabled = rounds === 0;
    plusBtn.disabled = !running || rounds >= maxRounds;
    finishBtn.disabled = !running || paused;
    pauseBtn.textContent = paused ? 'Reprendre' : 'Pause';
    roundBar.hidden = finishBtn.hidden = runBar.hidden = done;
    scoreBtn.hidden = discardBtn.hidden = !done;
  }

  let wakeLock: WakeLockSentinel | null = null;

  async function keepAwake(): Promise<void> {
    if (!('wakeLock' in navigator) || (wakeLock && !wakeLock.released)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Refusé (économie d'énergie, onglet masqué) : le chrono reste juste, seul l'écran peut s'éteindre.
    }
  }

  function letSleep(): void {
    void wakeLock?.release();
    wakeLock = null;
  }

  let lastMs = now();

  function tick(): void {
    const ms = now();
    if (ms - lastMs <= MAX_CUE_GAP_MS) cuesBetween(wod, lastMs, ms).forEach(playCue);
    lastMs = ms;
    paint();
    if (ms >= total) letSleep();
  }

  function togglePause(): void {
    unlockAudio();
    clock = clock.resumedAt === null ? resume(clock, Date.now()) : pause(clock, Date.now());
    save();
    lastMs = now();
    paint();
  }

  function changeRounds(delta: number): void {
    rounds = Math.max(0, Math.min(rounds + delta, maxRounds));
    save();
    paint();
  }

  /** Fige le chrono et passe à la saisie du score. */
  function finish(completed: boolean): void {
    const frozen = Math.min(Math.max(now(), 0), total);
    setSession({ stage: 'score', wod, wod_id, rounds, elapsedMs: frozen, completed });
    navigate('/score', true);
  }

  function discard(): void {
    setSession(null);
    navigate(wod_id ? `/wod/${wod_id}` : '/', true);
  }

  async function stop(): Promise<void> {
    const answer = await choose('Arrêter le WOD ?', 'Le chrono continue de tourner tant que tu n’as pas choisi.', [
      { label: 'Saisir mon score', value: 'score', kind: 'primary' },
      { label: 'Abandonner sans enregistrer', value: 'discard', kind: 'danger' },
      { label: 'Continuer le WOD', value: 'continue' },
    ]);
    if (answer === 'score') finish(false);
    else if (answer === 'discard') discard();
  }

  function onVisibility(): void {
    if (document.visibilityState !== 'visible') return;
    unlockAudio();
    if (now() < total) void keepAwake();
    tick();
  }

  const interval = window.setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', onVisibility);
  if (now() < total) void keepAwake();
  paint();

  return {
    el,
    destroy() {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      letSleep();
    },
  };
}
