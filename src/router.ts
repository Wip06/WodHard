import { dismissToast, h } from './dom';

/** `menu` : une page ouverte depuis le menu ☰ (chrono libre, séances, réglages). */
export type Tab = 'wods' | 'coach' | 'progress' | 'menu';

export interface View {
  el: HTMLElement;
  /** Onglet actif. Sans onglet, la barre du bas est masquée (chrono, saisie du score). */
  tab?: Tab;
  destroy?: () => void;
}

const TABS: { tab: Tab; path: string; label: string }[] = [
  { tab: 'wods', path: '/', label: 'WOD' },
  { tab: 'coach', path: '/ask', label: 'Coach' },
  { tab: 'progress', path: '/progress', label: 'Suivi' },
];

/** Pages du menu ☰ : moins fréquentes, elles laissent la barre du bas à trois onglets. */
const MENU: { path: string; label: string; hint: string }[] = [
  { path: '/chrono', label: 'Chrono libre', hint: 'Chrono, minuteur, intervalles (Tabata, EMOM…)' },
  { path: '/history', label: 'Toutes mes séances', hint: 'Tout ton historique, WOD et autres sports' },
  { path: '/exploits', label: 'Exploits', hint: 'Tes objectifs et tes records : course, vélo, Hyrox, charges…' },
  { path: '/bibliotheque', label: 'Bibliothèque de WOD', hint: 'Fran, Cindy, Murph… les classiques, prêts à ajouter' },
  { path: '/settings', label: 'Réglages', hint: 'Coach, sauvegarde, import' },
];

let root: HTMLElement;
let resolve: (path: string) => View;
let current: View | null = null;
/** Ferme le menu ☰ s'il est ouvert, et retire son écoute du clavier. */
let closeMenu: (() => void) | null = null;

export const currentPath = () => location.hash.replace(/^#/, '') || '/';

/** Barre du bas : trois onglets et le ☰, qui ouvre un panneau au-dessus de la barre. */
function tabBar(active: Tab): HTMLElement[] {
  const backdrop = h('div', { class: 'menu-backdrop', hidden: true, onclick: () => closeMenu?.() });
  const sheet = h(
    'nav',
    { class: 'menu-sheet', id: 'menu-sheet', 'aria-label': 'Autres pages', hidden: true },
    MENU.map(({ path, label, hint }) =>
      h(
        'a',
        // Une page déjà ouverte ne change pas l'adresse : le clic doit fermer le menu lui-même.
        { class: 'menu-item', href: `#${path}`, 'aria-current': currentPath() === path && 'page', onclick: () => closeMenu?.() },
        h('strong', null, label),
        h('span', null, hint),
      ),
    ),
  );
  const burger = h(
    'button',
    {
      type: 'button',
      class: 'tab tab-menu',
      'aria-label': 'Menu',
      'aria-expanded': 'false',
      'aria-controls': 'menu-sheet',
      'aria-current': active === 'menu' && 'page',
      onclick: () => (sheet.hidden ? open() : closeMenu?.()),
    },
    // Les trois traits sont dessinés en CSS ; le nom vient de aria-label.
  );
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    closeMenu?.();
    burger.focus();
  };
  function open(): void {
    sheet.hidden = backdrop.hidden = false;
    burger.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey);
    closeMenu = () => {
      sheet.hidden = backdrop.hidden = true;
      burger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onKey);
      closeMenu = null;
    };
    sheet.querySelector('a')?.focus();
  }
  const nav = h(
    'nav',
    { class: 'tabs', 'aria-label': 'Navigation' },
    TABS.map(({ tab, path, label }) => h('a', { href: `#${path}`, class: 'tab', 'aria-current': tab === active && 'page' }, label)),
    burger,
  );
  return [backdrop, sheet, nav];
}

export function render(): void {
  closeMenu?.();
  current?.destroy?.();
  current = resolve(currentPath());
  root.replaceChildren(current.el, ...(current.tab ? tabBar(current.tab) : []));
  // Chrono et saisie du score : rien ne doit recouvrir les boutons du bas.
  if (!current.tab) dismissToast();
  window.scrollTo(0, 0);
}

export function navigate(path: string, replace = false): void {
  if (currentPath() === path) render();
  else if (replace) location.replace(`#${path}`);
  else location.hash = path;
}

export function startRouter(container: HTMLElement, resolver: (path: string) => View): void {
  root = container;
  resolve = resolver;
  window.addEventListener('hashchange', render);
  render();
}
