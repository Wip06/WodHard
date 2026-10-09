/**
 * Garde l'écran allumé entre `keep` et `release`. Si le navigateur refuse (économie d'énergie,
 * onglet masqué), rien ne casse : le chrono reste juste, seul l'écran peut s'éteindre.
 */
export function screenWake(): { keep: () => Promise<void>; release: () => void } {
  let lock: WakeLockSentinel | null = null;
  let wanted = false;
  return {
    async keep() {
      wanted = true;
      if (!('wakeLock' in navigator) || (lock && !lock.released)) return;
      try {
        const acquired = await navigator.wakeLock.request('screen');
        // `release` a pu être appelé pendant l'attente.
        if (wanted) lock = acquired;
        else void acquired.release();
      } catch {
        // Refusé : sans conséquence sur le chrono.
      }
    },
    release() {
      wanted = false;
      void lock?.release();
      lock = null;
    },
  };
}
