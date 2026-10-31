import { h } from '../dom';
import { dateLabel, decimal, duration, kg, setsLine, setText } from '../format';
import { liftsOf, type Lift, type LiftSession } from '../lifts';
import type { View } from '../router';
import { sortedResults } from '../store';
import { pageHead } from './parts';

/** Exercices montrés dans l'onglet Progrès ; les autres sont sur la page « Mes charges ». */
const BLOCK_MAX = 6;
const SPARK_MAX = 10;

const round = (value: number) => Math.round(value * 2) / 2;
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** Valeur suivie d'une séance : son 1RM estimé, ou ses meilleures reps pour un exercice sans charge. */
const sessionValue = (session: LiftSession) =>
  session.oneRepMax ?? Math.max(0, ...session.sets.map((set) => set.reps ?? set.duration_sec ?? 0));

/** « 1RM estimé 117,5 kg », ou « 15 reps max » sans charge. */
function headline(lift: Lift): string {
  if (lift.best) return `1RM estimé ${kg(round(lift.best.oneRepMax))}`;
  if (lift.mostReps) return `${lift.mostReps.reps} reps max`;
  if (lift.heaviest) return `max ${kg(lift.heaviest.load)}`;
  if (lift.longestHold) return `${duration(lift.longestHold.seconds)} max`;
  return `${lift.sessions.length} séance${lift.sessions.length > 1 ? 's' : ''}`;
}

/** Tendance de la dernière séance sur la précédente : ▲, ▼ ou =. */
function trend(lift: Lift): { mark: string; tone: string } | null {
  const [previous, last] = lift.sessions.slice(-2).map(sessionValue);
  if (previous === undefined || last === undefined || lift.sessions.length < 2) return null;
  if (last > previous) return { mark: '▲', tone: 'up' };
  if (last < previous) return { mark: '▼', tone: 'down' };
  return { mark: '=', tone: '' };
}

function spark(lift: Lift): HTMLElement {
  const values = lift.sessions.slice(-SPARK_MAX).map(sessionValue);
  const low = Math.min(...values);
  const high = Math.max(...values);
  return h(
    'span',
    { class: 'spark', 'aria-hidden': 'true' },
    values.map((value) => h('span', { style: `height: ${Math.round(15 + (high === low ? 0.5 : (value - low) / (high - low)) * 85)}%` })),
  );
}

function liftRow(lift: Lift): HTMLElement {
  const last = lift.sessions.at(-1);
  const arrow = trend(lift);
  const record = lift.best ? `Record ${setText(lift.best.set)}` : lift.heaviest ? `Record ${lift.heaviest.reps} × ${kg(lift.heaviest.load)}` : '';
  return h(
    'li',
    null,
    h(
      'a',
      { class: 'repeat', href: `#/lift/${encodeURIComponent(lift.key)}` },
      h('span', { class: 'repeat-title' }, lift.name),
      lift.sessions.length > 1 && spark(lift),
      arrow && h('span', { class: `trend ${arrow.tone}` }, arrow.mark),
      h('span', { class: 'repeat-scores' }, headline(lift)),
      h('span', { class: 'repeat-meta' }, [record, last && `dernière fois ${shortDate(last.date)}`].filter(Boolean).join(' · ')),
    ),
  );
}

/** Bloc « Charges » de l'onglet Progrès : les exercices de force les plus récents. */
export function liftsBlock(): HTMLElement | false {
  const lifts = liftsOf(sortedResults());
  if (lifts.length === 0) return false;
  return h(
    'section',
    { class: 'dash-block' },
    h('h2', { class: 'dash-title' }, 'Charges'),
    h('ul', { class: 'repeats' }, lifts.slice(0, BLOCK_MAX).map(liftRow)),
    lifts.length > BLOCK_MAX && h('a', { class: 'btn ghost block', href: '#/lifts' }, `Voir les ${lifts.length} exercices`),
  );
}

/** Toutes les charges : un exercice par ligne, le plus récent en premier. */
export function liftsView(): View {
  const lifts = liftsOf(sortedResults());
  const el = h(
    'section',
    { class: 'page' },
    pageHead('Mes charges', { href: '#/progress', label: 'Progrès' }),
    lifts.length > 0
      ? h('section', { class: 'dash-block' }, h('ul', { class: 'repeats' }, lifts.map(liftRow)))
      : h('p', { class: 'empty' }, 'Aucune séance de force pour l’instant : tes charges apparaîtront ici.'),
  );
  return { el, tab: 'progress' };
}

/** Un exercice : records, évolution séance après séance, et toutes ses séries. */
export function liftView(key: string): View | null {
  const lift = liftsOf(sortedResults()).find((candidate) => candidate.key === decodeURIComponent(key));
  if (!lift) return null;
  const values = lift.sessions.map(sessionValue);
  const max = Math.max(...values, 1);
  const unit = lift.best ? '1RM estimé' : 'reps max';
  const el = h(
    'section',
    { class: 'page' },
    pageHead(lift.name, { href: '#/progress', label: 'Progrès' }),
    h(
      'dl',
      { class: 'facts' },
      lift.best && [h('dt', null, '1RM estimé'), h('dd', null, `${kg(round(lift.best.oneRepMax))} · ${shortDate(lift.best.date)}`)],
      lift.best && [h('dt', null, 'Meilleure série'), h('dd', null, setText(lift.best.set))],
      lift.heaviest && [h('dt', null, 'Charge la plus lourde'), h('dd', null, `${lift.heaviest.reps} × ${kg(lift.heaviest.load)}`)],
      lift.mostReps && [h('dt', null, 'Le plus de reps'), h('dd', null, `${lift.mostReps.reps} reps`)],
      h('dt', null, 'Séances'),
      h('dd', null, lift.sessions.length),
    ),
    lift.sessions.length > 1 &&
      h(
        'section',
        { class: 'dash-block' },
        h('h2', { class: 'dash-title' }, `Évolution · ${unit}`),
        h(
          'div',
          { class: `bars ${values.length > 13 ? 'dense' : ''}`, role: 'img', 'aria-label': `Évolution du ${unit}` },
          lift.sessions.map((session, i) =>
            h(
              'span',
              { class: 'bar-col' },
              h('span', { class: 'bar-track' }, h('span', { class: i === values.length - 1 ? 'bar current' : 'bar', style: `height: ${Math.round(((values[i] ?? 0) / max) * 100)}%` })),
              h('span', { class: 'bar-label' }, values.length <= 8 ? shortDate(session.date) : ''),
            ),
          ),
        ),
        lift.best && h('p', { class: 'dash-note' }, `Pour prescrire : 75 % de ton 1RM estimé ≈ ${kg(round(lift.best.oneRepMax * 0.75))}`),
      ),
    h(
      'section',
      { class: 'dash-block' },
      h('h2', { class: 'dash-title' }, 'Séances'),
      h(
        'ul',
        { class: 'record-lines' },
        [...lift.sessions].reverse().map((session) =>
          h(
            'li',
            null,
            h(
              'a',
              { href: `#/history/${session.resultId}` },
              h('strong', null, dateLabel(session.date)),
              ` · ${setsLine(session.sets, session.loadCount)}`,
              session.oneRepMax !== undefined && ` · 1RM est. ${decimal(round(session.oneRepMax))} kg`,
            ),
          ),
        ),
      ),
    ),
  );
  return { el, tab: 'progress' };
}
