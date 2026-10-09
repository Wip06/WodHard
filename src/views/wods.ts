import { unlockAudio } from '../audio';
import { choose, h, toast } from '../dom';
import { dateLabel, dayLabel, plural, scoreLine, today, wodSummary } from '../format';
import { navigate, render, type View } from '../router';
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
  removePlan,
  resultsFor,
  setSession,
  snoozeBackup,
  visiblePlan,
  type PlannedWod,
} from '../store';
import { newClock } from '../timer';
import type { SavedWod } from '../types';
import { isDate, parseImport } from '../validate';
import { exportData } from './data';
import { pageHead, resultRow, typeBadge, wodSheet } from './parts';

const MAX_ERRORS = 12;

/** Recherche en cours sur l'écran WOD, conservée quand on revient d'une fiche. */
let query = '';

function wodCard(saved: SavedWod): HTMLElement {
  const done = resultsFor(saved.id);
  const last = done[0];
  return h(
    'li',
    null,
    h(
      'a',
      { class: 'card', href: `#/wod/${saved.id}` },
      h('span', { class: 'card-top' }, typeBadge(saved.wod), !last && h('span', { class: 'chip todo' }, 'À faire')),
      h('strong', { class: 'card-title' }, saved.wod.title),
      h('span', { class: 'card-sub' }, wodSummary(saved.wod)),
      last &&
        h(
          'span',
          { class: 'card-meta' },
          `Fait ${done.length}× · dernier : ${scoreLine(last.wod, last.score)}, ${dateLabel(last.date)}`,
        ),
    ),
  );
}

function planCard({ entry, saved, done }: PlannedWod): HTMLElement {
  const now = today();
  const state = done ? 'done' : entry.date === now ? 'today' : entry.date < now ? 'late' : '';
  return h(
    'li',
    null,
    h(
      'a',
      { class: `card planned ${state}`, href: `#/wod/${saved.id}` },
      h(
        'span',
        { class: 'card-top' },
        h('span', { class: 'day' }, dayLabel(entry.date)),
        done
          ? h('span', { class: 'chip rx' }, '✓ Fait')
          : state === 'late'
            ? h('span', { class: 'chip late' }, 'En retard')
            : typeBadge(saved.wod),
      ),
      h('strong', { class: 'card-title' }, saved.wod.title),
      h('span', { class: 'card-sub' }, done ? scoreLine(done.wod, done.score) : wodSummary(saved.wod)),
    ),
  );
}

export function wodListView(): View {
  const plan = visiblePlan();
  const planned = new Set(plan.map((row) => row.saved.id));
  const others = [...getWods()].reverse().filter((saved) => !planned.has(saved.id));
  const backup = backupStatus();
  const index = new Map(getWods().map((saved) => [saved.id, searchText(saved.wod)]));

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

  function renderLists(): void {
    const found = (id: string) => matchesQuery(query, index.get(id) ?? '');
    const planFound = plan.filter((row) => found(row.saved.id));
    const othersFound = others.filter((saved) => found(saved.id));
    lists.replaceChildren(
      h(
        'div',
        { class: 'sections' },
        planFound.length > 0 && [
          h('h2', { class: 'section-title' }, 'Programme'),
          h('ul', { class: 'cards' }, planFound.map(planCard)),
        ],
        planFound.length > 0 && othersFound.length > 0 && h('h2', { class: 'section-title' }, 'Autres WOD'),
        othersFound.length > 0 && h('ul', { class: 'cards' }, othersFound.map(wodCard)),
        planFound.length + othersFound.length === 0 && [
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
  }
  renderLists();

  const el = h(
    'section',
    { class: 'page' },
    h('header', { class: 'brand' }, h('h1', null, 'WOD', h('span', null, 'HARD'))),
    h('a', { class: 'btn primary block', href: '#/ask' }, 'Demander à Claude'),
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
      ? [search, lists]
      : h(
          'p',
          { class: 'empty' },
          'Aucun WOD pour l’instant. Demande-en un à Claude puis colle sa réponse, ou crée-le à la main.',
        ),
  );
  return { el, tab: 'wods' };
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

    if (checked.value.kind === 'wod') {
      const { saved, duplicate } = addWod(checked.value.wod);
      toast(duplicate ? 'Ce WOD était déjà enregistré' : 'WOD enregistré');
      return navigate(`/wod/${saved.id}`, true);
    }
    const { added, planned } = addProgram(checked.value.items);
    toast(`${plural(added, 'WOD ajouté')}, ${planned} au programme`);
    navigate('/', true);
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
        ? `Les ${past.length} séances déjà faites restent dans l’historique.`
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
    past.length > 0 &&
      h(
        'section',
        { class: 'stack' },
        h('h2', { class: 'section-title' }, 'Mes résultats'),
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
