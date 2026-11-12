import { achievements, milestones, type Achievement, type AchievementGroup, type MilestoneScope } from '../achievements';
import { h } from '../dom';
import { today } from '../format';
import type { View } from '../router';
import { sortedActivities, sortedResults } from '../store';
import { goalsBlock } from './goals';
import { pageHead } from './parts';

/** Période des jalons, gardée le temps de la session. */
let milestoneScope: MilestoneScope = 'year';
const SCOPES: { scope: MilestoneScope; label: string }[] = [
  { scope: 'year', label: 'Cette année' },
  { scope: 'all', label: 'Depuis le début' },
];

/** « 10 nov. 2026 » : un record peut dater d'une autre année. */
const recordDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

function trophy(item: Achievement): HTMLElement {
  const content: (HTMLElement | false)[] = [
    h('span', { class: 'trophy-label' }, item.label, item.isNew ? h('span', { class: 'trophy-new' }, 'Nouveau') : false),
    h('strong', { class: 'trophy-value' }, item.value),
    item.detail ? h('span', { class: 'trophy-detail' }, item.detail) : false,
    item.date ? h('span', { class: 'trophy-date' }, recordDate(item.date)) : false,
  ];
  return h('li', null, item.href ? h('a', { class: 'trophy', href: item.href }, content) : h('div', { class: 'trophy' }, content));
}

const trophies = (group: AchievementGroup) => h('ul', { class: 'trophies' }, group.items.map(trophy));

/** Jalons, avec le choix de la période ; seul ce bloc est redessiné quand elle change. */
function milestonesBlock(input: Parameters<typeof milestones>[0]): HTMLElement {
  const block = h('section', { class: 'dash-block' });
  const draw = () => {
    const group = milestones(input, milestoneScope);
    block.replaceChildren(
      h('h2', { class: 'dash-title' }, 'Jalons'),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Période des jalons' },
        SCOPES.map(({ scope, label }) =>
          h(
            'button',
            {
              type: 'button',
              class: 'btn grow',
              'aria-pressed': String(scope === milestoneScope),
              onclick: () => {
                milestoneScope = scope;
                draw();
              },
            },
            label,
          ),
        ),
      ),
      group ? trophies(group) : h('p', { class: 'dash-note' }, 'Rien encore sur cette période.'),
    );
  };
  draw();
  return block;
}

/** Exploits : les objectifs, les records par thème (course, vélo, Hyrox, charges, WOD…), puis les jalons. */
export function achievementsView(): View {
  const input = { results: sortedResults(), activities: sortedActivities(), today: today() };
  const groups = achievements(input);
  const el = h(
    'section',
    { class: 'page' },
    pageHead('Exploits'),
    goalsBlock(),
    groups.length === 0
      ? h('p', { class: 'empty' }, 'Pas encore de record : fais un WOD ou ajoute une activité dans Suivi, tes records apparaîtront ici.')
      : groups.map((group) => h('section', { class: 'dash-block' }, h('h2', { class: 'dash-title' }, group.title), trophies(group))),
    groups.length > 0 && milestonesBlock(input),
  );
  return { el, tab: 'menu' };
}
