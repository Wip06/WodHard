import { choose, h, toast } from '../dom';
import { plural } from '../format';
import { GeminiError, listModels, loadCoach, modelState, preferredModel, saveCoach, workingModel } from '../gemini';
import { navigate, render, type View } from '../router';
import { field, pageHead } from './parts';

const KEY_PAGE = 'https://aistudio.google.com/app/apikey';

/** Réglages du coach Gemini : clé API, modèle et instructions, gardés sur cet appareil. */
export function coachView(): View {
  const saved = loadCoach();
  /** Modèles de secours trouvés à la dernière vérification de la clé. */
  let fallbacks = saved.fallbacks;

  const key = h('input', {
    type: 'password',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'AIza…',
    'aria-label': 'Clé API Gemini',
  });
  key.value = saved.key;

  const model = h('select', { 'aria-label': 'Modèle' });
  const fillModels = (names: string[], selected: string) =>
    model.replaceChildren(...names.map((name) => h('option', { value: name, selected: name === selected }, name)));
  if (saved.model) fillModels([saved.model], saved.model);

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
    errorBox.textContent = message;
    errorBox.hidden = false;
  };

  const verify = async () => {
    errorBox.hidden = true;
    if (key.value.trim() === '') return showError('Colle d’abord ta clé API.');
    status.textContent = 'Vérification de la clé…';
    try {
      const models = await listModels(key.value);
      const available = `${plural(models.length, 'modèle')} ${models.length > 1 ? 'disponibles' : 'disponible'}`;
      status.textContent = `Clé valide : ${available}. Test du modèle…`;
      const first = models.includes(model.value) ? model.value : preferredModel(models);
      const choice = await workingModel(key.value, models, first);
      fillModels(models, choice.model);
      fallbacks = choice.fallbacks;
      const named = (state: string) => choice.skipped.filter((entry) => entry.state === state).map((entry) => entry.model);
      const missing = named('missing');
      const busy = named('busy');
      status.textContent = [
        `Clé valide : ${available}. Modèle ${choice.model} opérationnel.`,
        missing.length > 0 && `${missing.join(', ')} ne répond pas.`,
        busy.length > 0 && `${busy.join(', ')} saturé pour le moment.`,
      ]
        .filter(Boolean)
        .join(' ');
    } catch (error) {
      status.textContent = '';
      showError(error instanceof GeminiError ? error.message : 'Vérification impossible : réessaie.');
    }
  };

  const save = async () => {
    errorBox.hidden = true;
    const settings = {
      key: key.value.trim(),
      model: model.value,
      fallbacks: fallbacks.filter((name) => name !== model.value),
      instructions: instructions.value.trim(),
    };
    const missing = [
      settings.key === '' && 'la clé API',
      settings.model === '' && 'le modèle (vérifie la clé pour obtenir la liste)',
    ].filter(Boolean);
    if (missing.length > 0) return showError(`À compléter : ${missing.join(', ')}.`);
    try {
      // Le modèle a pu être changé à la main dans la liste : on vérifie qu'il répond avant de l'enregistrer.
      // Un modèle saturé reste enregistrable : la surcharge est passagère et les secours prennent le relais.
      status.textContent = 'Test du modèle…';
      if ((await modelState(settings.key, settings.model)) === 'missing') {
        status.textContent = '';
        return showError(`Le modèle ${settings.model} ne répond pas : appuie sur « Vérifier la clé » pour en choisir un qui marche.`);
      }
      saveCoach(settings);
      toast('Coach prêt');
      navigate('/ask');
    } catch (error) {
      status.textContent = '';
      showError(error instanceof GeminiError ? error.message : 'Enregistrement impossible.');
    }
  };

  const reset = async () => {
    const confirmed = await choose('Effacer les réglages du coach ?', 'La clé et les instructions seront retirées de cet appareil.', [
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
    pageHead('Coach Gemini', { href: '#/data', label: 'Données' }),
    h('p', { class: 'lead' }, 'Le coach génère tes WOD directement dans l’appli, avec l’API gratuite de Google Gemini.'),
    h(
      'ol',
      { class: 'steps' },
      h(
        'li',
        null,
        'Crée une clé gratuite sur ',
        h('a', { href: KEY_PAGE, target: '_blank', rel: 'noopener' }, 'Google AI Studio'),
        ' (« Create API key »).',
      ),
      h('li', null, 'Colle-la ci-dessous, puis appuie sur « Vérifier la clé ».'),
      h('li', null, 'Colle ton profil et tes consignes, puis enregistre. Le format des WOD est fourni par l’appli : inutile de le recopier.'),
    ),
    h(
      'div',
      { class: 'stack' },
      field('Clé API', key),
      h('button', { class: 'btn block', onclick: () => void verify() }, 'Vérifier la clé'),
      status,
    ),
    field('Modèle', model),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Profil et consignes'), instructions),
    errorBox,
    h('button', { class: 'btn primary big block', onclick: () => void save() }, 'Enregistrer'),
    h(
      'p',
      { class: 'hint' },
      'Ces réglages restent sur cet appareil et ne font pas partie des sauvegardes. ',
      'À chaque message, ton profil et ton historique sont envoyés à Google.',
    ),
    saved.key !== '' && h('button', { class: 'btn ghost danger block', onclick: () => void reset() }, 'Effacer les réglages du coach'),
  );
  return { el, tab: 'data' };
}
