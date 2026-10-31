import { unlockAudio } from '../audio';
import { choose, h } from '../dom';
import { clock as clockText, plural } from '../format';
import { navigate, type View } from '../router';
import { getSession, setSession, type BlocksProgress, type Run } from '../store';
import { newClock } from '../timer';
import type { SingleWod } from '../types';
import { screenWake } from '../wake';
import { blockPlan } from './parts';

/** « Bloc 2 / 3 » : où l'on en est dans une séance en blocs. */
export const blockStep = (blocks: BlocksProgress) => `Bloc ${blocks.index + 1} / ${blocks.wod.blocks.length}`;

/**
 * Fin du chrono d'un WOD. Seul, il passe à la saisie du score. Dans une séance en blocs, le bloc
 * est gardé et la séance passe au bloc suivant ; après le dernier, à la saisie de toute la séance.
 */
export function endRun(current: { wod: SingleWod; wod_id?: string; blocks?: BlocksProgress }, run: Run): void {
  const { wod, wod_id, blocks } = current;
  if (!blocks) {
    setSession({ stage: 'score', wod, ...(wod_id && { wod_id }), ...run });
    return navigate('/score', true);
  }
  advance(wod_id, { ...blocks, runs: [...blocks.runs.slice(0, blocks.index), run] });
}

/** Bloc suivant de la séance (après une pause entre les deux), ou saisie du score après le dernier. */
function advance(wod_id: string | undefined, blocks: BlocksProgress): void {
  const index = blocks.runs.length;
  const id = wod_id ? { wod_id } : {};
  if (index >= blocks.wod.blocks.length) {
    setSession({ stage: 'score', wod: blocks.wod, ...id, rounds: 0, marks: [], completed: true, blocks: { ...blocks, index: index - 1 } });
    return navigate('/score', true);
  }
  setSession({ stage: 'next', wod: blocks.wod, ...id, rounds: 0, marks: [], blocks: { ...blocks, index, endedAt: Date.now() } });
  navigate('/next', true);
}

/** Démarre le chrono d'un bloc d'une séance, avec le décompte habituel. */
export function startBlock(wod_id: string | undefined, blocks: BlocksProgress): void {
  const block = blocks.wod.blocks[blocks.index];
  if (!block) return;
  unlockAudio();
  const { endedAt: _, ...running } = blocks;
  setSession({ stage: 'timer', wod: block, ...(wod_id && { wod_id }), clock: newClock(Date.now()), rounds: 0, marks: [], blocks: running });
  navigate('/timer', true);
}

/**
 * Entre deux blocs : ce qui vient d'être fait, la pause qui court, et le bloc suivant, à lancer
 * quand on est prêt. On peut aussi passer ce bloc ou terminer la séance ici.
 */
export function nextBlockView(): View | null {
  const session = getSession();
  if (!session || session.stage !== 'next') return null;
  const { blocks, wod_id } = session;
  const block = blocks.wod.blocks[blocks.index];
  if (!block) return null;
  const doneCount = blocks.runs.filter((run) => run !== null).length;
  const last = blocks.wod.blocks[blocks.index - 1];
  const remaining = blocks.wod.blocks.length - blocks.index;

  const pauseEl = h('strong', { class: 'pause-clock', role: 'timer' });
  const paint = () => {
    const sec = Math.max(0, Math.floor((Date.now() - (blocks.endedAt ?? Date.now())) / 1000));
    pauseEl.textContent = clockText(sec);
  };

  const skip = () => advance(wod_id, { ...blocks, runs: [...blocks.runs, null] });

  const finishNow = async () => {
    const confirmed = await choose(
      'Terminer la séance maintenant ?',
      remaining > 1 ? `Les ${remaining} blocs restants seront notés comme passés.` : 'Le dernier bloc sera noté comme passé.',
      [
        { label: 'Terminer et noter', value: true, kind: 'primary' },
        { label: 'Continuer la séance', value: false },
      ],
    );
    if (!confirmed) return;
    advance(wod_id, { ...blocks, runs: [...blocks.runs, ...Array.from({ length: remaining }, () => null)] });
  };

  const discard = async () => {
    const confirmed = await choose(
      'Abandonner la séance ?',
      doneCount > 0 ? `${plural(doneCount, 'bloc fait')} ne ${doneCount > 1 ? 'seront' : 'sera'} pas enregistré${doneCount > 1 ? 's' : ''}.` : 'Rien ne sera enregistré.',
      [
        { label: 'Abandonner', value: true, kind: 'danger' },
        { label: 'Continuer la séance', value: false },
      ],
    );
    if (!confirmed) return;
    setSession(null);
    navigate(wod_id ? `/wod/${wod_id}` : '/', true);
  };

  const el = h(
    'section',
    { class: 'page between' },
    h('header', { class: 'timer-head' }, h('strong', null, blocks.wod.title), h('span', null, blockStep(blocks))),
    h(
      'div',
      { class: 'pause-box' },
      h('span', { class: 'pause-label' }, last ? `${last.title} : ${blocks.runs.at(-1) === null ? 'passé' : 'terminé'} · pause` : 'Pause'),
      pauseEl,
    ),
    h('h2', { class: 'section-title' }, 'Bloc suivant'),
    h('article', { class: 'sheet' }, blockPlan(block, blocks.index)),
    h(
      'div',
      { class: 'stack' },
      h('button', { class: 'btn primary big block', onclick: () => startBlock(wod_id, blocks) }, `Lancer le bloc ${blocks.index + 1}`),
      h('div', { class: 'row' }, h('button', { class: 'btn grow', onclick: skip }, 'Passer ce bloc'), h('button', { class: 'btn grow', onclick: () => void finishNow() }, 'Terminer la séance')),
      h('button', { class: 'btn ghost danger block', onclick: () => void discard() }, 'Abandonner sans enregistrer'),
    ),
  );

  // Pendant la pause, l'écran reste allumé : le téléphone est posé à côté.
  const wake = screenWake();
  void wake.keep();
  paint();
  const interval = window.setInterval(paint, 500);
  return {
    el,
    destroy() {
      window.clearInterval(interval);
      wake.release();
    },
  };
}
