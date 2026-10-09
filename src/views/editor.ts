import { h, toast } from '../dom';
import { typeLabel } from '../format';
import { navigate, type View } from '../router';
import { addWod, findWod, updateWod } from '../store';
import type { Movement, Wod, WodType } from '../types';
import { validateWod } from '../validate';
import { field, pageHead } from './parts';

type Unit = 'reps' | 'distance_m' | 'calories' | 'duration_sec';

/** Un mouvement en cours de saisie : tout reste du texte jusqu'à la validation. */
interface MovementDraft {
  name: string;
  amount: string;
  unit: Unit;
  load: string;
  notes: string;
}

/** État du formulaire. Les champs des quatre types cohabitent : changer de type ne perd rien. */
interface Draft {
  type: WodType;
  title: string;
  description: string;
  warmup: string;
  equipment: string;
  durationMin: string;
  durationSec: string;
  intervalMin: string;
  intervalSec: string;
  intervals: string;
  capMin: string;
  capSec: string;
  rounds: string;
  scheme: string;
  /** EMOM : une liste par slot. Autres types : seule la première liste sert. */
  lists: MovementDraft[][];
}

const TYPES: WodType[] = ['amrap', 'emom', 'for_time', 'hyrox'];
const UNITS: { value: Unit; label: string }[] = [
  { value: 'reps', label: 'reps' },
  { value: 'distance_m', label: 'mètres' },
  { value: 'calories', label: 'calories' },
  { value: 'duration_sec', label: 'secondes' },
];

const FIELD_LABELS: Record<string, string> = {
  title: 'Titre',
  description: 'Description',
  warmup: 'Échauffement',
  equipment: 'Matériel',
  duration_sec: 'Durée',
  interval_sec: 'Durée d’un intervalle',
  intervals: 'Nombre d’intervalles',
  time_cap_sec: 'Time cap',
  rounds: 'Nombre de tours',
  rep_scheme: 'Schéma de reps',
  movements: 'Mouvements',
  segments: 'Segments',
  slots: 'Intervalles',
};
const PART_LABELS: Record<string, string> = { name: 'nom', load_kg: 'charge', notes: 'notes' };

const TITLE_MAX = 60;
const COPY_SUFFIX = ' (copie)';

/** Titre proposé pour une copie, raccourci au besoin pour tenir dans la limite du format. */
const copyTitle = (title: string) => `${title.slice(0, TITLE_MAX - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;

const emptyMovement = (): MovementDraft => ({ name: '', amount: '', unit: 'reps', load: '', notes: '' });
const isBlank = (m: MovementDraft) => [m.name, m.amount, m.load, m.notes].every((value) => value.trim() === '');
const text = (value: string) => (value.trim() === '' ? undefined : value.trim());
const number = (value: string) => (value.trim() === '' ? undefined : Number(value.trim().replace(',', '.')));

function seconds(min: string, sec: string): number | undefined {
  if (min.trim() === '' && sec.trim() === '') return undefined;
  return (number(min) ?? 0) * 60 + (number(sec) ?? 0);
}

function minSec(total: number | undefined): [string, string] {
  if (total === undefined) return ['', ''];
  return [String(Math.floor(total / 60)), total % 60 === 0 ? '' : String(total % 60)];
}

function movementDraft(movement: Movement): MovementDraft {
  const unit = UNITS.find(({ value }) => movement[value] !== undefined)?.value ?? 'reps';
  return {
    name: movement.name,
    amount: String(movement[unit] ?? ''),
    unit,
    load: String(movement.load_kg ?? ''),
    notes: movement.notes ?? '',
  };
}

function draftOf(wod?: Wod): Draft {
  const draft: Draft = {
    type: wod?.type ?? 'amrap',
    title: wod?.title ?? '',
    description: wod?.description ?? '',
    warmup: wod?.warmup ?? '',
    equipment: (wod?.equipment ?? []).join(', '),
    durationMin: '',
    durationSec: '',
    intervalMin: '1',
    intervalSec: '',
    intervals: '',
    capMin: '',
    capSec: '',
    rounds: '1',
    scheme: '',
    lists: [[emptyMovement()]],
  };
  switch (wod?.type) {
    case 'amrap':
      [draft.durationMin, draft.durationSec] = minSec(wod.duration_sec);
      draft.lists = [wod.movements.map(movementDraft)];
      break;
    case 'emom':
      [draft.intervalMin, draft.intervalSec] = minSec(wod.interval_sec);
      draft.intervals = String(wod.intervals);
      draft.lists = wod.slots.map((slot) => slot.map(movementDraft));
      break;
    case 'for_time':
      [draft.capMin, draft.capSec] = minSec(wod.time_cap_sec);
      draft.rounds = String(wod.rounds);
      draft.scheme = wod.rep_scheme?.join('-') ?? '';
      draft.lists = [wod.movements.map(movementDraft)];
      break;
    case 'hyrox':
      [draft.capMin, draft.capSec] = minSec(wod.time_cap_sec);
      draft.lists = [wod.segments.map(movementDraft)];
  }
  return draft;
}

const schemeOf = (draft: Draft) =>
  draft.type === 'for_time' ? draft.scheme.split(/\D+/).filter(Boolean).map(Number) : [];

/** Traduit le formulaire en WOD brut ; c'est le validateur commun qui juge ensuite. */
function rawOf(draft: Draft): Record<string, unknown> {
  const scheme = schemeOf(draft);
  const movement = (m: MovementDraft) => ({
    name: m.name,
    ...(scheme.length === 0 && { [m.unit]: number(m.amount) }),
    load_kg: number(m.load),
    notes: text(m.notes),
  });
  const equipment = draft.equipment
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const base = {
    schema_version: 1,
    type: draft.type,
    title: draft.title,
    description: text(draft.description),
    warmup: text(draft.warmup),
    equipment: equipment.length > 0 ? equipment : undefined,
  };
  const first = (draft.lists[0] ?? []).map(movement);
  const cap = seconds(draft.capMin, draft.capSec);

  switch (draft.type) {
    case 'amrap':
      return { ...base, duration_sec: seconds(draft.durationMin, draft.durationSec), movements: first };
    case 'emom':
      return {
        ...base,
        interval_sec: seconds(draft.intervalMin, draft.intervalSec),
        intervals: number(draft.intervals),
        slots: draft.lists.map((list) => list.map(movement)),
      };
    case 'for_time':
      return {
        ...base,
        time_cap_sec: cap,
        rounds: scheme.length > 0 ? scheme.length : number(draft.rounds),
        rep_scheme: scheme.length > 0 ? scheme : undefined,
        movements: first,
      };
    case 'hyrox':
      return { ...base, time_cap_sec: cap, segments: first };
  }
}

/** Réécrit une erreur du validateur ("movements[0].name : …") avec les mots du formulaire. */
function humanize(error: string): string {
  const [path = '', ...rest] = error.split(' : ');
  if (rest.length === 0) return error;
  let message = rest.join(' : ');
  const slots = /^(\d+) slots pour seulement (\d+) intervalles$/.exec(message);
  if (message === 'champ manquant' || message === 'doit être un texte non vide') message = 'à remplir';
  else if (message.startsWith('il faut exactement un champ')) message = 'quantité à remplir';
  else if (message === 'doit contenir au moins un mouvement') message = 'ajoutes-en au moins un';
  else if (message === 'aucun mouvement dans les slots') message = 'ajoute au moins un mouvement';
  else if (slots) message = `${slots[1]} intervalles décrits pour un total de ${slots[2]}`;

  const item = /^(movements|segments|slots\[(\d+)\])\[(\d+)\](?:\.(\w+))?$/.exec(path);
  if (item) {
    const [, list, slot, index, part] = item;
    const n = Number(index) + 1;
    const where =
      list === 'segments' ? `Segment ${n}` : slot === undefined ? `Mouvement ${n}` : `Intervalle ${Number(slot) + 1}, mouvement ${n}`;
    return `${where}${part ? ` (${PART_LABELS[part] ?? 'quantité'})` : ''} : ${message}`;
  }
  return `${FIELD_LABELS[path.replace(/\[.*$/, '')] ?? path} : ${message}`;
}

type InputAttrs = Record<string, string | boolean>;

/** Champ texte relié à une propriété du brouillon. */
function bind<K extends string>(target: Record<K, string>, key: K, attrs: InputAttrs): HTMLInputElement {
  const input = h('input', { type: 'text', autocomplete: 'off', ...attrs });
  input.value = target[key];
  input.addEventListener('input', () => {
    target[key] = input.value;
  });
  return input;
}

function bindArea<K extends string>(target: Record<K, string>, key: K, label: string): HTMLTextAreaElement {
  const area = h('textarea', { rows: 2, 'aria-label': label });
  area.value = target[key];
  area.addEventListener('input', () => {
    target[key] = area.value;
  });
  return area;
}

const numeric = (label: string, placeholder = ''): InputAttrs => ({
  inputmode: 'numeric',
  placeholder,
  'aria-label': label,
});

/**
 * Formulaire d'un WOD : création, modification de `id`, ou avec `copy` création d'un nouveau WOD
 * pré-rempli à partir de `id`. L'original et ses séances ne sont alors pas touchés.
 */
export function editorView(id?: string, copy = false): View | null {
  const source = id === undefined ? undefined : findWod(id);
  if (id !== undefined && !source) return null;
  const editing = copy ? undefined : source;
  const draft = draftOf(source?.wod);
  if (copy && source) draft.title = copyTitle(source.wod.title);

  const typeEl = h('div', { class: 'stack' });
  const listsEl = h('div', { class: 'stack' });
  const errorBox = h('div', { class: 'errors', role: 'alert', hidden: true });
  const usesScheme = () => schemeOf(draft).length > 0;

  function movementCard(list: MovementDraft[], movement: MovementDraft, index: number, noun: string): HTMLElement {
    const move = (delta: number) => {
      list.splice(index, 1);
      list.splice(index + delta, 0, movement);
      renderLists();
    };
    const unit = h(
      'select',
      { 'aria-label': 'Unité' },
      UNITS.map(({ value, label }) => h('option', { value, selected: value === movement.unit }, label)),
    );
    unit.addEventListener('change', () => {
      movement.unit = UNITS.find(({ value }) => value === unit.value)?.value ?? 'reps';
    });
    const icon = (label: string, symbol: string, disabled: boolean, onclick: () => void) =>
      h('button', { type: 'button', class: 'btn icon', 'aria-label': label, disabled, onclick }, symbol);

    return h(
      'div',
      { class: 'editor-card' },
      h(
        'div',
        { class: 'editor-head' },
        h('span', null, `${noun} ${index + 1}`),
        h(
          'span',
          { class: 'row' },
          icon('Monter', '↑', index === 0, () => move(-1)),
          icon('Descendre', '↓', index === list.length - 1, () => move(1)),
          icon('Supprimer', '✕', false, () => {
            list.splice(index, 1);
            renderLists();
          }),
        ),
      ),
      bind(movement, 'name', { placeholder: 'Nom, par exemple Wall ball', 'aria-label': 'Nom' }),
      h(
        'div',
        { class: 'row' },
        !usesScheme() && bind(movement, 'amount', { ...numeric('Quantité', 'Quantité'), inputmode: 'decimal' }),
        !usesScheme() && unit,
        bind(movement, 'load', { ...numeric('Charge en kg', 'Charge kg'), inputmode: 'decimal' }),
      ),
      bind(movement, 'notes', { placeholder: 'Notes, scaling (facultatif)', 'aria-label': 'Notes' }),
    );
  }

  function renderLists(): void {
    if (draft.lists.length === 0) draft.lists.push([]);
    const emom = draft.type === 'emom';
    const noun = draft.type === 'hyrox' ? 'Segment' : 'Mouvement';
    const shown = emom ? draft.lists : draft.lists.slice(0, 1);

    listsEl.replaceChildren(
      h(
        'div',
        { class: 'stack' },
        shown.flatMap((list, slot) => [
          emom &&
            h(
              'div',
              { class: 'editor-head' },
              h('h3', null, `Intervalle ${slot + 1}`),
              draft.lists.length > 1 &&
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn ghost',
                    onclick: () => {
                      draft.lists.splice(slot, 1);
                      renderLists();
                    },
                  },
                  'Retirer l’intervalle',
                ),
            ),
          ...list.map((movement, index) => movementCard(list, movement, index, noun)),
          emom && list.length === 0 && h('p', { class: 'hint' }, 'Sans mouvement, cet intervalle est un repos.'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn block',
              onclick: () => {
                list.push(emptyMovement());
                renderLists();
              },
            },
            `+ Ajouter un ${noun.toLowerCase()}`,
          ),
        ]),
        emom &&
          h(
            'button',
            {
              type: 'button',
              class: 'btn block',
              onclick: () => {
                draft.lists.push([]);
                renderLists();
              },
            },
            '+ Ajouter un intervalle en alternance',
          ),
      ),
    );
  }

  function renderType(): void {
    const minutes = (key: 'durationMin' | 'intervalMin' | 'capMin') => bind(draft, key, numeric('Minutes'));
    const secs = (key: 'durationSec' | 'intervalSec' | 'capSec') => bind(draft, key, numeric('Secondes'));

    switch (draft.type) {
      case 'amrap':
        typeEl.replaceChildren(field('Durée', minutes('durationMin'), 'min', secs('durationSec'), 's'));
        break;
      case 'emom':
        typeEl.replaceChildren(
          field('Durée d’un intervalle', minutes('intervalMin'), 'min', secs('intervalSec'), 's'),
          field('Nombre d’intervalles', bind(draft, 'intervals', numeric('Nombre d’intervalles'))),
        );
        break;
      case 'for_time': {
        const rounds = bind(draft, 'rounds', numeric('Nombre de tours'));
        const scheme = bind(draft, 'scheme', { placeholder: '21-15-9', 'aria-label': 'Schéma de reps' });
        rounds.disabled = usesScheme();
        scheme.addEventListener('input', () => {
          // Avec un schéma, les quantités par mouvement n'ont plus lieu d'être.
          if (rounds.disabled === usesScheme()) return;
          rounds.disabled = usesScheme();
          renderLists();
        });
        typeEl.replaceChildren(
          field('Time cap', minutes('capMin'), 'min', secs('capSec'), 's'),
          field('Nombre de tours', rounds),
          field('Schéma de reps (facultatif)', scheme),
          h('p', { class: 'hint' }, 'Avec un schéma comme 21-15-9, chaque mouvement prend ces reps tour après tour.'),
        );
        break;
      }
      case 'hyrox':
        typeEl.replaceChildren(field('Time cap (facultatif)', minutes('capMin'), 'min', secs('capSec'), 's'));
    }
  }

  const typeButtons = TYPES.map((type) =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn grow',
        'aria-pressed': String(type === draft.type),
        onclick: () => {
          draft.type = type;
          typeButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(TYPES[i] === type)));
          renderType();
          renderLists();
        },
      },
      typeLabel(type),
    ),
  );

  const submit = (event: Event) => {
    event.preventDefault();
    // Les lignes laissées entièrement vides sont retirées plutôt que signalées en erreur.
    draft.lists = draft.lists.map((list) => list.filter((movement) => !isBlank(movement)));
    renderLists();

    const checked = validateWod(rawOf(draft));
    if (!checked.ok) {
      errorBox.replaceChildren(
        h('strong', null, 'À corriger :'),
        h(
          'ul',
          null,
          checked.errors.map((error) => h('li', null, humanize(error))),
        ),
      );
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (editing) {
      updateWod(editing.id, checked.value);
      toast('WOD modifié');
      navigate(`/wod/${editing.id}`, true);
    } else {
      const { saved, duplicate } = addWod(checked.value);
      toast(duplicate ? 'Ce WOD était déjà enregistré' : 'WOD créé');
      navigate(`/wod/${saved.id}`, true);
    }
  };

  renderType();
  renderLists();

  const back = source ? `#/wod/${source.id}` : '#/';
  const heading = copy ? 'Dupliquer le WOD' : editing ? 'Modifier le WOD' : 'Créer un WOD';
  const el = h(
    'section',
    { class: 'page' },
    pageHead(heading, { href: back, label: source ? 'Retour' : 'WOD' }),
    h(
      'form',
      { class: 'form', novalidate: true, onsubmit: submit },
      h('div', { class: 'segmented' }, typeButtons),
      field('Titre', bind(draft, 'title', { maxlength: String(TITLE_MAX), 'aria-label': 'Titre' })),
      typeEl,
      listsEl,
      field('Description (facultatif)', bindArea(draft, 'description', 'Description')),
      field('Échauffement (facultatif)', bindArea(draft, 'warmup', 'Échauffement')),
      field(
        'Matériel (facultatif, séparé par des virgules)',
        bind(draft, 'equipment', { placeholder: 'kettlebell, rameur', 'aria-label': 'Matériel' }),
      ),
      errorBox,
      h('button', { type: 'submit', class: 'btn primary big block' }, 'Enregistrer'),
      h('a', { class: 'btn ghost block', href: back }, 'Annuler'),
    ),
  );
  return { el, tab: 'wods' };
}
