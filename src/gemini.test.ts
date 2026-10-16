import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseImport } from './validate';
import {
  COACH_FORMAT,
  coachReady,
  correctionRequest,
  errorMessage,
  GeminiError,
  generate,
  preferredModel,
  rankModels,
  responseText,
  textModels,
  workingModel,
} from './gemini';

describe('coach Gemini', () => {
  it('ne garde que les modèles qui savent générer du texte', () => {
    const body = {
      models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 42 },
      ],
    };
    expect(textModels(body)).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(textModels(null)).toEqual([]);
  });

  it('propose un modèle flash généraliste par défaut', () => {
    expect(preferredModel(['gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-image'])).toBe('gemini-2.5-flash');
    expect(preferredModel(['gemma-3-27b-it', 'gemini-2.5-pro'])).toBe('gemini-2.5-pro');
    expect(preferredModel([])).toBe('');
  });

  it('classe les modèles : flash, flash-lite, autres, pro en dernier', () => {
    expect(rankModels(['gemini-2.5-pro', 'gemini-x', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-tts', 'gemini-2.5-flash'])).toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-x',
      'gemini-2.5-pro',
    ]);
  });

  it('assemble le texte de la réponse', () => {
    const body = { candidates: [{ content: { parts: [{ text: '{"schema_version"' }, { text: ': 1}' }] } }] };
    expect(responseText(body)).toBe('{"schema_version": 1}');
    expect(responseText({ candidates: [] })).toBe('');
    expect(responseText({ promptFeedback: { blockReason: 'SAFETY' } })).toBe('');
  });

  it('traduit les erreurs de l’API', () => {
    const invalidKey = { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } };
    expect(errorMessage(400, invalidKey)).toMatch(/^Clé API refusée/);
    expect(errorMessage(403, null)).toMatch(/^Clé API refusée/);
    expect(errorMessage(404, null)).toMatch(/^Modèle indisponible/);
    expect(errorMessage(404, { error: { message: 'models/x is not found for API version v1beta' } })).toContain('(détail : models/x is not found for API version v1beta)');
    expect(errorMessage(429, null)).toMatch(/^Quota gratuit/);
    const perMinute = {
      error: {
        message: 'You exceeded your current quota. Please retry in 37.4s.',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' }],
      },
    };
    expect(errorMessage(429, perMinute, 'gemini-x')).toBe(
      'Quota gratuit de Gemini atteint pour gemini-x : réessaie dans 37 s (erreur 429 : You exceeded your current quota. Please retry in 37.4s.).',
    );
    expect(errorMessage(429, { error: { message: 'Please retry in 12.2s.' } })).toContain('réessaie dans 13 s');
    const notFree = { error: { message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-x-pro' } };
    expect(errorMessage(429, notFree, 'gemini-x-pro')).toBe(
      'Le modèle gemini-x-pro n’est pas inclus dans l’offre gratuite : dans les réglages du coach, appuie sur « Vérifier la clé » pour en choisir un autre.',
    );
    expect(errorMessage(503, null)).toMatch(/indisponible/);
    expect(errorMessage(503, { error: { message: 'The model is overloaded. Please try again later.' } }, 'gemini-x')).toBe(
      'Le modèle gemini-x est indisponible pour le moment (erreur 503 : The model is overloaded. Please try again later.). Réessaie un peu plus tard, ou choisis un autre modèle dans les réglages du coach.',
    );
    expect(errorMessage(400, { error: { message: 'Bad request' } })).toBe('Gemini a refusé la demande (erreur 400 : Bad request).');
  });

  describe('recherche d’un modèle qui répond', () => {
    afterEach(() => vi.unstubAllGlobals());

    /** Simule Google : chaque modèle répond avec le code indiqué, 200 par défaut. */
    const stubGoogle = (codes: Record<string, number>) => {
      const tried: string[] = [];
      vi.stubGlobal('fetch', async (url: string) => {
        const model = /models\/([^:]+):generateContent/.exec(url)?.[1] ?? '';
        tried.push(model);
        const status = codes[model] ?? 200;
        return new Response(JSON.stringify(status === 200 ? { candidates: [] } : { error: { message: 'nope' } }), { status });
      });
      return tried;
    };

    it('garde le modèle proposé quand il répond, et les suivants en secours', async () => {
      const tried = stubGoogle({});
      await expect(workingModel('k', ['gemini-a-flash', 'gemini-b-pro'], 'gemini-a-flash')).resolves.toEqual({
        model: 'gemini-a-flash',
        skipped: [],
        fallbacks: ['gemini-b-pro'],
      });
      expect(tried).toEqual(['gemini-a-flash']);
    });

    it('passe au suivant quand un modèle renvoie 404, sans essayer les modèles spécialisés', async () => {
      const tried = stubGoogle({ 'gemini-a-flash': 404 });
      const result = await workingModel('k', ['gemini-a-flash', 'gemini-tts', 'gemini-b-pro'], 'gemini-a-flash');
      expect(result).toEqual({ model: 'gemini-b-pro', skipped: [{ model: 'gemini-a-flash', state: 'missing' }], fallbacks: [] });
      expect(tried).toEqual(['gemini-a-flash', 'gemini-b-pro']);
    });

    it('écarte un modèle saturé mais le garde en secours', async () => {
      stubGoogle({ 'gemini-a-flash': 503 });
      const result = await workingModel('k', ['gemini-a-flash', 'gemini-b-pro'], 'gemini-a-flash');
      expect(result).toEqual({ model: 'gemini-b-pro', skipped: [{ model: 'gemini-a-flash', state: 'busy' }], fallbacks: ['gemini-a-flash'] });
    });

    it('écarte un modèle hors offre gratuite et garde en secours celui dont le quota est épuisé', async () => {
      const replies: Record<string, Response> = {};
      vi.stubGlobal('fetch', async (url: string) => {
        const model = /models\/([^:]+):generateContent/.exec(url)?.[1] ?? '';
        if (model === 'gemini-a-pro') return new Response(JSON.stringify({ error: { message: 'Quota exceeded, limit: 0' } }), { status: 429 });
        if (model === 'gemini-b-flash') return new Response(JSON.stringify({ error: { message: 'Please retry in 30s.' } }), { status: 429 });
        return replies[model] ?? new Response(JSON.stringify({ candidates: [] }), { status: 200 });
      });
      const result = await workingModel('k', ['gemini-a-pro', 'gemini-b-flash', 'gemini-c-flash-lite'], 'gemini-a-pro');
      expect(result).toEqual({
        model: 'gemini-c-flash-lite',
        skipped: [
          { model: 'gemini-a-pro', state: 'missing' },
          { model: 'gemini-b-flash', state: 'busy' },
        ],
        fallbacks: ['gemini-b-flash'],
      });
    });

    it('prévient quand tous les modèles sont saturés', async () => {
      stubGoogle({ 'gemini-a-flash': 503, 'gemini-b-pro': 500 });
      await expect(workingModel('k', ['gemini-a-flash', 'gemini-b-pro'], 'gemini-a-flash')).rejects.toThrow(/sont saturés en ce moment/);
    });

    it('s’arrête sur une erreur qui ne dépend pas du modèle, comme une clé refusée', async () => {
      stubGoogle({ 'gemini-a-flash': 403 });
      await expect(workingModel('k', ['gemini-a-flash', 'gemini-b-pro'], 'gemini-a-flash')).rejects.toMatchObject({ status: 403 });
    });

    it('signale quand aucun modèle ne répond', async () => {
      stubGoogle({ 'gemini-a-flash': 404, 'gemini-b-pro': 404 });
      await expect(workingModel('k', ['gemini-a-flash', 'gemini-b-pro'], 'gemini-a-flash')).rejects.toBeInstanceOf(GeminiError);
    });
  });

  describe('génération', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    const settings = { key: 'k', model: 'gemini-x', fallbacks: [], instructions: 'coach' };
    const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    const overloaded = () => new Response(JSON.stringify({ error: { message: 'The model is overloaded.' } }), { status: 503 });

    it('réessaie quand Google est surchargé, puis rend la réponse', async () => {
      vi.useFakeTimers();
      const replies = [overloaded(), overloaded(), ok('{"a":1}')];
      vi.stubGlobal('fetch', async () => replies.shift());
      let retries = 0;
      const answer = generate(settings, [{ role: 'user', text: 'x' }], () => retries++);
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(answer).resolves.toBe('{"a":1}');
      expect(retries).toBe(2);
    });

    it('abandonne après trois surcharges, avec le détail de Google', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', async () => overloaded());
      const answer = generate(settings, [{ role: 'user', text: 'x' }]);
      const outcome = expect(answer).rejects.toThrow('Le modèle gemini-x est indisponible pour le moment (erreur 503 : The model is overloaded.)');
      await vi.advanceTimersByTimeAsync(8_000);
      await outcome;
    });

    it('bascule sur un modèle de secours quand le modèle choisi reste saturé', async () => {
      vi.useFakeTimers();
      const models: string[] = [];
      vi.stubGlobal('fetch', async (url: string) => {
        const model = /models\/([^:]+):generateContent/.exec(url)?.[1] ?? '';
        models.push(model);
        return model === 'gemini-x' ? overloaded() : ok('{"b":2}');
      });
      const notes: string[] = [];
      const answer = generate({ ...settings, fallbacks: ['gemini-y'] }, [{ role: 'user', text: 'x' }], (note) => notes.push(note));
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(answer).resolves.toBe('{"b":2}');
      expect(models).toEqual(['gemini-x', 'gemini-x', 'gemini-x', 'gemini-y']);
      expect(notes.at(-1)).toBe('Le modèle gemini-x ne répond pas pour le moment : essai avec gemini-y…');
    });

    it('passe tout de suite au secours quand le quota du modèle choisi est épuisé', async () => {
      const models: string[] = [];
      vi.stubGlobal('fetch', async (url: string) => {
        const model = /models\/([^:]+):generateContent/.exec(url)?.[1] ?? '';
        models.push(model);
        return model === 'gemini-x' ? new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }) : ok('{"c":3}');
      });
      await expect(generate({ ...settings, fallbacks: ['gemini-y'] }, [{ role: 'user', text: 'x' }])).resolves.toBe('{"c":3}');
      expect(models).toEqual(['gemini-x', 'gemini-y']);
    });

    it('en mode question : réponse en texte et consignes ajoutées aux instructions', async () => {
      let sent: { systemInstruction: { parts: { text: string }[] }; generationConfig?: unknown } | undefined;
      vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return ok('Parce que tu débutes.');
      });
      await expect(generate(settings, [{ role: 'user', text: 'Pourquoi ?' }], undefined, { json: false, extra: 'MODE' })).resolves.toBe('Parce que tu débutes.');
      expect(sent?.systemInstruction.parts[0]?.text).toBe('coach\n\nMODE');
      expect(sent?.generationConfig).toBeUndefined();
    });

    it('sans profil : seul le format de l’appli part dans les instructions', async () => {
      let sent: { systemInstruction?: { parts: { text: string }[] } } | undefined;
      vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return ok('ok');
      });
      await generate({ ...settings, instructions: '  ' }, [{ role: 'user', text: 'x' }], undefined, { json: false, extra: 'FORMAT' });
      expect(sent?.systemInstruction?.parts[0]?.text).toBe('FORMAT');
    });

    it('ne réessaie pas une clé refusée', async () => {
      let calls = 0;
      vi.stubGlobal('fetch', async () => {
        calls++;
        return new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 });
      });
      await expect(generate(settings, [{ role: 'user', text: 'x' }])).rejects.toThrow(/^Clé API refusée/);
      expect(calls).toBe(1);
    });
  });

  it('fournit au coach un format dont tous les exemples sont acceptés par l’appli', () => {
    expect(COACH_FORMAT.startsWith('# Règles de l’application WODHARD'.replace('’', "'"))).toBe(true);
    const blocks = [...COACH_FORMAT.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
    expect(blocks).toHaveLength(8);
    for (const block of blocks) expect(parseImport(block)).toMatchObject({ ok: true });
  });

  it('considère le coach prêt avec une clé et un modèle, même sans profil', () => {
    expect(coachReady({ key: 'k', model: 'm', fallbacks: [], instructions: '' })).toBe(true);
    expect(coachReady({ key: '', model: 'm', fallbacks: [], instructions: 'profil' })).toBe(false);
  });

  it('renvoie au coach la liste des erreurs à corriger', () => {
    expect(correctionRequest(['title : champ manquant', 'type : doit valoir "amrap"'])).toBe(
      'L’application WODHARD a refusé ta réponse :\n- title : champ manquant\n- type : doit valoir "amrap"\nCorrige ces points et renvoie uniquement le JSON complet, au même format.',
    );
  });
});
