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
/** Hyrox : durée minimale d'un segment, pour qu'un double appui ne valide pas deux segments. */
const MIN_SEGMENT_MS = 1000;

export function timerView(): View | null {
  const initial = getSession();
  if (!initial || initial.stage !== 'timer') return null;
  const { wod, wod_id } = initial;
  let clock = initial.clock;
  let rounds = initial.rounds;
  const marks = [...initial.marks];

  const total = totalMs(wod);
  const counted = wod.type === 'amrap' || (wod.type === 'for_time' && wod.rounds > 1);
  const maxRounds = wod.type === 'for_time' ? wod.rounds - 1 : Infinity;
  const segments = wod.type === 'hyrox' ? wod.segments : [];
  const stepped = wod.type === 'hyrox';
  const now = () => elapsedMs(clock, Date.now());
  const save = () => setSession({ stage: 'timer', wod, wod_id, clock, rounds, marks });
  /** Segment en cours (le dernier reste affiché une fois tous terminés). */
  const segmentIndex = () => Math.min(marks.length, segments.length - 1);

  const phaseEl = h('p', { class: 'timer-phase' });
  const clockEl = h('p', { class: 'timer-clock', role: 'timer' });
  const subEl = h('p', { class: 'timer-sub' });
  const planEl = h('div', { class: 'timer-plan' });
  const roundLabel = h('span', { class: 'round-label' });
  const minusBtn = h(
    'button',
    {
      class: 'btn',
      'aria-label': stepped ? 'Revenir au segment précédent' : 'Retirer un tour',
      onclick: () => (stepped ? undoSegment() : changeRounds(-1)),
    },
    '−',
  );
  const plusBtn = h(
    'button',
    { class: 'btn grow', onclick: () => changeRounds(1) },
    wod.type === 'amrap' ? '+ 1 tour' : 'Tour suivant',
  );
  const roundBar = h('div', { class: 'round-bar' }, minusBtn, roundLabel, counted && plusBtn);
  const finishBtn = h('button', {
    class: 'btn primary big block',
    onclick: () => (stepped ? nextSegment() : finish(true)),
  });
  const pauseBtn = h('button', { class: 'btn grow', onclick: togglePause });
  const runBar = h(
    'div',
    { class: 'row' },
    pauseBtn,
    h('button', { class: 'btn grow', onclick: () => void stop() }, 'Arrêter'),
  );
  const scoreBtn = h(
    'button',
    { class: 'btn primary big block', onclick: () => finish(wod.type === 'amrap' || wod.type === 'emom') },
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
      (counted || stepped) && roundBar,
      (wod.type === 'for_time' || stepped) && finishBtn,
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
    if (f.phase === 'done') return wod.type === 'amrap' || wod.type === 'emom' ? 'Terminé !' : 'Time cap !';
    switch (wod.type) {
      case 'amrap':
        return 'Temps restant';
      case 'emom':
        return `Intervalle ${f.interval + 1} / ${wod.intervals}`;
      case 'for_time':
        return 'Temps écoulé';
      case 'hyrox':
        return 'Temps total';
    }
  }

  function subText(f: Frame, ms: number): string {
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
      case 'hyrox': {
        if (f.phase === 'countdown') return plural(segments.length, 'segment');
        return `Ce segment : ${clockText(Math.floor((ms - (marks.at(-1) ?? 0)) / 1000))}`;
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
      case 'hyrox': {
        const index = segmentIndex();
        const next = segments[index + 1];
        return [
          h('div', { class: 'segment-now' }, movementList(segments.slice(index, index + 1))),
          h('p', { class: 'segment-next' }, next ? `Ensuite : ${movementText(next)}` : 'Dernier segment'),
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
    const countsDown = wod.type === 'amrap' || wod.type === 'emom';
    const left = countsDown ? f.seconds : Math.ceil((total - ms) / 1000);

    el.dataset.phase = paused ? 'paused' : f.phase;
    el.toggleAttribute('data-urgent', running && left <= URGENT_SEC);

    const text = f.phase === 'countdown' ? String(f.seconds) : clockText(f.seconds);
    if (clockEl.textContent !== text) clockEl.textContent = text;
    phaseEl.textContent = phaseText(f, paused);
    subEl.textContent = subText(f, ms);

    const key = `${f.interval}:${rounds}:${marks.length}`;
    if (key !== planKey) {
      planKey = key;
      planEl.replaceChildren(...planFor(f));
    }

    if (stepped) {
      roundLabel.textContent = `Segment ${segmentIndex() + 1} / ${segments.length}`;
      minusBtn.disabled = marks.length === 0;
      finishBtn.textContent = marks.length < segments.length - 1 ? 'Segment suivant' : 'Terminé !';
    } else {
      roundLabel.textContent =
        wod.type === 'for_time' ? `Tour ${Math.min(rounds + 1, wod.rounds)} / ${wod.rounds}` : plural(rounds, 'tour');
      minusBtn.disabled = rounds === 0;
      finishBtn.textContent = 'Terminé !';
    }
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

  /** Hyrox : valide le segment en cours ; le dernier termine le WOD. */
  function nextSegment(): void {
    const ms = now();
    if (ms < 0 || ms - (marks.at(-1) ?? 0) < MIN_SEGMENT_MS) return;
    marks.push(ms);
    if (marks.length >= segments.length) return finish(true);
    playCue('tick');
    save();
    paint();
  }

  function undoSegment(): void {
    marks.pop();
    save();
    paint();
  }

  /** Fige le chrono et passe à la saisie du score. */
  function finish(completed: boolean): void {
    const frozen = Math.min(Math.max(now(), 0), total);
    setSession({ stage: 'score', wod, wod_id, rounds, marks, elapsedMs: frozen, completed });
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
