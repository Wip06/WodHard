import { playCue, unlockAudio } from '../audio';
import { confetti } from '../confetti';
import { choose, h } from '../dom';
import { clock as clockText, duration, movementText, plural, wodHeadline } from '../format';
import { navigate, type View } from '../router';
import { isRest } from '../movements';
import { getSession, setSession } from '../store';
import { cuesBetween, elapsedMs, frame, pause, resume, totalMs, type Frame } from '../timer';
import type { Movement } from '../types';
import { screenWake } from '../wake';
import { movementList } from './parts';

const TICK_MS = 100;
/** Au-delà de cet écart entre deux rafraîchissements (appli en arrière-plan), les bips manqués sont ignorés. */
const MAX_CUE_GAP_MS = 1500;
const URGENT_SEC = 3;
/** Durée minimale d'un tour ou d'un segment, pour qu'un double appui n'en valide pas deux. */
const MIN_SPLIT_MS = 1000;
/** Bips avant la fin d'un repos, en secondes. */
const REST_BEEPS = [3, 2, 1];

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
  /** AMRAP et EMOM s'arrêtent avec leur durée ; For Time et Hyrox continuent après le cap. */
  const endsAtTotal = wod.type === 'amrap' || wod.type === 'emom';
  const now = () => elapsedMs(clock, Date.now());
  const save = () => setSession({ stage: 'timer', wod, wod_id, clock, rounds, marks });
  /** Segment en cours (le dernier reste affiché une fois tous terminés). */
  const segmentIndex = () => Math.min(marks.length, segments.length - 1);
  /**
   * Repos en cours, sur le temps du chrono : il s'arrête avec la pause. Dans un Hyrox, la fin
   * d'un segment de repos passe d'elle-même au segment suivant.
   */
  let rest: { endMs: number; advance: boolean } | null = null;

  const phaseEl = h('p', { class: 'timer-phase' });
  const clockEl = h('p', { class: 'timer-clock', role: 'timer' });
  const subEl = h('p', { class: 'timer-sub' });
  const planEl = h('div', { class: 'timer-plan' });
  const restClock = h('strong', { class: 'rest-clock', role: 'timer' });
  const restBox = h(
    'div',
    { class: 'rest-box', hidden: true },
    h('span', { class: 'rest-label' }, 'Repos'),
    restClock,
    h('button', { class: 'btn', onclick: () => endRest(false) }, 'Fin du repos'),
  );
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
    onclick: () => (stepped ? nextSegment() : void confirmFinish()),
  });
  const pauseBtn = h('button', { class: 'btn grow', onclick: togglePause });
  const runBar = h(
    'div',
    { class: 'row' },
    pauseBtn,
    h('button', { class: 'btn grow', onclick: () => void stop() }, 'Arrêter'),
  );
  // AMRAP et EMOM, une fois le temps écoulé : le score est déjà acquis, pas besoin de confirmer.
  const scoreBtn = h('button', { class: 'btn primary big block', onclick: () => finish(true) }, 'Finish');
  const discardBtn = h('button', { class: 'btn ghost block', onclick: discard }, 'Ne pas enregistrer');

  const el = h(
    'section',
    { class: 'timer' },
    h('header', { class: 'timer-head' }, h('strong', null, wod.title), h('span', null, wodHeadline(wod))),
    h('div', { class: 'timer-face' }, phaseEl, clockEl, subEl),
    restBox,
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
    if (f.phase === 'done') return 'Terminé !';
    if (f.overtime) return 'Hors cap';
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
    // Temps passé dans le tour ou le segment en cours.
    const lap = clockText(Math.floor((ms - (marks.at(-1) ?? 0)) / 1000));
    switch (wod.type) {
      case 'amrap':
        return f.phase === 'countdown' ? `AMRAP ${duration(wod.duration_sec)}` : `Ce tour : ${lap}`;
      case 'for_time': {
        const cap = clockText(wod.time_cap_sec);
        if (f.overtime) {
          return counted ? `Ce tour : ${lap} · cap ${cap} dépassé` : `Cap ${cap} dépassé de ${clockText(f.seconds - wod.time_cap_sec)}`;
        }
        return counted && f.phase === 'running' ? `Ce tour : ${lap} · cap ${cap}` : `Time cap ${cap}`;
      }
      case 'emom': {
        if (f.phase === 'countdown') return `${wod.intervals} × ${duration(wod.interval_sec)}`;
        if (f.interval >= wod.intervals - 1) return 'Dernier intervalle';
        const next = slotAt(f.interval + 1);
        return `Ensuite : ${next.length > 0 ? next.map((movement) => movementText(movement)).join(' + ') : 'repos'}`;
      }
      case 'hyrox': {
        if (f.phase === 'countdown') return plural(segments.length, 'segment');
        return `Ce segment : ${lap}`;
      }
    }
  }

  function planFor(f: Frame): HTMLElement[] {
    // Le bouton de repos n'apparaît que chrono lancé, et pas pendant un repos déjà en cours.
    const onRest = f.phase === 'running' && !rest ? (sec: number) => startRest(sec) : undefined;
    switch (wod.type) {
      case 'amrap':
        return [movementList(wod.movements, { onRest })];
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
          movementList(wod.movements, { schemeReps: scheme?.[round], onRest }),
        ];
      }
      case 'hyrox': {
        const index = segmentIndex();
        const next = segments[index + 1];
        return [
          h('div', { class: 'segment-now' }, movementList(segments.slice(index, index + 1), { onRest: onRest && ((sec) => startRest(sec, true)) })),
          h('p', { class: 'segment-next' }, next ? `Ensuite : ${movementText(next)}` : 'Dernier segment'),
        ];
      }
    }
  }

  let planKey = '';
  /** Les confettis ne partent qu'une fois, quand le temps d'un AMRAP ou d'un EMOM s'achève. */
  let celebrated = frame(wod, now()).phase === 'done';

  function paint(): void {
    const ms = now();
    const f = frame(wod, ms);
    const done = f.phase === 'done';
    const running = f.phase === 'running';
    if (done && !celebrated) {
      celebrated = true;
      confetti();
    }
    const paused = clock.resumedAt === null && !done;
    const countsDown = wod.type === 'amrap' || wod.type === 'emom';
    const left = countsDown ? f.seconds : Math.ceil((total - ms) / 1000);

    el.dataset.phase = paused ? 'paused' : f.overtime ? 'overtime' : f.phase;
    el.toggleAttribute('data-urgent', running && !f.overtime && left <= URGENT_SEC);

    const text = f.phase === 'countdown' ? String(f.seconds) : clockText(f.seconds);
    if (clockEl.textContent !== text) clockEl.textContent = text;
    phaseEl.textContent = phaseText(f, paused);
    subEl.textContent = subText(f, ms);

    const key = `${f.interval}:${rounds}:${marks.length}:${f.phase}:${rest ? 'rest' : ''}`;
    if (key !== planKey) {
      planKey = key;
      planEl.replaceChildren(...planFor(f));
    }

    if (stepped) {
      roundLabel.textContent = `Segment ${segmentIndex() + 1} / ${segments.length}`;
      minusBtn.disabled = marks.length === 0;
      finishBtn.textContent = marks.length < segments.length - 1 ? 'Segment suivant' : 'Finish';
    } else {
      roundLabel.textContent =
        wod.type === 'for_time' ? `Tour ${Math.min(rounds + 1, wod.rounds)} / ${wod.rounds}` : plural(rounds, 'tour');
      minusBtn.disabled = rounds === 0;
      finishBtn.textContent = 'Finish';
    }
    restBox.hidden = rest === null;
    el.toggleAttribute('data-resting', rest !== null);
    if (rest) restClock.textContent = clockText(Math.max(0, Math.ceil((rest.endMs - ms) / 1000)));
    plusBtn.disabled = !running || rounds >= maxRounds;
    finishBtn.disabled = !running || paused;
    pauseBtn.textContent = paused ? 'Reprendre' : 'Pause';
    roundBar.hidden = finishBtn.hidden = runBar.hidden = done;
    scoreBtn.hidden = discardBtn.hidden = !done;
  }

  const wake = screenWake();
  let lastMs = now();

  function tick(): void {
    const ms = now();
    if (ms - lastMs <= MAX_CUE_GAP_MS) {
      cuesBetween(wod, lastMs, ms).forEach(playCue);
      if (rest) {
        const { endMs } = rest;
        if (REST_BEEPS.some((sec) => lastMs < endMs - sec * 1000 && ms >= endMs - sec * 1000)) playCue('tick');
      }
    }
    if (rest && ms >= rest.endMs) endRest(true);
    if (rest && frame(wod, ms).phase === 'done') rest = null;
    lastMs = ms;
    paint();
    if (endsAtTotal && ms >= total) wake.release();
  }

  function togglePause(): void {
    unlockAudio();
    clock = clock.resumedAt === null ? resume(clock, Date.now()) : pause(clock, Date.now());
    save();
    lastMs = now();
    paint();
  }

  /** AMRAP et For Time : valide le tour en cours en notant son temps de passage, ou annule le dernier. */
  function changeRounds(delta: number): void {
    if (delta > 0) {
      const ms = now();
      if (rounds >= maxRounds || ms - (marks.at(-1) ?? 0) < MIN_SPLIT_MS) return;
      marks.push(ms);
    } else {
      marks.pop();
    }
    rounds = Math.max(0, Math.min(rounds + delta, maxRounds));
    save();
    paint();
  }

  /** Lance un repos ; `advance` : c'est le segment en cours d'un Hyrox, validé à la fin du repos. */
  function startRest(sec: number, advance = false): void {
    unlockAudio();
    rest = { endMs: now() + sec * 1000, advance };
    playCue('rest');
    paint();
  }

  /** Fin du repos, à son terme (`onTime`) ou plus tôt à la demande. */
  function endRest(onTime: boolean): void {
    if (!rest) return;
    const { endMs, advance } = rest;
    rest = null;
    playCue('go');
    if (advance && marks.length < segments.length - 1) {
      marks.push(onTime ? endMs : now());
      save();
    }
    paint();
  }

  /** Hyrox : entrer dans un segment de repos lance son compte à rebours. */
  function enterSegment(): void {
    const segment = segments[marks.length];
    if (segment && isRest(segment) && marks.length < segments.length - 1) startRest(segment.duration_sec ?? 0, true);
  }

  /** Hyrox : valide le segment en cours ; le dernier passe par la confirmation du Finish. */
  function nextSegment(): void {
    const ms = now();
    if (ms < 0 || ms - (marks.at(-1) ?? 0) < MIN_SPLIT_MS) return;
    if (marks.length >= segments.length - 1) return void confirmFinish();
    rest = null;
    marks.push(ms);
    playCue('tick');
    save();
    enterSegment();
    paint();
  }

  function undoSegment(): void {
    rest = null;
    marks.pop();
    save();
    paint();
  }

  /**
   * For Time et Hyrox : « Finish » termine la séance après confirmation, pour éviter un arrêt
   * accidentel. Le temps retenu est celui de l'appui, pas celui de la confirmation.
   */
  async function confirmFinish(): Promise<void> {
    const at = now();
    const confirmed = await choose('Terminer la séance ?', 'Le chrono s’arrête et tu passes à la saisie du score.', [
      { label: 'Terminer', value: true, kind: 'primary' },
      { label: 'Continuer', value: false },
    ]);
    if (!confirmed) return;
    if (stepped) marks.push(at);
    confetti();
    finish(true, at);
  }

  /** Fige le chrono et passe à la saisie du score. */
  function finish(completed: boolean, at = now()): void {
    // AMRAP et EMOM : le score est celui de la fin du temps. For Time et Hyrox : le temps réel, même hors cap.
    const frozen = Math.max(endsAtTotal ? Math.min(at, total) : at, 0);
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
    if (!endsAtTotal || now() < total) void wake.keep();
    tick();
  }

  const interval = window.setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', onVisibility);
  if (!endsAtTotal || now() < total) void wake.keep();
  paint();

  return {
    el,
    destroy() {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      wake.release();
    },
  };
}
