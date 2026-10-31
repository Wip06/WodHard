import { choose, h, toast } from '../dom';
import { celebrate } from '../fireworks';
import { clock, exerciseSummary, movementText, setText, today, wodSummary } from '../format';
import { recordsBeaten } from '../lifts';
import { coachReady, loadCoach } from '../claude';
import { allMovements, isRest } from '../movements';
import { adjustmentDirection, lastSplits, repsInRounds, scalesDown } from '../records';
import { asPrescribed, plannedSets } from '../strength';
import { navigate, type View } from '../router';
import {
  currentRecords,
  findResult,
  getSession,
  newId,
  sameWorkout,
  saveResult,
  setSession,
  sortedResults,
  type Session,
} from '../store';
import { splitsFromMarks } from '../timer';
import type { Adjustment, Movement, Result, Score, StrengthSet, StrengthWod, Wod } from '../types';
import { isDate, validateScore } from '../validate';
import { askAdvice, badges, field, pageHead, splitsList, wodPlan } from './parts';

/** Valeurs de départ du formulaire : champs de tous les types de score, tous facultatifs. */
interface Draft {
  rounds?: number;
  extra_reps?: number;
  intervals_completed?: number;
  finished?: boolean;
  time_sec?: number;
  reps_completed?: number;
  segments_completed?: number;
  splits_sec?: number[];
  rx: boolean;
  rpe?: number;
  notes?: string;
  adjustments?: Adjustment[];
  /** Force : séries faites, une liste par exercice. */
  exercises?: StrengthSet[][];
  duration_sec?: number;
}

interface Context {
  wod: Wod;
  draft: Draft;
  editing?: Result;
  wodId?: string;
}

const FIELD_LABELS: Record<string, string> = {
  rounds: 'Tours complets',
  extra_reps: 'Reps en plus',
  intervals_completed: 'Intervalles tenus',
  time_sec: 'Temps',
  reps_completed: 'Reps réalisées',
  segments_completed: 'Segments terminés',
  splits_sec: 'Temps par segment',
  rpe: 'RPE',
  notes: 'Notes',
};

function draftFromSession(session: Extract<Session, { stage: 'score' }>): Draft {
  const { wod, elapsedMs, completed, rounds, marks } = session;
  const draft: Draft = { rx: true };
  if (wod.type === 'strength') {
    // Séries notées au chrono ; sans chrono, les séries prévues, à corriger au besoin.
    const exercises = session.strength?.done ?? wod.exercises.map((exercise) => plannedSets(exercise).map((set) => ({ ...set })));
    return {
      rx: asPrescribed(wod, { exercises, rx: true }),
      exercises,
      ...(elapsedMs !== undefined && { duration_sec: Math.max(1, Math.floor(elapsedMs / 1000)) }),
    };
  }
  if (elapsedMs === undefined) {
    if (wod.type === 'for_time' || wod.type === 'hyrox') draft.finished = true;
    return draft;
  }
  switch (wod.type) {
    case 'amrap':
      draft.rounds = rounds;
      draft.extra_reps = 0;
      // Un temps par tour, à condition que chaque tour compté ait bien été validé au chrono.
      if (rounds > 0 && marks.length === rounds) draft.splits_sec = splitsFromMarks(marks);
      break;
    case 'emom':
      draft.intervals_completed = completed ? wod.intervals : Math.floor(elapsedMs / (wod.interval_sec * 1000));
      break;
    case 'for_time':
      draft.finished = completed;
      if (completed) {
        draft.time_sec = Math.max(1, Math.floor(elapsedMs / 1000));
        // Tous les tours intermédiaires validés : le dernier tour se termine avec le WOD.
        if (wod.rounds > 1 && marks.length === wod.rounds - 1) draft.splits_sec = splitsFromMarks([...marks, elapsedMs]);
      } else {
        draft.reps_completed = repsInRounds(wod, rounds);
        if (rounds > 0 && marks.length === rounds) draft.splits_sec = splitsFromMarks(marks);
      }
      break;
    case 'hyrox':
      draft.finished = completed;
      if (marks.length > 0) draft.splits_sec = splitsFromMarks(marks);
      // Le temps final est celui du dernier segment validé, pour rester égal à la somme des segments.
      if (completed) draft.time_sec = Math.max(1, Math.floor((marks.at(-1) ?? elapsedMs) / 1000));
      else draft.segments_completed = marks.length;
  }
  return draft;
}

function context(resultId?: string): Context | null {
  if (resultId) {
    const editing = findResult(resultId);
    return editing ? { wod: editing.wod, draft: { ...editing.score }, editing } : null;
  }
  const session = getSession();
  if (!session || session.stage !== 'score') return null;
  return { wod: session.wod, draft: draftFromSession(session), wodId: session.wod_id };
}

function numberInput(value: number | undefined, label: string, max?: number): HTMLInputElement {
  return h('input', {
    type: 'number',
    inputmode: 'numeric',
    min: 0,
    max,
    step: 1,
    value: value ?? '',
    'aria-label': label,
  });
}

/**
 * Champ décimal. En texte plutôt qu'en `number` : un clavier français tape « 62,5 », qu'un champ
 * numérique refuserait en silence ; la virgule est convertie à la lecture.
 */
const DECIMAL = { type: 'text', inputmode: 'decimal', autocomplete: 'off' } as const;

/**
 * Séries d'une séance de force, exercice par exercice : une ligne par série (reps ou durée, et
 * charge), avec de quoi en ajouter ou en retirer. `onChange` signale chaque modification.
 */
function strengthFields(wod: StrengthWod, initial: StrengthSet[][], onChange: () => void) {
  const lists = wod.exercises.map((exercise, i) => {
    const timed = plannedSets(exercise).some((set) => set.duration_sec !== undefined);
    const loaded = plannedSets(exercise).some((set) => set.load_kg !== undefined) || (initial[i] ?? []).some((set) => set.load_kg !== undefined);
    const rowsEl = h('ol', { class: 'sets-editor' });
    const rows: { amount: HTMLInputElement; load: HTMLInputElement | null; el: HTMLElement }[] = [];
    const renumber = () => rows.forEach((row, j) => (row.el.querySelector('.set-label')!.textContent = `Série ${j + 1}`));
    const addRow = (set: StrengthSet) => {
      const amount = h('input', {
        type: 'number',
        inputmode: 'numeric',
        min: 0,
        step: 1,
        value: (timed ? set.duration_sec : set.reps) ?? '',
        'aria-label': timed ? `${exercise.name} : durée en secondes` : `${exercise.name} : répétitions`,
      });
      const load = loaded
        ? h('input', { ...DECIMAL, value: set.load_kg === undefined ? '' : String(set.load_kg).replace('.', ','), 'aria-label': `${exercise.name} : charge en kg` })
        : null;
      const row = h(
        'li',
        { class: 'set-row' },
        h('span', { class: 'set-label' }),
        amount,
        h('span', null, timed ? 's' : 'reps'),
        load && [h('span', { class: 'times' }, '×'), load, h('span', null, exercise.load_count === 2 ? 'kg/main' : 'kg')],
        h(
          'button',
          {
            type: 'button',
            class: 'btn icon',
            'aria-label': 'Retirer cette série',
            onclick: () => {
              rows.splice(rows.indexOf(entry), 1);
              row.remove();
              renumber();
              onChange();
            },
          },
          '✕',
        ),
      );
      const entry = { amount, load, el: row };
      rows.push(entry);
      rowsEl.append(row);
      renumber();
    };
    (initial[i] ?? []).forEach(addRow);
    rowsEl.addEventListener('input', onChange);
    const el = h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, `${i + 1}. ${exercise.name} · prévu ${exerciseSummary(exercise)}`),
      rowsEl,
      h(
        'button',
        {
          type: 'button',
          class: 'btn block',
          onclick: () => {
            const last = rows.at(-1);
            addRow(last ? { [timed ? 'duration_sec' : 'reps']: readNumber(last.amount), load_kg: last.load ? readNumber(last.load) : undefined } : plannedSets(exercise)[0] ?? {});
            onChange();
          },
        },
        '+ Série',
      ),
    );
    const read = (): StrengthSet[] =>
      rows.flatMap((row) => {
        const amount = readNumber(row.amount);
        if (amount === undefined) return [];
        const set: StrengthSet = timed ? { duration_sec: amount } : { reps: amount };
        const weight = row.load ? readNumber(row.load) : undefined;
        if (weight !== undefined) set.load_kg = weight;
        return [set];
      });
    return { el, read };
  });
  return { els: lists.map((list) => list.el), read: () => lists.map((list) => list.read()) };
}

const readNumber = (input: HTMLInputElement) =>
  input.value.trim() === '' ? undefined : Number(input.value.trim().replace(',', '.'));

type QuantityKey = 'reps' | 'distance_m' | 'calories' | 'duration_sec';
const UNITS: Record<QuantityKey, string> = { reps: 'reps', distance_m: 'm', calories: 'cal', duration_sec: 's' };
const quantityKey = (m: Movement) => (Object.keys(UNITS) as QuantityKey[]).find((key) => m[key] !== undefined);

/**
 * « Ce que j'ai vraiment fait » : une ligne par mouvement adapté, pré-remplie avec le prescrit.
 * Seules les valeurs modifiées sont gardées ; une ligne laissée telle quelle est ignorée.
 */
function adjustmentsEditor(wod: Wod, initial: Adjustment[], onChange: () => void) {
  const movements = allMovements(wod);
  const choices = movements.map((movement, index) => ({ movement, index })).filter(({ movement }) => !isRest(movement));
  const scheme = wod.type === 'for_time' ? wod.rep_scheme?.join('-') : undefined;
  const rowsEl = h('div', { class: 'stack' });
  const rows: { read: () => Adjustment | null }[] = [];

  function addRow(start?: Adjustment): void {
    const first = choices.find(({ index }) => index === start?.index) ?? choices[0];
    if (!first) return;
    const select = h(
      'select',
      { 'aria-label': 'Mouvement adapté' },
      choices.map(({ movement, index }) =>
        h('option', { value: index, selected: index === first.index }, `${index + 1}. ${movementText(movement)}`),
      ),
    );
    const replaced = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Fait à la place (facultatif), ex. Ring row', 'aria-label': 'Mouvement fait à la place' });
    replaced.value = start?.replaced_by ?? '';
    const amount = h('input', { ...DECIMAL, 'aria-label': 'Quantité réalisée' });
    const unit = h('span');
    const weight = h('input', { ...DECIMAL, 'aria-label': 'Charge réalisée' });
    const weightUnit = h('span');
    const amountRow = h('div', { class: 'field-row' }, amount, unit);
    const schemeHint = h('p', { class: 'hint left' }, `Ce mouvement suit le schéma ${scheme ?? ''} : seule la charge peut changer.`);
    const target = () => movements[Number(select.value)];

    /** Valeurs prescrites du mouvement choisi, ou celles déjà notées pour cette ligne. */
    const fill = (from?: Adjustment) => {
      const movement = target();
      if (!movement) return;
      const key = quantityKey(movement);
      amountRow.hidden = key === undefined;
      schemeHint.hidden = key !== undefined || scheme === undefined;
      unit.textContent = key ? UNITS[key] : '';
      amount.value = String((key && (from?.[key] ?? movement[key])) ?? '').replace('.', ',');
      weight.value = String(from?.load_kg ?? movement.load_kg ?? '').replace('.', ',');
      weight.placeholder = movement.load_kg === undefined ? 'aucune' : '';
      weightUnit.textContent = (from?.load_count ?? movement.load_count) === 2 ? 'kg par main' : 'kg';
    };
    fill(start);
    select.addEventListener('change', () => {
      fill();
      onChange();
    });

    const row = {
      read(): Adjustment | null {
        const movement = target();
        if (!movement) return null;
        const adjustment: Adjustment = { index: Number(select.value), name: movement.name };
        const by = replaced.value.trim();
        if (by !== '') adjustment.replaced_by = by;
        const key = quantityKey(movement);
        const done = readNumber(amount);
        if (key && done !== undefined && done !== movement[key]) adjustment[key] = done;
        const kg = readNumber(weight);
        if (kg !== undefined && kg !== movement.load_kg) adjustment.load_kg = kg;
        if (start?.load_count !== undefined) adjustment.load_count = start.load_count;
        return Object.keys(adjustment).length > 2 ? adjustment : null;
      },
    };
    rows.push(row);
    const card = h(
      'div',
      { class: 'editor-card' },
      h(
        'div',
        { class: 'editor-head' },
        h('span', null, 'Mouvement adapté'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn icon',
            'aria-label': 'Retirer cette adaptation',
            onclick: () => {
              rows.splice(rows.indexOf(row), 1);
              card.remove();
              onChange();
            },
          },
          '✕',
        ),
      ),
      select,
      replaced,
      schemeHint,
      amountRow,
      h('div', { class: 'field-row' }, weight, weightUnit),
    );
    card.addEventListener('input', onChange);
    rowsEl.append(card);
  }

  initial.forEach((adjustment) => addRow(adjustment));
  const el = h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, 'Adaptations (facultatif)'),
    h(
      'p',
      { class: 'hint left' },
      'Note ce que tu as vraiment fait. Plus léger ou moins de reps : la séance passe en scaled. Plus lourd ou plus de reps : elle reste Rx et devient Rx+.',
    ),
    rowsEl,
    choices.length > 0 &&
      h(
        'button',
        {
          type: 'button',
          class: 'btn block',
          onclick: () => {
            addRow();
            onChange();
          },
        },
        '+ Adapter un mouvement',
      ),
  );
  return { el, read: () => rows.map((row) => row.read()).filter((adjustment) => adjustment !== null) };
}

export function scoreView(resultId?: string): View | null {
  const found = context(resultId);
  if (!found) return null;
  const { wod, draft, editing, wodId } = found;

  // Champs propres au type de WOD ; `read` renvoie leur valeur au format du score.
  let read: () => Record<string, unknown>;
  const typeFields: (HTMLElement | false)[] = [];

  /** Rappel des temps relevés au chrono. Pour une nouvelle séance, ils sont comparés à la dernière fois. */
  const splitsRecap = (splits: number[] | undefined, label: string) =>
    splits !== undefined &&
    splits.length > 0 &&
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, label),
      splitsList(wod, splits, editing ? undefined : lastSplits(sameWorkout(wod))),
    );

  const rx = h('input', { type: 'checkbox', checked: draft.rx });
  // Force : les séries faites ; Rx se coche tant que tout le prescrit est fait.
  let strength: ReturnType<typeof strengthFields> | null = null;

  switch (wod.type) {
    case 'strength': {
      strength = strengthFields(wod, draft.exercises ?? [], () => {
        if (strength) rx.checked = asPrescribed(wod, { exercises: strength.read(), rx: true });
      });
      typeFields.push(...strength.els);
      const fields = strength;
      read = () => ({ exercises: fields.read(), ...(draft.duration_sec !== undefined && { duration_sec: draft.duration_sec }) });
      break;
    }
    case 'amrap': {
      const splits = draft.splits_sec;
      const rounds = numberInput(draft.rounds, 'Tours complets');
      const extra = numberInput(draft.extra_reps, 'Reps en plus');
      typeFields.push(
        field('Tours complets', rounds),
        field('Reps en plus', extra),
        splitsRecap(splits, 'Temps par tour, relevés au chrono'),
      );
      read = () => {
        const done = readNumber(rounds);
        // Les temps par tour ne sont gardés que s'il y en a toujours un par tour compté.
        const keep = splits !== undefined && splits.length === done;
        return { rounds: done, extra_reps: readNumber(extra), ...(keep && { splits_sec: splits }) };
      };
      break;
    }
    case 'emom': {
      const done = numberInput(draft.intervals_completed, 'Intervalles tenus', wod.intervals);
      typeFields.push(field('Intervalles tenus', done, `sur ${wod.intervals}`));
      read = () => ({ intervals_completed: readNumber(done) });
      break;
    }
    case 'for_time':
    case 'hyrox': {
      // Les deux se terminent par un temps ; sinon on note où l'on s'est arrêté (reps ou segments).
      const segmentCount = wod.type === 'hyrox' ? wod.segments.length : null;
      /** Nombre de temps attendus quand le WOD est terminé : un par segment ou par tour. */
      const fullCount = wod.type === 'hyrox' ? wod.segments.length : wod.rounds;
      const splits = draft.splits_sec;
      let finished = draft.finished ?? true;
      const minutes = numberInput(draft.time_sec === undefined ? undefined : Math.floor(draft.time_sec / 60), 'Minutes');
      const seconds = numberInput(draft.time_sec === undefined ? undefined : draft.time_sec % 60, 'Secondes', 59);
      const partial =
        segmentCount === null
          ? numberInput(draft.reps_completed, 'Reps réalisées')
          : numberInput(draft.segments_completed, 'Segments terminés', segmentCount);
      const timeField = field('Temps', minutes, 'min', seconds, 's');
      const readTime = () => {
        const min = readNumber(minutes);
        const sec = readNumber(seconds);
        return min === undefined && sec === undefined ? undefined : (min ?? 0) * 60 + (sec ?? 0);
      };
      // Un temps au-delà du cap reste valable : la séance est simplement marquée hors cap.
      const cap = wod.time_cap_sec;
      const capHint = h('p', { class: 'hint left', hidden: true });
      if (cap !== undefined) capHint.textContent = `Au-delà du time cap de ${clock(cap)} : la séance sera marquée hors cap.`;
      const refreshCap = () => {
        const time = readTime();
        capHint.hidden = !(finished && cap !== undefined && time !== undefined && time > cap);
      };
      minutes.addEventListener('input', refreshCap);
      seconds.addEventListener('input', refreshCap);
      const partialField =
        segmentCount === null
          ? field('Reps réalisées au time cap', partial)
          : field('Segments terminés', partial, `sur ${segmentCount}`);
      const yes = h('button', { type: 'button', class: 'btn grow', onclick: () => setFinished(true) }, 'Terminé');
      const no = h(
        'button',
        { type: 'button', class: 'btn grow', onclick: () => setFinished(false) },
        segmentCount === null ? 'Time cap atteint' : 'Arrêté avant la fin',
      );
      const setFinished = (value: boolean) => {
        finished = value;
        yes.setAttribute('aria-pressed', String(value));
        no.setAttribute('aria-pressed', String(!value));
        timeField.hidden = !value;
        partialField.hidden = value;
        refreshCap();
      };
      setFinished(finished);
      typeFields.push(
        h('div', { class: 'segmented' }, yes, no),
        timeField,
        capHint,
        partialField,
        splitsRecap(splits, `Temps par ${segmentCount === null ? 'tour' : 'segment'}, relevés au chrono`),
      );
      read = () => {
        if (finished) {
          const time = readTime();
          // Les temps relevés ne sont gardés que s'ils correspondent encore au temps final.
          const keep = draft.finished === true && splits?.length === fullCount && time === draft.time_sec;
          return { finished, time_sec: time, ...(keep && { splits_sec: splits }) };
        }
        const done = readNumber(partial);
        if (segmentCount === null) {
          // For Time au time cap : les tours terminés avant l'arrêt gardent leur temps.
          const keep = draft.finished === false && splits !== undefined && splits.length > 0;
          return { finished, reps_completed: done, ...(keep && { splits_sec: splits }) };
        }
        const keep = splits !== undefined && splits.length === done;
        return { finished, segments_completed: done, ...(keep && { splits_sec: splits }) };
      };
      break;
    }
  }

  // Une adaptation à la baisse (ou un mouvement remplacé) décoche Rx ; une adaptation à la hausse le garde.
  const adjustments = adjustmentsEditor(wod, draft.adjustments ?? [], () => {
    const directions = adjustments.read().map((adjustment) => adjustmentDirection(wod, adjustment));
    if (directions.includes('down') || directions.includes('replaced')) rx.checked = false;
  });
  let rpe = draft.rpe;
  const rpeButtons = Array.from({ length: 10 }, (_, i) => i + 1).map((value) =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'aria-pressed': String(value === rpe),
        onclick: () => {
          rpe = rpe === value ? undefined : value;
          rpeButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i + 1 === rpe)));
        },
      },
      value,
    ),
  );
  const notes = h('textarea', { rows: 3, 'aria-label': 'Notes', placeholder: 'Sensations, scaling utilisé…' });
  notes.value = draft.notes ?? '';
  const date = h('input', { type: 'date', value: editing?.date ?? today(), max: today(), 'aria-label': 'Date' });
  const errorBox = h('div', { class: 'errors', role: 'alert', hidden: true });

  const setPath = /^exercises\[(\d+)\]\[(\d+)\]/;
  const showErrors = (errors: string[]) => {
    errorBox.replaceChildren(
      h(
        'ul',
        null,
        errors.map((error) => {
          const [key = '', ...rest] = error.split(' : ');
          const adjusted = /^adjustments\[(\d+)\]/.exec(key);
          const set = setPath.exec(key);
          const label = adjusted
            ? `Adaptation ${Number(adjusted[1]) + 1}`
            : set
              ? `Exercice ${Number(set[1]) + 1}, série ${Number(set[2]) + 1}`
              : (FIELD_LABELS[key] ?? key);
          return h('li', null, rest.length > 0 ? `${label} : ${rest.join(' : ')}` : error);
        }),
      ),
    );
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'nearest' });
  };

  const submit = (event: Event) => {
    event.preventDefault();
    const done = wod.type === 'strength' ? [] : adjustments.read();
    // Faire moins que prescrit passe en scaled ; faire plus garde le Rx (et donne le Rx+).
    const raw: Record<string, unknown> = { ...read(), rx: rx.checked && !scalesDown(wod, done) };
    if (done.length > 0) raw.adjustments = done;
    if (rpe !== undefined) raw.rpe = rpe;
    if (notes.value.trim() !== '') raw.notes = notes.value;

    const checked = validateScore(raw, wod);
    const errors = checked.ok ? [] : [...checked.errors];
    if (!isDate(date.value)) errors.push('Date invalide.');
    if (!checked.ok || errors.length > 0) return showErrors(errors);

    const score: Score = checked.value;
    if (editing) {
      saveResult({ ...editing, date: date.value, score });
      toast('Score modifié');
      navigate(`/history/${editing.id}`, true);
    } else {
      const id = newId();
      const before = sortedResults();
      const result: Result = { id, ...(wodId && { wod_id: wodId }), date: date.value, wod, score };
      saveResult(result);
      setSession(null);
      // Record : sur le WOD (déjà fait), ou sur un exercice de force (charge, 1RM estimé, reps).
      const lifted = recordsBeaten(before, result)[0];
      const record = currentRecords().has(id) || lifted !== undefined;
      const saved = findResult(id);
      const advice = saved && coachReady(loadCoach()) ? { label: 'Avis du coach', run: () => askAdvice(saved) } : undefined;
      toast(lifted ? `Nouveau record : ${lifted.name} ${setText(lifted.set)}` : record ? 'Nouveau record !' : 'Séance enregistrée', advice);
      // La séance s'ouvre : score, comparaison avec la dernière fois, avis du coach.
      navigate(`/history/${id}`, true);
      // Un record prolonge la fête sur la séance, jusqu'à ce que l'on en sorte.
      if (record) celebrate([`/history/${id}`]);
    }
  };

  const cancel = async () => {
    if (editing) return navigate(`/history/${editing.id}`, true);
    const confirmed = await choose('Ne pas enregistrer cette séance ?', 'Le score saisi sera perdu.', [
      { label: 'Ne pas enregistrer', value: true, kind: 'danger' },
      { label: 'Continuer la saisie', value: false },
    ]);
    if (!confirmed) return;
    setSession(null);
    navigate(wodId ? `/wod/${wodId}` : '/', true);
  };

  const el = h(
    'section',
    { class: 'page' },
    pageHead(editing ? 'Modifier le score' : 'Mon score'),
    h(
      'div',
      { class: 'sheet-top' },
      badges(wod),
      h('strong', null, wod.title),
      h('span', { class: 'summary' }, wodSummary(wod)),
    ),
    h('details', { class: 'recap' }, h('summary', null, 'Revoir le WOD'), wodPlan(wod)),
    h(
      'form',
      { class: 'form', novalidate: true, onsubmit: submit },
      typeFields,
      wod.type !== 'strength' && adjustments.el,
      h('label', { class: 'check' }, rx, h('span', null, 'Rx : tout le prescrit, sans scaling (Rx+ si tu as fait plus)')),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'RPE : effort ressenti de 1 à 10 (facultatif)'),
        h('div', { class: 'rpe' }, rpeButtons),
      ),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Notes (facultatif)'), notes),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Date'), date),
      errorBox,
      h('button', { type: 'submit', class: 'btn primary big block' }, 'Enregistrer'),
      h('button', { type: 'button', class: 'btn ghost block', onclick: () => void cancel() }, 'Annuler'),
    ),
  );
  return { el };
}
