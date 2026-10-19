import { h } from '../dom';
import { CHAT_DRAFT_KEY, coachReady, loadCoach } from '../gemini';
import { navigate } from '../router';
import {
  clock,
  dateLabel,
  duration,
  load,
  movementText,
  plural,
  quantity,
  scoreLine,
  teamLabel,
  typeLabel,
  wodHeadline,
  wodSummary,
} from '../format';
import { allMovements, isRest } from '../movements';
import { isOverCap, splitDeltas, type Delta } from '../records';
import { activityLine, activityName } from '../sports';
import type { Activity, Adjustment, Movement, Result, Wod } from '../types';

export function pageHead(title: string, back?: { href: string; label: string }): HTMLElement {
  return h(
    'header',
    { class: 'page-head' },
    back && h('a', { class: 'back', href: back.href }, `‹ ${back.label}`),
    h('h1', null, title),
  );
}

/** Un champ de formulaire : libellé puis contrôles (et unités) sur une ligne. */
export function field(label: string, ...controls: (HTMLElement | string)[]): HTMLElement {
  return h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    h('div', { class: 'field-row' }, controls),
  );
}

export function typeBadge(wod: Wod): HTMLElement {
  return h('span', { class: `badge ${wod.type}` }, typeLabel(wod.type));
}

/** Type du WOD, suivi de « Duo » pour un WOD à plusieurs. */
export function badges(wod: Wod): HTMLElement {
  if (wod.team_size === undefined) return typeBadge(wod);
  return h('span', { class: 'badges' }, typeBadge(wod), h('span', { class: 'badge team' }, teamLabel(wod.team_size)));
}

/** Ouvre la conversation avec le coach, le message déjà écrit, prêt à être envoyé. */
export function openChat(draft: string): void {
  try {
    sessionStorage.setItem(CHAT_DRAFT_KEY, draft);
  } catch {
    // Sans stockage de session, la conversation s'ouvre simplement vide.
  }
  navigate('/ask');
}

const askHow = (name: string) =>
  openChat(`Comment bien faire le mouvement « ${name} » ? Explique-moi la technique pas à pas.`);

export interface ListOptions {
  /** Reps du tour en cours, pour les mouvements qui suivent le rep_scheme. */
  schemeReps?: number;
  /** Le rep_scheme en entier (« 21-15-9 »), affiché quand le tour n'est pas connu. */
  scheme?: string;
  /** Propose « Comment faire ? » au coach sur chaque mouvement. */
  askable?: boolean;
  /** Propose de lancer le compte à rebours de chaque repos. */
  onRest?: (sec: number) => void;
}

/** Un repos s'affiche comme une pause, pas comme un exercice. */
function restItem(movement: Movement, onRest?: (sec: number) => void): HTMLElement {
  const sec = movement.duration_sec ?? 0;
  return h(
    'li',
    { class: 'movement pause' },
    h('span', { class: 'qty' }, duration(sec)),
    h(
      'span',
      { class: 'what' },
      h('span', { class: 'name' }, 'Repos'),
      movement.notes && h('span', { class: 'note' }, movement.notes),
      onRest && h('button', { type: 'button', class: 'how', onclick: () => onRest(sec) }, `Lancer le repos (${clock(sec)})`),
    ),
  );
}

function movementItem(movement: Movement, options: ListOptions): HTMLElement {
  if (isRest(movement)) return restItem(movement, options.onRest);
  const amount = quantity(movement, options.schemeReps) ?? options.scheme;
  const weight = load(movement);
  return h(
    'li',
    { class: 'movement' },
    h('span', { class: 'qty' }, amount ?? '·'),
    h(
      'span',
      { class: 'what' },
      h('span', { class: 'name' }, movement.name),
      weight !== null && h('span', { class: 'load' }, weight),
      movement.notes && h('span', { class: 'note' }, movement.notes),
      options.askable &&
        h('button', { type: 'button', class: 'how', onclick: () => askHow(movement.name) }, 'Comment faire ?'),
    ),
  );
}

/** Liste de mouvements ; une liste vide (slot EMOM de repos) affiche « Repos ». */
export function movementList(movements: Movement[], options: ListOptions = {}): HTMLElement {
  return h(
    'ul',
    { class: 'movements' },
    movements.length > 0
      ? movements.map((movement) => movementItem(movement, options))
      : h('li', { class: 'movement rest' }, 'Repos'),
  );
}

/** Le contenu du WOD : consigne puis mouvements. */
export function wodPlan(wod: Wod, askable = false): HTMLElement {
  switch (wod.type) {
    case 'amrap':
      return h(
        'div',
        { class: 'plan' },
        h('p', { class: 'rule' }, `Un maximum de tours en ${duration(wod.duration_sec)} :`),
        movementList(wod.movements, { askable }),
      );
    case 'emom': {
      const total = duration(wod.interval_sec * wod.intervals);
      const looping = wod.slots.length > 1;
      return h(
        'div',
        { class: 'plan' },
        h(
          'p',
          { class: 'rule' },
          `Toutes les ${duration(wod.interval_sec)} pendant ${total}`,
          looping ? `, en alternant ${wod.slots.length} intervalles :` : ' :',
        ),
        wod.slots.flatMap((slot, i) => [
          looping && h('p', { class: 'slot-label' }, `Intervalle ${i + 1}`),
          movementList(slot, { askable }),
        ]),
      );
    }
    case 'for_time': {
      const scheme = wod.rep_scheme?.join('-');
      // Avec un rep_scheme, un mouvement qui a sa propre quantité la garde à chaque tour.
      const fixed = scheme !== undefined && wod.movements.some((movement) => quantity(movement) !== null && !isRest(movement));
      const volume = scheme
        ? `${scheme} reps${fixed ? ' (sauf quantité indiquée)' : ' de chaque mouvement'}`
        : wod.rounds > 1
          ? `${wod.rounds} tours`
          : 'Une fois';
      return h(
        'div',
        { class: 'plan' },
        h('p', { class: 'rule' }, `${volume}, le plus vite possible (time cap ${duration(wod.time_cap_sec)}) :`),
        movementList(wod.movements, { scheme, askable }),
      );
    }
    case 'hyrox': {
      const cap = wod.time_cap_sec === undefined ? '' : ` (time cap ${duration(wod.time_cap_sec)})`;
      return h(
        'div',
        { class: 'plan' },
        h('p', { class: 'rule' }, `Enchaîne les segments dans l’ordre, le plus vite possible${cap} :`),
        movementList(wod.segments, { askable }),
      );
    }
  }
}

/** Écart avec une séance précédente : vert si c'est mieux, orange si c'est moins bien. */
export function deltaChip(delta: Delta): HTMLElement {
  const tone = delta.better === null ? '' : delta.better ? 'better' : 'worse';
  return h('span', { class: `delta ${tone}` }, delta.text);
}

/**
 * Temps relevés au chrono : un par segment (Hyrox) ou par tour (AMRAP, For Time). Avec `previous`,
 * l'écart par rapport à ces temps précédents est affiché ligne par ligne.
 */
export function splitsList(wod: Wod, splits: number[], previous?: number[]): HTMLElement | false {
  if (splits.length === 0) return false;
  const deltas = splitDeltas(splits, previous);
  const label = (i: number): string => {
    if (wod.type === 'hyrox') {
      const segment = wod.segments[i];
      return segment ? movementText(segment) : `Segment ${i + 1}`;
    }
    const reps = wod.type === 'for_time' ? wod.rep_scheme?.[i] : undefined;
    return reps === undefined ? `Tour ${i + 1}` : `Tour ${i + 1} (${reps} reps)`;
  };
  return h(
    'ol',
    { class: wod.type === 'hyrox' ? 'splits' : 'splits rounds' },
    splits.map((sec, i) => {
      const diff = deltas[i] ?? null;
      return h(
        'li',
        null,
        h(
          'span',
          { class: 'split-row' },
          h('span', { class: 'what' }, label(i)),
          diff !== null &&
            deltaChip({
              text: diff === 0 ? '=' : `${diff < 0 ? '−' : '+'}${clock(Math.abs(diff))}`,
              better: diff === 0 ? null : diff < 0,
            }),
          h('span', { class: 'split' }, clock(sec)),
        ),
      );
    }),
  );
}

/** Fiche complète d'un WOD : titre, contexte, échauffement et contenu. */
export function wodSheet(wod: Wod): HTMLElement {
  // « Comment faire ? » n'a de sens qu'avec un coach Gemini prêt à répondre.
  const askable = coachReady(loadCoach());
  return h(
    'article',
    { class: 'sheet' },
    h('div', { class: 'sheet-top' }, badges(wod), h('span', { class: 'summary' }, wodSummary(wod))),
    h('h2', { class: 'sheet-title' }, wod.title),
    wod.description && h('p', { class: 'description' }, wod.description),
    wod.equipment &&
      wod.equipment.length > 0 &&
      h(
        'ul',
        { class: 'chips', 'aria-label': 'Matériel' },
        wod.equipment.map((item) => h('li', { class: 'chip' }, item)),
      ),
    wod.warmup && h('div', { class: 'warmup' }, h('h3', null, 'Échauffement'), h('p', null, wod.warmup)),
    wodPlan(wod, askable),
  );
}

/** Quantité avec son unité : « 5 reps », « 400 m ». */
function amount(movement: Movement): string | null {
  return movement.reps === undefined ? quantity(movement) : plural(movement.reps, 'rep');
}

/** « Ring row au lieu de Pull-up : 8 reps au lieu de 5 reps », « Thruster : 30 kg au lieu de 43 kg ». */
export function adjustmentText(wod: Wod, adjustment: Adjustment): string {
  const target = allMovements(wod)[adjustment.index];
  const what = adjustment.replaced_by ? `${adjustment.replaced_by} au lieu de ${adjustment.name}` : adjustment.name;
  const changes: string[] = [];
  const done = amount(adjustment);
  if (done !== null) {
    const planned = target && amount(target);
    changes.push(planned && planned !== done ? `${done} au lieu de ${planned}` : done);
  }
  if (adjustment.load_kg !== undefined || adjustment.load_count !== undefined) {
    const doneLoad = load({ load_kg: adjustment.load_kg ?? target?.load_kg, load_count: adjustment.load_count ?? target?.load_count });
    const plannedLoad = target ? load(target) : null;
    if (doneLoad !== null) changes.push(plannedLoad && plannedLoad !== doneLoad ? `${doneLoad} au lieu de ${plannedLoad}` : doneLoad);
  }
  return changes.length > 0 ? `${what} : ${changes.join(', ')}` : what;
}

/** Message qui demande au coach son avis sur une séance, avec tout ce qui a été noté. */
export function adviceRequest(result: Result): string {
  const { wod, score } = result;
  const facts = [`Score : ${scoreLine(wod, score)}${isOverCap(wod, score) ? ' (hors cap)' : ''}, ${score.rx ? 'Rx' : 'scaled'}`];
  if (score.rpe !== undefined) facts.push(`RPE ${score.rpe}/10`);
  if ('splits_sec' in score && score.splits_sec && score.splits_sec.length > 0) {
    facts.push(`Temps par ${wod.type === 'hyrox' ? 'segment' : 'tour'} : ${score.splits_sec.map(clock).join(', ')}`);
  }
  if (score.adjustments && score.adjustments.length > 0) {
    facts.push(`Adaptations : ${score.adjustments.map((adjustment) => adjustmentText(wod, adjustment)).join(' ; ')}`);
  }
  if (score.notes) facts.push(`Mes notes : ${score.notes}`);
  return [
    `Donne-moi ton avis sur ma séance du ${dateLabel(result.date)} : « ${wod.title} » (${wodHeadline(wod)}).`,
    `${facts.join('. ')}.`,
    'Qu’en penses-tu, et que me conseilles-tu pour la prochaine fois ?',
  ].join('\n');
}

export const askAdvice = (result: Result) => openChat(adviceRequest(result));

/** Ligne d'une activité d'un autre sport, au même format qu'une séance de WOD. */
export function activityRow(activity: Activity): HTMLElement {
  return h(
    'li',
    null,
    h(
      'a',
      { class: 'card result', href: `#/activity/${activity.id}` },
      h('span', { class: 'card-top' }, h('span', { class: 'date' }, dateLabel(activity.date)), h('span', { class: 'badge sport' }, activityName(activity))),
      activity.title && activity.sport !== 'other' && h('strong', { class: 'card-title' }, activity.title),
      h(
        'span',
        { class: 'result-line' },
        h('span', { class: 'score' }, activityLine(activity)),
        activity.rpe !== undefined && h('span', { class: 'chip' }, `RPE ${activity.rpe}`),
      ),
    ),
  );
}

export function resultRow(result: Result, withTitle = true, record = false): HTMLElement {
  const { score } = result;
  return h(
    'li',
    null,
    h(
      'a',
      { class: 'card result', href: `#/history/${result.id}` },
      h(
        'span',
        { class: 'card-top' },
        h('span', { class: 'date' }, dateLabel(result.date)),
        withTitle && badges(result.wod),
      ),
      withTitle && h('strong', { class: 'card-title' }, result.wod.title),
      h(
        'span',
        { class: 'result-line' },
        h('span', { class: 'score' }, scoreLine(result.wod, score)),
        record && h('span', { class: 'chip pr' }, 'PR'),
        isOverCap(result.wod, score) && h('span', { class: 'chip late' }, 'Hors cap'),
        h('span', { class: `chip ${score.rx ? 'rx' : ''}` }, score.rx ? 'Rx' : 'Scaled'),
        score.rpe !== undefined && h('span', { class: 'chip' }, `RPE ${score.rpe}`),
      ),
    ),
  );
}
