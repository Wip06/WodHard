import { choose, copyText, h, toast } from '../dom';
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
  sortedResults,
} from '../store';
import { coachReady, loadCoach } from '../gemini';
import { parseBackup } from '../validate';
import { pageHead } from './parts';

const MAX_ERRORS = 8;
const LIMITS = [
  { value: '10', label: 'Les 10 dernières' },
  { value: '30', label: 'Les 30 dernières' },
  { value: 'all', label: 'Tout' },
];
const DEFAULT_LIMIT = '30';

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = h('a', { href: url, download: file.name, class: 'offscreen' });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportData(): Promise<void> {
  const file = new File([JSON.stringify(buildBackup(), null, 2)], `wodhard-${today()}.json`, {
    type: 'application/json',
  });
  // Sur téléphone, la feuille de partage (« Enregistrer dans Fichiers ») est plus fiable
  // qu'un téléchargement, surtout pour une PWA installée sur iOS.
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      download(file);
    }
  } else {
    download(file);
  }
  markExported();
  render();
}

/** Ouverte depuis l'écran d'accueil (appli installée) plutôt que dans un onglet du navigateur. */
const installed = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function dataView(): View {
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

  const importFile = async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    const checked = parseBackup(await file.text());
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

  const picker = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'offscreen',
    'aria-label': 'Fichier de sauvegarde',
    onchange: () => void importFile(),
  });

  const sessions = sortedResults().length;
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
    pageHead('Données'),
    h(
      'p',
      { class: 'lead' },
      'Tes WOD et tes scores sont stockés uniquement sur cet appareil. Exporte une sauvegarde de temps en temps.',
    ),
    h(
      'dl',
      { class: 'facts' },
      h('dt', null, 'WOD enregistrés'),
      h('dd', null, getWods().length),
      h('dt', null, 'Séances'),
      h('dd', null, sessions),
      h('dt', null, 'Dernière sauvegarde'),
      h('dd', null, exported ? new Date(exported).toLocaleDateString('fr-FR', { dateStyle: 'long' }) : 'jamais'),
      h('dt', null, 'Séances non sauvegardées'),
      h('dd', null, backupStatus().unsaved),
      h('dt', null, 'Stockage protégé'),
      h('dd', null, persisted),
    ),
    installHint,
    sessions > 0 &&
      h(
        'div',
        { class: 'stack' },
        h('a', { class: 'btn block', href: '#/history' }, `Toutes mes séances (${sessions})`),
        h('button', { class: 'btn block', onclick: () => void copy() }, 'Copier mon historique pour Claude'),
        h('label', { class: 'inline-field' }, h('span', null, 'Séances copiées, en JSON :'), limit),
      ),
    h(
      'div',
      { class: 'stack' },
      h('button', { class: 'btn primary block', onclick: () => void exportData() }, 'Exporter mes données'),
      h('button', { class: 'btn block', onclick: () => picker.click() }, 'Importer une sauvegarde'),
      h(
        'a',
        { class: 'btn block', href: '#/coach' },
        coachReady(loadCoach()) ? 'Coach Gemini : configuré' : 'Configurer le coach Gemini',
      ),
      picker,
      errorBox,
    ),
  );
  return { el, tab: 'data' };
}
