import { demoUrl, parseReply, proposesWod, type Block, type Inline } from '../chatText';
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

/** Aperçu de la réponse en cours d'écriture : le texte, sans le JSON d'une séance tant qu'il n'est pas fini. */
function preview(text: string): string {
  const fence = text.indexOf('```');
  return fence === -1 ? text : `${text.slice(0, fence).trimEnd()}\n\nSéance en cours d’écriture…`;
}

const renderLine = (parts: Inline[]) => parts.map((part) => (part.bold ? h('strong', null, part.text) : part.text));

function renderBlocks(blocks: Block[]): HTMLElement[] {
  return blocks.map((block) =>
    block.kind === 'p'
      ? h('p', null, block.lines.flatMap((line, i) => [i > 0 && h('br'), ...renderLine(line)]))
      : h(block.kind, null, block.lines.map((line) => h('li', null, renderLine(line)))),
  );
}

/** Bulle du coach : texte mis en forme, liens de démonstration et bouton d'ajout d'une séance valide. */
function coachBubble(text: string): HTMLElement {
  const { blocks, demos, proposal } = parseReply(text);
  return h(
    'div',
    { class: 'msg coach' },
    renderBlocks(blocks),
    demos.map((name) =>
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
  );
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
  const typingNote = h('span', { class: 'typing-note' });
  const dots = h('span', { class: 'dots', 'aria-label': 'Le coach écrit' }, h('i'), h('i'), h('i'));
  const live = h('p', { class: 'live', hidden: true });
  const typing = h('div', { class: 'msg coach typing', role: 'status' }, dots, live, typingNote);
  /** Affiche la réponse au fil de l'eau, une fois par image au plus. */
  let pending: string | null = null;
  const showLive = (text: string) => {
    if (pending === null) {
      requestAnimationFrame(() => {
        live.textContent = preview(pending ?? '');
        live.hidden = live.textContent === '';
        dots.hidden = !live.hidden;
        pending = null;
        scrollToEnd();
      });
    }
    pending = text;
  };
  const resetLive = () => {
    pending = null;
    live.textContent = '';
    live.hidden = true;
    dots.hidden = false;
  };

  const scrollToEnd = () => window.scrollTo({ top: document.documentElement.scrollHeight });
  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  };

  function renderThread(waiting = false): void {
    thread.replaceChildren(
      ...(messages.length > 0 ? [] : [coachBubble(WELCOME)]),
      ...messages.map((message) =>
        message.role === 'user' ? h('div', { class: 'msg user' }, h('p', null, message.text)) : coachBubble(message.text),
      ),
      ...(waiting ? [typing] : []),
    );
  }

  /** Une réponse qui propose un WOD illisible par l'appli est renvoyée une fois au coach pour correction. */
  async function answer(turns: Turn[]): Promise<string> {
    const options = { extra: COACH_FORMAT, onText: showLive };
    const first = await generate(coach, turns, options);
    const proposed = proposesWod(first) ? parseImport(first) : null;
    if (!proposed || proposed.ok) return first;
    resetLive();
    typingNote.textContent = 'Séance refusée par l’appli : le coach la corrige…';
    const correction: Turn[] = [...turns, { role: 'model', text: first }, { role: 'user', text: correctionRequest(proposed.errors) }];
    return generate(coach, correction, options);
  }

  async function send(): Promise<void> {
    const text = input.value.trim();
    if (text === '') return toast('Écris d’abord ton message');
    if (sendBtn.disabled) return;
    // Le contexte est fixé au premier message : la suite de la conversation ne le reconstruit pas.
    const turn: ChatTurn = messages.length === 0 ? { role: 'user', text, context: currentContext() } : { role: 'user', text };
    messages = trim([...messages, turn]);
    input.value = '';
    grow();
    errorBox.hidden = true;
    sendBtn.disabled = true;
    typingNote.textContent = '';
    resetLive();
    renderThread(true);
    scrollToEnd();
    try {
      const reply = await answer(withContext(messages));
      messages = [...messages, { role: 'model', text: reply }];
      saveChat(messages);
    } catch (error) {
      // Le message n'a pas eu de réponse : il revient dans le champ, prêt à être renvoyé.
      messages = messages.slice(0, -1);
      input.value = text;
      grow();
      errorBox.textContent = error instanceof CoachError ? error.message : 'Erreur inattendue : réessaie.';
      errorBox.hidden = false;
    } finally {
      sendBtn.disabled = false;
      renderThread();
      scrollToEnd();
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
