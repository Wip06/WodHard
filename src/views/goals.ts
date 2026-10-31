import { choose, h, toast } from '../dom';
import { dateLabel, kg, scoreLine, setText, today } from '../format';
import { deadlineText, goalStatus, type GoalStatus } from '../goals';
import { liftFor, liftsOf } from '../lifts';
import { canonicalName, nameKey } from '../movements';
import { workKey } from '../records';
import { navigate, type View } from '../router';
import { deleteGoal, findGoal, findWod, getWods, goalStatuses, newId, saveGoal, sortedResults } from '../store';
import type { Goal, SavedWod } from '../types';
import { validateGoal } from '../validate';
import { field, pageHead } from './parts';

/** Objectifs atteints depuis moins de tant de jours, encore montrés avec ceux en cours. */
const RECENT_DAYS = 30;
const DECIMAL = { type: 'text', inputmode: 'decimal', autocomplete: 'off' } as const;

/** WOD sur lesquels un objectif peut se fixer : un temps ou un nombre de tours. */
const goalWods = () =>
  getWods()
    .filter((saved) => saved.wod.type === 'amrap' || saved.wod.type === 'for_time' || saved.wod.type === 'hyrox')
    // Les références d'abord : ce sont elles que l'on refait pour mesurer sa progression.
    .sort((a, b) => Number(b.reference_weeks !== undefined) - Number(a.reference_weeks !== undefined));

/** Ce qui est fait, ce qu'il reste, et l'échéance, sur une ligne. */
function statusLine(status: GoalStatus): string {
  if (status.achievedOn) return `Atteint le ${dateLabel(status.achievedOn)}`;
  const { goal } = status;
  return [status.current, status.remaining, goal.date && deadlineText(goal.date, today())].filter(Boolean).join(' · ');
}

function meter(progress: number): HTMLElement {
  return h('span', { class: 'meter', role: 'img', 'aria-label': `${Math.round(progress * 100)} %` }, h('span', { style: `width: ${Math.round(progress * 100)}%` }));
}

function goalRow(status: GoalStatus): HTMLElement {
  const late = !status.achievedOn && status.goal.date !== undefined && status.goal.date < today();
  return h(
    'li',
    null,
    h(
      'a',
      { class: `goal-row ${status.achievedOn ? 'achieved' : ''}`, href: `#/goal/${status.goal.id}` },
      h('span', { class: 'goal-title' }, status.title, status.achievedOn && h('span', { class: 'chip rx' }, '✓ Atteint')),
      status.progress !== undefined && !status.achievedOn && meter(status.progress),
      h('span', { class: `goal-meta ${late ? 'late' : ''}` }, statusLine(status)),
    ),
  );
}

/** Bloc « Objectifs » de l'onglet Progrès : en cours, puis atteints récemment, puis les plus anciens repliés. */
export function goalsBlock(): HTMLElement {
  const statuses = goalStatuses();
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const shown = statuses.filter((status) => !status.achievedOn || status.achievedOn >= since);
  const older = statuses.filter((status) => status.achievedOn && status.achievedOn < since);
  return h(
    'section',
    { class: 'dash-block' },
    h('h2', { class: 'dash-title' }, 'Objectifs'),
    statuses.length === 0 && h('p', { class: 'dash-note' }, 'Une charge à soulever, un temps à battre sur un WOD, ou ce que tu veux : l’appli suit où tu en es, et le coach en tient compte.'),
    shown.length > 0 && h('ul', { class: 'goals' }, shown.map(goalRow)),
    older.length > 0 && h('details', null, h('summary', { class: 'dash-note' }, `Objectifs atteints plus tôt (${older.length})`), h('ul', { class: 'goals' }, older.map(goalRow))),
    h('a', { class: 'btn block', href: '#/goal/new' }, '+ Nouvel objectif'),
  );
}

/** Objectifs en cours sur un entraînement ou un exercice, pour les fiches d'un WOD et d'un exercice. */
export function goalLinks(match: (goal: Goal) => boolean): HTMLElement | false {
  const statuses = goalStatuses().filter((status) => match(status.goal) && !status.achievedOn);
  if (statuses.length === 0) return false;
  return h('ul', { class: 'goals' }, statuses.map(goalRow));
}

export const sameWorkGoal = (wod: SavedWod['wod']) => (goal: Goal) => goal.kind === 'wod' && workKey(goal.wod) === workKey(wod);
export const sameLiftGoal = (key: string) => (goal: Goal) => goal.kind === 'lift' && nameKey(canonicalName(goal.exercise)) === key;

/** Un objectif : où tu en es, comment y arriver, et de quoi le modifier ou le cocher. */
export function goalView(id: string): View | null {
  const goal = findGoal(id);
  if (!goal) return null;
  const status = goalStatus(goal, sortedResults());

  const setDone = (done: boolean) => {
    if (goal.kind !== 'free') return;
    const { done_on: _, ...rest } = goal;
    saveGoal(done ? { ...rest, done_on: today() } : rest);
    toast(done ? 'Bravo, objectif atteint !' : 'Objectif remis en cours');
    navigate(`/goal/${id}`, true);
  };

  const remove = async () => {
    const confirmed = await choose(`Supprimer « ${status.title} » ?`, 'Tes séances ne sont pas touchées.', [
      { label: 'Supprimer', value: true, kind: 'danger' },
      { label: 'Annuler', value: false },
    ]);
    if (!confirmed) return;
    deleteGoal(id);
    toast('Objectif supprimé');
    navigate('/progress', true);
  };

  const link =
    goal.kind === 'lift'
      ? liftFor(sortedResults(), goal.exercise) && h('a', { class: 'btn block', href: `#/lift/${encodeURIComponent(nameKey(canonicalName(goal.exercise)))}` }, `Mes charges en ${canonicalName(goal.exercise)}`)
      : goal.kind === 'wod' && goal.wod_id && findWod(goal.wod_id)
        ? h('a', { class: 'btn block', href: `#/wod/${goal.wod_id}` }, `Voir ${goal.wod.title}`)
        : false;

  const el = h(
    'section',
    { class: 'page' },
    pageHead(status.title, { href: '#/progress', label: 'Progrès' }),
    h(
      'div',
      { class: `scoreboard goal ${status.achievedOn ? 'achieved' : ''}` },
      status.achievedOn
        ? h('strong', { class: 'score' }, `Atteint le ${dateLabel(status.achievedOn)}`)
        : status.current && h('strong', { class: 'score' }, status.current),
      status.progress !== undefined && !status.achievedOn && meter(status.progress),
      status.remaining && !status.achievedOn && h('p', { class: 'compare' }, status.remaining),
      status.hint && h('p', { class: 'compare' }, status.hint),
      goal.date && !status.achievedOn && h('p', { class: `compare ${goal.date < today() ? 'late' : ''}` }, deadlineText(goal.date, today())),
      goal.kind === 'free' && !status.achievedOn && h('p', { class: 'compare' }, 'Coche-le quand c’est fait.'),
    ),
    goal.notes && h('p', { class: 'description' }, goal.notes),
    h(
      'div',
      { class: 'stack' },
      goal.kind === 'free' &&
        (goal.done_on
          ? h('button', { class: 'btn block', onclick: () => setDone(false) }, 'Finalement pas encore')
          : h('button', { class: 'btn primary block', onclick: () => setDone(true) }, 'C’est atteint !')),
      link,
      h('a', { class: 'btn block', href: `#/goal/${id}/edit` }, 'Modifier'),
      h('button', { class: 'btn ghost danger block', onclick: () => void remove() }, 'Supprimer cet objectif'),
    ),
  );
  return { el, tab: 'progress' };
}

type Kind = Goal['kind'];
const KIND_LABELS: Record<Kind, string> = { lift: 'Charge', wod: 'WOD', free: 'Autre' };

/**
 * Formulaire d'un objectif. `preset` pré-remplit un nouvel objectif depuis une fiche : « wod:<id> »
 * ou « lift:<clé> ».
 */
export function goalFormView(id?: string, preset?: string): View | null {
  const editing = id === undefined ? undefined : findGoal(id);
  if (id !== undefined && !editing) return null;
  const results = sortedResults();
  const wods = goalWods();
  const presetWod = preset?.startsWith('wod:') ? findWod(preset.slice(4)) : undefined;
  const presetLift = preset?.startsWith('lift:') ? liftsOf(results).find((lift) => lift.key === decodeURIComponent(preset.slice(5))) : undefined;
  let kind: Kind = editing?.kind ?? (presetWod ? 'wod' : presetLift ? 'lift' : 'lift');

  // Charge
  const lifts = liftsOf(results);
  const exercise = h('input', { type: 'text', autocomplete: 'off', list: 'goal-lifts', placeholder: 'Back squat', 'aria-label': 'Exercice' });
  exercise.value = editing?.kind === 'lift' ? editing.exercise : (presetLift?.name ?? '');
  const load = h('input', { ...DECIMAL, 'aria-label': 'Charge visée en kg' });
  load.value = editing?.kind === 'lift' ? String(editing.load_kg).replace('.', ',') : '';
  const reps = h('input', { type: 'number', inputmode: 'numeric', min: 1, step: 1, 'aria-label': 'Répétitions' });
  reps.value = editing?.kind === 'lift' ? String(editing.reps) : '1';
  const liftHint = h('p', { class: 'hint left' });
  const refreshLift = () => {
    const lift = exercise.value.trim() === '' ? undefined : liftFor(results, exercise.value);
    const record = lift?.heaviest ? `charge la plus lourde ${lift.heaviest.reps} × ${kg(lift.heaviest.load)}` : '';
    const estimate = lift?.best ? `1RM estimé ${kg(Math.round(lift.best.oneRepMax * 2) / 2)} (${setText(lift.best.set)})` : '';
    liftHint.textContent = lift ? `Aujourd’hui : ${[record, estimate].filter(Boolean).join(' · ')}` : '';
    liftHint.hidden = !lift;
  };
  exercise.addEventListener('input', refreshLift);
  refreshLift();
  const liftPanel = h(
    'div',
    { class: 'stack' },
    field('Exercice', exercise),
    h('datalist', { id: 'goal-lifts' }, lifts.map((lift) => h('option', { value: lift.name }))),
    field('Charge visée', load, 'kg'),
    field('Répétitions', reps, 'au moins'),
    liftHint,
  );

  // WOD
  const startWod = editing?.kind === 'wod' ? editing.wod_id : presetWod?.id;
  const wodSelect = h(
    'select',
    { 'aria-label': 'WOD' },
    h('option', { value: '' }, wods.length > 0 ? 'Choisir un WOD…' : 'Aucun AMRAP, For Time ou Hyrox dans tes WOD'),
    wods.map((saved) => h('option', { value: saved.id, selected: saved.id === startWod }, `${saved.wod.title}${saved.reference_weeks !== undefined ? ' · référence' : ''}`)),
  );
  const minutes = h('input', { type: 'number', inputmode: 'numeric', min: 0, step: 1, 'aria-label': 'Minutes' });
  const seconds = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 59, step: 1, 'aria-label': 'Secondes' });
  const rounds = h('input', { type: 'number', inputmode: 'numeric', min: 0, step: 1, 'aria-label': 'Tours' });
  const extra = h('input', { type: 'number', inputmode: 'numeric', min: 0, step: 1, 'aria-label': 'Reps en plus' });
  if (editing?.kind === 'wod') {
    if (editing.time_sec !== undefined) {
      minutes.value = String(Math.floor(editing.time_sec / 60));
      seconds.value = String(editing.time_sec % 60);
    }
    rounds.value = editing.rounds === undefined ? '' : String(editing.rounds);
    extra.value = editing.extra_reps === undefined ? '' : String(editing.extra_reps);
  }
  const timeField = field('Temps à battre', minutes, 'min', seconds, 's');
  const roundsField = field('Score à atteindre', rounds, 'tours', extra, 'reps');
  const wodHint = h('p', { class: 'hint left' });
  /** Le WOD choisi, ou celui de l'objectif modifié s'il n'est plus dans la bibliothèque. */
  const chosenWod = () => findWod(wodSelect.value)?.wod ?? (editing?.kind === 'wod' && !wodSelect.value ? editing.wod : undefined);
  const refreshWod = () => {
    const wod = chosenWod();
    timeField.hidden = !wod || wod.type === 'amrap';
    roundsField.hidden = !wod || wod.type !== 'amrap';
    const key = wod && workKey(wod);
    const done = key ? [...results].filter((result) => result.score.rx && workKey(result.wod) === key) : [];
    wodHint.textContent = done.length > 0 ? `Ton dernier score en Rx : ${scoreLine(done[0]!.wod, done[0]!.score)}` : wod ? 'Pas encore fait en Rx.' : '';
  };
  wodSelect.addEventListener('change', refreshWod);
  refreshWod();
  const wodPanel = h('div', { class: 'stack' }, field('WOD', wodSelect), timeField, roundsField, wodHint, h('p', { class: 'hint left' }, 'L’objectif est atteint par un score en Rx.'));

  // Autre
  const title = h('input', { type: 'text', autocomplete: 'off', maxlength: 60, placeholder: '10 strict pull-ups', 'aria-label': 'Objectif' });
  title.value = editing?.kind === 'free' ? editing.title : '';
  const freePanel = h('div', { class: 'stack' }, field('Objectif', title), h('p', { class: 'hint left' }, 'Tu le coches toi-même quand c’est fait.'));

  // Commun
  const date = h('input', { type: 'date', min: today(), 'aria-label': 'Échéance' });
  date.value = editing?.date ?? '';
  const notes = h('textarea', { rows: 2, 'aria-label': 'Notes', placeholder: 'Pourquoi, comment…' });
  notes.value = editing?.notes ?? '';
  const errorBox = h('div', { class: 'errors', role: 'alert', hidden: true });

  const panels: Record<Kind, HTMLElement> = { lift: liftPanel, wod: wodPanel, free: freePanel };
  const kinds = (Object.keys(KIND_LABELS) as Kind[]).map((value) =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn grow',
        'aria-pressed': String(value === kind),
        onclick: () => {
          kind = value;
          kinds.forEach((button, i) => button.setAttribute('aria-pressed', String(Object.keys(KIND_LABELS)[i] === kind)));
          showPanel();
        },
      },
      KIND_LABELS[value],
    ),
  );
  const showPanel = () => (Object.keys(panels) as Kind[]).forEach((value) => (panels[value].hidden = value !== kind));
  showPanel();

  const number = (input: HTMLInputElement) => (input.value.trim() === '' ? undefined : Number(input.value.trim().replace(',', '.')));

  const submit = (event: Event) => {
    event.preventDefault();
    const base = {
      id: editing?.id ?? newId(),
      kind,
      created: editing?.created ?? today(),
      ...(date.value && { date: date.value }),
      ...(notes.value.trim() && { notes: notes.value.trim() }),
    };
    let raw: Record<string, unknown>;
    if (kind === 'lift') {
      raw = { ...base, exercise: canonicalName(exercise.value.trim()), load_kg: number(load), reps: number(reps) };
    } else if (kind === 'wod') {
      const wod = chosenWod();
      const saved = findWod(wodSelect.value);
      const time = number(minutes) === undefined && number(seconds) === undefined ? undefined : (number(minutes) ?? 0) * 60 + (number(seconds) ?? 0);
      raw = {
        ...base,
        wod,
        ...(saved ? { wod_id: saved.id } : editing?.kind === 'wod' && editing.wod_id ? { wod_id: editing.wod_id } : {}),
        ...(wod?.type === 'amrap' ? { rounds: number(rounds) ?? 0, ...(number(extra) && { extra_reps: number(extra) }) } : { time_sec: time }),
      };
    } else {
      raw = { ...base, title: title.value.trim(), ...(editing?.kind === 'free' && editing.done_on && { done_on: editing.done_on }) };
    }
    const checked = validateGoal(raw);
    if (!checked.ok) {
      errorBox.replaceChildren(h('strong', null, 'À corriger :'), h('ul', null, checked.errors.map((error) => h('li', null, humanize(error)))));
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'nearest' });
      return;
    }
    saveGoal(checked.value);
    const status = goalStatus(checked.value, results);
    toast(status.achievedOn && checked.value.kind !== 'free' ? 'Objectif déjà atteint : vise plus haut ?' : 'Objectif enregistré');
    navigate(`/goal/${checked.value.id}`, true);
  };

  const back = editing ? `#/goal/${editing.id}` : '#/progress';
  const el = h(
    'section',
    { class: 'page' },
    pageHead(editing ? 'Modifier l’objectif' : 'Nouvel objectif', { href: back, label: editing ? 'Objectif' : 'Progrès' }),
    h(
      'form',
      { class: 'form', novalidate: true, onsubmit: submit },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Sorte d’objectif' }, kinds),
      liftPanel,
      wodPanel,
      freePanel,
      field('Échéance (facultatif)', date),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Notes (facultatif)'), notes),
      errorBox,
      h('button', { type: 'submit', class: 'btn primary big block' }, 'Enregistrer'),
      h('a', { class: 'btn ghost block', href: back }, 'Annuler'),
    ),
  );
  return { el, tab: 'progress' };
}

const ERROR_LABELS: Record<string, string> = {
  exercise: 'Exercice',
  load_kg: 'Charge visée',
  reps: 'Répétitions',
  wod: 'WOD',
  time_sec: 'Temps à battre',
  rounds: 'Score à atteindre',
  extra_reps: 'Reps en plus',
  title: 'Objectif',
  date: 'Échéance',
};

/** « load_kg : doit être un nombre > 0 » → « Charge visée : à remplir (un nombre > 0) ». */
function humanize(error: string): string {
  const [path = '', ...rest] = error.split(' : ');
  const message = rest.join(' : ');
  const key = path.replace(/[.[].*$/, '');
  const label = ERROR_LABELS[key];
  if (!label) return error;
  if (message === 'champ manquant' || message === 'doit être un texte non vide' || message.startsWith('le WOD doit')) return `${label} : à remplir`;
  return `${label} : ${message}`;
}
