import { unlockAudio } from '../audio';
import { choose, h, toast } from '../dom';
import { addDays, dateLabel, dayLabel, daysBetween, plural, scoreLine, today, wodHeadline, wodSummary } from '../format';
import { navigate, render, type View } from '../router';
import { agoText, canBeReference, type Reference } from '../references';
import { matchesQuery, searchText } from '../search';
import {
  addPlan,
  addProgram,
  addWod,
  backupStatus,
  currentRecords,
  deleteWod,
  findWod,
  getWods,
  pendingDates,
  planWods,
  previewPlanning,
  previewReschedule,
  removePlan,
  removePlanEntries,
  removeWods,
  reschedulePlan,
  references,
  resultsFor,
  sameWorkout,
  setSession,
  sortedResults,
  snoozeBackup,
  visiblePlan,
  type PlannedWod,
} from '../store';
import { newClock } from '../timer';
import type { SavedWod } from '../types';
import { isDate, parseImport, type Import } from '../validate';
import { exportData } from './data';
import { startBlock } from './blocks';
import { badges, field, pageHead, resultRow, typeBadge, wodSheet } from './parts';
import { goalLinks, sameWorkGoal } from './goals';
import { progressionChart, referenceChip, referenceSection } from './references';

const MAX_ERRORS = 12;

/** Recherche en cours sur l'écran WOD, conservée quand on revient d'une fiche. */
let query = '';
/** Section « Déjà faits » dépliée, conservée de la même façon. */
let doneOpen = false;

type Content = (HTMLElement | false)[];

function wodCardContent(saved: SavedWod): Content {
  const done = resultsFor(saved.id);
  const last = done[0];
  return [
    h(
      'span',
      { class: 'card-top' },
      badges(saved.wod),
      saved.reference_weeks !== undefined && canBeReference(saved) && referenceChip(),
      !!last && h('span', { class: 'chip rx' }, '✓ Fait'),
    ),
    h('strong', { class: 'card-title' }, saved.wod.title),
    h('span', { class: 'card-sub' }, wodSummary(saved.wod)),
    !!last &&
      h(
        'span',
        { class: 'card-meta' },
        `Fait ${done.length}× · dernier : ${scoreLine(last.wod, last.score)}, ${dateLabel(last.date)}`,
      ),
  ];
}

/** Objectifs en cours sur ce WOD, et de quoi en fixer un (sur un AMRAP, un For Time ou un Hyrox). */
function goalSection(saved: SavedWod): HTMLElement | false {
  const { wod } = saved;
  if (wod.type !== 'amrap' && wod.type !== 'for_time' && wod.type !== 'hyrox') return false;
  const goals = goalLinks(sameWorkGoal(wod));
  return h(
    'section',
    { class: 'stack' },
    h('h2', { class: 'section-title' }, 'Objectif'),
    goals,
    h('a', { class: `btn block ${goals ? 'ghost' : ''}`, href: `#/goal/new/wod:${saved.id}` }, goals ? 'Fixer un autre objectif' : 'Fixer un objectif sur ce WOD'),
  );
}

/** WOD de référence dont le délai est écoulé : quand il a été fait, et son record. */
function redoCardContent({ saved, last, best, results }: Reference): Content {
  return [
    h('span', { class: 'card-top' }, badges(saved.wod), h('span', { class: 'chip due' }, 'À refaire')),
    h('strong', { class: 'card-title' }, saved.wod.title),
    h('span', { class: 'card-sub' }, wodSummary(saved.wod)),
    !!last &&
      h(
        'span',
        { class: 'card-meta' },
        `Dernière fois ${agoText(last.date, today())} : ${scoreLine(last.wod, last.score)}`,
        best && results.length > 1 ? ` · record ${scoreLine(best.wod, best.score)}` : '',
      ),
  ];
}

function planState({ entry }: PlannedWod): string {
  const now = today();
  return entry.date === now ? 'today' : entry.date < now ? 'late' : '';
}

function planCardContent(row: PlannedWod): Content {
  const { entry, saved } = row;
  return [
    h(
      'span',
      { class: 'card-top' },
      h('span', { class: 'day' }, dayLabel(entry.date)),
      planState(row) === 'late' ? h('span', { class: 'chip late' }, 'En retard') : typeBadge(saved.wod),
    ),
    h('strong', { class: 'card-title' }, saved.wod.title),
    h('span', { class: 'card-sub' }, wodHeadline(saved.wod)),
  ];
}

const accord = (n: number, word: string) => `${word}${n > 1 ? 's' : ''}`;

/**
 * Demande comment reprogrammer : décaler de N jours, ou donner la nouvelle date de la première
 * séance. Renvoie le décalage en jours, ou null si l'utilisateur renonce.
 */
function askReschedule(count: number, earliest: string, suggested: string): Promise<number | null> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog' });
    const close = (value: number | null) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    let mode: 'shift' | 'date' = 'shift';
    const days = h('input', { type: 'number', inputmode: 'numeric', step: 1, value: 1, 'aria-label': 'Nombre de jours' });
    const start = h('input', { type: 'date', value: suggested, 'aria-label': 'Nouvelle date de la première séance' });
    const preview = h('p', { class: 'hint left' });
    const offset = () =>
      mode === 'shift' ? Number(days.value) : isDate(start.value) ? daysBetween(earliest, start.value) : NaN;
    const refresh = () => {
      const value = offset();
      preview.textContent = Number.isInteger(value)
        ? `Première séance : ${dayLabel(earliest)} → ${dayLabel(addDays(earliest, value))}`
        : 'Indique un nombre de jours entier ou une date.';
    };
    const shiftPanel = h(
      'div',
      { class: 'stack' },
      field('Décaler de', days, 'jours'),
      h(
        'div',
        { class: 'presets' },
        [-1, 1, 7].map((step) =>
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onclick: () => {
                days.value = String(step);
                refresh();
              },
            },
            step > 0 ? `+${step} j` : `${step} j`,
          ),
        ),
      ),
    );
    const datePanel = h('div', { class: 'stack', hidden: true }, field('Première séance le', start));
    const modes = (['shift', 'date'] as const).map((option) =>
      h(
        'button',
        {
          type: 'button',
          class: 'btn grow',
          'aria-pressed': String(option === mode),
          onclick: () => {
            mode = option;
            modes.forEach((button, i) => button.setAttribute('aria-pressed', String((i === 0) === (mode === 'shift'))));
            shiftPanel.hidden = mode !== 'shift';
            datePanel.hidden = mode !== 'date';
            refresh();
          },
        },
        option === 'shift' ? 'Décaler' : 'Nouvelle date',
      ),
    );
    days.addEventListener('input', refresh);
    start.addEventListener('input', refresh);
    dialog.append(
      h('h2', null, `Reprogrammer ${plural(count, 'séance')}`),
      h('p', null, 'Les écarts entre les séances sont conservés. Les séances déjà faites ne bougent pas.'),
      h('div', { class: 'segmented' }, modes),
      shiftPanel,
      datePanel,
      preview,
      h(
        'div',
        { class: 'dialog-actions' },
        h(
          'button',
          {
            class: 'btn block primary',
            onclick: () => {
              const value = offset();
              if (Number.isInteger(value)) close(value);
            },
          },
          'Reprogrammer',
        ),
        h('button', { class: 'btn block', onclick: () => close(null) }, 'Annuler'),
      ),
    );
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(null);
    });
    refresh();
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Demande où placer des WOD sans date : date du premier, puis un WOD tous les N jours. */
function askPlanning(count: number): Promise<{ start: string; every: number } | null> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog' });
    const close = (value: { start: string; every: number } | null) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const start = h('input', { type: 'date', value: addDays(today(), 1), 'aria-label': 'Date du premier WOD' });
    const every = h('input', { type: 'number', inputmode: 'numeric', min: 1, step: 1, value: 1, 'aria-label': 'Espacement en jours' });
    const preview = h('p', { class: 'hint left' });
    const read = () => {
      const days = Number(every.value);
      return isDate(start.value) && Number.isInteger(days) && days >= 1 ? { start: start.value, every: days } : null;
    };
    const refresh = () => {
      const choice = read();
      if (!choice) {
        preview.textContent = 'Choisis une date et un espacement d’au moins 1 jour.';
        return;
      }
      const dates = Array.from({ length: Math.min(count, 3) }, (_, i) => dateLabel(addDays(choice.start, i * choice.every)));
      preview.textContent = `Dates : ${dates.join(', ')}${count > 3 ? '…' : ''}`;
    };
    start.addEventListener('input', refresh);
    every.addEventListener('input', refresh);
    dialog.append(
      h('h2', null, `Planifier ${count} WOD`),
      h('p', null, 'Ils sont placés dans l’ordre de la liste, à partir de la date choisie.'),
      field('Premier WOD le', start),
      field('Un WOD tous les', every, 'jours'),
      h(
        'div',
        { class: 'presets' },
        [
          { label: 'Tous les jours', days: 1 },
          { label: 'Un jour sur deux', days: 2 },
          { label: 'Tous les 3 jours', days: 3 },
        ].map(({ label, days }) =>
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onclick: () => {
                every.value = String(days);
                refresh();
              },
            },
            label,
          ),
        ),
      ),
      preview,
      h(
        'div',
        { class: 'dialog-actions' },
        h(
          'button',
          {
            class: 'btn block primary',
            onclick: () => {
              const choice = read();
              if (choice) close(choice);
            },
          },
          'Planifier',
        ),
        h('button', { class: 'btn block', onclick: () => close(null) }, 'Annuler'),
      ),
    );
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(null);
    });
    refresh();
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function wodListView(): View {
  // L'écran WOD montre ce qui reste à faire : une séance faite quitte le programme pour l'historique,
  // et les WOD déjà faits descendent dans « Déjà faits », du plus récemment fait au plus ancien.
  const plan = visiblePlan().filter((row) => !row.done);
  const planned = new Set(plan.map((row) => row.saved.id));
  const library = [...getWods()].reverse().filter((saved) => !planned.has(saved.id));
  // Rang de la dernière séance de chaque WOD, de la plus récente à la plus ancienne.
  const recency = new Map<string, number>();
  sortedResults().forEach((result, rank) => {
    if (result.wod_id !== undefined && !recency.has(result.wod_id)) recency.set(result.wod_id, rank);
  });
  const others = library.filter((saved) => !recency.has(saved.id));
  // Références dont le délai est écoulé : elles remontent de « Déjà faits » à « À refaire ».
  const toRedo = references().filter((reference) => reference.due && !planned.has(reference.saved.id) && recency.has(reference.saved.id));
  const redoIds = new Set(toRedo.map((reference) => reference.saved.id));
  const finished = library
    .filter((saved) => recency.has(saved.id) && !redoIds.has(saved.id))
    .sort((a, b) => (recency.get(a.id) ?? 0) - (recency.get(b.id) ?? 0));
  const backup = backupStatus();
  const index = new Map(getWods().map((saved) => [saved.id, searchText(saved.wod)]));

  // Mode sélection : séances du programme (« plan:id ») et WOD de la bibliothèque (« wod:id »).
  let selecting = false;
  const selected = new Set<string>();
  let visibleKeys: string[] = [];
  const entryIds = () => [...selected].filter((key) => key.startsWith('plan:')).map((key) => key.slice(5));
  /** WOD sélectionnés hors du programme, sans date à venir, dans l'ordre de la liste. */
  const unplannedIds = () =>
    [...toRedo.map((reference) => reference.saved), ...others, ...finished].filter((saved) => selected.has(`wod:${saved.id}`)).map((saved) => saved.id);
  const wodIds = () => {
    const ids = new Set([...selected].filter((key) => key.startsWith('wod:')).map((key) => key.slice(4)));
    for (const id of entryIds()) {
      const row = plan.find((candidate) => candidate.entry.id === id);
      if (row) ids.add(row.saved.id);
    }
    return [...ids];
  };

  const search = h('input', {
    type: 'search',
    placeholder: 'Rechercher : nom, mouvement, type…',
    autocomplete: 'off',
    enterkeyhint: 'search',
    'aria-label': 'Rechercher un WOD',
  });
  search.value = query;
  search.addEventListener('input', () => {
    query = search.value;
    renderLists();
  });
  const lists = h('div');

  const countEl = h('strong', { class: 'select-count' });
  const allBtn = h('button', { class: 'btn ghost', onclick: () => toggleAll() });
  const rescheduleBtn = h('button', { class: 'btn grow', onclick: () => void reschedule() }, 'Reprogrammer');
  const unplanBtn = h('button', { class: 'btn grow', onclick: unplanSelected }, 'Retirer du programme');
  const deleteBtn = h('button', { class: 'btn block danger', onclick: () => void deleteSelected() }, 'Supprimer de la bibliothèque');
  const bar = h(
    'div',
    { class: 'select-bar', hidden: true },
    h('div', { class: 'select-head' }, countEl, allBtn),
    h('div', { class: 'select-actions' }, rescheduleBtn, unplanBtn),
    deleteBtn,
  );
  const selectBtn = h('button', { class: 'btn select-toggle', onclick: () => setSelecting(!selecting) }, 'Sélectionner');

  function refreshBar(): void {
    countEl.textContent = selected.size === 0 ? 'Aucun WOD sélectionné' : `${selected.size} ${accord(selected.size, 'sélectionné')}`;
    const allChosen = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
    allBtn.textContent = allChosen ? 'Tout désélectionner' : 'Tout sélectionner';
    // Des WOD sans date se planifient ; des séances du programme se reprogramment.
    rescheduleBtn.textContent = unplannedIds().length > 0 ? 'Planifier' : 'Reprogrammer';
    rescheduleBtn.disabled = selected.size === 0;
    unplanBtn.disabled = entryIds().length === 0;
    deleteBtn.disabled = wodIds().length === 0;
  }

  function setSelecting(value: boolean): void {
    selecting = value;
    selected.clear();
    selectBtn.textContent = selecting ? 'Terminé' : 'Sélectionner';
    bar.hidden = !selecting;
    el.classList.toggle('selecting', selecting);
    renderLists();
  }

  function toggleAll(): void {
    const allChosen = visibleKeys.every((key) => selected.has(key));
    for (const key of visibleKeys) {
      if (allChosen) selected.delete(key);
      else selected.add(key);
    }
    renderLists();
  }

  /** Carte cliquable vers la fiche, ou case à cocher en mode sélection. */
  function card(key: string, href: string, extraClass: string, content: Content): HTMLElement {
    if (!selecting) return h('li', null, h('a', { class: `card ${extraClass}`, href }, content));
    const box = h('input', { type: 'checkbox', checked: selected.has(key), 'aria-label': 'Sélectionner' });
    box.addEventListener('change', () => {
      if (box.checked) selected.add(key);
      else selected.delete(key);
      refreshBar();
    });
    return h('li', null, h('label', { class: `card selectable ${extraClass}` }, box, h('span', { class: 'card-body' }, content)));
  }

  function renderLists(): void {
    const found = (id: string) => matchesQuery(query, index.get(id) ?? '');
    const planFound = plan.filter((row) => found(row.saved.id));
    const redoFound = toRedo.filter((reference) => found(reference.saved.id));
    const othersFound = others.filter((saved) => found(saved.id));
    const finishedFound = finished.filter((saved) => found(saved.id));
    // Une recherche déplie « Déjà faits » pour montrer tout ce qui correspond.
    const searching = query.trim() !== '';
    let shown = doneOpen || searching;
    const openKeys = [
      ...planFound.map((row) => `plan:${row.entry.id}`),
      ...redoFound.map((reference) => `wod:${reference.saved.id}`),
      ...othersFound.map((saved) => `wod:${saved.id}`),
    ];
    const doneKeys = finishedFound.map((saved) => `wod:${saved.id}`);
    visibleKeys = shown ? [...openKeys, ...doneKeys] : openKeys;

    const doneSection = h(
      'details',
      { class: 'done-section', open: shown },
      h('summary', { class: 'section-title' }, `Déjà faits (${finishedFound.length})`),
      h(
        'ul',
        { class: 'cards' },
        finishedFound.map((saved) => card(`wod:${saved.id}`, `#/wod/${saved.id}`, 'done', wodCardContent(saved))),
      ),
    );
    doneSection.addEventListener('toggle', () => {
      if (doneSection.open === shown) return;
      shown = doneSection.open;
      if (!searching) doneOpen = shown;
      // « Tout sélectionner » ne prend que les WOD visibles.
      visibleKeys = shown ? [...openKeys, ...doneKeys] : openKeys;
      refreshBar();
    });

    lists.replaceChildren(
      h(
        'div',
        { class: 'sections' },
        planFound.length > 0 && [
          h('h2', { class: 'section-title' }, 'Programme'),
          h(
            'ul',
            { class: 'cards' },
            planFound.map((row) =>
              card(`plan:${row.entry.id}`, `#/wod/${row.saved.id}`, `planned ${planState(row)}`, planCardContent(row)),
            ),
          ),
        ],
        redoFound.length > 0 && [
          h('h2', { class: 'section-title' }, 'À refaire'),
          h(
            'ul',
            { class: 'cards' },
            redoFound.map((reference) => card(`wod:${reference.saved.id}`, `#/wod/${reference.saved.id}`, 'due', redoCardContent(reference))),
          ),
        ],
        othersFound.length > 0 && [
          h('h2', { class: 'section-title' }, 'À faire'),
          h(
            'ul',
            { class: 'cards' },
            othersFound.map((saved) => card(`wod:${saved.id}`, `#/wod/${saved.id}`, '', wodCardContent(saved))),
          ),
        ],
        !searching &&
          planFound.length + redoFound.length + othersFound.length === 0 &&
          h('p', { class: 'empty' }, 'Tout est fait ! Demande un nouveau WOD au coach, ou refais un WOD déjà fait.'),
        finishedFound.length > 0 && doneSection,
        searching && planFound.length + redoFound.length + othersFound.length + finishedFound.length === 0 && [
          h('p', { class: 'empty' }, `Aucun WOD ne correspond à « ${query.trim()} ».`),
          h(
            'button',
            {
              class: 'btn block',
              onclick: () => {
                query = search.value = '';
                renderLists();
              },
            },
            'Effacer la recherche',
          ),
        ],
      ),
    );
    refreshBar();
  }

  /** Après une action groupée : on quitte la sélection et on propose d'annuler. */
  function done(message: string, undo: () => void): void {
    render();
    toast(message, {
      label: 'Annuler',
      run: () => {
        undo();
        render();
      },
    });
  }

  async function reschedule(): Promise<void> {
    const unplanned = unplannedIds();
    if (unplanned.length > 0) return planSelected(unplanned);
    const ids = entryIds();
    const earliest = pendingDates(ids)[0];
    if (!earliest) return toast('Ces séances sont déjà faites : elles restent à leur date.');
    const preview = previewReschedule(ids, 0);
    // Pour une séance en retard, la nouvelle date proposée est aujourd'hui plutôt que l'ancienne.
    const suggested = earliest < today() ? today() : earliest;
    const offset = await askReschedule(preview.moved, earliest, suggested);
    if (offset === null) return;
    if (offset === 0) return toast('La date ne change pas : rien n’a été reprogrammé.');
    const { moved, skippedDone, conflicts } = previewReschedule(ids, offset);
    if (conflicts.length > 0) {
      const confirmed = await choose(
        conflicts.length > 1 ? 'Des jours sont déjà pris' : 'Un jour est déjà pris',
        `Une autre séance est déjà prévue le ${conflicts.map(dateLabel).join(', ')}. Reprogrammer quand même ?`,
        [
          { label: 'Reprogrammer quand même', value: true, kind: 'primary' },
          { label: 'Annuler', value: false },
        ],
      );
      if (!confirmed) return;
    }
    const undo = reschedulePlan(ids, offset);
    const kept = skippedDone > 0 ? ` (${plural(skippedDone, 'séance faite')} non déplacée${skippedDone > 1 ? 's' : ''})` : '';
    done(`${plural(moved, 'séance')} ${accord(moved, 'reprogrammée')}${kept}`, undo);
  }

  async function planSelected(ids: string[]): Promise<void> {
    const choice = await askPlanning(ids.length);
    if (!choice) return;
    const conflicts = previewPlanning(ids, choice.start, choice.every);
    if (conflicts.length > 0) {
      const confirmed = await choose(
        conflicts.length > 1 ? 'Des jours sont déjà pris' : 'Un jour est déjà pris',
        `Une autre séance est déjà prévue le ${conflicts.map(dateLabel).join(', ')}. Planifier quand même ?`,
        [
          { label: 'Planifier quand même', value: true, kind: 'primary' },
          { label: 'Annuler', value: false },
        ],
      );
      if (!confirmed) return;
    }
    const undo = planWods(ids, choice.start, choice.every);
    const untouched = entryIds().length > 0 ? ' (les séances déjà au programme n’ont pas bougé)' : '';
    done(`${ids.length} WOD ${accord(ids.length, 'planifié')}${untouched}`, undo);
  }

  function unplanSelected(): void {
    const ids = entryIds();
    if (ids.length === 0) return;
    const undo = removePlanEntries(ids);
    done(`${plural(ids.length, 'séance')} ${accord(ids.length, 'retirée')} du programme`, undo);
  }

  async function deleteSelected(): Promise<void> {
    const ids = wodIds();
    if (ids.length === 0) return;
    const confirmed = await choose(
      `Supprimer ${ids.length} WOD de la bibliothèque ?`,
      'Ils sont aussi retirés du programme. Les séances déjà faites sont conservées dans Données › Toutes mes séances.',
      [
        { label: 'Supprimer', value: true, kind: 'danger' },
        { label: 'Annuler', value: false },
      ],
    );
    if (!confirmed) return;
    const undo = removeWods(ids);
    // « WOD » reste invariable : « 3 WOD supprimés ».
    done(`${ids.length} WOD ${accord(ids.length, 'supprimé')}`, undo);
  }

  const el = h(
    'section',
    { class: 'page' },
    h('header', { class: 'brand' }, h('h1', null, 'WOD', h('span', null, 'HARD'))),
    h('a', { class: 'btn primary block', href: '#/ask' }, 'Demander au coach'),
    h(
      'div',
      { class: 'row' },
      h('a', { class: 'btn grow', href: '#/add' }, 'Coller un WOD'),
      h('a', { class: 'btn grow', href: '#/edit' }, 'Créer un WOD'),
    ),
    backup.due &&
      h(
        'div',
        { class: 'notice' },
        h(
          'p',
          null,
          `${plural(backup.unsaved, 'séance')} ${backup.unsaved > 1 ? 'ne sont' : 'n’est'} dans aucune sauvegarde. `,
          'Tes données n’existent que sur cet appareil.',
        ),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn primary grow', onclick: () => void exportData() }, 'Exporter'),
          h(
            'button',
            {
              class: 'btn grow',
              onclick: () => {
                snoozeBackup();
                render();
              },
            },
            'Plus tard',
          ),
        ),
      ),
    getWods().length > 0
      ? [h('div', { class: 'row' }, search, selectBtn), lists, bar]
      : h(
          'p',
          { class: 'empty' },
          'Aucun WOD pour l’instant. Demande-en un au coach ou colle sa réponse, ou crée-le à la main.',
        ),
  );
  renderLists();
  return { el, tab: 'wods' };
}

/** Enregistre un WOD ou un programme déjà validé, puis ouvre ce qui vient d'être ajouté. */
export function saveImport(value: Import): void {
  if (value.kind === 'wod') {
    const { saved, duplicate } = addWod(value.wod);
    toast(duplicate ? 'Ce WOD était déjà enregistré' : 'WOD enregistré');
    return navigate(`/wod/${saved.id}`, true);
  }
  const { added, planned } = addProgram(value.items);
  toast(`${plural(added, 'WOD ajouté')}, ${planned} au programme`);
  navigate('/', true);
}

export function addWodView(): View {
  const input = h('textarea', {
    class: 'json-input',
    rows: 12,
    placeholder: '{ "schema_version": 1, "type": "amrap", … }',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    'aria-label': 'JSON du WOD ou du programme',
  });
  const errorBox = h('div', { class: 'errors', role: 'alert', hidden: true });

  const showErrors = (errors: string[]) => {
    const extra = errors.length - MAX_ERRORS;
    errorBox.replaceChildren(
      h('strong', null, 'Ce JSON n’est pas valide :'),
      h(
        'ul',
        null,
        errors.slice(0, MAX_ERRORS).map((error) => h('li', null, error)),
        extra > 0 && h('li', null, `… et ${extra} autres erreurs`),
      ),
    );
    errorBox.hidden = false;
  };

  const submit = () => {
    if (input.value.trim() === '') return showErrors(['Colle d’abord le JSON du WOD ou du programme.']);
    const checked = parseImport(input.value);
    if (!checked.ok) return showErrors(checked.errors);
    saveImport(checked.value);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim() === '') return toast('Le presse-papiers est vide');
      input.value = text;
      submit();
    } catch {
      toast('Presse-papiers inaccessible : colle le JSON dans la zone de texte');
      input.focus();
    }
  };

  const el = h(
    'section',
    { class: 'page' },
    pageHead('Nouveau WOD', { href: '#/', label: 'WOD' }),
    h(
      'p',
      { class: 'lead' },
      'Copie le JSON généré par ton projet Claude, puis colle-le ici : un WOD seul ou un programme de plusieurs WOD.',
    ),
    h('button', { class: 'btn primary block', onclick: paste }, 'Coller depuis le presse-papiers'),
    input,
    errorBox,
    h('button', { class: 'btn block', onclick: submit }, 'Valider et enregistrer'),
  );
  return { el, tab: 'wods' };
}

export function wodDetailView(id: string): View | null {
  const saved = findWod(id);
  if (!saved) return null;
  const { wod } = saved;
  const past = resultsFor(id);
  const records = currentRecords();
  const pending = visiblePlan().filter((row) => row.saved.id === id && !row.done);

  const start = () => {
    // Une séance en blocs démarre par son premier bloc ; le chrono enchaînera les suivants.
    if (wod.type === 'session') return startBlock(id, { wod, index: 0, runs: [] });
    unlockAudio();
    setSession({ stage: 'timer', wod, wod_id: id, clock: newClock(Date.now()), rounds: 0, marks: [] });
    navigate('/timer');
  };

  const scoreWithoutTimer = () => {
    setSession({ stage: 'score', wod, wod_id: id, rounds: 0, marks: [], completed: false });
    navigate('/score');
  };

  const planDate = h('input', { type: 'date', value: today(), 'aria-label': 'Date prévue' });
  const plan = () => {
    if (!isDate(planDate.value)) return toast('Choisis une date');
    toast(addPlan(id, planDate.value) ? `Planifié : ${dayLabel(planDate.value)}` : 'Déjà prévu ce jour-là');
    render();
  };
  const unplan = (entryId: string) => {
    removePlan(entryId);
    render();
  };

  const remove = async () => {
    const message =
      past.length > 0
        ? past.length > 1
          ? `Les ${past.length} séances déjà faites sont conservées dans Données › Toutes mes séances.`
          : 'La séance déjà faite est conservée dans Données › Toutes mes séances.'
        : 'Ce WOD n’a pas encore été fait.';
    const confirmed = await choose(`Supprimer « ${wod.title} » ?`, message, [
      { label: 'Supprimer', value: true, kind: 'danger' },
      { label: 'Annuler', value: false },
    ]);
    if (!confirmed) return;
    deleteWod(id);
    toast('WOD supprimé');
    navigate('/', true);
  };

  const el = h(
    'section',
    { class: 'page' },
    pageHead('', { href: '#/', label: 'WOD' }),
    wodSheet(wod),
    h(
      'div',
      { class: 'stack' },
      h('button', { class: 'btn primary big block', onclick: start }, 'Lancer le chrono'),
      h('p', { class: 'hint' }, 'Départ après un décompte de 10 secondes.'),
      h('button', { class: 'btn block', onclick: scoreWithoutTimer }, 'Saisir un score sans chrono'),
    ),
    h(
      'section',
      { class: 'stack' },
      h('h2', { class: 'section-title' }, 'Programme'),
      pending.map(({ entry }) =>
        h(
          'div',
          { class: 'plan-line' },
          h('span', null, `Prévu : ${dayLabel(entry.date)}`),
          h('button', { class: 'btn ghost', onclick: () => unplan(entry.id) }, 'Retirer'),
        ),
      ),
      h('div', { class: 'row' }, planDate, h('button', { class: 'btn', onclick: plan }, 'Planifier')),
    ),
    referenceSection(saved, render),
    goalSection(saved),
    past.length > 0 &&
      h(
        'section',
        { class: 'stack' },
        h('h2', { class: 'section-title' }, 'Mes résultats'),
        // Toutes les séances du même entraînement, y compris d'une copie de ce WOD.
        progressionChart(sameWorkout(wod)),
        h(
          'ul',
          { class: 'cards' },
          past.map((result) => resultRow(result, false, records.has(result.id))),
        ),
      ),
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'row' },
        h('a', { class: 'btn grow', href: `#/edit/${id}` }, 'Modifier'),
        h('a', { class: 'btn grow', href: `#/copy/${id}` }, 'Dupliquer'),
      ),
      h('button', { class: 'btn ghost danger block', onclick: () => void remove() }, 'Supprimer ce WOD'),
    ),
  );
  return { el, tab: 'wods' };
}
