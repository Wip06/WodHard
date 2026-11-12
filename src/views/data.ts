import { choose, copyText, h, offerFile, toast } from '../dom';
import { plural, today } from '../format';
import { render, type View } from '../router';
import {
  applyBackup,
  backupStatus,
  buildBackup,
  buildHistory,
  getWods,
  lastExport,
  markExported,
  sortedActivities,
  sortedResults,
} from '../store';
import { coachReady, loadCoach } from '../claude';
import { parseBackup } from '../validate';
import { pageHead } from './parts';

const MAX_ERRORS = 8;
const LIMITS = [
  { value: '10', label: 'Les 10 dernières' },
  { value: '30', label: 'Les 30 dernières' },
  { value: 'all', label: 'Tout' },
];
const DEFAULT_LIMIT = '30';

async function saveBackupFile(): Promise<void> {
  const file = new File([JSON.stringify(buildBackup(), null, 2)], `wodhard-${today()}.json`, {
    type: 'application/json',
  });
  if (!(await offerFile(file))) return;
  markExported();
  render();
}

/** La sauvegarde copiée compte comme exportée : le rappel s'arrête, à toi de la coller en lieu sûr. */
async function copyBackup(): Promise<void> {
  if (!(await copyText(JSON.stringify(buildBackup(), null, 2)))) return toast('Copie impossible');
  markExported();
  render();
  toast('Sauvegarde copiée : colle-la tout de suite dans un endroit sûr (notes, mail…)');
}

/**
 * Exporter, depuis les Réglages ou le rappel de l'écran WOD : un fichier, ou le contenu à coller,
 * comme pour l'import. Chaque choix agit dans son `run`, sur le toucher même : Safari refuse le
 * partage et le presse-papiers après la fenêtre.
 */
export function exportData(): void {
  void choose('Exporter mes données', 'Un fichier à garder, ou le contenu à coller ailleurs ?', [
    { label: 'Enregistrer un fichier', value: null, kind: 'primary', run: () => void saveBackupFile() },
    { label: 'Copier dans le presse-papiers', value: null, run: () => void copyBackup() },
    { label: 'Annuler', value: null },
  ]);
}

/** Ouverte depuis l'écran d'accueil (appli installée) plutôt que dans un onglet du navigateur. */
const installed = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Réglages : coach, sauvegarde et import, copie de l'historique, chiffres de l'appli. */
export function settingsView(): View {
  const exported = lastExport();
  const errorBox = h('div', { class: 'errors', role: 'alert', hidden: true });
  const persisted = h('span', null, '…');
  const installHint = h('p', { class: 'hint', hidden: true });
  /**
   * « oui » : le navigateur s'engage à ne pas effacer les données. Sinon, une appli installée
   * échappe au moins à l'effacement après 7 jours sans ouverture (Safari), mais pas au manque de place.
   */
  const showProtection = (yes: boolean) => {
    const home = installed();
    persisted.textContent = yes ? 'oui' : home ? 'en partie' : 'non';
    installHint.textContent = home
      ? 'Installée sur l’écran d’accueil, l’appli n’est pas effacée après 7 jours sans ouverture. Le système peut quand même vider ses données si l’appareil manque de place : exporte une sauvegarde de temps en temps.'
      : 'Installe l’appli sur l’écran d’accueil pour que le navigateur ne purge pas ses données.';
    installHint.hidden = yes;
  };
  const asked = navigator.storage?.persisted?.();
  if (asked) void asked.then(showProtection, () => showProtection(false));
  else showProtection(false);

  /** Vérifie une sauvegarde, venue d'un fichier ou collée, puis propose de la fusionner ou de tout remplacer. */
  const importText = async (text: string) => {
    errorBox.hidden = true;
    const checked = parseBackup(text);
    if (!checked.ok) {
      const extra = checked.errors.length - MAX_ERRORS;
      errorBox.replaceChildren(
        h('strong', null, 'Import impossible :'),
        h(
          'ul',
          null,
          checked.errors.slice(0, MAX_ERRORS).map((error) => h('li', null, error)),
          extra > 0 && h('li', null, `… et ${extra} autres erreurs`),
        ),
      );
      errorBox.hidden = false;
      return;
    }
    const { wods, results } = checked.value;
    const mode = await choose(
      'Importer cette sauvegarde ?',
      `Elle contient ${wods.length} WOD et ${plural(results.length, 'séance')}.`,
      [
        { label: 'Fusionner avec mes données', value: 'merge' as const, kind: 'primary' },
        { label: 'Remplacer toutes mes données', value: 'replace' as const, kind: 'danger' },
        { label: 'Annuler', value: null },
      ],
    );
    if (!mode) return;
    applyBackup(checked.value, mode);
    toast('Sauvegarde importée');
    render();
  };

  const importFile = async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (file) await importText(await file.text());
  };

  // Si le presse-papiers est refusé, on colle à la main dans une zone de texte.
  const pasteBox = h('textarea', {
    class: 'json-input',
    rows: 6,
    placeholder: 'Colle ici le contenu de la sauvegarde',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    'aria-label': 'Contenu de la sauvegarde',
  });
  const manualPaste = h(
    'div',
    { class: 'stack', hidden: true },
    pasteBox,
    h(
      'button',
      {
        class: 'btn block',
        onclick: () => (pasteBox.value.trim() === '' ? toast('Colle d’abord le contenu de la sauvegarde') : void importText(pasteBox.value)),
      },
      'Importer le texte collé',
    ),
  );

  const paste = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast('Presse-papiers inaccessible : colle le contenu dans la zone de texte');
      manualPaste.hidden = false;
      pasteBox.focus();
      return;
    }
    if (text.trim() === '') return toast('Le presse-papiers est vide');
    await importText(text);
  };

  const picker = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'offscreen',
    'aria-label': 'Fichier de sauvegarde',
    onchange: () => void importFile(),
  });

  const sessions = sortedResults().length + sortedActivities().length;
  const limit = h(
    'select',
    { 'aria-label': 'Séances à copier' },
    LIMITS.map(({ value, label }) => h('option', { value, selected: value === DEFAULT_LIMIT }, label)),
  );
  const copy = async () => {
    const history = buildHistory(limit.value === 'all' ? undefined : Number(limit.value));
    const copied = await copyText(JSON.stringify(history));
    toast(copied ? `${plural(history.entries.length, 'séance')} dans le presse-papiers` : 'Copie impossible');
  };

  const el = h(
    'section',
    { class: 'page' },
    pageHead('Réglages'),
    h(
      'section',
      { class: 'stack' },
      h('h2', { class: 'section-title' }, 'Coach'),
      h('a', { class: 'btn block', href: '#/coach' }, coachReady(loadCoach()) ? 'Coach : configuré ›' : 'Configurer le coach ›'),
    ),
    h(
      'section',
      { class: 'stack' },
      h('h2', { class: 'section-title' }, 'Sauvegarde'),
      h('p', { class: 'lead' }, 'Tes WOD et tes scores sont stockés uniquement sur cet appareil. Exporte une sauvegarde de temps en temps.'),
      h(
        'dl',
        { class: 'facts' },
        h('dt', null, 'Dernière sauvegarde'),
        h('dd', null, exported ? new Date(exported).toLocaleDateString('fr-FR', { dateStyle: 'long' }) : 'jamais'),
        h('dt', null, 'Séances non sauvegardées'),
        h('dd', null, backupStatus().unsaved),
        h('dt', null, 'Stockage protégé'),
        h('dd', null, persisted),
      ),
      installHint,
      h('button', { class: 'btn primary block', onclick: exportData }, 'Exporter mes données'),
      h(
        'button',
        {
          class: 'btn block',
          // Chaque choix agit dans son `run`, sur le toucher même : la réponse de la boîte ne sert pas.
          onclick: () =>
            void choose('Importer une sauvegarde', 'D’où vient ta sauvegarde ?', [
              { label: 'Choisir un fichier', value: null, kind: 'primary', run: () => picker.click() },
              { label: 'Coller depuis le presse-papiers', value: null, run: () => void paste() },
              { label: 'Annuler', value: null },
            ]),
        },
        'Importer une sauvegarde',
      ),
      manualPaste,
      picker,
      errorBox,
    ),
    sessions > 0 &&
      h(
        'section',
        { class: 'stack' },
        h('h2', { class: 'section-title' }, 'Coach dans une autre appli'),
        h('p', { class: 'hint left' }, 'Copie ton historique, colle-le dans la conversation de ton coach, puis rapporte sa réponse avec « Coller un WOD ».'),
        h('button', { class: 'btn block', onclick: () => void copy() }, 'Copier mon historique pour le coach'),
        h('label', { class: 'inline-field' }, h('span', null, 'Séances copiées, en JSON :'), limit),
      ),
    h(
      'section',
      { class: 'stack' },
      h('h2', { class: 'section-title' }, 'En bref'),
      h(
        'dl',
        { class: 'facts' },
        h('dt', null, 'WOD enregistrés'),
        h('dd', null, getWods().length),
        h('dt', null, 'Séances de WOD'),
        h('dd', null, sortedResults().length),
        h('dt', null, 'Autres sports'),
        h('dd', null, sortedActivities().length),
      ),
    ),
  );
  return { el, tab: 'menu' };
}
