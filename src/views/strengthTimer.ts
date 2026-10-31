import { playCue, unlockAudio } from '../audio';
import { choose, h } from '../dom';
import { celebrate } from '../fireworks';
import { clock as clockText, decimal, duration, kg, setsLine, setText, wodHeadline } from '../format';
import { liftFor } from '../lifts';
import { navigate, type View } from '../router';
import { setSession, sortedResults, type Session, type StrengthProgress } from '../store';
import { plannedSets, restOf } from '../strength';
import { elapsedMs, type Clock } from '../timer';
import { blockStep, endRun } from './blocks';
import type { StrengthSet, StrengthWod } from '../types';
import { screenWake } from '../wake';

const TICK_MS = 200;
/** Bips avant la fin d'un repos ou d'une série chronométrée, en secondes. */
const BEEPS = [3, 2, 1];
/** Réglage du repos en cours, en secondes. */
const REST_STEP_SEC = 15;
/** WOD terminé : les feux d'artifice durent jusqu'à ce que l'on quitte le chrono ou la saisie du score. */
const CELEBRATION_SCREENS = ['/timer', '/score'];

/** Pas de réglage d'une charge : 2,5 kg sur une barre, 1 kg sur des haltères ou une charge légère. */
const loadStep = (load: number, pair: boolean) => (pair || load < 20 ? 1 : 2.5);

type TimerSession = Extract<Session, { stage: 'timer' }>;

/**
 * Chrono d'une séance de force : il guide série par série. On ajuste les reps (ou la durée) et la
 * charge réellement faites, on valide, et le repos démarre tout seul avec ses bips. Tout est
 * enregistré à chaque série : rien n'est perdu si l'appli se ferme.
 */
export function strengthTimerView(initial: TimerSession, wod: StrengthWod): View {
  const { wod_id, blocks } = initial;
  // Pas de décompte de départ : une séance de force démarre à la première série.
  let clock: Clock = initial.strength ? initial.clock : { accumMs: 0, resumedAt: Date.now() };
  const progress: StrengthProgress = initial.strength ?? { done: wod.exercises.map(() => []), exercise: 0, restUntil: null };
  const results = sortedResults();

  /** Série en cours d'ajustement : reps (ou durée) et charge, avant validation. */
  let draft: StrengthSet = {};
  /** Série chronométrée (gainage…) en cours : fin, en Date.now(). */
  let workUntil: number | null = null;
  let lastTick = Date.now();

  const save = () => setSession({ stage: 'timer', wod, wod_id, clock, rounds: 0, marks: [], strength: progress, ...(blocks && { blocks }) });
  const exercise = () => wod.exercises[progress.exercise] ?? wod.exercises[0]!;
  const planned = () => plannedSets(exercise());
  const done = () => progress.done[progress.exercise] ?? [];
  const pair = () => exercise().load_count === 2;
  const allDone = () => wod.exercises.every((item, i) => (progress.done[i]?.length ?? 0) >= plannedSets(item).length);
  const exerciseDone = () => done().length >= planned().length;

  /** Valeurs proposées pour la prochaine série : la série prévue, sinon la dernière faite. */
  const resetDraft = () => {
    const next = planned()[done().length] ?? done().at(-1) ?? planned().at(-1) ?? {};
    draft = { ...next };
  };

  const elapsedEl = h('span', { class: 'elapsed', role: 'timer' });
  const tabs = h('nav', { class: 'exercise-tabs', 'aria-label': 'Exercices' });
  const phaseEl = h('p', { class: 'timer-phase' });
  const bigEl = h('p', { class: 'timer-clock strength-clock' });
  const subEl = h('p', { class: 'timer-sub' });
  const card = h('div', { class: 'strength-card' });
  const primary = h('button', { class: 'btn primary big block' });
  const restRow = h(
    'div',
    { class: 'row' },
    h('button', { class: 'btn grow', onclick: () => shiftRest(-REST_STEP_SEC) }, `−${REST_STEP_SEC} s`),
    h('button', { class: 'btn grow', onclick: () => shiftRest(REST_STEP_SEC) }, `+${REST_STEP_SEC} s`),
    h('button', { class: 'btn grow', onclick: endRest }, 'Passer'),
  );
  const extraRow = h('div', { class: 'row' });

  const el = h(
    'section',
    { class: 'timer strength' },
    h('header', { class: 'timer-head' }, h('strong', null, wod.title), h('span', null, blocks ? `${blockStep(blocks)} · ` : '', wodHeadline(wod), ' · ', elapsedEl)),
    tabs,
    h('div', { class: 'timer-face' }, phaseEl, bigEl, subEl),
    card,
    h(
      'div',
      { class: 'timer-controls' },
      restRow,
      primary,
      extraRow,
      h('button', { class: 'btn ghost block', onclick: () => void stop() }, 'Arrêter'),
    ),
  );

  const resting = () => progress.restUntil !== null && Date.now() < progress.restUntil;
  const working = () => workUntil !== null && Date.now() < workUntil;
  const left = (until: number) => Math.max(0, Math.ceil((until - Date.now()) / 1000));

  /** Ajusteur − valeur + d'une série. */
  function stepper(label: string, value: string, onMinus: () => void, onPlus: () => void): HTMLElement {
    return h(
      'div',
      { class: 'stepper' },
      h('button', { type: 'button', class: 'btn icon', 'aria-label': `${label} : moins`, onclick: onMinus }, '−'),
      h('strong', { 'aria-label': label }, value),
      h('button', { type: 'button', class: 'btn icon', 'aria-label': `${label} : plus`, onclick: onPlus }, '+'),
    );
  }

  function adjust(change: (set: StrengthSet) => void): void {
    change(draft);
    paint();
  }

  function renderCard(): void {
    const item = exercise();
    const target = planned()[done().length];
    const lift = liftFor(results, item.name);
    const lastSession = lift?.sessions.at(-1);
    const steppers: HTMLElement[] = [];
    if (!exerciseDone() || target === undefined) {
      if (draft.duration_sec !== undefined) {
        steppers.push(
          stepper('Durée', duration(draft.duration_sec), () => adjust((set) => (set.duration_sec = Math.max(5, (set.duration_sec ?? 0) - 5))), () => adjust((set) => (set.duration_sec = (set.duration_sec ?? 0) + 5))),
        );
      } else {
        steppers.push(
          stepper('Répétitions', `${draft.reps ?? 0} reps`, () => adjust((set) => (set.reps = Math.max(0, (set.reps ?? 0) - 1))), () => adjust((set) => (set.reps = (set.reps ?? 0) + 1))),
        );
      }
      if (draft.load_kg !== undefined) {
        const step = loadStep(draft.load_kg, pair());
        steppers.push(
          stepper(
            'Charge',
            pair() ? `2 × ${kg(draft.load_kg)}` : kg(draft.load_kg),
            () => adjust((set) => (set.load_kg = Math.max(0, (set.load_kg ?? 0) - step))),
            () => adjust((set) => (set.load_kg = (set.load_kg ?? 0) + step)),
          ),
        );
      }
    }
    const parts = [
      h('h2', { class: 'exercise-name' }, item.name),
      target && h('p', { class: 'target' }, `Prévu : ${setText(target, item.load_count)}`),
      ...steppers,
      done().length > 0 &&
        h(
          'ol',
          { class: 'done-sets', 'aria-label': 'Séries faites' },
          done().map((set) => h('li', null, setText(set, item.load_count))),
        ),
      lastSession &&
        h('p', { class: 'hint left' }, `Dernière fois (${new Date(`${lastSession.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}) : ${setsLine(lastSession.sets, lastSession.loadCount)}`),
      lift?.best &&
        h('p', { class: 'hint left' }, `Record : ${setText(lift.best.set, item.load_count)} · 1RM estimé ${decimal(Math.round(lift.best.oneRepMax * 2) / 2)} kg`),
      item.notes && h('p', { class: 'note' }, item.notes),
    ];
    card.replaceChildren(...parts.filter((part): part is HTMLElement => part instanceof HTMLElement));
  }

  function renderTabs(): void {
    tabs.replaceChildren(
      ...wod.exercises.map((item, i) => {
        const count = progress.done[i]?.length ?? 0;
        const total = plannedSets(item).length;
        return h(
          'button',
          {
            type: 'button',
            class: `exercise-tab ${i === progress.exercise ? 'current' : ''} ${count >= total ? 'complete' : ''}`,
            'aria-pressed': String(i === progress.exercise),
            onclick: () => goTo(i),
          },
          `${i + 1}. ${item.name} `,
          h('span', null, `${count}/${total}`),
        );
      }),
    );
  }

  function paint(): void {
    elapsedEl.textContent = clockText(Math.max(0, Math.floor(elapsedMs(clock, Date.now()) / 1000)));
    const rest = resting();
    const work = working();
    el.toggleAttribute('data-resting', rest);
    const item = exercise();
    const count = done().length;
    const total = planned().length;
    if (work) {
      phaseEl.textContent = 'Série en cours';
      bigEl.textContent = clockText(left(workUntil ?? 0));
      subEl.textContent = `${item.name} · série ${count + 1} / ${total}`;
    } else if (rest) {
      phaseEl.textContent = 'Repos';
      bigEl.textContent = clockText(left(progress.restUntil ?? 0));
      subEl.textContent = exerciseDone()
        ? allDone()
          ? 'Toutes les séries prévues sont faites'
          : `Ensuite : ${wod.exercises[nextExercise() ?? progress.exercise]?.name ?? ''}`
        : `Ensuite : série ${count + 1} / ${total}${planned()[count] ? ` · ${setText(planned()[count]!, item.load_count)}` : ''}`;
    } else {
      phaseEl.textContent = `Exercice ${progress.exercise + 1} / ${wod.exercises.length}`;
      bigEl.textContent = exerciseDone() ? '✓' : `${count + 1} / ${total}`;
      subEl.textContent = exerciseDone() ? 'Séries prévues faites' : `Série ${count + 1} sur ${total}`;
    }
    restRow.hidden = !rest;
    renderTabs();
    renderCard();

    // Bouton principal : valider la série, ou passer à la suite une fois les séries faites.
    if (exerciseDone()) {
      const next = nextExercise();
      primary.textContent = next !== undefined ? 'Exercice suivant' : blocks ? 'Terminer ce bloc' : 'Terminer et noter la séance';
      primary.onclick = () => (next === undefined ? void finish(true) : goTo(next));
    } else if (draft.duration_sec !== undefined && !work) {
      primary.textContent = `Lancer la série (${clockText(draft.duration_sec)})`;
      primary.onclick = startWork;
    } else {
      primary.textContent = work ? 'Série faite (arrêter)' : 'Série faite';
      primary.onclick = validateSet;
    }
    extraRow.replaceChildren(
      ...(count > 0 ? [h('button', { class: 'btn grow', onclick: undoSet }, 'Annuler la série')] : []),
      ...(exerciseDone() ? [h('button', { class: 'btn grow', onclick: extraSet }, 'Série en plus')] : []),
    );
    extraRow.hidden = extraRow.childElementCount === 0;
  }

  /** Prochain exercice qui a encore des séries prévues, en partant de celui en cours. */
  function nextExercise(): number | undefined {
    for (let step = 1; step <= wod.exercises.length; step++) {
      const i = (progress.exercise + step) % wod.exercises.length;
      const item = wod.exercises[i];
      if (item && (progress.done[i]?.length ?? 0) < plannedSets(item).length) return i;
    }
    return undefined;
  }

  function goTo(index: number): void {
    progress.exercise = index;
    resetDraft();
    save();
    paint();
  }

  function validateSet(): void {
    unlockAudio();
    const set: StrengthSet = { ...draft };
    if (working() && workUntil !== null && set.duration_sec !== undefined) {
      // Série chronométrée arrêtée avant la fin : on garde le temps tenu.
      set.duration_sec = Math.max(1, set.duration_sec - left(workUntil));
    }
    workUntil = null;
    progress.done[progress.exercise] = [...done(), set];
    playCue('tick');
    if (allDone()) {
      progress.restUntil = null;
      save();
      celebrate(CELEBRATION_SCREENS);
    } else {
      progress.restUntil = Date.now() + restOf(exercise()) * 1000;
      playCue('rest');
      save();
    }
    resetDraft();
    paint();
  }

  function startWork(): void {
    unlockAudio();
    workUntil = Date.now() + (draft.duration_sec ?? 0) * 1000;
    playCue('go');
    paint();
  }

  function undoSet(): void {
    progress.done[progress.exercise] = done().slice(0, -1);
    progress.restUntil = null;
    resetDraft();
    save();
    paint();
  }

  /** Une série de plus que prévu, avec les valeurs ajustées (au départ, celles de la dernière). */
  function extraSet(): void {
    progress.done[progress.exercise] = [...done(), { ...draft }];
    progress.restUntil = Date.now() + restOf(exercise()) * 1000;
    playCue('tick');
    playCue('rest');
    save();
    paint();
  }

  function shiftRest(seconds: number): void {
    if (progress.restUntil === null) return;
    progress.restUntil = Math.max(Date.now(), progress.restUntil + seconds * 1000);
    save();
    paint();
  }

  function endRest(): void {
    progress.restUntil = null;
    playCue('go');
    save();
    paint();
  }

  /** Arrête le chrono et passe à la saisie du score (ou au bloc suivant d'une séance), avec les séries notées. */
  function finish(completed: boolean): void {
    const at = Math.max(0, elapsedMs(clock, Date.now()));
    endRun({ wod, wod_id, blocks }, { rounds: 0, marks: [], strength: progress, elapsedMs: at, completed });
  }

  async function stop(): Promise<void> {
    const answer = await choose(blocks ? 'Arrêter ce bloc ?' : 'Arrêter la séance ?', 'Les séries faites sont gardées pour la saisie du score.', [
      { label: blocks ? 'Terminer ce bloc' : 'Saisir mon score', value: 'score', kind: 'primary' },
      { label: blocks ? 'Abandonner la séance' : 'Abandonner sans enregistrer', value: 'discard', kind: 'danger' },
      { label: blocks ? 'Continuer le bloc' : 'Continuer la séance', value: 'continue' },
    ]);
    if (answer === 'score') finish(allDone());
    else if (answer === 'discard') {
      setSession(null);
      navigate(wod_id ? `/wod/${wod_id}` : '/', true);
    }
  }

  function tick(): void {
    const now = Date.now();
    for (const until of [progress.restUntil, workUntil]) {
      if (until === null) continue;
      if (BEEPS.some((sec) => lastTick < until - sec * 1000 && now >= until - sec * 1000)) playCue('tick');
    }
    if (workUntil !== null && now >= workUntil) {
      playCue('end');
      validateSet();
    }
    if (progress.restUntil !== null && now >= progress.restUntil) {
      progress.restUntil = null;
      playCue('go');
      save();
      paint();
    }
    lastTick = now;
    elapsedEl.textContent = clockText(Math.max(0, Math.floor(elapsedMs(clock, now) / 1000)));
    if (resting() || working()) bigEl.textContent = clockText(left((working() ? workUntil : progress.restUntil) ?? 0));
  }

  const wake = screenWake();
  void wake.keep();
  resetDraft();
  save();
  paint();
  const interval = window.setInterval(tick, TICK_MS);
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    unlockAudio();
    void wake.keep();
    lastTick = Date.now();
    tick();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    el,
    destroy() {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      wake.release();
    },
  };
}
