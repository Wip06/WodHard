import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRequest,
  checkKey,
  COACH_FORMAT,
  CoachError,
  coachReady,
  correctionRequest,
  DEFAULT_MODEL,
  generate,
  loadCoach,
  replyText,
  type CoachSettings,
} from './claude';
import { parseImport } from './validate';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
});

const settings: CoachSettings = { key: 'sk-ant-test', model: 'claude-opus-5-5', instructions: 'Profil : intermédiaire.' };

/** Réponse en flux, au format des évènements de l'API Messages. */
function sse(events: Record<string, unknown>[]): Response {
  const body = events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function textStream(parts: string[], stop_reason = 'end_turn'): Response {
  return sse([
    {
      type: 'message_start',
      message: { id: 'msg_1', type: 'message', role: 'assistant', model: settings.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...parts.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]);
}

function apiError(status: number, type: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json', 'x-should-retry': 'false', ...headers },
  });
}

/** Faux réseau : enregistre les demandes et rend les réponses prévues, dans l'ordre. */
function fakeFetch(...responses: Response[]) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> | null }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url: String(input), headers: new Headers(init?.headers), body });
    const next = responses.shift();
    if (!next) throw new Error('aucune réponse prévue');
    return next;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

beforeEach(() => memory.clear());

describe('réglages du coach', () => {
  it('propose Claude Opus 5.5 par défaut, et n’est prêt qu’avec une clé', () => {
    expect(loadCoach()).toEqual({ key: '', model: DEFAULT_MODEL, instructions: '' });
    expect(coachReady(settings)).toBe(true);
    expect(coachReady({ ...settings, key: '  ' })).toBe(false);
  });

  it('oublie la clé de l’ancien coach Gemini mais garde le profil', () => {
    memory.set('wodhard:coach', JSON.stringify({ key: 'AIzaSyTEST', model: 'gemini-2.5-flash', fallbacks: ['gemini-2.5-flash-lite'], instructions: 'Mon profil' }));
    expect(loadCoach()).toEqual({ key: '', model: 'claude-opus-5-5', instructions: 'Mon profil' });
    expect(memory.get('wodhard:coach')).not.toContain('AIza');
  });
});

describe('demande envoyée à Claude', () => {
  it('met le profil puis les règles de l’appli en consignes, et la conversation en messages', () => {
    const request = buildRequest(settings, [{ role: 'user', text: 'Un WOD ?' }, { role: 'model', text: 'Voici.' }, { role: 'user', text: 'Merci' }], 'RÈGLES');
    expect(request).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'Profil : intermédiaire.\n\nRÈGLES',
      messages: [
        { role: 'user', content: 'Un WOD ?' },
        { role: 'assistant', content: 'Voici.' },
        { role: 'user', content: 'Merci' },
      ],
      cache_control: { type: 'ephemeral' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(request.max_tokens).toBeGreaterThanOrEqual(16_000);
  });

  it('sans repli côté serveur pour Haiku, et sans consignes vides', () => {
    const request = buildRequest({ ...settings, model: 'claude-haiku-5-5', instructions: '' }, [{ role: 'user', text: 'Salut' }]);
    expect(request).not.toHaveProperty('fallbacks');
    expect(request).not.toHaveProperty('betas');
    expect(request).not.toHaveProperty('system');
  });

  it('ne garde que le texte de la réponse', () => {
    const message = {
      content: [
        { type: 'thinking', thinking: '', signature: 's' },
        { type: 'text', text: 'Bonjour ' },
        { type: 'text', text: 'champion' },
      ],
    } as unknown as Parameters<typeof replyText>[0];
    expect(replyText(message)).toBe('Bonjour champion');
  });
});

describe('génération', () => {
  it('reçoit la réponse au fil de l’eau, depuis le navigateur, avec la clé de l’athlète', async () => {
    const { impl, calls } = fakeFetch(textStream(['Bon', 'jour !']));
    const seen: string[] = [];
    const reply = await generate(settings, [{ role: 'user', text: 'Salut' }], { extra: 'RÈGLES', onText: (text) => seen.push(text), fetch: impl });
    expect(reply).toBe('Bonjour !');
    expect(seen).toEqual(['Bon', 'Bonjour !']);
    const [call] = calls;
    expect(call?.url).toContain('https://api.anthropic.com/v1/messages');
    // Le SDK envoie la clé API en « Authorization: Bearer ».
    expect(call?.headers.get('authorization')).toBe('Bearer sk-ant-test');
    expect(call?.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(call?.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(call?.body).toMatchObject({ stream: true, fallbacks: 'default', system: 'Profil : intermédiaire.\n\nRÈGLES' });
  });

  it('prévient quand Claude décline la demande', async () => {
    const { impl } = fakeFetch(textStream([], 'refusal'));
    await expect(generate(settings, [{ role: 'user', text: '…' }], { fetch: impl })).rejects.toThrow('Claude a décliné cette demande');
  });

  it('traduit les erreurs de l’API', async () => {
    const cases: [Response, string, number | undefined][] = [
      [apiError(401, 'authentication_error', 'invalid x-api-key'), 'Clé API refusée', 401],
      [apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'), 'Your credit balance is too low', 400],
      [apiError(429, 'rate_limit_error', 'Too many requests'), 'Trop de demandes', 429],
      [apiError(529, 'overloaded_error', 'Overloaded'), 'surchargé', 529],
      [apiError(404, 'not_found_error', 'model: claude-x'), 'Modèle introuvable', 404],
    ];
    for (const [response, message, status] of cases) {
      const { impl } = fakeFetch(response);
      const error = await generate(settings, [{ role: 'user', text: 'Salut' }], { fetch: impl }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CoachError);
      expect((error as CoachError).message).toContain(message);
      expect((error as CoachError).status).toBe(status);
    }
  });

  it('vérifie la clé sur le modèle choisi par un comptage de tokens, sans générer de texte', async () => {
    const { impl, calls } = fakeFetch(new Response(JSON.stringify({ input_tokens: 8 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await checkKey('sk-ant-test', 'claude-opus-5-5', impl)).toBe('Claude Opus 5.5');
    expect(calls[0]?.url).toContain('/v1/messages/count_tokens');
    expect(calls[0]?.body).toMatchObject({ model: 'claude-opus-5-5' });
    const refused = fakeFetch(apiError(401, 'authentication_error', 'invalid x-api-key'));
    await expect(checkKey('sk-ant-bad', 'claude-opus-5-5', refused.impl)).rejects.toThrow('Clé API refusée');
  });
});

describe('format fourni au coach', () => {
  it('ne contient que des exemples acceptés par l’appli', () => {
    expect(COACH_FORMAT.startsWith("# Règles de l'application WODHARD")).toBe(true);
    const blocks = [...COACH_FORMAT.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
    expect(blocks).toHaveLength(9);
    for (const block of blocks) expect(parseImport(block)).toMatchObject({ ok: true });
  });

  it('renvoie au coach la liste des erreurs à corriger', () => {
    expect(correctionRequest(['title : champ manquant', 'type : doit valoir "amrap"'])).toBe(
      'L’application WODHARD a refusé ta réponse :\n- title : champ manquant\n- type : doit valoir "amrap"\nCorrige ces points et renvoie uniquement le JSON complet, au même format.',
    );
  });
});
