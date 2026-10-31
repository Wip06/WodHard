import { h, toast } from '../dom';
import { dateLabel, scoreLine, today } from '../format';
import { agoText, canBeReference, REFERENCE_CHOICES, REFERENCE_WEEKS, type Reference } from '../references';
import { compareScores } from '../records';
import { performance } from '../stats';
import { references, setReference } from '../store';
import type { Result, SavedWod } from '../types';

const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
/** Séances montrées sur la courbe de progression. */
const CHART_MAX = 12;

export const referenceChip = () => h('span', { class: 'chip ref' }, 'Référence');

/** Quand refaire : « à refaire depuis le 3 déc. », « prochain test le 12 déc. », ou « pas encore fait ». */
export function dueText(reference: Reference): string {
  if (!reference.dueOn) return 'pas encore fait';
  return reference.due ? `à refaire depuis le ${shortDate(reference.dueOn)}` : `prochain test le ${shortDate(reference.dueOn)}`;
}

/**
 * Évolution d'un entraînement, séance après séance : plus la barre est haute, meilleur est le score
 * (un temps plus court, plus de tours…). `results` va de la plus ancienne à la plus récente.
 */
export function progressionChart(results: Result[]): HTMLElement | false {
  if (results.length < 2) return false;
  const shown = results.slice(-CHART_MAX);
  const values = shown.map((result) => performance(result.wod, result.score));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const best = results.reduce((top, result) => (compareScores(result.score, top.score, [result.wod, top.wod]) > 0 ? result : top));
  const first = results[0]!;
  const last = results.at(-1)!;
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'bars', role: 'img', 'aria-label': `Évolution du score, de ${scoreLine(first.wod, first.score)} à ${scoreLine(last.wod, last.score)}` },
      shown.map((result, i) =>
        h(
          'span',
          { class: 'bar-col', title: `${dateLabel(result.date)} : ${scoreLine(result.wod, result.score)}` },
          h(
            'span',
            { class: 'bar-track' },
            h('span', {
              class: result === best ? 'bar best' : i === shown.length - 1 ? 'bar current' : 'bar',
              style: `height: ${Math.round(15 + (high === low ? 0.5 : (values[i]! - low) / (high - low)) * 85)}%`,
            }),
          ),
          h('span', { class: 'bar-label' }, shown.length <= 8 ? shortDate(result.date) : ''),
        ),
      ),
    ),
    // La légende reprend les couleurs des barres : record en vert, dernière fois en jaune.
    h(
      'p',
      { class: 'dash-note' },
      `Premier : ${scoreLine(first.wod, first.score)} · `,
      h('span', { class: 'note-best' }, `Record : ${scoreLine(best.wod, best.score)}`),
      ' · ',
      h('span', { class: 'note-last' }, `Dernier : ${scoreLine(last.wod, last.score)}`),
    ),
  );
}

/** Fiche d'un WOD : en faire une référence, choisir quand le refaire, ou arrêter de le suivre. */
export function referenceSection(saved: SavedWod, onChange: () => void): HTMLElement | false {
  if (!canBeReference(saved)) return false;
  const reference = references().find((candidate) => candidate.saved.id === saved.id);
  if (!reference) {
    return h(
      'section',
      { class: 'stack' },
      h('h2', { class: 'section-title' }, 'Référence'),
      h('p', { class: 'hint left' }, 'Un WOD de référence se refait régulièrement pour mesurer ta progression : l’appli te rappelle quand le refaire.'),
      h(
        'button',
        {
          class: 'btn block',
          onclick: () => {
            setReference(saved.id, REFERENCE_WEEKS);
            toast('WOD de référence');
            onChange();
          },
        },
        'En faire un WOD de référence',
      ),
    );
  }
  const weeks = h(
    'select',
    { 'aria-label': 'Délai avant de le refaire' },
    [...new Set([...REFERENCE_CHOICES, reference.weeks])]
      .sort((a, b) => a - b)
      .map((value) => h('option', { value, selected: value === reference.weeks }, `${value} semaines`)),
  );
  weeks.addEventListener('change', () => {
    setReference(saved.id, Number(weeks.value));
    onChange();
  });
  return h(
    'section',
    { class: 'stack' },
    h('h2', { class: 'section-title' }, 'Référence'),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'À refaire toutes les'), weeks),
    h('p', { class: `hint left ${reference.due ? 'due' : ''}` }, reference.last ? `Dernière fois ${agoText(reference.last.date, today())} · ${dueText(reference)}` : 'Pas encore fait : lance-le pour avoir ton premier score.'),
    h(
      'button',
      {
        class: 'btn ghost block',
        onclick: () => {
          setReference(saved.id, null);
          toast('Ce WOD n’est plus une référence');
          onChange();
        },
      },
      'Ne plus en faire une référence',
    ),
  );
}

/** Ligne d'une référence dans l'onglet Progrès : courbe, dernier score, record, prochain test. */
function referenceRow(reference: Reference): HTMLElement {
  const { saved, results, last, best } = reference;
  const values = results.slice(-10).map((result) => performance(result.wod, result.score));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const first = results[0];
  const trend = first && last && results.length > 1 ? compareScores(last.score, first.score, [last.wod, first.wod]) : 0;
  return h(
    'li',
    null,
    h(
      'a',
      { class: 'repeat', href: `#/wod/${saved.id}` },
      h('span', { class: 'repeat-title' }, saved.wod.title),
      results.length > 1 &&
        h('span', { class: 'spark', 'aria-hidden': 'true' }, values.map((v) => h('span', { style: `height: ${Math.round(15 + (high === low ? 0.5 : (v - low) / (high - low)) * 85)}%` }))),
      results.length > 1 && h('span', { class: `trend ${trend > 0 ? 'up' : trend < 0 ? 'down' : ''}` }, trend > 0 ? '▲' : trend < 0 ? '▼' : '='),
      h('span', { class: 'repeat-scores' }, last ? scoreLine(last.wod, last.score) : 'Pas encore fait'),
      h(
        'span',
        { class: `repeat-meta ${reference.due ? 'due' : ''}` },
        [best && results.length > 1 && `record ${scoreLine(best.wod, best.score)}`, dueText(reference)].filter(Boolean).join(' · '),
      ),
    ),
  );
}

/** Bloc « Tes références » de l'onglet Progrès, celles à refaire en premier. */
export function referencesBlock(): HTMLElement | false {
  const list = references().sort((a, b) => Number(b.due) - Number(a.due) || (a.dueOn ?? '').localeCompare(b.dueOn ?? ''));
  if (list.length === 0) return false;
  return h(
    'section',
    { class: 'dash-block' },
    h('h2', { class: 'dash-title' }, 'Tes références'),
    h('ul', { class: 'repeats' }, list.map(referenceRow)),
  );
}

/** Résumé des références pour le coach. */
export function referencesSummary(): string | null {
  const list = references();
  if (list.length === 0) return null;
  return `- Références : ${list
    .map((reference) => `${reference.saved.wod.title} ${reference.last ? scoreLine(reference.last.wod, reference.last.score) : 'pas encore fait'} (${dueText(reference)})`)
    .join(' ; ')}.`;
}
