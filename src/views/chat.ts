import { demoUrl, parseReply, preview, proposesWod, type Block, type Inline } from '../chatText';
import { choose, h, toast } from '../dom';
import { today } from '../format';
import {
  CHAT_DRAFT_KEY,
  COACH_FORMAT,
  CoachError,
  coachReady,
  correctionRequest,
  generate,
  loadCoach,
  modelLabel,
  type Turn,
} from '../claude';
import type { View } from '../router';
import { buildHistory } from '../store';
import { isObj, parseImport } from '../validate';
import { pageHead } from './parts';
import { saveImport } from './wods';

const CHAT_KEY = 'wodhard:coach-chat';
const HISTORY_LIMIT = 30;
/** Messages gardés : au-delà, les plus anciens sont oubliés, pour que les demandes restent courtes. */
const MAX_MESSAGES = 20;

/** Hauteur maximale du champ de saisie avant qu'il ne défile, en pixels. */
const INPUT_MAX_HEIGHT = 140;

/**
 * Un message de la conversation. Le premier message de l'athlète garde le contexte (date du jour et
 * historique) tel qu'il était au début : la conversation envoyée ne change alors qu'en s'allongeant,
 * et son début est relu depuis le cache à chaque message.
 */
interface ChatTurn extends Turn {
  context?: string;
}

/** Conversation en cours, gardée sur cet appareil pour la retrouver en revenant sur l'écran. */
function loadChat(): ChatTurn[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CHAT_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (message): message is ChatTurn =>
          isObj(message) && (message.role === 'user' || message.role === 'model') && typeof message.text === 'string',
      )
      .map(({ role, text, context }) => (typeof context === 'string' ? { role, text, context } : { role, text }));
  } catch {
    return [];
  }
}

function saveChat(messages: ChatTurn[]): void {
  try {
    if (messages.length > 0) localStorage.setItem(CHAT_KEY, JSON.stringify(messages));
    else localStorage.removeItem(CHAT_KEY);
  } catch {
    // Conversation non mémorisée : elle reste affichée tant que l'écran est ouvert.
  }
}

/** Message préparé par « Comment faire ? » sur une fiche WOD, repris une seule fois. */
function takeDraft(): string {
  try {
    const draft = sessionStorage.getItem(CHAT_DRAFT_KEY) ?? '';
    sessionStorage.removeItem(CHAT_DRAFT_KEY);
    return draft;
  } catch {
    return '';
  }
}

/** Garde les derniers messages, en commençant toujours par un message de l'athlète. */
function trim(messages: ChatTurn[]): ChatTurn[] {
  const kept = messages.slice(-MAX_MESSAGES);
  while (kept[0]?.role === 'model') kept.shift();
  return kept;
}

/** Contexte donné au coach au début d'une conversation : la date du jour et l'historique. */
function currentContext(): string {
  const history = buildHistory(HISTORY_LIMIT);
  const context = [`Date du jour : ${today()}`];
  if (history.entries.length > 0 || history.planned || history.activities) context.push(JSON.stringify(history));
  return context.join('\n\n');
}

/** Le premier message porte le contexte ; une conversation plus ancienne que ce réglage le reçoit à jour. */
function withContext(messages: ChatTurn[]): Turn[] {
  return messages.map((message, i) =>
    i === 0
      ? { role: message.role, text: `${message.context ?? currentContext()}\n\nQuestion : ${message.text}` }
      : { role: message.role, text: message.text },
  );
}

/**
 * Révélation du texte : le réseau l'envoie par paquets irréguliers, l'écran le montre à un rythme
 * lissé, avec en moyenne ce retard sur le texte reçu. Assez long pour ne jamais se vider entre deux
 * paquets, assez court pour suivre le coach.
 */
const REVEAL_LAG_MS = 400;
/** Une fois la réponse complète, le reste s'affiche plus vite. */
const FINISH_LAG_MS = 120;
/** Vitesse minimale, en caractères par seconde, pour que la fin d'une réponse ne traîne pas. */
const MIN_REVEAL_CPS = 60;
/** Attente maximale, en fin de réponse, pour finir de révéler le texte avant d'afficher la bulle finale. */
const SETTLE_MS = 1500;
/** Durée du défilement qui monte la question en haut de l'écran : le texte ne s'écrit qu'après. */
const SCROLL_MS = 450;

/**
 * Fin du mot qui contient la position `index` : le texte se révèle mot par mot, pour qu'un mot ne
 * s'écrive jamais lettre à lettre au bord de la bulle avant de sauter à la ligne. Un dernier mot
 * peut-être incomplet attend la suite, sauf quand la réponse est finie.
 */
function wordEnd(text: string, index: number, complete: boolean): number {
  let end = index;
  while (end < text.length && !/\s/.test(text.charAt(end))) end++;
  if (end < text.length || complete) return end;
  for (let i = index - 1; i >= 0; i--) if (/\s/.test(text.charAt(i))) return i;
  return 0;
}


const renderLine = (parts: Inline[]) => parts.map((part) => (part.bold ? h('strong', null, part.text) : part.text));

function renderBlocks(blocks: Block[]): HTMLElement[] {
  return blocks.map((block) =>
    block.kind === 'p'
      ? h('p', null, block.lines.flatMap((line, i) => [i > 0 && h('br'), ...renderLine(line)]))
      : h(block.kind, null, block.lines.map((line) => h('li', null, renderLine(line)))),
  );
}

/** Contenu d'une bulle du coach : texte mis en forme, liens de démonstration et bouton d'ajout d'une séance valide. */
function coachContent(text: string): (HTMLElement | false | null | undefined)[] {
  const { blocks, demos, proposal } = parseReply(text);
  return [
    ...renderBlocks(blocks),
    ...demos.map((name) =>
      h('a', { class: 'demo', href: demoUrl(name), target: '_blank', rel: 'noopener' }, `▶ Démo vidéo : ${name}`),
    ),
    proposal?.ok &&
      h(
        'button',
        { class: 'btn primary block', onclick: () => saveImport(proposal.value) },
        proposal.value.kind === 'wod'
          ? `Ajouter « ${proposal.value.wod.title} » à mes WOD`
          : `Ajouter ce programme (${proposal.value.items.length} WOD)`,
      ),
    proposal &&
      !proposal.ok &&
      h('p', { class: 'note' }, 'L’appli ne peut pas lire la séance proposée : demande au coach de la corriger.'),
  ];
}

const coachBubble = (text: string) => h('div', { class: 'msg coach' }, coachContent(text));

/**
 * Bulle du coach pendant qu'il écrit : trois points, puis le texte révélé mot par mot à un rythme
 * régulier, déjà mis en forme comme il le sera une fois fini.
 */
function writingBubble(holdMs = 0) {
  const dots = h('span', { class: 'dots', 'aria-label': 'Le coach écrit' }, h('i'), h('i'), h('i'));
  const note = h('span', { class: 'typing-note' });
  const status = h('div', { class: 'typing' }, dots, note);
  const body = h('div', { class: 'live-body', hidden: true });
  const el = h('div', { class: 'msg coach writing', role: 'status' }, body, status);
  let received = '';
  /** Position révélée, en caractères (fractionnaire : elle avance un peu à chaque image). */
  let position = 0;
  /** Caractères affichés, arrêtés à la fin d'un mot. */
  let shown = 0;
  let complete = false;
  let frame = 0;
  let last: number | undefined;
  let caughtUp: (() => void) | null = null;
  const startAt = performance.now() + holdMs;

  const refresh = () => {
    body.hidden = body.childElementCount === 0;
    dots.hidden = !body.hidden;
    status.hidden = dots.hidden && note.textContent === '';
  };
  const paint = (now: number) => {
    frame = 0;
    if (now < startAt) {
      frame = requestAnimationFrame(paint);
      return;
    }
    // Pas de temps réel entre deux images : le rythme est le même à 60 ou 120 images par seconde.
    const elapsed = Math.min(now - (last ?? now), 100);
    last = now;
    const backlog = received.length - position;
    if (backlog > 0) {
      const lag = complete ? FINISH_LAG_MS : REVEAL_LAG_MS;
      position = Math.min(received.length, position + Math.max((MIN_REVEAL_CPS * elapsed) / 1000, (backlog * elapsed) / lag));
    }
    const cut = wordEnd(received, Math.floor(position), complete);
    if (cut > shown) {
      shown = cut;
      body.replaceChildren(...coachContent(preview(received.slice(0, shown))).filter((node) => node instanceof HTMLElement));
      refresh();
    }
    if (shown >= received.length && complete) {
      caughtUp?.();
      caughtUp = null;
    } else if (position < received.length || (complete && shown < received.length)) {
      frame = requestAnimationFrame(paint);
    } else {
      // Tout est révélé sauf peut-être un mot en cours : on attend le prochain paquet.
      last = undefined;
    }
  };
  const run = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };

  return {
    el,
    show(text: string): void {
      received = text;
      run();
    },
    /** Repart de zéro, avec un message d'attente (le coach corrige sa séance). */
    restart(message: string): void {
      cancelAnimationFrame(frame);
      frame = 0;
      last = undefined;
      received = '';
      position = 0;
      shown = 0;
      complete = false;
      body.replaceChildren();
      note.textContent = message;
      refresh();
    },
    /** La réponse est complète : attend que tout son texte soit à l'écran. */
    settle(text: string): Promise<void> {
      received = text;
      complete = true;
      if (shown >= received.length) return Promise.resolve();
      return new Promise((resolve) => {
        caughtUp = resolve;
        window.setTimeout(resolve, SETTLE_MS);
        run();
      });
    },
    stop(): void {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

const WELCOME = [
  'Salut ! Je suis ton coach.',
  '',
  'Demande-moi une séance, en solo ou en duo, un programme, ou comment faire un mouvement : je connais ton profil et ton historique.',
].join('\n');

export function chatView(): View {
  const coach = loadCoach();
  if (!coachReady(coach)) {
    const el = h(
      'section',
      { class: 'page' },
      pageHead('Demander au coach', { href: '#/', label: 'WOD' }),
      h(
        'div',
        { class: 'notice' },
        h('p', null, 'Configure le coach Claude pour lui demander tes séances et lui poser tes questions, sans quitter l’appli.'),
        h('a', { class: 'btn block', href: '#/coach' }, 'Configurer le coach Claude'),
      ),
      h(
        'p',
        { class: 'hint left' },
        'Tu passes par Claude ? Copie ton historique depuis l’onglet Données, colle-le dans ton projet, puis rapporte sa réponse avec « Coller un WOD ».',
      ),
    );
    return { el, tab: 'wods' };
  }

  let messages = loadChat();
  const thread = h('div', { class: 'chat', 'aria-live': 'polite' });
  const errorBox = h('div', { class: 'errors chat-error', role: 'alert', hidden: true });
  const input = h('textarea', { rows: 1, 'aria-label': 'Ton message', placeholder: 'Écris au coach…' });
  const sendBtn = h('button', { type: 'submit', class: 'send', 'aria-label': 'Envoyer' }, '↑');
  const scrollToEnd = () => window.scrollTo({ top: document.documentElement.scrollHeight });
  /** Espace réservé sous la dernière question, pour que la réponse s'y écrive sans faire défiler l'écran. */
  let lastTurn: HTMLElement | null = null;
  /**
   * Monte la question en haut de l'écran, une seule fois et en douceur, et réserve la place de la
   * réponse en dessous : elle s'écrit ensuite sans que rien ne bouge. Une réponse plus longue que
   * l'écran se lit en faisant défiler soi-même.
   */
  const makeRoom = (asked: HTMLElement, turn: HTMLElement) => {
    const header = document.querySelector('.chat-head')?.getBoundingClientRect().height ?? 0;
    const composer = document.querySelector('.composer')?.getBoundingClientRect().height ?? 0;
    turn.style.minHeight = `${Math.max(0, window.innerHeight - header - composer - asked.offsetHeight - 40)}px`;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, asked.getBoundingClientRect().top + window.scrollY - header - 12), behavior: smooth ? 'smooth' : 'auto' });
  };
  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  };

  const userBubble = (text: string) => h('div', { class: 'msg user' }, h('p', null, text));

  function renderThread(): void {
    thread.replaceChildren(
      ...(messages.length > 0 ? [] : [coachBubble(WELCOME)]),
      ...messages.map((message) => (message.role === 'user' ? userBubble(message.text) : coachBubble(message.text))),
    );
  }

  /** Une réponse qui propose un WOD illisible par l'appli est renvoyée une fois au coach pour correction. */
  async function answer(turns: Turn[], writing: ReturnType<typeof writingBubble>): Promise<string> {
    const options = { extra: COACH_FORMAT, onText: (text: string) => writing.show(text) };
    const first = await generate(coach, turns, options);
    const proposed = proposesWod(first) ? parseImport(first) : null;
    if (!proposed || proposed.ok) return first;
    writing.restart('Séance refusée par l’appli : le coach la corrige…');
    const correction: Turn[] = [...turns, { role: 'model', text: first }, { role: 'user', text: correctionRequest(proposed.errors) }];
    return generate(coach, correction, options);
  }

  async function send(): Promise<void> {
    const text = input.value.trim();
    if (text === '') return toast('Écris d’abord ton message');
    if (sendBtn.disabled) return;
    // Le contexte est fixé au premier message : la suite de la conversation ne le reconstruit pas.
    const starting = messages.length === 0;
    const turn: ChatTurn = starting ? { role: 'user', text, context: currentContext() } : { role: 'user', text };
    messages = trim([...messages, turn]);
    input.value = '';
    grow();
    errorBox.hidden = true;
    sendBtn.disabled = true;
    // Les bulles s'ajoutent à la suite : rien de ce qui est déjà affiché n'est redessiné.
    if (starting) thread.replaceChildren();
    // L'espace gardé sous la réponse précédente n'a plus lieu d'être.
    if (lastTurn) lastTurn.style.minHeight = '';
    const asked = userBubble(text);
    const writing = writingBubble(SCROLL_MS);
    const room = h('div', { class: 'turn' }, writing.el);
    lastTurn = room;
    thread.append(asked, room);
    makeRoom(asked, room);
    try {
      const reply = await answer(withContext(messages), writing);
      await writing.settle(reply);
      writing.el.replaceWith(coachBubble(reply));
      messages = [...messages, { role: 'model', text: reply }];
      saveChat(messages);
    } catch (error) {
      // Le message n'a pas eu de réponse : il revient dans le champ, prêt à être renvoyé.
      writing.stop();
      asked.remove();
      room.remove();
      lastTurn = null;
      messages = messages.slice(0, -1);
      if (messages.length === 0) renderThread();
      input.value = text;
      grow();
      errorBox.textContent = error instanceof CoachError ? error.message : 'Erreur inattendue : réessaie.';
      errorBox.hidden = false;
      scrollToEnd();
    } finally {
      sendBtn.disabled = false;
    }
  }

  async function reset(): Promise<void> {
    if (messages.length === 0) return;
    const confirmed = await choose('Nouvelle conversation ?', 'La conversation actuelle sera effacée.', [
      { label: 'Effacer', value: true, kind: 'danger' },
      { label: 'Annuler', value: false },
    ]);
    if (!confirmed) return;
    messages = [];
    saveChat(messages);
    renderThread();
  }

  input.addEventListener('input', grow);
  // Sur ordinateur, Entrée envoie et Maj+Entrée va à la ligne ; sur téléphone, Entrée va à la ligne.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || !window.matchMedia('(pointer: fine)').matches) return;
    event.preventDefault();
    void send();
  });

  const draft = takeDraft();
  if (draft) input.value = draft;
  renderThread();

  const el = h(
    'section',
    { class: 'chat-page' },
    h(
      'header',
      { class: 'chat-head' },
      h('a', { class: 'icon-btn', href: '#/', 'aria-label': 'Retour' }, '‹'),
      h('div', { class: 'chat-title' }, h('strong', null, 'Coach'), h('span', null, modelLabel(coach.model))),
      h('button', { class: 'icon-btn', 'aria-label': 'Nouvelle conversation', onclick: () => void reset() }, '✎'),
      h('a', { class: 'icon-btn', href: '#/coach', 'aria-label': 'Réglages du coach' }, '⚙'),
    ),
    thread,
    errorBox,
    h(
      'form',
      {
        class: 'composer',
        onsubmit: (event) => {
          event.preventDefault();
          void send();
        },
      },
      input,
      sendBtn,
    ),
    h('p', { class: 'chat-privacy' }, 'Tes messages, ton profil et ton historique sont envoyés à Anthropic (Claude).'),
  );

  // Ouvre la conversation sur le dernier message, et sur le champ quand un message est préparé.
  requestAnimationFrame(() => {
    scrollToEnd();
    grow();
    if (draft) input.focus();
  });
  return { el };
}
