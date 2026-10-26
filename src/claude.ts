import type Anthropic from '@anthropic-ai/sdk';
import type { APIError } from '@anthropic-ai/sdk';
import coachFormat from './coach-format.md?raw';
import { isObj } from './validate';

/**
 * Coach intégré : l'appli appelle elle-même l'API Claude d'Anthropic, depuis le navigateur, avec la
 * clé de l'athlète. Il n'y a pas de serveur entre les deux ; chaque message est facturé sur son compte.
 */

const SETTINGS_KEY = 'wodhard:coach';
/** Plafond de la réponse, réflexion comprise. La réponse arrive en continu, sans risque de délai dépassé. */
const MAX_TOKENS = 32_000;
const TIMEOUT_MS = 180_000;
/** Profondeur de réflexion : assez pour un programme cohérent, sans faire durer une simple question. */
const EFFORT = 'medium';

export interface CoachModel {
  id: string;
  label: string;
  note: string;
}

/** Modèles proposés, du plus capable au plus économique. */
export const MODELS: CoachModel[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Le plus capable : le meilleur pour tes programmes.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Plus rapide, environ deux fois moins cher qu’Opus.' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Très rapide et très économique, pour des questions simples.' },
];
export const DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * Modèles qui acceptent le repli côté serveur : si Claude décline une demande, l'API la reprend
 * aussitôt sur un autre modèle, dans le même appel.
 */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Réglages du coach. Ils restent sur cet appareil et ne font pas partie des sauvegardes :
 * la clé est un secret, et le dépôt de l'appli est public.
 */
export interface CoachSettings {
  key: string;
  model: string;
  /** Profil et consignes de l'athlète, collés dans les réglages. Le format des WOD vient de l'appli. */
  instructions: string;
}

/** Un échange de la conversation. `model` désigne le coach (nom gardé pour les conversations enregistrées). */
export interface Turn {
  role: 'user' | 'model';
  text: string;
}

export interface GenerateOptions {
  /** Ajouté aux consignes du profil : les règles et le format des WOD fournis par l'appli. */
  extra?: string;
  /** Texte reçu jusqu'ici, à chaque nouveau morceau de la réponse. */
  onText?: (text: string) => void;
  /** Pour les tests : remplace l'accès réseau. */
  fetch?: typeof fetch;
}

/**
 * Règles de réponse et format des WOD, fournis par l'appli à chaque échange : ils restent ainsi
 * alignés sur le validateur, et l'athlète n'a que son profil à donner.
 */
export const COACH_FORMAT = coachFormat;

/** Message préparé ailleurs dans l'appli (« Comment faire ? » sur un mouvement), repris par la conversation. */
export const CHAT_DRAFT_KEY = 'wodhard:chat-draft';

export class CoachError extends Error {
  /** Code HTTP renvoyé par l'API, quand il y en a un. */
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** Réglages enregistrés. Ceux de l'ancien coach Gemini perdent leur clé, mais gardent le profil. */
export function loadCoach(): CoachSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (isObj(raw)) {
      const text = (value: unknown) => (typeof value === 'string' ? value : '');
      const settings = { key: text(raw.key), model: text(raw.model), instructions: text(raw.instructions) };
      if (settings.model.startsWith('gemini') || settings.key.startsWith('AIza')) {
        const migrated = { key: '', model: DEFAULT_MODEL, instructions: settings.instructions };
        // La clé Google n'a plus d'usage : elle ne reste pas sur l'appareil.
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return settings;
    }
  } catch {
    // Réglages illisibles : le coach est simplement à reconfigurer.
  }
  return { key: '', model: DEFAULT_MODEL, instructions: '' };
}

export function saveCoach(settings: CoachSettings | null): void {
  try {
    if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    else localStorage.removeItem(SETTINGS_KEY);
  } catch {
    throw new CoachError('Réglages impossibles à enregistrer : stockage plein ou bloqué.');
  }
}

export const coachReady = (settings: CoachSettings) => settings.key.trim() !== '' && settings.model !== '';

export const modelLabel = (id: string) => MODELS.find((model) => model.id === id)?.label ?? id;

type Sdk = typeof import('@anthropic-ai/sdk');
let sdk: Promise<Sdk> | undefined;
/** Le SDK n'est chargé qu'au premier échange avec le coach : l'appli s'ouvre aussi vite qu'avant. */
const loadSdk = () => (sdk ??= import('@anthropic-ai/sdk'));

function client(mod: Sdk, key: string, fetchImpl?: typeof fetch): Anthropic {
  return new mod.default({
    apiKey: key.trim(),
    // L'appli n'a pas de serveur : la clé de l'athlète, gardée sur son appareil, part du navigateur.
    dangerouslyAllowBrowser: true,
    timeout: TIMEOUT_MS,
    ...(fetchImpl && { fetch: fetchImpl }),
  });
}

/** Explication renvoyée par l'API dans le corps d'une erreur, quand il y en a une. */
function apiDetail(error: APIError): string {
  const body = error.error;
  if (isObj(body) && isObj(body.error) && typeof body.error.message === 'string') return body.error.message;
  return '';
}

/** Message en français pour une erreur de l'API ou du réseau ; sans `mod`, le SDK n'a pas pu être chargé. */
function coachError(error: unknown, mod: Sdk | undefined): CoachError {
  if (error instanceof CoachError) return error;
  if (!mod) return new CoachError('Impossible de joindre le coach : vérifie ta connexion, puis réessaie.');
  const Anthropic = mod.default;
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new CoachError('Claude met trop de temps à répondre : réessaie.');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new CoachError('Connexion à Claude impossible : vérifie ton réseau, puis réessaie.');
  }
  if (!(error instanceof Anthropic.APIError)) return new CoachError('Erreur inattendue : réessaie.');
  const detail = apiDetail(error);
  const explained = detail ? ` (${detail})` : '';
  if (error instanceof Anthropic.AuthenticationError) {
    return new CoachError('Clé API refusée : vérifie-la dans les réglages du coach. Une clé Claude commence par « sk-ant- ».', 401);
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new CoachError(`Cette clé n’a pas accès à ce modèle${explained}. Vérifie ton compte sur console.anthropic.com.`, 403);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new CoachError('Modèle introuvable pour cette clé : choisis-en un autre dans les réglages du coach.', 404);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new CoachError('Trop de demandes pour le moment : réessaie dans une minute.', 429);
  }
  if (error instanceof Anthropic.BadRequestError) {
    // Un crédit épuisé arrive aussi sous cette forme : l'explication de l'API le dit.
    return new CoachError(`Claude a refusé la demande${explained}. Si ton crédit est épuisé, recharge-le sur console.anthropic.com.`, 400);
  }
  if (error.status === 529 || error instanceof Anthropic.InternalServerError) {
    return new CoachError('Claude est surchargé pour le moment : réessaie un peu plus tard.', error.status);
  }
  return new CoachError(`Erreur de l’API Claude${error.status ? ` (${error.status})` : ''}${explained} : réessaie.`, error.status);
}

/**
 * Vérifie la clé et l'accès au modèle, sans rien générer ni facturer : un simple comptage de tokens.
 * (La liste des modèles ne convient pas : ses refus n'autorisent pas la lecture depuis un navigateur.)
 */
export async function checkKey(key: string, model: string, fetchImpl?: typeof fetch): Promise<string> {
  let mod: Sdk | undefined;
  try {
    mod = await loadSdk();
    await client(mod, key, fetchImpl).messages.countTokens({ model, messages: [{ role: 'user', content: 'ok' }] });
    return modelLabel(model);
  } catch (error) {
    throw coachError(error, mod);
  }
}

/** Corps de la demande : profil et règles de l'appli en consignes, puis la conversation. */
export function buildRequest(settings: CoachSettings, turns: Turn[], extra?: string) {
  const system = [settings.instructions.trim(), extra].filter(Boolean).join('\n\n');
  return {
    model: settings.model,
    max_tokens: MAX_TOKENS,
    ...(system && { system }),
    messages: turns.map(({ role, text }) => ({ role: role === 'model' ? ('assistant' as const) : ('user' as const), content: text })),
    // Consignes et début de conversation identiques d'un message à l'autre : relus depuis le cache, à moindre coût.
    cache_control: { type: 'ephemeral' as const },
    output_config: { effort: EFFORT } as const,
    ...(FALLBACK_MODELS.has(settings.model) && { betas: [FALLBACK_BETA], fallbacks: 'default' as const }),
  };
}

/** Texte de la réponse : seuls les blocs de texte comptent (la réflexion et les marques de repli sont ignorées). */
export function replyText(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim();
}

/** Envoie la conversation et renvoie la réponse du coach, affichée au fil de l'eau avec `onText`. */
export async function generate(settings: CoachSettings, turns: Turn[], options: GenerateOptions = {}): Promise<string> {
  let message: Anthropic.Beta.BetaMessage;
  let mod: Sdk | undefined;
  try {
    mod = await loadSdk();
    const stream = client(mod, settings.key, options.fetch).beta.messages.stream(buildRequest(settings, turns, options.extra));
    let received = '';
    stream.on('text', (delta) => {
      received += delta;
      options.onText?.(received);
    });
    message = await stream.finalMessage();
  } catch (error) {
    throw coachError(error, mod);
  }
  if (message.stop_reason === 'refusal') {
    throw new CoachError('Claude a décliné cette demande : reformule-la autrement.');
  }
  const text = replyText(message);
  if (text === '') {
    throw new CoachError(
      message.stop_reason === 'max_tokens' ? 'Réponse trop longue, coupée avant la fin : demande plus court.' : 'Claude n’a renvoyé aucune réponse : réessaie.',
    );
  }
  return text;
}

/** Message renvoyé au coach quand l'appli refuse sa réponse, pour qu'il la corrige. */
export function correctionRequest(errors: string[]): string {
  return [
    'L’application WODHARD a refusé ta réponse :',
    ...errors.map((error) => `- ${error}`),
    'Corrige ces points et renvoie uniquement le JSON complet, au même format.',
  ].join('\n');
}
