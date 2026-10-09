import { playCue, unlockAudio } from '../audio';
import { h, toast } from '../dom';
import { clock as clockText, duration } from '../format';
import {
  DEFAULT_CONFIG,
  freeClock,
  freeCues,
  freeFrame,
  freeTotalMs,
  type FreeConfig,
  type FreeFrame,
  type FreeMode,
} from '../freeTimer';
import { navigate, type View } from '../router';
import { elapsedMs, pause, resume, type Clock } from '../timer';
import { isObj } from '../validate';
import { screenWake } from '../wake';
import { field, pageHead } from './parts';

const CONFIG_KEY = 'wodhard:chrono';
const TICK_MS = 100;
/** Au-delà de cet écart entre deux rafraîchissements (appli en arrière-plan), les bips manqués sont ignorés. */
const MAX_CUE_GAP_MS = 1500;
const URGENT_SEC = 3;

const MODES: { mode: FreeMode; label: string }[] = [
  { mode: 'intervals', label: 'Intervalles' },
  { mode: 'countdown', label: 'Minuteur' },
  { mode: 'stopwatch', label: 'Chrono' },
];

const PRESETS = [
  { label: 'Tabata 20/10 × 8', work: 20, rest: 10, rounds: 8 },
  { label: '30/30 × 10', work: 30, rest: 30, rounds: 10 },
  { label: 'EMOM 10 min', work: 60, rest: 0, rounds: 10 },
];

/** Chrono lancé. Il vit en mémoire : il survit à un changement d'écran, pas à la fermeture de l'appli. */
let running: { config: FreeConfig; clock: Clock } | null = null;

function loadConfig(): FreeConfig {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null');
    if (!isObj(raw)) return DEFAULT_CONFIG;
    const int = (value: unknown, fallback: number, min: number) =>
      typeof value === 'number' && Number.isInteger(value) && value >= min ? value : fallback;
    return {
      mode: MODES.find(({ mode }) => mode === raw.mode)?.mode ?? DEFAULT_CONFIG.mode,
      durationSec: int(raw.durationSec, DEFAULT_CONFIG.durationSec, 1),
      workSec: int(raw.workSec, DEFAULT_CONFIG.workSec, 1),
      restSec: int(raw.restSec, DEFAULT_CONFIG.restSec, 0),
      rounds: int(raw.rounds, DEFAULT_CONFIG.rounds, 1),
      leadIn: typeof raw.leadIn === 'boolean' ? raw.leadIn : DEFAULT_CONFIG.leadIn,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(config: FreeConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Réglages non mémorisés : le chrono démarre quand même.
  }
}

/** Entier positif ou nul saisi dans un champ ; NaN si ce n'en est pas un. Un champ vide vaut 0. */
const int = (value: string) => (value.trim() === '' ? 0 : /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN);

function describe(config: FreeConfig): { title: string; summary: string } {
  switch (config.mode) {
    case 'stopwatch':
      return { title: 'Chrono', summary: 'Sans limite de temps' };
    case 'countdown':
      return { title: 'Minuteur', summary: duration(config.durationSec) };
    case 'intervals': {
      const rest = config.restSec > 0 ? ` / ${duration(config.restSec)} de repos` : '';
      return { title: 'Intervalles', summary: `${config.rounds} × ${duration(config.workSec)}${rest}` };
    }
  }
}

export function chronoView(): View {
  if (running) {
    history.replaceState(null, '', '#/chrono/run');
    return chronoRunView();
  }
  const saved = loadConfig();
  let mode = saved.mode;
  const draft = {
    durationMin: String(Math.floor(saved.durationSec / 60)),
    durationSec: saved.durationSec % 60 === 0 ? '' : String(saved.durationSec % 60),
    work: String(saved.workSec),
    rest: String(saved.restSec),
    rounds: String(saved.rounds),
  };

  const params = h('div', { class: 'stack' });
  const summary = h('p', { class: 'hint' });
  const leadIn = h('input', { type: 'checkbox', checked: saved.leadIn });

  /** Réglages saisis, ou null s'ils ne permettent pas de lancer le mode choisi. */
  function read(): FreeConfig | null {
    const config: FreeConfig = { ...saved, mode, leadIn: leadIn.checked };
    if (mode === 'countdown') {
      config.durationSec = int(draft.durationMin) * 60 + int(draft.durationSec);
      return config.durationSec >= 1 ? config : null;
    }
    if (mode === 'intervals') {
      config.workSec = int(draft.work);
      config.restSec = int(draft.rest);
      config.rounds = int(draft.rounds);
      return config.workSec >= 1 && config.restSec >= 0 && config.rounds >= 1 ? config : null;
    }
    return config;
  }

  function refreshSummary(): void {
    const config = read();
    if (!config) summary.textContent = 'Réglages à compléter.';
    else if (mode === 'intervals') summary.textContent = `Durée totale : ${duration(freeTotalMs(config) / 1000)}`;
    else summary.textContent = mode === 'stopwatch' ? 'Chronomètre sans limite de temps.' : '';
  }

  function input(key: keyof typeof draft, label: string): HTMLInputElement {
    const el = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': label });
    el.value = draft[key];
    el.addEventListener('input', () => {
      draft[key] = el.value;
      refreshSummary();
    });
    return el;
  }

  function renderParams(): void {
    if (mode === 'intervals') {
      params.replaceChildren(
        field('Travail', input('work', 'Travail'), 's'),
        field('Repos', input('rest', 'Repos'), 's'),
        field('Tours', input('rounds', 'Tours')),
        h(
          'div',
          { class: 'presets' },
          PRESETS.map((preset) =>
            h(
              'button',
              {
                type: 'button',
                class: 'btn',
                onclick: () => {
                  Object.assign(draft, { work: String(preset.work), rest: String(preset.rest), rounds: String(preset.rounds) });
                  renderParams();
                },
              },
              preset.label,
            ),
          ),
        ),
      );
    } else if (mode === 'countdown') {
      params.replaceChildren(field('Durée', input('durationMin', 'Minutes'), 'min', input('durationSec', 'Secondes'), 's'));
    } else {
      params.replaceChildren();
    }
    refreshSummary();
  }

  const modeButtons = MODES.map((option) =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn grow',
        'aria-pressed': String(option.mode === mode),
        onclick: () => {
          mode = option.mode;
          modeButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(MODES[i]?.mode === mode)));
          renderParams();
        },
      },
      option.label,
    ),
  );

  const start = () => {
    const config = read();
    if (!config) return toast('Réglages à compléter');
    saveConfig(config);
    unlockAudio();
    running = { config, clock: freeClock(config, Date.now()) };
    navigate('/chrono/run');
  };

  renderParams();
  leadIn.addEventListener('change', refreshSummary);

  const el = h(
    'section',
    { class: 'page' },
    pageHead('Chrono libre'),
    h('p', { class: 'lead' }, 'Un chrono sans WOD ni score : échauffement, Tabata, temps de repos…'),
    h('div', { class: 'segmented' }, modeButtons),
    params,
    h('label', { class: 'check' }, leadIn, h('span', null, 'Décompte de 10 secondes avant le départ')),
    summary,
    h('button', { class: 'btn primary big block', onclick: start }, 'Démarrer'),
  );
  return { el, tab: 'chrono' };
}

export function chronoRunView(): View {
  if (!running) {
    history.replaceState(null, '', '#/chrono');
    return chronoView();
  }
  const state = running;
  const { config } = state;
  const total = freeTotalMs(config);
  const { title, summary } = describe(config);
  const now = () => elapsedMs(state.clock, Date.now());

  const phaseEl = h('p', { class: 'timer-phase' });
  const clockEl = h('p', { class: 'timer-clock', role: 'timer' });
  const subEl = h('p', { class: 'timer-sub' });
  const pauseBtn = h('button', { class: 'btn grow', onclick: togglePause });
  const runBar = h('div', { class: 'row' }, pauseBtn, h('button', { class: 'btn grow', onclick: close }, 'Arrêter'));
  const restartBtn = h('button', { class: 'btn primary big block', onclick: restart }, 'Recommencer');
  const closeBtn = h('button', { class: 'btn ghost block', onclick: close }, 'Fermer');

  const el = h(
    'section',
    { class: 'timer' },
    h('header', { class: 'timer-head' }, h('strong', null, title), h('span', null, summary)),
    h('div', { class: 'timer-face free' }, phaseEl, clockEl, subEl),
    h('div', { class: 'timer-controls' }, runBar, restartBtn, closeBtn),
  );

  function phaseText(f: FreeFrame, paused: boolean): string {
    if (paused) return 'En pause';
    if (f.phase === 'countdown') return 'Prêt ?';
    if (f.phase === 'done') return 'Terminé !';
    if (config.mode === 'intervals') return f.resting ? 'Repos' : 'Travail';
    return config.mode === 'countdown' ? 'Temps restant' : 'Temps écoulé';
  }

  function paint(): void {
    const f = freeFrame(config, now());
    const done = f.phase === 'done';
    const paused = state.clock.resumedAt === null && !done;
    const active = f.phase === 'running';

    el.dataset.phase = paused ? 'paused' : f.phase;
    el.dataset.kind = active && f.resting ? 'rest' : 'work';
    el.toggleAttribute('data-urgent', active && config.mode !== 'stopwatch' && f.seconds <= URGENT_SEC);

    const text = f.phase === 'countdown' ? String(f.seconds) : clockText(f.seconds);
    if (clockEl.textContent !== text) clockEl.textContent = text;
    phaseEl.textContent = phaseText(f, paused);
    subEl.textContent = config.mode === 'intervals' ? `Tour ${f.round + 1} / ${config.rounds}` : '';
    pauseBtn.textContent = paused ? 'Reprendre' : 'Pause';
    runBar.hidden = done;
    restartBtn.hidden = closeBtn.hidden = !done;
  }

  const wake = screenWake();
  let lastMs = now();

  function tick(): void {
    const ms = now();
    if (ms - lastMs <= MAX_CUE_GAP_MS) freeCues(config, lastMs, ms).forEach(playCue);
    lastMs = ms;
    paint();
    if (ms >= total) wake.release();
  }

  function togglePause(): void {
    unlockAudio();
    state.clock = state.clock.resumedAt === null ? resume(state.clock, Date.now()) : pause(state.clock, Date.now());
    lastMs = now();
    paint();
  }

  function restart(): void {
    unlockAudio();
    state.clock = freeClock(config, Date.now());
    lastMs = now();
    void wake.keep();
    paint();
  }

  function close(): void {
    running = null;
    navigate('/chrono', true);
  }

  function onVisibility(): void {
    if (document.visibilityState !== 'visible') return;
    unlockAudio();
    if (now() < total) void wake.keep();
    tick();
  }

  const interval = window.setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', onVisibility);
  if (now() < total) void wake.keep();
  paint();

  return {
    el,
    destroy() {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      wake.release();
    },
  };
}
