import { choose, h, toast } from '../dom';
import { today, wodSummary } from '../format';
import { navigate, type View } from '../router';
import { findResult, getSession, newId, saveResult, setSession, type Session } from '../store';
import type { ForTimeWod, Result, Score, Wod } from '../types';
import { isDate, validateScore } from '../validate';
import { pageHead, typeBadge, wodPlan } from './parts';

/** Valeurs de départ du formulaire : champs de tous les types de score, tous facultatifs. */
interface Draft {
  rounds?: number;
  extra_reps?: number;
  intervals_completed?: number;
  finished?: boolean;
  time_sec?: number;
  reps_completed?: number;
  rx: boolean;
  rpe?: number;
  notes?: string;
}

const FIELD_LABELS: Record<string, string> = {
  rounds: 'Tours complets',
  extra_reps: 'Reps en plus',
  intervals_completed: 'Intervalles tenus',
  time_sec: 'Temps',
  reps_completed: 'Reps réalisées',
  rpe: 'RPE',
  notes: 'Notes',
};

/** Reps cumulées sur les premiers tours, quand tous les mouvements se comptent en reps. */
function repsInRounds(wod: ForTimeWod, rounds: number): number | undefined {
  if (rounds === 0) return undefined;
  if (wod.rep_scheme) {
    const reps = wod.rep_scheme.slice(0, rounds).reduce((sum, n) => sum + n, 0);
    return reps * wod.movements.length;
  }
  let perRound = 0;
  for (const movement of wod.movements) {
    const reps = movement.reps ?? movement.calories;
    if (reps === undefined) return undefined;
    perRound += reps;
  }
  return perRound * rounds;
}

function draftFromSession(session: Extract<Session, { stage: 'score' }>): Draft {
  const { wod, elapsedMs, completed, rounds } = session;
  const draft: Draft = { rx: true };
  if (elapsedMs === undefined) {
    if (wod.type === 'for_time') draft.finished = true;
    return draft;
  }
  switch (wod.type) {
    case 'amrap':
      draft.rounds = rounds;
      draft.extra_reps = 0;
      break;
    case 'emom':
      draft.intervals_completed = completed ? wod.intervals : Math.floor(elapsedMs / (wod.interval_sec * 1000));
      break;
    case 'for_time':
      draft.finished = completed;
      if (completed) draft.time_sec = Math.max(1, Math.floor(elapsedMs / 1000));
      else draft.reps_completed = repsInRounds(wod, rounds);
  }
  return draft;
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

const field = (label: string, ...controls: (HTMLElement | string)[]) =>
  h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), h('div', { class: 'field-row' }, controls));

const readNumber = (input: HTMLInputElement) => (input.value.trim() === '' ? undefined : Number(input.value));

export function scoreView(resultId?: string): View | null {
  let wod: Wod;
  let draft: Draft;
  let editing: Result | undefined;
  let wodId: string | undefined;

  if (resultId) {
    editing = findResult(resultId);
    if (!editing) return null;
    wod = editing.wod;
    draft = { ...editing.score };
  } else {
    const session = getSession();
    if (!session || session.stage !== 'score') return null;
    wod = session.wod;
    wodId = session.wod_id;
    draft = draftFromSession(session);
  }

  // Champs propres au type de WOD ; `read` renvoie leur valeur au format du score.
  let read: () => Record<string, unknown>;
  const typeFields: HTMLElement[] = [];

  switch (wod.type) {
    case 'amrap': {
      const rounds = numberInput(draft.rounds, 'Tours complets');
      const extra = numberInput(draft.extra_reps, 'Reps en plus');
      typeFields.push(field('Tours complets', rounds), field('Reps en plus', extra));
      read = () => ({ rounds: readNumber(rounds), extra_reps: readNumber(extra) });
      break;
    }
    case 'emom': {
      const done = numberInput(draft.intervals_completed, 'Intervalles tenus', wod.intervals);
      typeFields.push(field('Intervalles tenus', done, `sur ${wod.intervals}`));
      read = () => ({ intervals_completed: readNumber(done) });
      break;
    }
    case 'for_time': {
      let finished = draft.finished ?? true;
      const minutes = numberInput(draft.time_sec === undefined ? undefined : Math.floor(draft.time_sec / 60), 'Minutes');
      const seconds = numberInput(draft.time_sec === undefined ? undefined : draft.time_sec % 60, 'Secondes', 59);
      const reps = numberInput(draft.reps_completed, 'Reps réalisées');
      const timeField = field('Temps', minutes, 'min', seconds, 's');
      const repsField = field('Reps réalisées au time cap', reps);
      const yes = h('button', { type: 'button', class: 'btn grow', onclick: () => setFinished(true) }, 'Terminé');
      const no = h('button', { type: 'button', class: 'btn grow', onclick: () => setFinished(false) }, 'Time cap atteint');
      const setFinished = (value: boolean) => {
        finished = value;
        yes.setAttribute('aria-pressed', String(value));
        no.setAttribute('aria-pressed', String(!value));
        timeField.hidden = !value;
        repsField.hidden = value;
      };
      setFinished(finished);
      typeFields.push(h('div', { class: 'segmented' }, yes, no), timeField, repsField);
      read = () => {
        if (!finished) return { finished, reps_completed: readNumber(reps) };
        const min = readNumber(minutes);
        const sec = readNumber(seconds);
        const time = min === undefined && sec === undefined ? undefined : (min ?? 0) * 60 + (sec ?? 0);
        return { finished, time_sec: time };
      };
      break;
    }
  }

  const rx = h('input', { type: 'checkbox', checked: draft.rx });
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

  const showErrors = (errors: string[]) => {
    errorBox.replaceChildren(
      h(
        'ul',
        null,
        errors.map((error) => {
          const [key = '', ...rest] = error.split(' : ');
          return h('li', null, rest.length > 0 ? `${FIELD_LABELS[key] ?? key} : ${rest.join(' : ')}` : error);
        }),
      ),
    );
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'nearest' });
  };

  const submit = (event: Event) => {
    event.preventDefault();
    const raw: Record<string, unknown> = { ...read(), rx: rx.checked };
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
      saveResult({ id: newId(), ...(wodId && { wod_id: wodId }), date: date.value, wod, score });
      setSession(null);
      toast('Séance enregistrée');
      navigate('/history', true);
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
      typeBadge(wod),
      h('strong', null, wod.title),
      h('span', { class: 'summary' }, wodSummary(wod)),
    ),
    h('details', { class: 'recap' }, h('summary', null, 'Revoir le WOD'), wodPlan(wod)),
    h(
      'form',
      { class: 'form', novalidate: true, onsubmit: submit },
      typeFields,
      h('label', { class: 'check' }, rx, h('span', null, 'Rx : fait comme prescrit, sans scaling')),
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
