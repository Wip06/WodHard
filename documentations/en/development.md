# Developing WODHARD

*[Version française](../fr/developpement.md)*

For anyone who wants to change the app, run the tests or publish it.

## The essentials

- **TypeScript without a framework**, built with **Vite**. The interface is made of elements created by the `h()` function in `src/dom.ts`.
- **Installable app** (PWA, `vite-plugin-pwa`): it works offline and updates the next time it's opened.
- **No server**: data stays in the browser's storage. The coach calls the Anthropic API directly from the phone, with the user's own key (`@anthropic-ai/sdk`, the app's only runtime dependency).
- **Tests** with Vitest.
- The interface, code comments and commit messages are in French.

## Getting started

Node version in `.nvmrc`.

```bash
npm ci          # install
npm run dev     # run the app locally
npm test        # tests
npm run build   # type-check, then build into dist/
npm run preview # serve the built version, as it runs online
```

## Where things are

| Folder | Contents |
|---|---|
| `src/` | The code. `main.ts` declares the pages, `router.ts` handles navigation and the bottom bar, `views/` has one file per screen. |
| `src/store.ts` | Reading and writing data, backups, the history copied for the coach. |
| `src/validate.ts` | Checks everything that comes in: pasted WODs, programs, imported backups, coach replies. Unknown fields are rejected. |
| `src/claude.ts` | The coach: API calls, available models, error messages. |
| `test/` | The tests, one file per tested module of `src/` (`validate.test.ts` for `validate.ts`…). |
| `documentations/` | The guides, in French (`fr/`) and English (`en/`), and the coach rules. |
| `public/icons/` | The app icons. |

## Data

Everything lives in the browser's `localStorage`, under keys starting with `wodhard:`. The main data (WODs, sessions, program, other sports, goals) is in `wodhard:data`. An exported backup is a copy of it, without the coach's API key (`wodhard:coach`).

The format of a backup, a WOD and a program is checked by `src/validate.ts`. If you add a field, add it to the validator too, otherwise imports that contain it will be rejected.

## The coach

The rules the app sends to the coach with each message are in [`../fr/regles-du-coach.md`](../fr/regles-du-coach.md), in French: the built-in coach answers in French. `src/claude.ts` loads them as is. The same rules serve anyone using a coach in another AI app; their English translation is [`coach-rules.md`](coach-rules.md).

If you change the WOD format:

1. Update `src/validate.ts`.
2. Update the coach rules, in French and in English.
3. Run the tests: they check that each of the 9 JSON examples of both files is accepted by the app.

## Security

- **No raw HTML**: `h()` creates text through text nodes, never through `innerHTML`. A pasted WOD or a coach reply therefore can't inject code. Keep it that way.
- **Content Security Policy (CSP)**: `vite.config.ts` adds it to the page at build time only. It only allows the app's own files and connections to `https://api.anthropic.com`. If you add an external resource or another service, add it to the policy, then check the built version with `npm run preview`.
- **Styles**: computed sizes (meters, charts) go through `el.style`, which `h()` handles for the `style` attribute. The CSP rejects hard-coded `style` attributes.

## Publishing

Every push to `main` runs `.github/workflows/deploy.yml`: install, tests, build, then publish to GitHub Pages, at https://wip06.github.io/WodHard/. If a test fails, nothing is published.

Paths are relative (`base: './'`), so the app works whatever the repository is called.
