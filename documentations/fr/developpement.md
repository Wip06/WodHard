# Développer WODHARD

*[English version](../en/development.md)*

Pour qui veut modifier l'appli, lancer les tests ou la publier.

## L'essentiel

- **TypeScript sans framework**, construit avec **Vite**. L'interface est faite d'éléments créés par la fonction `h()` de `src/dom.ts`.
- **Appli installable** (PWA, `vite-plugin-pwa`) : elle fonctionne hors ligne et se met à jour au lancement suivant.
- **Pas de serveur** : les données restent dans le stockage du navigateur. Le coach appelle directement l'API d'Anthropic depuis le téléphone, avec la clé de l'utilisateur (`@anthropic-ai/sdk`, seule dépendance de l'appli).
- **Tests** avec Vitest.
- L'interface, les commentaires du code et les messages de commit sont en français.

## Démarrer

Version de Node dans `.nvmrc`.

```bash
npm ci          # installer
npm run dev     # lancer l'appli en local
npm test        # tests
npm run build   # vérifier les types, puis construire dans dist/
npm run preview # servir la version construite, comme en ligne
```

## Où est quoi

| Dossier | Contenu |
|---|---|
| `src/` | Le code. `main.ts` déclare les pages, `router.ts` gère la navigation et la barre du bas, `views/` contient un fichier par écran. |
| `src/store.ts` | Lecture et écriture des données, sauvegardes, historique copié pour le coach. |
| `src/validate.ts` | Vérification de tout ce qui entre : WOD collés, programmes, sauvegardes importées, réponses du coach. Un champ inconnu est refusé. |
| `src/claude.ts` | Le coach : appel à l'API, modèles proposés, messages d'erreur. |
| `test/` | Les tests, un fichier par module testé de `src/` (`validate.test.ts` pour `validate.ts`…). |
| `documentations/` | Les guides, en français (`fr/`) et en anglais (`en/`), et les règles du coach. |
| `public/icons/` | Les icônes de l'appli. |

## Les données

Tout est dans le `localStorage` du navigateur, sous des clés qui commencent par `wodhard:`. Les données principales (WOD, séances, programme, autres sports, objectifs) sont dans `wodhard:data`. Une sauvegarde exportée en est une copie, sans la clé API du coach (`wodhard:coach`).

Le format d'une sauvegarde, d'un WOD et d'un programme est vérifié par `src/validate.ts`. Si tu ajoutes un champ, ajoute-le aussi au validateur, sinon les imports qui le contiennent seront refusés.

## Le coach

Les règles que l'appli envoie au coach, avec chaque message, sont dans [`regles-du-coach.md`](regles-du-coach.md), en français : le coach intégré répond en français. `src/claude.ts` les charge telles quelles. Les mêmes règles servent à qui utilise un coach dans une autre appli d'IA ; leur traduction anglaise est dans [`../en/coach-rules.md`](../en/coach-rules.md).

Si tu changes le format des WOD :

1. Modifie `src/validate.ts`.
2. Mets à jour les règles du coach, en français et en anglais.
3. Lance les tests : ils vérifient que chacun des 9 exemples JSON des deux fichiers est accepté par l'appli.

## La sécurité

- **Aucun HTML brut** : `h()` crée les textes par des nœuds texte, jamais par `innerHTML`. Un WOD collé ou une réponse du coach ne peut donc pas injecter de code. Garde cette règle.
- **Politique de sécurité du contenu (CSP)** : `vite.config.ts` l'ajoute à la page au build seulement. Elle n'autorise que les fichiers de l'appli et les connexions à `https://api.anthropic.com`. Si tu ajoutes une ressource externe ou un autre service, ajoute-le à la politique, puis vérifie la version construite avec `npm run preview`.
- **Styles** : les tailles calculées (jauges, graphiques) passent par `el.style`, que `h()` gère pour l'attribut `style`. La CSP refuse les attributs `style` écrits en dur.

## Publier

Chaque push sur `main` lance `.github/workflows/deploy.yml` : installation, tests, build, puis publication sur GitHub Pages, à l'adresse https://wip06.github.io/WodHard/. Si un test échoue, rien n'est publié.

Les chemins sont relatifs (`base: './'`), donc l'appli fonctionne quel que soit le nom du dépôt.
