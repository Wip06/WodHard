import { h } from '../dom';
import { clock, dateLabel, duration, kg, movementText, quantity, scoreLine, typeLabel, wodSummary } from '../format';
import { splitDeltas, type Delta } from '../records';
import type { Movement, Result, Wod } from '../types';

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
        withTitle && typeBadge(result.wod),
      ),
      withTitle && h('strong', { class: 'card-title' }, result.wod.title),
      h(
        'span',
        { class: 'result-line' },
        h('span', { class: 'score' }, scoreLine(result.wod, score)),
        record && h('span', { class: 'chip pr' }, 'PR'),
        h('span', { class: `chip ${score.rx ? 'rx' : ''}` }, score.rx ? 'Rx' : 'Scaled'),
        score.rpe !== undefined && h('span', { class: 'chip' }, `RPE ${score.rpe}`),
      ),
    ),
  );
}
