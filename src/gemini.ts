import coachFormat from './coach-format.md?raw';
import { isObj } from './validate';

/**
 * Coach intégré : l'appli appelle elle-même l'API Gemini de Google (offre gratuite). Google accepte
 * ces appels directement depuis le navigateur ; il n'y a donc pas de serveur entre les deux.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta';
const SETTINGS_KEY = 'wodhard:coach';
const TIMEOUT_MS = 90_000;
/** Nombre maximal de modèles essayés pour en trouver un qui répond. */
const MAX_PROBES = 6;
const PROBE_TEXT = 'Réponds uniquement par l’objet JSON {"ok": true}.';
/** Attentes avant chaque nouvel essai quand Google est surchargé (erreurs 500 et plus). */
const RETRY_DELAYS_MS = [2_000, 6_000];
/** Nombre de modèles de secours gardés pour les moments où le modèle choisi sature. */
const MAX_FALLBACKS = 2;

/**
 * Réglages du coach. Ils restent sur cet appareil et ne font pas partie des sauvegardes :
 * la clé est un secret, et le dépôt de l'appli est public.
 */
export interface CoachSettings {
  key: string;
  model: string;
  /** Modèles essayés si `model` est saturé, trouvés lors de la vérification de la clé. */
  fallbacks: string[];
  /** Profil et consignes de l'athlète, collés dans les réglages. Le format des WOD vient de l'appli. */
  instructions: string;
}

/** Résultat du test d'un modèle : il répond, il n'existe pas pour cette clé, ou il est saturé. */
export type ModelState = 'ok' | 'missing' | 'busy';

/** Un échange de la conversation envoyée à Gemini. */
export interface Turn {
  role: 'user' | 'model';
  text: string;
}

/** Options d'une demande : `json: false` pour une réponse en texte, `extra` ajouté aux instructions. */
export interface GenerateOptions {
  json?: boolean;
  extra?: string;
}

/**
 * Règles de réponse et format des WOD, fournis par l'appli à chaque échange : ils restent ainsi
 * alignés sur le validateur, et l'athlète n'a que son profil à donner.
 */
export const COACH_FORMAT = coachFormat;

/** Message préparé ailleurs dans l'appli (« Comment faire ? » sur un mouvement), repris par la conversation. */
export const CHAT_DRAFT_KEY = 'wodhard:chat-draft';

export class GeminiError extends Error {
  /** Code HTTP renvoyé par Google, quand la réponse en avait un. */
  status?: number;
  /** Erreur 429 avec un quota de 0 : le modèle n'est pas inclus dans l'offre gratuite. */
  notFree = false;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export function loadCoach(): CoachSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (isObj(raw)) {
      const text = (value: unknown) => (typeof value === 'string' ? value : '');
      const fallbacks = Array.isArray(raw.fallbacks) ? raw.fallbacks.filter((name) => typeof name === 'string') : [];
      return { key: text(raw.key), model: text(raw.model), fallbacks, instructions: text(raw.instructions) };
    }
  } catch {
    // Réglages illisibles : le coach est simplement à reconfigurer.
  }
  return { key: '', model: '', fallbacks: [], instructions: '' };
}

export function saveCoach(settings: CoachSettings | null): void {
  try {
    if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    else localStorage.removeItem(SETTINGS_KEY);
  } catch {
    throw new GeminiError('Réglages impossibles à enregistrer : stockage plein ou bloqué.');
  }
}

export const coachReady = (settings: CoachSettings) => settings.key.trim() !== '' && settings.model !== '';

/** Message en français pour une réponse d'erreur de l'API, avec l'explication de Google quand il y en a une. */
export function errorMessage(status: number, body: unknown, model?: string): string {
  const error = isObj(body) && isObj(body.error) ? body.error : {};
  const detail = typeof error.message === 'string' ? error.message : '';
  const code = `erreur ${status}${detail ? ` : ${detail.slice(0, 160)}` : ''}`;
  if (/api key/i.test(detail) || status === 401 || status === 403) {
    return 'Clé API refusée par Google : vérifie-la dans les réglages du coach.';
  }
  if (status === 404) {
    // Google explique la cause en anglais ; on la garde pour pouvoir diagnostiquer.
    const why = detail ? ` (détail : ${detail.slice(0, 160)})` : '';
    return `Modèle indisponible : dans les réglages du coach, appuie sur « Vérifier la clé » pour en choisir un qui répond${why}.`;
  }
  if (status === 429) {
    if (notInFreeTier(detail)) {
      return `Le modèle ${model ?? 'choisi'} n’est pas inclus dans l’offre gratuite : dans les réglages du coach, appuie sur « Vérifier la clé » pour en choisir un autre.`;
    }
    const wait = retryDelay(error, detail);
    const when = wait === undefined ? 'réessaie un peu plus tard' : `réessaie dans ${wait} s`;
    return `Quota gratuit de Gemini atteint${model ? ` pour ${model}` : ''} : ${when} (${code}).`;
  }
  if (status >= 500) {
    const who = model ? `Le modèle ${model}` : 'Gemini';
    return `${who} est indisponible pour le moment (${code}). Réessaie un peu plus tard, ou choisis un autre modèle dans les réglages du coach.`;
  }
  return `Gemini a refusé la demande (erreur ${status}${detail ? ` : ${detail}` : ''}).`;
}

/** Google signale un modèle exclu de l'offre gratuite par un quota de 0. */
const notInFreeTier = (detail: string) => /limit: 0\b/.test(detail);

/** Délai d'attente conseillé par Google après une erreur 429, en secondes. */
function retryDelay(error: Record<string, unknown>, detail: string): number | undefined {
  const details = Array.isArray(error.details) ? error.details : [];
  for (const item of details) {
    if (isObj(item) && typeof item.retryDelay === 'string') return Math.ceil(parseFloat(item.retryDelay));
  }
  const inText = /retry in ([\d.]+)\s*s/i.exec(detail);
  return inText ? Math.ceil(parseFloat(inText[1] ?? '')) : undefined;
}

async function call(path: string, key: string, init?: RequestInit, model?: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), TIMEOUT_MS);
  const separator = path.includes('?') ? '&' : '?';
  let response: Response;
  try {
    response = await fetch(`${API}/${path}${separator}key=${encodeURIComponent(key.trim())}`, {
      ...init,
      signal: controller.signal,
    });
  } catch {
    throw new GeminiError(
      controller.signal.aborted
        ? 'Gemini n’a pas répondu à temps : réessaie.'
        : 'Connexion à Gemini impossible : vérifie ta connexion internet.',
    );
  } finally {
    globalThis.clearTimeout(timer);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = new GeminiError(errorMessage(response.status, body, model), response.status);
    const message = isObj(body) && isObj(body.error) && typeof body.error.message === 'string' ? body.error.message : '';
    failure.notFree = response.status === 429 && notInFreeTier(message);
    throw failure;
  }
  return body;
}

/** Modèles de la réponse de l'API capables de générer du texte, sans le préfixe « models/ ». */
export function textModels(body: unknown): string[] {
  const models = isObj(body) && Array.isArray(body.models) ? body.models : [];
  const names: string[] = [];
  for (const model of models) {
    if (!isObj(model) || typeof model.name !== 'string' || !Array.isArray(model.supportedGenerationMethods)) continue;
    if (model.supportedGenerationMethods.includes('generateContent')) names.push(model.name.replace(/^models\//, ''));
  }
  return names;
}

/** Modèle de texte généraliste, par opposition aux modèles d'image, de voix, d'embeddings… */
const isGeneral = (name: string) => !/(image|tts|audio|live|embedding|vision|learnlm|gemma)/.test(name);

/**
 * Ordre de préférence pour l'offre gratuite : flash d'abord (rapide, quota large), puis flash-lite,
 * les autres, et pro en dernier (quota gratuit faible, voire nul).
 */
const preference = (name: string) => (/flash/.test(name) ? (/lite/.test(name) ? 1 : 0) : /pro/.test(name) ? 3 : 2);

/** Modèles généralistes, du plus au moins adapté à l'offre gratuite ; l'ordre de l'API départage. */
export const rankModels = (models: string[]) => models.filter(isGeneral).sort((a, b) => preference(a) - preference(b));

/** Modèle proposé par défaut : le premier du classement. */
export function preferredModel(models: string[]): string {
  return rankModels(models)[0] ?? models[0] ?? '';
}

const isTransient = (error: unknown) => error instanceof GeminiError && error.status !== undefined && error.status >= 500;
const isMissing = (error: unknown) => error instanceof GeminiError && error.status === 404;
const isQuota = (error: unknown) => error instanceof GeminiError && error.status === 429;

/**
 * Teste un modèle par une toute petite demande : certains figurent dans la liste mais renvoient
 * 404 ou sont exclus de l'offre gratuite, d'autres sont saturés ou ont épuisé leur quota du moment.
 * Une autre erreur (clé, réseau) est levée.
 */
export async function modelState(key: string, model: string): Promise<ModelState> {
  try {
    await call(
      `models/${model}:generateContent`,
      key,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: PROBE_TEXT }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
      model,
    );
    return 'ok';
  } catch (error) {
    if (isMissing(error) || (error instanceof GeminiError && error.notFree)) return 'missing';
    if (isTransient(error) || isQuota(error)) return 'busy';
    throw error;
  }
}

export interface ModelChoice {
  model: string;
  /** Modèles écartés avant de trouver `model`, avec la raison. */
  skipped: { model: string; state: Exclude<ModelState, 'ok'> }[];
  /** Modèles à essayer si `model` sature plus tard : non testés, ou seulement saturés. */
  fallbacks: string[];
}

/**
 * Premier modèle qui répond, en commençant par `first`, puis les autres modèles généralistes
 * de la liste. Un modèle absent ou saturé est écarté ; une autre erreur arrête la recherche.
 */
export async function workingModel(key: string, models: string[], first: string): Promise<ModelChoice> {
  const candidates = [first, ...rankModels(models).filter((name) => name !== first)].slice(0, MAX_PROBES);
  const skipped: ModelChoice['skipped'] = [];
  for (const [index, model] of candidates.entries()) {
    const state = await modelState(key, model);
    if (state === 'ok') {
      const busy = skipped.filter((entry) => entry.state === 'busy').map((entry) => entry.model);
      return { model, skipped, fallbacks: [...candidates.slice(index + 1), ...busy].slice(0, MAX_FALLBACKS) };
    }
    skipped.push({ model, state });
  }
  if (skipped.some((entry) => entry.state === 'busy')) {
    throw new GeminiError('Tous les modèles essayés sont saturés en ce moment : réessaie dans quelques minutes.', 503);
  }
  throw new GeminiError(`Aucun des modèles essayés ne répond : ${skipped.map((entry) => entry.model).join(', ')}.`);
}

/** Vérifie la clé et renvoie les modèles disponibles pour elle. */
export async function listModels(key: string): Promise<string[]> {
  const models = textModels(await call('models?pageSize=200', key));
  if (models.length === 0) throw new GeminiError('Clé acceptée, mais aucun modèle de texte disponible.');
  return models;
}

/** Texte de la première réponse proposée par l'API, ou chaîne vide s'il n'y en a pas. */
export function responseText(body: unknown): string {
  const candidate = isObj(body) && Array.isArray(body.candidates) ? body.candidates[0] : undefined;
  const content = isObj(candidate) && isObj(candidate.content) ? candidate.content : undefined;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  return parts.map((part) => (isObj(part) && typeof part.text === 'string' ? part.text : '')).join('');
}

/**
 * Envoie la conversation au coach et renvoie sa réponse, qu'il doit donner en JSON. Si Google est
 * surchargé, le modèle choisi est réessayé deux fois ; s'il reste saturé, a épuisé son quota ou a
 * disparu, chaque modèle de secours est essayé une fois. `notify` décrit ces essais à l'écran.
 */
export async function generate(
  settings: CoachSettings,
  turns: Turn[],
  notify?: (message: string) => void,
  options: GenerateOptions = {},
): Promise<string> {
  const models = [settings.model, ...settings.fallbacks.filter((name) => name !== settings.model)];
  let lastError: unknown;
  for (const [index, model] of models.entries()) {
    const previous = models[index - 1];
    if (previous) notify?.(`Le modèle ${previous} ne répond pas pour le moment : essai avec ${model}…`);
    for (let attempt = 0; ; attempt++) {
      try {
        return await generateOnce({ ...settings, model }, turns, options);
      } catch (error) {
        lastError = error;
        if (!isTransient(error) && !isQuota(error) && !isMissing(error)) throw error;
        // Seule une surcharge du modèle choisi vaut un nouvel essai ; sinon, on passe au secours.
        const delay = index === 0 && isTransient(error) ? RETRY_DELAYS_MS[attempt] : undefined;
        if (delay === undefined) break;
        notify?.('Gemini est surchargé : nouvel essai dans quelques secondes…');
        await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function generateOnce(settings: CoachSettings, turns: Turn[], options: GenerateOptions): Promise<string> {
  const instructions = [settings.instructions.trim(), options.extra].filter(Boolean).join('\n\n');
  const body = await call(`models/${settings.model}:generateContent`, settings.key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(instructions && { systemInstruction: { parts: [{ text: instructions }] } }),
      contents: turns.map(({ role, text }) => ({ role, parts: [{ text }] })),
      // Pour un WOD, le coach ne répond qu'en JSON : l'appli n'a rien à extraire d'une phrase.
      ...(options.json !== false && { generationConfig: { responseMimeType: 'application/json' } }),
    }),
  }, settings.model);
  const text = responseText(body);
  if (text.trim() === '') {
    const candidate = isObj(body) && Array.isArray(body.candidates) ? body.candidates[0] : undefined;
    const reason = isObj(candidate) && typeof candidate.finishReason === 'string' ? ` (${candidate.finishReason})` : '';
    throw new GeminiError(`Gemini n’a renvoyé aucune réponse${reason} : réessaie.`);
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
