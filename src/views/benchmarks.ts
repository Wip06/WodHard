import { BENCHMARKS } from '../benchmarks';
import { h, toast } from '../dom';
import { movementText } from '../format';
import { workKey } from '../records';
import { REFERENCE_WEEKS } from '../references';
import type { View } from '../router';
import { addWod, getWods, setReference } from '../store';
import type { Movement, Wod } from '../types';
import { badges, pageHead } from './parts';

/** Les mouvements d'un WOD sur une ligne : « Thruster (43 kg) · Pull-up ». */
function movementsLine(wod: Wod): string {
  const movements: Movement[] =
    wod.type === 'amrap' || wod.type === 'for_time' ? wod.movements : wod.type === 'emom' ? wod.slots.flat() : wod.type === 'hyrox' ? wod.segments : [];
  return movements.map((movement) => movementText(movement)).join(' · ');
}

/** Le WOD déjà dans la bibliothèque, même modifié depuis (même entraînement). */
const inLibrary = (wod: Wod) => getWods().find((saved) => workKey(saved.wod) === workKey(wod));

function benchmarkCard(wod: Wod): HTMLElement {
  const action = h('div', { class: 'row' });
  const showAction = () => {
    const saved = inLibrary(wod);
    action.replaceChildren(
      saved
        ? h('a', { class: 'btn grow', href: `#/wod/${saved.id}` }, '✓ Dans tes WOD · Ouvrir')
        : h(
            'button',
            {
              class: 'btn primary grow',
              onclick: () => {
                const added = addWod(wod).saved;
                if (added.reference_weeks === undefined) setReference(added.id, REFERENCE_WEEKS);
                toast(`${wod.title} ajouté à tes WOD, à refaire toutes les ${REFERENCE_WEEKS} semaines`);
                // Seule cette carte change : la page ne remonte pas en haut.
                showAction();
              },
            },
            'Ajouter',
          ),
    );
  };
  showAction();
  return h(
    'li',
    { class: 'card' },
    h('span', { class: 'card-top' }, badges(wod)),
    h('strong', { class: 'card-title' }, wod.title),
    h('span', { class: 'card-sub' }, movementsLine(wod)),
    wod.description && h('span', { class: 'card-meta' }, wod.description),
    action,
  );
}

/** Bibliothèque de WOD : les classiques, à ajouter en un toucher. */
export function benchmarksView(): View {
  const el = h(
    'section',
    { class: 'page' },
    pageHead('Bibliothèque de WOD'),
    h(
      'p',
      { class: 'lead' },
      `Les grands classiques du CrossFit, à refaire toutes les ${REFERENCE_WEEKS} semaines pour mesurer ta progression. Les charges sont celles du Rx hommes ; celles des femmes sont en note.`,
    ),
    h('ul', { class: 'cards' }, BENCHMARKS.map(benchmarkCard)),
  );
  return { el, tab: 'menu' };
}
