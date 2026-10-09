import { dismissToast, h } from './dom';

export type Tab = 'wods' | 'chrono' | 'history' | 'data';

export interface View {
  el: HTMLElement;
  /** Onglet actif. Sans onglet, la barre du bas est masquée (chrono, saisie du score). */
  tab?: Tab;
  destroy?: () => void;
}

const TABS: { tab: Tab; path: string; label: string }[] = [
  { tab: 'wods', path: '/', label: 'WOD' },
  { tab: 'chrono', path: '/chrono', label: 'Chrono' },
  { tab: 'history', path: '/history', label: 'Historique' },
  { tab: 'data', path: '/data', label: 'Données' },
];

let root: HTMLElement;
let resolve: (path: string) => View;
let current: View | null = null;

export const currentPath = () => location.hash.replace(/^#/, '') || '/';

function tabBar(active: Tab): HTMLElement {
  return h(
    'nav',
    { class: 'tabs', 'aria-label': 'Navigation' },
    TABS.map(({ tab, path, label }) =>
      h('a', { href: `#${path}`, class: 'tab', 'aria-current': tab === active && 'page' }, label),
    ),
  );
}

export function render(): void {
  current?.destroy?.();
  current = resolve(currentPath());
  root.replaceChildren(current.el, ...(current.tab ? [tabBar(current.tab)] : []));
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
