import { choose, copyText, h, toast } from '../dom';
import { dateLabel, plural, scoreLine } from '../format';
import { navigate, type View } from '../router';
import { lastSplits, scoreDelta } from '../records';
import { buildHistory, currentRecords, deleteResult, findResult, findWod, sameWorkout, sortedResults } from '../store';
import { deltaChip, pageHead, resultRow, splitsList, wodSheet } from './parts';

const LIMITS = [
  { value: '10', label: 'Les 10 dernières' },
  { value: '30', label: 'Les 30 dernières' },
  { value: 'all', label: 'Tout' },
];
const DEFAULT_LIMIT = '30';

export function historyView(): View {
  const results = sortedResults();
  const records = currentRecords();
  const limit = h(
    'select',
    { 'aria-label': 'Séances à copier' },
    LIMITS.map(({ value, label }) => h('option', { value, selected: value === DEFAULT_LIMIT }, label)),
  );

  const copy = async () => {
    const history = buildHistory(limit.value === 'all' ? undefined : Number(limit.value));
    const copied = await copyText(JSON.stringify(history));
    toast(copied ? `${plural(history.entries.length, 'séance')} dans le presse-papiers` : 'Copie impossible');
  };

  const el = h(
    'section',
    { class: 'page' },
    pageHead('Historique'),
    results.length > 0
      ? [
          h(
            'div',
            { class: 'stack' },
            h('button', { class: 'btn primary block', onclick: () => void copy() }, 'Copier mon historique'),
            h('label', { class: 'inline-field' }, h('span', null, 'Séances copiées, en JSON pour Claude :'), limit),
          ),
          h(
            'ul',
            { class: 'cards' },
            results.map((result) => resultRow(result, true, records.has(result.id))),
          ),
        ]
      : h('p', { class: 'empty' }, 'Aucune séance pour l’instant. Lance un WOD et saisis ton score : il apparaîtra ici.'),
  );
  return { el, tab: 'history' };
}

export function resultView(id: string): View | null {
  const result = findResult(id);
  if (!result) return null;
  const { wod, score } = result;
  const inLibrary = result.wod_id !== undefined && findWod(result.wod_id) !== undefined;

  // Comparaison avec les autres séances du même entraînement.
  const workout = sameWorkout(wod);
  const earlier = workout.slice(0, Math.max(workout.findIndex((other) => other.id === id), 0));
  const previous = earlier.at(-1);
  const delta = previous ? scoreDelta(wod, score, previous.score) : null;
  const records = currentRecords();
  const isRecord = records.has(id);
  const best = workout.find((other) => records.has(other.id));

  const remove = async () => {
    const confirmed = await choose('Supprimer cette séance ?', `${wod.title}, ${dateLabel(result.date)}.`, [
      { label: 'Supprimer', value: true, kind: 'danger' },
      { label: 'Annuler', value: false },
    ]);
    if (!confirmed) return;
    deleteResult(id);
    toast('Séance supprimée');
    navigate('/history', true);
  };

  const el = h(
    'section',
    { class: 'page' },
    pageHead(dateLabel(result.date), { href: '#/history', label: 'Historique' }),
    h(
      'div',
      { class: 'scoreboard' },
      h('strong', { class: 'score' }, scoreLine(wod, score)),
      h(
        'span',
        { class: 'result-line' },
        isRecord && h('span', { class: 'chip pr' }, 'Record'),
        h('span', { class: `chip ${score.rx ? 'rx' : ''}` }, score.rx ? 'Rx' : 'Scaled'),
        score.rpe !== undefined && h('span', { class: 'chip' }, `RPE ${score.rpe}/10`),
      ),
      previous &&
        h(
          'p',
          { class: 'compare' },
          `Séance précédente, ${dateLabel(previous.date)} : ${scoreLine(previous.wod, previous.score)}`,
          delta && deltaChip(delta),
        ),
      best && !isRecord && h('p', { class: 'compare' }, `Record : ${scoreLine(best.wod, best.score)}, ${dateLabel(best.date)}`),
      score.notes && h('p', { class: 'description' }, score.notes),
      'splits_sec' in score &&
        score.splits_sec !== undefined &&
        splitsList(wod, score.splits_sec, lastSplits(earlier)),
    ),
    wodSheet(wod),
    h(
      'div',
      { class: 'stack' },
      h('a', { class: 'btn block', href: `#/score/${id}` }, 'Modifier le score'),
      inLibrary && h('a', { class: 'btn block', href: `#/wod/${result.wod_id}` }, 'Refaire ce WOD'),
      h('button', { class: 'btn ghost danger block', onclick: () => void remove() }, 'Supprimer cette séance'),
    ),
  );
  return { el, tab: 'history' };
}
