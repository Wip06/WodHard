import { unlockAudio } from '../audio';
import { choose, h, toast } from '../dom';
import { dateLabel, scoreLine, wodSummary } from '../format';
import { navigate, type View } from '../router';
import { addWod, deleteWod, findWod, getWods, resultsFor, setSession } from '../store';
import { newClock } from '../timer';
import type { SavedWod } from '../types';
import { parseWod } from '../validate';
import { pageHead, resultRow, typeBadge, wodSheet } from './parts';

const MAX_ERRORS = 12;

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

export function wodListView(): View {
  const wods = [...getWods()].reverse();
  const el = h(
    'section',
    { class: 'page' },
    h('header', { class: 'brand' }, h('h1', null, 'WOD', h('span', null, 'HARD'))),
    h('a', { class: 'btn primary block', href: '#/add' }, '+ Coller un WOD'),
    wods.length > 0
      ? h('ul', { class: 'cards' }, wods.map(wodCard))
      : h(
          'p',
          { class: 'empty' },
          'Aucun WOD pour l’instant. Génère-en un dans ton projet Claude, copie le JSON, puis colle-le ici.',
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
    'aria-label': 'JSON du WOD',
  });
  const errorBox = h('div', { class: 'errors', role: 'alert', hidden: true });

  const showErrors = (errors: string[]) => {
    const extra = errors.length - MAX_ERRORS;
    errorBox.replaceChildren(
      h('strong', null, 'Ce WOD n’est pas valide :'),
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
    if (input.value.trim() === '') return showErrors(['Colle d’abord le JSON du WOD.']);
    const checked = parseWod(input.value);
    if (!checked.ok) return showErrors(checked.errors);
    const { saved, duplicate } = addWod(checked.value);
    toast(duplicate ? 'Ce WOD était déjà enregistré' : 'WOD enregistré');
    navigate(`/wod/${saved.id}`, true);
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
    h('p', { class: 'lead' }, 'Copie le JSON généré par ton projet Claude, puis colle-le ici.'),
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

  const start = () => {
    unlockAudio();
    setSession({ stage: 'timer', wod, wod_id: id, clock: newClock(Date.now()), rounds: 0 });
    navigate('/timer');
  };

  const scoreWithoutTimer = () => {
    setSession({ stage: 'score', wod, wod_id: id, rounds: 0, completed: false });
    navigate('/score');
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
    past.length > 0 &&
      h(
        'section',
        { class: 'stack' },
        h('h2', { class: 'section-title' }, 'Mes résultats'),
        h(
          'ul',
          { class: 'cards' },
          past.map((result) => resultRow(result, false)),
        ),
      ),
    h('button', { class: 'btn ghost danger block', onclick: remove }, 'Supprimer ce WOD'),
  );
  return { el, tab: 'wods' };
}
