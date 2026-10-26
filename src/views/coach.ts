import { checkKey, CoachError, loadCoach, MODELS, saveCoach } from '../claude';
import { choose, h, toast } from '../dom';
import { navigate, render, type View } from '../router';
import { field, pageHead } from './parts';

const CONSOLE = 'https://console.anthropic.com/';

/** Réglages du coach Claude : clé API, modèle et profil, gardés sur cet appareil. */
export function coachView(): View {
  const saved = loadCoach();

  const key = h('input', {
    type: 'password',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'sk-ant-…',
    'aria-label': 'Clé API Claude',
  });
  key.value = saved.key;

  const model = h(
    'select',
    { 'aria-label': 'Modèle' },
    MODELS.map(({ id, label }) => h('option', { value: id, selected: id === saved.model }, label)),
  );
  const modelNote = h('p', { class: 'hint left' });
  const showNote = () => (modelNote.textContent = MODELS.find(({ id }) => id === model.value)?.note ?? '');
  model.addEventListener('change', showNote);
  showNote();

  const instructions = h('textarea', {
    rows: 10,
    spellcheck: 'false',
    placeholder: 'Ton niveau, ta salle et ton matériel, tes charges de départ, tes préférences et contraintes…',
    'aria-label': 'Profil et consignes',
  });
  instructions.value = saved.instructions;

  const status = h('p', { class: 'hint left', role: 'status' });
  const errorBox = h('div', { class: 'errors', role: 'alert', hidden: true });
  const showError = (message: string) => {
    status.textContent = '';
    errorBox.textContent = message;
    errorBox.hidden = false;
  };

  /** Vérifie la clé sur le modèle choisi : la demande est gratuite. */
  const verified = async (): Promise<boolean> => {
    errorBox.hidden = true;
    if (key.value.trim() === '') {
      showError('Colle d’abord ta clé API.');
      return false;
    }
    status.textContent = 'Vérification de la clé…';
    try {
      const name = await checkKey(key.value, model.value);
      status.textContent = `Clé valide : ${name} est disponible.`;
      return true;
    } catch (error) {
      showError(error instanceof CoachError ? error.message : 'Vérification impossible : réessaie.');
      return false;
    }
  };

  const save = async () => {
    if (!(await verified())) return;
    try {
      saveCoach({ key: key.value.trim(), model: model.value, instructions: instructions.value.trim() });
      toast('Coach prêt');
      navigate('/ask');
    } catch (error) {
      showError(error instanceof CoachError ? error.message : 'Enregistrement impossible.');
    }
  };

  const reset = async () => {
    const confirmed = await choose('Effacer les réglages du coach ?', 'La clé et le profil seront retirés de cet appareil.', [
      { label: 'Effacer', value: true, kind: 'danger' },
      { label: 'Annuler', value: false },
    ]);
    if (!confirmed) return;
    saveCoach(null);
    toast('Réglages du coach effacés');
    render();
  };

  const el = h(
    'section',
    { class: 'page' },
    pageHead('Coach Claude', { href: '#/data', label: 'Données' }),
    h('p', { class: 'lead' }, 'Le coach crée tes WOD et répond à tes questions dans l’appli, avec l’API Claude d’Anthropic.'),
    h(
      'div',
      { class: 'notice' },
      h('p', null, 'L’API est payante, à l’usage : chaque message est facturé sur ton compte Anthropic. Elle n’est pas comprise dans un abonnement Claude (Pro ou Max).'),
    ),
    saved.key === '' &&
      saved.instructions !== '' &&
      h('p', { class: 'hint left' }, 'Ton profil est conservé : il ne manque que ta clé Claude.'),
    h(
      'ol',
      { class: 'steps' },
      h(
        'li',
        null,
        'Sur ',
        h('a', { href: CONSOLE, target: '_blank', rel: 'noopener' }, 'console.anthropic.com'),
        ', ajoute du crédit (Billing) et fixe une limite de dépense mensuelle si tu veux.',
      ),
      h('li', null, 'Crée une clé (API keys › Create key) et colle-la ci-dessous.'),
      h('li', null, 'Choisis le modèle, colle ton profil, puis enregistre. Le format des WOD est fourni par l’appli : inutile de le recopier.'),
    ),
    h(
      'div',
      { class: 'stack' },
      field('Clé API', key),
      h('button', { class: 'btn block', onclick: () => void verified() }, 'Vérifier la clé'),
      status,
    ),
    h('div', { class: 'stack' }, field('Modèle', model), modelNote),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Profil et consignes'), instructions),
    errorBox,
    h('button', { class: 'btn primary big block', onclick: () => void save() }, 'Enregistrer'),
    h(
      'p',
      { class: 'hint' },
      'Ta clé reste sur cet appareil et ne fait pas partie des sauvegardes. ',
      'À chaque message, ton profil et ton historique sont envoyés à Anthropic.',
    ),
    saved.key !== '' && h('button', { class: 'btn ghost danger block', onclick: () => void reset() }, 'Effacer les réglages du coach'),
  );
  return { el, tab: 'data' };
}
