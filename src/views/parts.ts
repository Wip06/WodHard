import { h } from '../dom';
import { clock, dateLabel, duration, kg, movementText, quantity, scoreLine, typeLabel, wodSummary } from '../format';
import type { Movement, Result, Wod } from '../types';

export function pageHead(title: string, back?: { href: string; label: string }): HTMLElement {
  return h(
    'header',
    { class: 'page-head' },
    back && h('a', { class: 'back', href: back.href }, `‹ ${back.label}`),
    h('h1', null, title),
  );
}

export function typeBadge(wod: Wod): HTMLElement {
  return h('span', { class: `badge ${wod.type}` }, typeLabel(wod.type));
}

function movementItem(movement: Movement, schemeReps?: number): HTMLElement {
  const amount = quantity(movement, schemeReps);
  return h(
    'li',
    { class: 'movement' },
    h('span', { class: 'qty' }, amount ?? '·'),
    h(
      'span',
      { class: 'what' },
      h('span', { class: 'name' }, movement.name),
      movement.load_kg !== undefined && h('span', { class: 'load' }, kg(movement.load_kg)),
      movement.notes && h('span', { class: 'note' }, movement.notes),
    ),
  );
}

/** Liste de mouvements ; une liste vide (slot EMOM de repos) affiche « Repos ». */
export function movementList(movements: Movement[], schemeReps?: number): HTMLElement {
  return h(
    'ul',
    { class: 'movements' },
    movements.length > 0
      ? movements.map((movement) => movementItem(movement, schemeReps))
      : h('li', { class: 'movement rest' }, 'Repos'),
  );
}

/** Le contenu du WOD : consigne puis mouvements. */
export function wodPlan(wod: Wod): HTMLElement {
  switch (wod.type) {
    case 'amrap':
      return h(
        'div',
        { class: 'plan' },
        h('p', { class: 'rule' }, `Un maximum de tours en ${duration(wod.duration_sec)} :`),
        movementList(wod.movements),
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
          movementList(slot),
        ]),
      );
    }
    case 'for_time': {
      const volume = wod.rep_scheme
        ? `${wod.rep_scheme.join('-')} reps de chaque mouvement`
        : wod.rounds > 1
          ? `${wod.rounds} tours`
          : 'Une fois';
      return h(
        'div',
        { class: 'plan' },
        h('p', { class: 'rule' }, `${volume}, le plus vite possible (time cap ${duration(wod.time_cap_sec)}) :`),
        movementList(wod.movements),
      );
    }
    case 'hyrox': {
      const cap = wod.time_cap_sec === undefined ? '' : ` (time cap ${duration(wod.time_cap_sec)})`;
      return h(
        'div',
        { class: 'plan' },
        h('p', { class: 'rule' }, `Enchaîne les segments dans l’ordre, le plus vite possible${cap} :`),
        movementList(wod.segments),
      );
    }
  }
}

/** Temps de chaque segment d'un Hyrox, en face du segment correspondant. */
export function splitsList(wod: Wod, splits: number[]): HTMLElement | false {
  if (wod.type !== 'hyrox' || splits.length === 0) return false;
  return h(
    'ol',
    { class: 'splits' },
    splits.map((sec, i) => {
      const segment = wod.segments[i];
      return h(
        'li',
        null,
        h('span', { class: 'what' }, segment ? movementText(segment) : `Segment ${i + 1}`),
        h('span', { class: 'split' }, clock(sec)),
      );
    }),
  );
}

/** Fiche complète d'un WOD : titre, contexte, échauffement et contenu. */
export function wodSheet(wod: Wod): HTMLElement {
  return h(
    'article',
    { class: 'sheet' },
    h('div', { class: 'sheet-top' }, typeBadge(wod), h('span', { class: 'summary' }, wodSummary(wod))),
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
    wodPlan(wod),
  );
}

export function resultRow(result: Result, withTitle = true): HTMLElement {
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
        withTitle && typeBadge(result.wod),
      ),
      withTitle && h('strong', { class: 'card-title' }, result.wod.title),
      h(
        'span',
        { class: 'result-line' },
        h('span', { class: 'score' }, scoreLine(result.wod, score)),
        h('span', { class: `chip ${score.rx ? 'rx' : ''}` }, score.rx ? 'Rx' : 'Scaled'),
        score.rpe !== undefined && h('span', { class: 'chip' }, `RPE ${score.rpe}`),
      ),
    ),
  );
}
