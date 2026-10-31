import { coachReady, loadCoach } from '../claude';
import { choose, h, toast } from '../dom';
import { clock, dateLabel, daysBetween, decimal, kg, scoreLine, setText, today } from '../format';
import { deadlineText, goalStatus, type GoalStatus } from '../goals';
import { liftFor, liftsOf } from '../lifts';
import { canonicalName, isRest, nameKey } from '../movements';
import { DIVISIONS, isFullRace, RACE_TYPES, raceDetails, raceName, racePace, racePlan, raceSegments, raceTargets, RUN_DISTANCES } from '../race';
import { SPORT_INFO } from '../sports';
import { workKey } from '../records';
import { navigate, type View } from '../router';
import { deleteGoal, findGoal, findWod, getWods, goalStatuses, newId, saveGoal, sortedActivities, sortedResults } from '../store';
import type { Division, EnduranceRace, Goal, HyroxRace, RaceGoal, RaceType, SavedWod } from '../types';
import { validateGoal } from '../validate';
import { deltaChip, field, openChat, pageHead } from './parts';

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
  return [status.current, status.remaining, goal.date && deadlineText(goal.date, today(), goal.kind === 'race')].filter(Boolean).join(' · ');
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

/** « Dans 134 jours », « Demain », « C'est aujourd'hui ! ». */
function countdown(date: string): string {
  const days = daysBetween(today(), date);
  return days === 0 ? 'C’est aujourd’hui !' : days === 1 ? 'Demain' : `Dans ${days} jours`;
}

/** Un objectif en tête de l'écran WOD : une course avec son compte à rebours, les autres avec leur jauge. */
function goalBanner(status: GoalStatus): HTMLElement {
  const { goal } = status;
  const href = `#/goal/${goal.id}`;
  if (goal.kind === 'race') {
    // Sans nom, le nom par défaut (« Trail 42 km ») redirait les détails : on ne garde que ceux-ci.
    const aim = goal.target_sec === undefined ? raceDetails(goal) : `objectif ${clock(goal.target_sec)}`;
    const what = goal.name || goal.target_sec !== undefined ? `${raceName(goal)} · ${aim}` : aim;
    return h(
      'a',
      { class: 'goal-banner', href },
      h('span', { class: 'goal-banner-title' }, countdown(goal.date)),
      status.progress !== undefined && meter(status.progress),
      h('span', { class: 'goal-banner-meta' }, what),
    );
  }
  const line = statusLine(status);
  const late = goal.date !== undefined && goal.date < today();
  return h(
    'a',
    { class: 'goal-banner', href },
    h('span', { class: 'goal-banner-title' }, status.title),
    status.progress !== undefined && meter(status.progress),
    line && h('span', { class: `goal-banner-meta ${late ? 'late' : ''}` }, line),
  );
}

/**
 * Objectifs en cours, en tête de l'écran WOD, par échéance. Les objectifs atteints restent dans
 * l'onglet Progrès ; une course passée sans être atteinte n'y figure plus.
 */
export function goalBanners(): HTMLElement | false {
  const now = today();
  const statuses = goalStatuses().filter((status) => !status.achievedOn && !(status.goal.kind === 'race' && status.goal.date < now));
  if (statuses.length === 0) return false;
  return h('ul', { class: 'goal-banners', 'aria-label': 'Objectifs en cours' }, statuses.map((status) => h('li', null, goalBanner(status))));
}

/** Objectifs en cours sur un entraînement ou un exercice, pour les fiches d'un WOD et d'un exercice. */
export function goalLinks(match: (goal: Goal) => boolean): HTMLElement | false {
  const statuses = goalStatuses().filter((status) => match(status.goal) && !status.achievedOn);
  if (statuses.length === 0) return false;
  return h('ul', { class: 'goals' }, statuses.map(goalRow));
}

export const sameWorkGoal = (wod: SavedWod['wod']) => (goal: Goal) => goal.kind === 'wod' && workKey(goal.wod) === workKey(wod);
export const sameLiftGoal = (key: string) => (goal: Goal) => goal.kind === 'lift' && nameKey(canonicalName(goal.exercise)) === key;

/** « Course 3 · 1 km », « Sled push · 50 m », « Wall ball · 100 reps ». */
function segmentLabel(name: string, distance?: number, reps?: number, run?: number): string {
  if (run !== undefined) return `Course ${run} · 1 km`;
  return `${name} · ${distance !== undefined ? `${decimal(distance)} m` : `${reps ?? 0} reps`}`;
}

/**
 * Plan de course : le temps visé sur chaque segment et le temps cumulé. Avec une course complète
 * déjà faite et chronométrée segment par segment, chaque temps est comparé au plan.
 */
function racePlanSection(goal: HyroxRace): HTMLElement {
  const plan = racePlan(goal.target_sec);
  const segments = raceSegments();
  const targets = raceTargets(goal.target_sec);
  const last = sortedResults().find((result) => isFullRace(result.wod) && 'splits_sec' in result.score && result.score.splits_sec !== undefined);
  // Temps de la dernière course, segment par segment, repos mis à part.
  const actual: number[] = [];
  if (last && last.wod.type === 'hyrox' && 'splits_sec' in last.score && last.score.splits_sec) {
    const splits = last.score.splits_sec;
    last.wod.segments.forEach((segment, i) => {
      const sec = splits[i];
      if (!isRest(segment) && sec !== undefined) actual.push(sec);
    });
  }
  const complete = actual.length === segments.length;
  let cumulative = 0;
  let run = 0;
  const stationTotal = [...plan.stations.values()].reduce((sum, sec) => sum + sec, 0);
  return h(
    'section',
    { class: 'dash-block' },
    h('h2', { class: 'dash-title' }, 'Plan de course'),
    h('p', { class: 'dash-note' }, `Course : ${clock(Math.round(plan.runPerKm))} par km, transition comprise · stations : ${clock(Math.round(stationTotal))} au total.`),
    complete && last && h('p', { class: 'dash-note' }, `Comparé à ta course complète du ${dateLabel(last.date)}`),
    h(
      'ol',
      { class: 'race-plan' },
      segments.map((segment, i) => {
        const target = targets[i] ?? 0;
        cumulative += target;
        const isRun = segment.name === 'Run';
        if (isRun) run++;
        const done = complete ? actual[i] : undefined;
        const diff = done === undefined ? null : done - target;
        return h(
          'li',
          { class: isRun ? 'run' : 'station' },
          h(
            'span',
            { class: 'what' },
            segmentLabel(segment.name, segment.distance_m, segment.reps, isRun ? run : undefined),
            done !== undefined &&
              diff !== null &&
              h('span', { class: 'race-actual' }, `fait en ${clock(done)}`, deltaChip({ text: diff === 0 ? '=' : `${diff < 0 ? '−' : '+'}${clock(Math.abs(diff))}`, better: diff === 0 ? null : diff < 0 })),
          ),
          h('span', { class: 'race-target' }, clock(target)),
          h('span', { class: 'race-total' }, clock(cumulative)),
        );
      }),
    ),
    h('p', { class: 'dash-legend' }, 'Répartition type d’une course Hyrox : ajuste-la avec le coach selon tes points forts. En simulation, le chrono te dit si tu es en avance ou en retard sur ce plan.'),
  );
}

/** Message au coach pour préparer la course. */
function raceRequest(goal: RaceGoal): string {
  if (goal.race === 'hyrox') {
    return `Prépare-moi pour ${goal.name ? `la course ${goal.name}` : 'ma course Hyrox'} du ${dateLabel(goal.date)}, en ${DIVISIONS[goal.division]}, avec l’objectif de finir en ${clock(goal.target_sec)}. Je veux un programme jusqu’à la course, avec des simulations (dont une course complète aux charges de ma catégorie) et un affûtage la dernière semaine.`;
  }
  const aim = goal.target_sec === undefined ? 'avec l’objectif de la finir' : `avec l’objectif de la finir en ${clock(goal.target_sec)}`;
  return `Prépare-moi pour ${raceName(goal)} du ${dateLabel(goal.date)} (${raceDetails(goal)}), ${aim}. Je veux un programme jusqu’à la course qui garde mes WOD, avec les sorties de préparation qu’il faut et un affûtage la dernière semaine.`;
}

/** Course d'endurance suivie avec les activités : un sport et une distance. Sinon, elle se coche à la main. */
const tracked = (goal: EnduranceRace) => RACE_TYPES[goal.race].sport !== undefined && goal.distance_m !== undefined;

/** Un objectif : où tu en es, comment y arriver, et de quoi le modifier ou le cocher. */
export function goalView(id: string): View | null {
  const goal = findGoal(id);
  if (!goal) return null;
  const status = goalStatus(goal, sortedResults(), sortedActivities());
  /** Coché à la main : un objectif libre, ou une course que les activités ne peuvent pas suivre. */
  const manual = goal.kind === 'free' || (goal.kind === 'race' && goal.race !== 'hyrox' && !tracked(goal));

  const setDone = (done: boolean) => {
    if (goal.kind !== 'free' && (goal.kind !== 'race' || goal.race === 'hyrox')) return;
    const { done_on: _, ...rest } = goal;
    saveGoal(done ? { ...rest, done_on: today() } : rest);
    toast(done ? 'Bravo, objectif atteint !' : 'Objectif remis en cours');
    navigate(`/goal/${id}`, true);
  };
  const pace = goal.kind === 'race' ? racePace(goal) : null;

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
      goal.kind === 'race' && h('p', { class: 'compare' }, raceDetails(goal)),
      pace && h('p', { class: 'compare' }, `allure visée ${pace}`),
      goal.date && !status.achievedOn && h('p', { class: `compare ${goal.date < today() ? 'late' : ''}` }, deadlineText(goal.date, today(), goal.kind === 'race')),
      manual && !status.achievedOn && h('p', { class: 'compare' }, 'Coche-le quand c’est fait.'),
    ),
    goal.notes && h('p', { class: 'description' }, goal.notes),
    goal.kind === 'race' && goal.race === 'hyrox' && racePlanSection(goal),
    h(
      'div',
      { class: 'stack' },
      // Jour de la course passé : la sortie se note comme une activité, et l'objectif se met à jour.
      goal.kind === 'race' &&
        goal.race !== 'hyrox' &&
        tracked(goal) &&
        !status.achievedOn &&
        goal.date <= today() &&
        h('a', { class: 'btn primary block', href: `#/activity/new/race:${goal.id}` }, 'Noter ma course'),
      goal.kind === 'race' && coachReady(loadCoach()) && h('button', { class: 'btn block', onclick: () => openChat(raceRequest(goal)) }, 'Préparer la course avec le coach'),
      manual &&
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
const KIND_LABELS: Record<Kind, string> = { lift: 'Charge', wod: 'WOD', race: 'Course', free: 'Autre' };

/**
 * Formulaire d'un objectif. `preset` pré-remplit un nouvel objectif depuis une fiche : « wod:<id> »
 * ou « lift:<clé> ».
 */
export function goalFormView(id?: string, preset?: string): View | null {
  const editing = id === undefined ? undefined : findGoal(id);
  if (id !== undefined && !editing) return null;
  const results = sortedResults();
  const wods = goalWods();
  const number = (input: HTMLInputElement) => (input.value.trim() === '' ? undefined : Number(input.value.trim().replace(',', '.')));
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

  // Course : Hyrox, ou une course d'endurance (course à pied, trail, vélo…)
  const race = editing?.kind === 'race' ? editing : undefined;
  const raceType = h(
    'select',
    { 'aria-label': 'Type de course' },
    h('option', { value: '' }, 'Choisir…'),
    (Object.keys(RACE_TYPES) as RaceType[]).map((value) => h('option', { value, selected: race?.race === value }, RACE_TYPES[value].label)),
  );
  const raceNameInput = h('input', { type: 'text', autocomplete: 'off', maxlength: 60, 'aria-label': 'Nom de la course' });
  raceNameInput.value = race?.name ?? '';
  const division = h(
    'select',
    { 'aria-label': 'Catégorie' },
    h('option', { value: '' }, 'Choisir…'),
    (Object.keys(DIVISIONS) as Division[]).map((value) => h('option', { value, selected: race?.race === 'hyrox' && race.division === value }, DIVISIONS[value])),
  );
  const distanceInput = h('input', { ...DECIMAL, 'aria-label': 'Distance' });
  const distanceUnit = h('span');
  const elevation = h('input', { type: 'number', inputmode: 'numeric', min: 0, step: 10, 'aria-label': 'Dénivelé positif' });
  const hours = h('input', { type: 'number', inputmode: 'numeric', min: 0, step: 1, 'aria-label': 'Heures' });
  const raceMinutes = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 59, step: 1, 'aria-label': 'Minutes de course' });
  const raceSeconds = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 59, step: 1, 'aria-label': 'Secondes de course' });
  if (race?.target_sec !== undefined) {
    hours.value = String(Math.floor(race.target_sec / 3600));
    raceMinutes.value = String(Math.floor((race.target_sec % 3600) / 60));
    raceSeconds.value = race.target_sec % 60 ? String(race.target_sec % 60) : '';
  }
  /** Distance en mètres : saisie en km, sauf la natation, en mètres. */
  const inMeters = () => SPORT_INFO[RACE_TYPES[raceType.value as RaceType]?.sport ?? 'run'].unit === 'm';
  const raceDistance = () => {
    const value = number(distanceInput);
    return value === undefined ? undefined : inMeters() ? value : Math.round(value * 1000 * 10) / 10;
  };
  const showDistance = (meters: number | undefined) => {
    distanceInput.value = meters === undefined ? '' : String(inMeters() ? meters : meters / 1000).replace('.', ',');
  };
  if (race?.race !== 'hyrox' && race?.distance_m !== undefined) showDistance(race.distance_m);
  if (race?.race === 'trail' && race.elevation_m !== undefined) elevation.value = String(race.elevation_m);
  const raceTime = () =>
    [hours, raceMinutes, raceSeconds].every((input) => number(input) === undefined)
      ? undefined
      : (number(hours) ?? 0) * 3600 + (number(raceMinutes) ?? 0) * 60 + (number(raceSeconds) ?? 0);
  const presets = h(
    'div',
    { class: 'presets' },
    RUN_DISTANCES.map(({ label, meters }) =>
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () => {
            showDistance(meters);
            refreshRace();
          },
        },
        label,
      ),
    ),
  );
  const divisionField = field('Catégorie', division);
  const distanceField = field('Distance (facultatif)', distanceInput, distanceUnit);
  const elevationField = field('Dénivelé positif (facultatif)', elevation, 'm D+');
  const timeLabel = h('span', { class: 'field-label' });
  const raceTimeField = h('div', { class: 'field' }, timeLabel, h('div', { class: 'field-row' }, hours, 'h', raceMinutes, 'min', raceSeconds, 's'));
  const raceHint = h('p', { class: 'hint left' });
  const NAME_PLACEHOLDERS: Record<RaceType, string> = {
    hyrox: 'Hyrox Paris',
    run: 'Marathon de Paris',
    trail: 'Trail des Templiers',
    bike: 'Étape du Tour',
    swim: 'Traversée du lac',
    triathlon: 'Triathlon de Nice',
    other: 'Spartan Race',
  };
  /** Les champs du type choisi, et l'allure qui correspond au temps visé. */
  const refreshRace = () => {
    const type = (raceType.value || undefined) as RaceType | undefined;
    const sport = type ? RACE_TYPES[type].sport : undefined;
    raceNameInput.placeholder = type ? NAME_PLACEHOLDERS[type] : '';
    divisionField.hidden = type !== 'hyrox';
    distanceField.hidden = !type || type === 'hyrox' || type === 'triathlon';
    distanceUnit.textContent = inMeters() ? 'm' : 'km';
    presets.hidden = type !== 'run';
    elevationField.hidden = type !== 'trail';
    raceTimeField.hidden = !type;
    timeLabel.textContent = type === 'hyrox' ? 'Temps visé' : 'Temps visé (facultatif : vide pour viser l’arrivée)';
    const meters = raceDistance();
    const time = raceTime();
    const pace = sport && meters && time ? SPORT_INFO[sport].pace?.(time, meters) : undefined;
    raceHint.textContent =
      type === 'hyrox'
        ? 'L’appli en tire un plan de course segment par segment, et te dit en simulation si tu es dans les temps.'
        : pace
          ? `${sport === 'bike' ? 'Vitesse' : 'Allure'} visée : ${pace}`
          : sport && type !== 'triathlon'
            ? 'Avec une distance, tes activités de ce sport suivent ta préparation.'
            : type
              ? 'Tu la coches toi-même une fois finie.'
              : '';
  };
  // Changer de type garde la distance saisie, convertie si l'unité change (km ↔ m).
  let kept = raceDistance();
  raceType.addEventListener('focus', () => (kept = raceDistance()));
  raceType.addEventListener('change', () => {
    showDistance(kept);
    refreshRace();
  });
  for (const input of [distanceInput, hours, raceMinutes, raceSeconds]) input.addEventListener('input', refreshRace);
  const racePanel = h(
    'div',
    { class: 'stack' },
    field('Type de course', raceType),
    field('Nom (facultatif)', raceNameInput),
    divisionField,
    distanceField,
    presets,
    elevationField,
    raceTimeField,
    raceHint,
  );
  refreshRace();

  // Commun
  const date = h('input', { type: 'date', min: today(), 'aria-label': 'Échéance' });
  const dateLabelEl = h('span', { class: 'field-label' });
  date.value = editing?.date ?? '';
  const notes = h('textarea', { rows: 2, 'aria-label': 'Notes', placeholder: 'Pourquoi, comment…' });
  notes.value = editing?.notes ?? '';
  const errorBox = h('div', { class: 'errors', role: 'alert', hidden: true });

  const panels: Record<Kind, HTMLElement> = { lift: liftPanel, wod: wodPanel, race: racePanel, free: freePanel };
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
  const showPanel = () => {
    (Object.keys(panels) as Kind[]).forEach((value) => (panels[value].hidden = value !== kind));
    // Une course a forcément une date.
    dateLabelEl.textContent = kind === 'race' ? 'Date de la course' : 'Échéance (facultatif)';
  };
  showPanel();

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
    } else if (kind === 'race') {
      const type = raceType.value || undefined;
      const time = raceTime();
      const common = { ...base, race: type, ...(raceNameInput.value.trim() && { name: raceNameInput.value.trim() }) };
      raw =
        type === 'hyrox'
          ? { ...common, division: division.value || undefined, target_sec: time }
          : {
              ...common,
              ...(type !== 'triathlon' && raceDistance() !== undefined && { distance_m: raceDistance() }),
              ...(type === 'trail' && number(elevation) !== undefined && { elevation_m: number(elevation) }),
              ...(time !== undefined && { target_sec: time }),
              ...(race?.race !== 'hyrox' && race?.done_on && { done_on: race.done_on }),
            };
      // Sans type choisi, le validateur lirait une ancienne course Hyrox : on le dit clairement.
      if (!type) raw.race = '';
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
      racePanel,
      freePanel,
      h('div', { class: 'field' }, dateLabelEl, h('div', { class: 'field-row' }, date)),
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
  date: 'Date',
  name: 'Nom',
  race: 'Type de course',
  division: 'Catégorie',
  target_sec: 'Temps visé',
  distance_m: 'Distance',
  elevation_m: 'Dénivelé',
};

/** « load_kg : doit être un nombre > 0 » → « Charge visée : à remplir (un nombre > 0) ». */
function humanize(error: string): string {
  const [path = '', ...rest] = error.split(' : ');
  const message = rest.join(' : ');
  const key = path.replace(/[.[].*$/, '');
  const label = ERROR_LABELS[key];
  if (!label) return error;
  if (message.startsWith('champ manquant') || message === 'doit être un texte non vide' || message.startsWith('le WOD doit') || message.startsWith('doit valoir "open') || message.startsWith('doit valoir "hyrox')) {
    return `${label} : à remplir`;
  }
  return `${label} : ${message}`;
}
