import { choose, h, offerFile, toast } from '../dom';
import { adjustmentText, dateLabel, scoreLine, setsLine } from '../format';
import { coachReady, loadCoach } from '../claude';
import { navigate, type View } from '../router';
import { isOverCap, lastSplits, scoreDelta } from '../records';
import { sessionCard, sessionFileName } from '../sessionCard';
import { sessionImageFile } from '../sessionImage';
import { currentRecords, deleteResult, findResult, findWod, sameWorkout, sortedActivities, sortedResults } from '../store';
import { activityRow, askAdvice, deltaChip, pageHead, resultRow, rxChip, splitsList, wodSheet } from './parts';

/**
 * Toutes les séances, WOD et autres sports, de la plus récente à la plus ancienne. On y retrouve
 * aussi celles d'un WOD supprimé de la bibliothèque.
 */
export function historyView(): View {
  const records = currentRecords();
  const rows = [
    ...sortedResults().map((result) => ({ date: result.date, row: () => resultRow(result, true, records.has(result.id)) })),
    ...sortedActivities().map((activity) => ({ date: activity.date, row: () => activityRow(activity) })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const el = h(
    'section',
    { class: 'page' },
    pageHead('Toutes mes séances', { href: '#/data', label: 'Données' }),
    rows.length > 0
      ? h(
          'ul',
          { class: 'cards' },
          rows.map(({ row }) => row()),
        )
      : h('p', { class: 'empty' }, 'Aucune séance pour l’instant. Lance un WOD et saisis ton score : elle apparaîtra ici.'),
  );
  return { el, tab: 'data' };
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
    navigate(inLibrary ? `/wod/${result.wod_id}` : '/history', true);
  };

  const el = h(
    'section',
    { class: 'page' },
    // Retour à la fiche du WOD ; sans elle (WOD supprimé), à la liste de toutes les séances.
    pageHead(dateLabel(result.date), inLibrary ? { href: `#/wod/${result.wod_id}`, label: 'WOD' } : { href: '#/history', label: 'Mes séances' }),
    h(
      'div',
      { class: 'scoreboard' },
      h('strong', { class: 'score' }, scoreLine(wod, score)),
      h(
        'span',
        { class: 'result-line' },
        isRecord && h('span', { class: 'chip pr' }, 'Record'),
        isOverCap(wod, score) && h('span', { class: 'chip late' }, 'Hors cap'),
        rxChip(wod, score),
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
      'exercises' in score &&
        wod.type === 'strength' &&
        h(
          'div',
          { class: 'adjustments' },
          h('span', { class: 'field-label' }, 'Séries'),
          h(
            'ul',
            null,
            wod.exercises.map((exercise, i) =>
              h('li', null, h('strong', null, exercise.name), ` : ${setsLine(score.exercises[i] ?? [], exercise.load_count)}`),
            ),
          ),
        ),
      score.adjustments &&
        score.adjustments.length > 0 &&
        h(
          'div',
          { class: 'adjustments' },
          h('span', { class: 'field-label' }, 'Adapté'),
          h(
            'ul',
            null,
            score.adjustments.map((adjustment) => h('li', null, adjustmentText(wod, adjustment))),
          ),
        ),
      score.notes && h('p', { class: 'description' }, score.notes),
      'splits_sec' in score &&
        score.splits_sec !== undefined &&
        splitsList(wod, score.splits_sec, lastSplits(earlier)),
    ),
    wodSheet(wod),
    h(
      'div',
      { class: 'stack' },
      coachReady(loadCoach()) && h('button', { class: 'btn primary block', onclick: () => askAdvice(result) }, 'Avis du coach'),
      h('a', { class: 'btn block', href: `#/history/${id}/recap` }, 'Récapitulatif'),
      h('a', { class: 'btn block', href: `#/score/${id}` }, 'Modifier le score'),
      inLibrary && h('a', { class: 'btn block', href: `#/wod/${result.wod_id}` }, 'Refaire ce WOD'),
      h('button', { class: 'btn ghost danger block', onclick: () => void remove() }, 'Supprimer cette séance'),
    ),
  );
  return { el, tab: 'wods' };
}

/** Séance précédente du même WOD, pour la comparaison. */
function previousOf(id: string) {
  const result = findResult(id);
  if (!result) return undefined;
  const workout = sameWorkout(result.wod);
  return workout.slice(0, Math.max(workout.findIndex((other) => other.id === id), 0)).at(-1);
}

/**
 * Récapitulatif de la séance, en image : à enregistrer dans ses photos, par exemple pour l'ajouter
 * à l'activité Strava que la montre a créée, pour que Strava en reprenne le contenu.
 */
export function recapView(id: string): View | null {
  const result = findResult(id);
  if (!result) return null;
  const card = sessionCard(result, previousOf(id), currentRecords().has(id));
  const image = h('img', { class: 'session-image', alt: `Image de la séance « ${result.wod.title} »` });
  const save = h('button', { class: 'btn primary big block', disabled: true }, 'Enregistrer l’image');
  let file: File | null = null;
  let url = '';
  sessionImageFile(card, sessionFileName(result))
    .then((made) => {
      file = made;
      url = URL.createObjectURL(made);
      image.src = url;
      save.disabled = false;
    })
    .catch(() => toast('Image impossible à créer'));
  // Le partage doit partir directement du toucher : l'image est donc prête avant.
  save.addEventListener('click', () => {
    if (file) void offerFile(file);
  });

  const el = h(
    'section',
    { class: 'page' },
    pageHead('Récapitulatif', { href: `#/history/${id}`, label: 'Séance' }),
    h('p', { class: 'lead' }, 'Enregistre-la dans tes photos, puis ajoute-la à ton activité Strava : Strava en reprend le contenu.'),
    image,
    save,
    h('p', { class: 'hint' }, 'Sur iPhone, tu peux aussi appuyer longuement sur l’image, puis choisir « Enregistrer dans Photos ».'),
  );
  return {
    el,
    tab: 'wods',
    destroy: () => {
      if (url) URL.revokeObjectURL(url);
    },
  };
}
