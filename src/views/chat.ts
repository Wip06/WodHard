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

/** Images pour rattraper le texte reçu : le réseau l'envoie par paquets, l'écran le révèle régulièrement. */
const REVEAL_FRAMES = 6;
/** Attente maximale, en fin de réponse, pour finir de révéler le texte avant d'afficher la bulle finale. */
const SETTLE_MS = 1000;


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
 * Bulle du coach pendant qu'il écrit : trois points, puis le texte révélé à un rythme régulier, déjà
 * mis en forme comme il le sera une fois fini. `onGrow` est appelé quand la bulle grandit.
 */
function writingBubble(onGrow: (bubble: HTMLElement) => void) {
  const dots = h('span', { class: 'dots', 'aria-label': 'Le coach écrit' }, h('i'), h('i'), h('i'));
  const note = h('span', { class: 'typing-note' });
  const status = h('div', { class: 'typing' }, dots, note);
  const body = h('div', { class: 'live-body', hidden: true });
  const el = h('div', { class: 'msg coach writing', role: 'status' }, body, status);
  let received = '';
  let shown = 0;
  let frame = 0;
  let caughtUp: (() => void) | null = null;

  const refresh = () => {
    body.hidden = body.childElementCount === 0;
    dots.hidden = !body.hidden;
    status.hidden = dots.hidden && note.textContent === '';
  };
  const paint = () => {
    frame = 0;
    const backlog = received.length - shown;
    if (backlog > 0) {
      // Plus le retard est grand, plus la révélation accélère : elle ne traîne jamais derrière le coach.
      shown += Math.max(1, Math.ceil(backlog / REVEAL_FRAMES));
      body.replaceChildren(...coachContent(preview(received.slice(0, shown))).filter((node) => node instanceof HTMLElement));
      refresh();
      onGrow(el);
    }
    if (shown < received.length) frame = requestAnimationFrame(paint);
    else {
      caughtUp?.();
      caughtUp = null;
    }
  };

  return {
    el,
    show(text: string): void {
      received = text;
      if (!frame) frame = requestAnimationFrame(paint);
    },
    /** Repart de zéro, avec un message d'attente (le coach corrige sa séance). */
    restart(message: string): void {
      cancelAnimationFrame(frame);
      frame = 0;
      received = '';
      shown = 0;
      body.replaceChildren();
      note.textContent = message;
      refresh();
    },
    /** Attend que tout le texte reçu soit à l'écran. */
    settle(): Promise<void> {
      if (shown >= received.length) return Promise.resolve();
      return new Promise((resolve) => {
        caughtUp = resolve;
        window.setTimeout(resolve, SETTLE_MS);
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
  /** Suit la réponse tant que son début reste à l'écran ; au-delà, elle se lit à son rythme, sans saut. */
  const follow = (bubble: HTMLElement) => {
    const header = document.querySelector('.chat-head')?.getBoundingClientRect().bottom ?? 0;
    if (bubble.getBoundingClientRect().top > header + 12) scrollToEnd();
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
    const asked = userBubble(text);
    const writing = writingBubble(follow);
    thread.append(asked, writing.el);
    scrollToEnd();
    try {
      const reply = await answer(withContext(messages), writing);
      await writing.settle();
      const bubble = coachBubble(reply);
      writing.el.replaceWith(bubble);
      follow(bubble);
      messages = [...messages, { role: 'model', text: reply }];
      saveChat(messages);
    } catch (error) {
      // Le message n'a pas eu de réponse : il revient dans le champ, prêt à être renvoyé.
      writing.stop();
      asked.remove();
      writing.el.remove();
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
