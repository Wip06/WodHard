import './style.css';
import { toast } from './dom';
import { render, startRouter, type View } from './router';
import { DATA_KEY, getSession, loadData, loadSession } from './store';
import { askView } from './views/ask';
import { chronoRunView, chronoView } from './views/chrono';
import { dataView } from './views/data';
import { editorView } from './views/editor';
import { historyView, resultView } from './views/history';
import { scoreView } from './views/score';
import { timerView } from './views/timer';
import { addWodView, wodDetailView, wodListView } from './views/wods';

const routes: [RegExp, (...params: string[]) => View | null][] = [
  [/^\/$/, wodListView],
  [/^\/add$/, addWodView],
  [/^\/ask$/, askView],
  [/^\/chrono$/, chronoView],
  [/^\/chrono\/run$/, chronoRunView],
  [/^\/edit(?:\/([\w-]+))?$/, (id) => editorView(id)],
  [/^\/copy\/([\w-]+)$/, (id) => editorView(id, true)],
  [/^\/wod\/([\w-]+)$/, wodDetailView],
  [/^\/timer$/, timerView],
  [/^\/score(?:\/([\w-]+))?$/, scoreView],
  [/^\/history$/, historyView],
  [/^\/history\/([\w-]+)$/, resultView],
  [/^\/data$/, dataView],
];

function resolve(requested: string): View {
  // Un WOD en cours prime sur toute autre page, jusqu'au score enregistré ou à l'abandon.
  const session = getSession();
  const forced = session ? `/${session.stage}` : null;
  const path = forced ?? requested;
  if (path !== requested) history.replaceState(null, '', `#${path}`);

  for (const [pattern, build] of routes) {
    const match = pattern.exec(path);
    const view = match && build(...match.slice(1));
    if (view) return view;
  }
  history.replaceState(null, '', '#/');
  return wodListView();
}

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Élément #app introuvable');

const loadError = loadData();
loadSession();
startRouter(root, resolve);
if (loadError) toast(loadError);

// Demande au navigateur de ne pas purger les données (accordé surtout aux PWA installées).
void navigator.storage?.persist?.();

// Garde les onglets ouverts en parallèle synchronisés.
window.addEventListener('storage', (event) => {
  if (event.key !== DATA_KEY) return;
  loadData();
  render();
});
