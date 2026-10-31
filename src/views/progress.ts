import { h } from '../dom';
import { clock, dateLabel, decimal, duration, plural, scoreLine, today } from '../format';
import { coachReady, loadCoach } from '../claude';
import { render, type View } from '../router';
import { distanceText, SPORT_INFO } from '../sports';
import { dashboard, DEFAULT_RPE, STREAK_MIN, type Dashboard, type Family } from '../stats';
import { currentRecords, findWod, getPlan, references, sortedActivities, sortedResults } from '../store';
import { workKey } from '../records';
import { liftsBlock } from './lifts';
import { referencesBlock, referencesSummary } from './references';
import { openChat, pageHead } from './parts';

const PERIODS = [
  { weeks: 4, label: '4 semaines', since: 'les 4 dernières semaines' },
  { weeks: 13, label: '3 mois', since: 'les 3 derniers mois' },
  { weeks: 52, label: '1 an', since: 'la dernière année' },
];
/** Période choisie, conservée tant que l'appli reste ouverte. */
let weeks = 4;

const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const FAMILY_LABELS: Record<Family, string> = { cardio: 'Cardio', gym: 'Gym', charges: 'Charges', autre: 'Autres sports' };
/** Écart de charge au-delà duquel la semaine est signalée, en %. */
const LOAD_ALERT = 30;

const percent = (share: number) => `${Math.round(share * 100)} %`;
/** « +35 % sur », « −20 % sur », ou « plus du double de » au-delà de +100 %. */
const changeText = (change: number) =>
  change > 100 ? 'plus du double de' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)} % sur`;
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const monthOf = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { month: 'short' });

function block(title: string, ...content: (HTMLElement | string | false | null | undefined)[]): HTMLElement {
  return h('section', { class: 'dash-block' }, h('h2', { class: 'dash-title' }, title), content);
}

function weekBlock(d: Dashboard): HTMLElement {
  const { week } = d;
  return block(
    'Cette semaine',
    h(
      'div',
      { class: 'stat-grid' },
      h(
        'div',
        { class: 'stat' },
        h('strong', null, week.sessions),
        h('span', null, week.sessions > 1 ? 'séances' : 'séance'),
        week.planned > 0 &&
          h(
            'span',
            { class: 'stat-sub' },
            `${week.plannedDone} / ${week.planned} ${week.planned > 1 ? 'prévues' : 'prévue'}`,
            h('span', { class: 'meter' }, h('span', { style: `width: ${Math.round((week.plannedDone / week.planned) * 100)}%` })),
          ),
      ),
      h('div', { class: 'stat' }, h('strong', null, week.effortSec > 0 ? duration(week.effortSec) : '0'), h('span', null, 'd’effort')),
      h('div', { class: 'stat' }, h('strong', null, week.rpe === undefined ? '—' : decimal(week.rpe, 1)), h('span', null, 'RPE moyen')),
    ),
    week.streak > 0 &&
      h(
        'p',
        { class: 'dash-note' },
        `${plural(week.streak, 'semaine')} d’affilée à ${STREAK_MIN} séances ou plus`,
      ),
  );
}

function heatmapBlock(d: Dashboard): HTMLElement {
  return block(
    `Régularité · ${plural(d.heatmap.length, 'semaine')}`,
    h(
      'div',
      { class: 'heatmap-wrap' },
      // Sur un an, les cases sont trop petites pour l'initiale des jours.
      d.heatmap.length <= 13 && h('div', { class: 'heatmap-days', 'aria-hidden': 'true' }, DAYS.map((day) => h('span', null, day))),
      h(
        'div',
        {
          class: `heatmap ${d.heatmap.length > 13 ? 'dense' : ''}`,
          style: `grid-template-columns: repeat(${d.heatmap.length}, minmax(0, 34px))`,
          role: 'img',
          'aria-label': 'Jours avec séance',
        },
        // Rangée par rangée (un jour de la semaine), colonne par colonne (une semaine).
        DAYS.flatMap((_, day) =>
          d.heatmap.map((column) => {
            const level = column.days[day];
            return h('span', { class: level === null || level === undefined ? 'cell future' : `cell l${level}` });
          }),
        ),
      ),
    ),
    h(
      'p',
      { class: 'dash-legend' },
      h('span', { class: 'cell l1' }),
      'facile',
      h('span', { class: 'cell l2' }),
      'soutenu',
      h('span', { class: 'cell l3' }),
      'dur (RPE 8+)',
    ),
  );
}

/**
 * Étiquettes sous les barres : la date de chaque semaine sur 4 semaines, sinon le mois là où il
 * change. Sur un an, les barres sont étroites : on garde au moins 5 barres entre deux mois, en
 * partant de la fin, pour que le mois en cours soit toujours nommé.
 */
function monthLabels(mondays: string[]): (monday: string, i: number) => string {
  if (mondays.length <= 4) return (monday) => shortDate(monday);
  const gap = mondays.length > 13 ? 5 : 2;
  const changes = mondays.flatMap((monday, i) => (i === 0 || monthOf(mondays[i - 1] ?? monday) !== monthOf(monday) ? [i] : []));
  const kept = new Set<number>();
  let next = Infinity;
  for (const i of changes.reverse()) {
    if (next - i >= gap) {
      kept.add(i);
      next = i;
    }
  }
  return (monday, i) => (kept.has(i) ? monthOf(monday) : '');
}

function loadBlock(d: Dashboard): HTMLElement {
  const max = Math.max(...d.loads.map((week) => week.load), 1);
  const label = monthLabels(d.loads.map((week) => week.monday));
  const change = d.loadChange;
  return block(
    'Charge · durée × RPE, par semaine',
    h(
      'div',
      { class: `bars ${d.loads.length > 13 ? 'dense' : ''}`, role: 'img', 'aria-label': 'Charge par semaine' },
      d.loads.map((week, i) =>
        h(
          'span',
          { class: 'bar-col' },
          h(
            'span',
            { class: 'bar-track' },
            h('span', { class: i === d.loads.length - 1 ? 'bar current' : 'bar', style: `height: ${Math.round((week.load / max) * 100)}%` }),
          ),
          h('span', { class: 'bar-label' }, label(week.monday, i)),
        ),
      ),
    ),
    change !== undefined &&
      h(
        'p',
        { class: `dash-note ${change >= LOAD_ALERT ? 'warn' : ''}` },
        `7 derniers jours : ${changeText(change)} ta moyenne des 4 semaines d’avant.`,
        change >= LOAD_ALERT ? ' Pense à la récupération.' : change <= -LOAD_ALERT ? ' Semaine plus légère.' : '',
      ),
    d.missingRpe > 0 &&
      h('p', { class: 'dash-legend' }, `${plural(d.missingRpe, 'séance')} sans RPE, comptée${d.missingRpe > 1 ? 's' : ''} à ${DEFAULT_RPE}.`),
  );
}

function mixBlock(d: Dashboard): HTMLElement | false {
  if (d.kinds.length === 0) return false;
  const max = Math.max(...d.kinds.map((kind) => kind.count));
  const families = (Object.keys(FAMILY_LABELS) as Family[])
    .filter((family) => d.families[family] >= 0.005)
    .map((family) => `${FAMILY_LABELS[family]} ${percent(d.families[family])}`);
  return block(
    'Répartition',
    h(
      'ul',
      { class: 'hbars' },
      d.kinds.map((kind) =>
        h(
          'li',
          null,
          h('span', { class: 'hbar-label' }, kind.label),
          h('span', { class: 'hbar-track' }, h('span', { class: `hbar ${kind.sport ? 'sport' : ''}`, style: `width: ${Math.round((kind.count / max) * 100)}%` })),
          h('span', { class: 'hbar-count' }, kind.count),
        ),
      ),
    ),
    families.length > 0 && h('p', { class: 'dash-note' }, families.join(' · ')),
  );
}

function repeatedBlock(d: Dashboard): HTMLElement | false {
  // Les références ont leur propre bloc.
  const referenceKeys = new Set(references().map((reference) => workKey(reference.saved.wod)));
  const repeated = d.repeated.filter((item) => !referenceKeys.has(workKey(item.last.wod)));
  if (repeated.length === 0) return false;
  return block(
    'Tes WOD refaits',
    h(
      'ul',
      { class: 'repeats' },
      repeated.map((item) => {
        const href = item.wodId && findWod(item.wodId) ? `#/wod/${item.wodId}` : `#/history/${item.last.id}`;
        const trend = item.trend > 0 ? '▲' : item.trend < 0 ? '▼' : '=';
        return h(
          'li',
          null,
          h(
            'a',
            { class: 'repeat', href },
            h('span', { class: 'repeat-title' }, item.title),
            h('span', { class: 'spark', 'aria-hidden': 'true' }, item.spark.map((v) => h('span', { style: `height: ${Math.round(15 + v * 85)}%` }))),
            h('span', { class: `trend ${item.trend > 0 ? 'up' : item.trend < 0 ? 'down' : ''}`, 'aria-label': item.trend > 0 ? 'en progrès' : item.trend < 0 ? 'en recul' : 'stable' }, trend),
            h('span', { class: 'repeat-scores' }, `${scoreLine(item.first.wod, item.first.score)} → ${scoreLine(item.last.wod, item.last.score)}`),
            h(
              'span',
              { class: 'repeat-meta' },
              `${item.count} fois`,
              item.record && ` · record le ${shortDate(item.record.date)}`,
            ),
          ),
        );
      }),
    ),
  );
}

function hyroxBlock(d: Dashboard): HTMLElement | false {
  const { hyrox } = d;
  if (!hyrox) return false;
  const diff = hyrox.runPace !== undefined && hyrox.previousRunPace !== undefined ? Math.round(hyrox.runPace - hyrox.previousRunPace) : undefined;
  return block(
    'Hyrox',
    hyrox.runPace !== undefined && h('p', null, 'Course : ', h('strong', null, `${clock(Math.round(hyrox.runPace))} /km`), ' en moyenne'),
    hyrox.previousRunPace !== undefined &&
      h(
        'p',
        { class: 'dash-note' },
        `Période d’avant : ${clock(Math.round(hyrox.previousRunPace))} /km`,
        diff !== undefined && diff !== 0 && h('span', { class: `delta ${diff < 0 ? 'better' : 'worse'}` }, `${diff < 0 ? '−' : '+'}${Math.abs(diff)} s`),
      ),
    hyrox.slowest && h('p', null, 'Station la plus longue : ', h('strong', null, hyrox.slowest.name), ` (${clock(Math.round(hyrox.slowest.sec))} en moyenne)`),
  );
}

function sportsBlock(d: Dashboard): HTMLElement | false {
  if (d.sports.length === 0) return false;
  return block(
    'Autres sports',
    h(
      'ul',
      { class: 'sport-lines' },
      d.sports.map((entry) => {
        const { pace } = SPORT_INFO[entry.sport];
        const parts = [
          plural(entry.count, 'séance'),
          entry.distanceM > 0 && distanceText(entry.distanceM, entry.sport),
          duration(entry.durationSec),
          pace && entry.withDistance.m > 0 && pace(entry.withDistance.sec, entry.withDistance.m),
        ].filter(Boolean);
        return h('li', null, h('strong', null, entry.label), h('span', null, parts.join(' · ')));
      }),
    ),
  );
}

function recordsBlock(d: Dashboard): HTMLElement | false {
  if (d.records.length === 0) return false;
  return block(
    'Records de la période',
    h(
      'ul',
      { class: 'record-lines' },
      d.records.map((result) =>
        h(
          'li',
          null,
          h('a', { href: `#/history/${result.id}` }, h('strong', null, result.wod.title), ` ${scoreLine(result.wod, result.score)} · ${shortDate(result.date)}`),
        ),
      ),
    ),
  );
}

/** Résumé du tableau de bord envoyé au coach. */
function summary(d: Dashboard, since: string): string {
  const lines = [`Analyse ma progression sur ${since} (depuis le ${dateLabel(d.from)}) :`];
  const { week } = d;
  const planned = week.planned > 0 ? ` (${week.plannedDone} sur ${week.planned} ${week.planned > 1 ? 'prévues' : 'prévue'})` : '';
  const rpe = week.rpe === undefined ? '' : `, RPE moyen ${decimal(week.rpe, 1)}`;
  lines.push(`- Cette semaine : ${plural(week.sessions, 'séance')}${planned}, ${duration(week.effortSec)} d’effort${rpe}. Série : ${plural(week.streak, 'semaine')} à ${STREAK_MIN} séances ou plus.`);
  if (d.loadChange !== undefined) lines.push(`- Charge des 7 derniers jours : ${changeText(d.loadChange)} ma moyenne des 4 semaines d’avant.`);
  if (d.kinds.length > 0) {
    const families = (Object.keys(FAMILY_LABELS) as Family[]).filter((f) => d.families[f] >= 0.005).map((f) => `${FAMILY_LABELS[f].toLowerCase()} ${percent(d.families[f])}`);
    lines.push(`- Répartition : ${d.kinds.map((kind) => `${kind.label} ${kind.count}`).join(', ')} ; ${families.join(', ')}.`);
  }
  if (d.repeated.length > 0) {
    lines.push(`- WOD refaits : ${d.repeated.map((item) => `${item.title} ${scoreLine(item.first.wod, item.first.score)} → ${scoreLine(item.last.wod, item.last.score)} (${item.count} fois)`).join(' ; ')}.`);
  }
  const refs = referencesSummary();
  if (refs) lines.push(refs);
  if (d.hyrox?.runPace !== undefined) {
    const before = d.hyrox.previousRunPace === undefined ? '' : ` (${clock(Math.round(d.hyrox.previousRunPace))} /km la période d’avant)`;
    const station = d.hyrox.slowest ? `, station la plus longue : ${d.hyrox.slowest.name}` : '';
    lines.push(`- Hyrox : course à ${clock(Math.round(d.hyrox.runPace))} /km${before}${station}.`);
  }
  if (d.sports.length > 0) {
    lines.push(`- Autres sports : ${d.sports.map((entry) => `${entry.label} ${plural(entry.count, 'séance')}${entry.distanceM > 0 ? `, ${distanceText(entry.distanceM, entry.sport)}` : ''}`).join(' ; ')}.`);
  }
  lines.push('Qu’est-ce qui progresse, qu’est-ce qui coince, et que me conseilles-tu pour les prochaines semaines ?');
  return lines.join('\n');
}

export function progressView(): View {
  const results = sortedResults();
  const activities = sortedActivities();
  const addButton = h('a', { class: 'btn primary block', href: '#/activity/new' }, '+ Ajouter une activité');
  const head = [
    pageHead('Progrès'),
    h('p', { class: 'lead' }, 'Course, vélo, natation… : ajoute tes autres séances pour tout suivre ici.'),
    addButton,
  ];
  if (results.length + activities.length === 0) {
    const el = h(
      'section',
      { class: 'page' },
      head,
      h('p', { class: 'empty' }, 'Rien à montrer pour l’instant : fais un WOD ou ajoute une activité, tes progrès apparaîtront ici.'),
    );
    return { el, tab: 'progress' };
  }

  const period = PERIODS.find((p) => p.weeks === weeks) ?? PERIODS[0];
  const d = dashboard({ results, activities, plan: getPlan(), today: today(), weeks, records: currentRecords() });
  const el = h(
    'section',
    { class: 'page' },
    head,
    h(
      'div',
      { class: 'segmented', role: 'group', 'aria-label': 'Période' },
      PERIODS.map((p) =>
        h(
          'button',
          {
            type: 'button',
            class: 'btn grow',
            'aria-pressed': String(p.weeks === weeks),
            onclick: () => {
              weeks = p.weeks;
              render();
            },
          },
          p.label,
        ),
      ),
    ),
    weekBlock(d),
    heatmapBlock(d),
    loadBlock(d),
    mixBlock(d),
    referencesBlock(),
    repeatedBlock(d),
    hyroxBlock(d),
    liftsBlock(),
    sportsBlock(d),
    recordsBlock(d),
    coachReady(loadCoach()) &&
      h('button', { class: 'btn block', onclick: () => openChat(summary(d, period?.since ?? '')) }, 'Demander l’analyse au coach'),
    h('a', { class: 'btn ghost block', href: '#/history' }, 'Toutes mes séances'),
  );
  return { el, tab: 'progress' };
}
