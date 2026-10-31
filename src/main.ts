import './style.css';
import { toast } from './dom';
import { render, startRouter, type View } from './router';
import { DATA_KEY, getSession, loadData, loadSession } from './store';
import { activityFormView, activityView } from './views/activity';
import { nextBlockView } from './views/blocks';
import { chronoRunView, chronoView } from './views/chrono';
import { chatView, proposalView } from './views/chat';
import { coachView } from './views/coach';
import { dataView } from './views/data';
import { editorView, sessionEditorView } from './views/editor';
import { goalFormView, goalView } from './views/goals';
import { historyView, recapView, resultView } from './views/history';
import { liftsView, liftView } from './views/lifts';
import { progressView } from './views/progress';
import { scoreView } from './views/score';
import { timerView } from './views/timer';
import { addWodView, wodDetailView, wodListView } from './views/wods';

const routes: [RegExp, (...params: string[]) => View | null][] = [
  [/^\/$/, wodListView],
  [/^\/add$/, addWodView],
  [/^\/ask$/, chatView],
  [/^\/ask\/proposal\/([\w-]+)$/, proposalView],
  [/^\/chrono$/, chronoView],
  [/^\/chrono\/run$/, chronoRunView],
  [/^\/coach$/, coachView],
  [/^\/edit(?:\/([\w-]+))?$/, (id) => editorView(id)],
  [/^\/edit\/([\w-]+)\/block\/(\d+)$/, (id, index) => editorView(id, false, Number(index))],
  [/^\/compose$/, () => sessionEditorView()],
  [/^\/copy\/([\w-]+)$/, (id) => editorView(id, true)],
  [/^\/wod\/([\w-]+)$/, wodDetailView],
  [/^\/timer$/, timerView],
  [/^\/next$/, nextBlockView],
  [/^\/score(?:\/([\w-]+))?$/, scoreView],
  [/^\/history$/, historyView],
  [/^\/history\/([\w-]+)$/, resultView],
  [/^\/history\/([\w-]+)\/recap$/, recapView],
  [/^\/data$/, dataView],
  [/^\/progress$/, progressView],
  [/^\/lifts$/, liftsView],
  [/^\/lift\/([^/]+)$/, liftView],
  [/^\/goal\/new$/, () => goalFormView()],
  [/^\/goal\/new\/((?:wod|lift):[^/]+)$/, (preset) => goalFormView(undefined, preset)],
  [/^\/goal\/([\w-]+)\/edit$/, (id) => goalFormView(id)],
  [/^\/goal\/([\w-]+)$/, goalView],
  [/^\/activity\/new$/, () => activityFormView()],
  [/^\/activity\/new\/(race:[\w-]+)$/, (preset) => activityFormView(undefined, preset)],
  [/^\/activity\/([\w-]+)\/edit$/, (id) => activityFormView(id)],
  [/^\/activity\/([\w-]+)$/, activityView],
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
