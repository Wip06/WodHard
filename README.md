# WODHARD

Ton carnet de WOD sur téléphone : ton programme, le chrono, tes scores, ta progression et, si tu veux, un coach qui te prépare tes séances.

## 1. Ouvrir et installer l'appli

Ouvre ce lien sur ton téléphone : **https://wip06.github.io/WODHARD/**

Puis installe-la sur ton écran d'accueil :

- **iPhone** (Safari) : bouton Partager › **Sur l'écran d'accueil**.
- **Android** (Chrome) : menu ⋮ › **Installer l'application** (ou **Ajouter à l'écran d'accueil**).

Ne saute pas cette étape : installée, l'appli s'ouvre en plein écran, et Safari n'efface plus ses données au bout de 7 jours sans ouverture. Les mises à jour arrivent toutes seules, au lancement suivant.

## 2. La règle d'or : tes données restent sur ton téléphone

- Pas de compte, pas de serveur : tes WOD, tes scores et tes objectifs sont enregistrés **uniquement sur ce téléphone**. Personne d'autre ne les voit, pas même la personne qui t'a donné le lien.
- Rien n'est partagé entre appareils : l'appli sur ton téléphone et celle sur ton ordinateur sont deux carnets séparés.
- **Exporte une sauvegarde régulièrement** : menu ☰ › **Réglages** › **Exporter mes données**, puis **Enregistrer un fichier** ou **Copier dans le presse-papiers** (à coller dans une note ou un mail). L'appli te le rappelle sur l'écran WOD quand des séances ne sont dans aucune sauvegarde.
- Supprimer l'appli de l'écran d'accueil ou effacer les données du navigateur efface aussi tes séances : exporte avant.
- **Changement de téléphone** : exporte sur l'ancien, puis sur le nouveau, menu ☰ › **Réglages** › **Importer une sauvegarde**. Tu choisis alors de **fusionner** avec ce qui s'y trouve déjà ou de **tout remplacer**.

## 3. Le coach (facultatif)

L'appli marche très bien sans coach : tu peux créer tes WOD à la main. Le coach te prépare des séances et des programmes adaptés à ton profil et à ton historique. Deux façons de l'utiliser :

### Option A : le coach dans l'appli (payant, à l'usage)

Il te faut ta propre clé API Anthropic. Elle est facturée à chaque message sur ton compte, et elle n'est pas comprise dans les abonnements Pro ou Max d'Anthropic.

1. Sur [console.anthropic.com](https://console.anthropic.com/), ajoute du crédit (Billing) et **fixe une limite de dépense mensuelle** : tu ne pourras jamais dépasser ce montant.
2. Crée une clé (API keys › Create key). Elle commence par `sk-ant-`.
3. Dans l'appli : onglet **Coach** › **Configurer le coach**. Colle ta clé, choisis le modèle, remplis ton profil, puis **Enregistrer**.

Conseils :

- **Le modèle** : Opus est le plus capable, le meilleur pour un programme sur plusieurs semaines. Sonnet est plus rapide et environ deux fois moins cher. Haiku est très économique, pour des questions simples.
- **Le profil** fait toute la différence : plus il est précis, plus les séances te ressemblent. Un exemple juste en dessous.
- Ta clé reste sur ton téléphone et ne fait pas partie des sauvegardes. Ne la partage pas : tout message envoyé avec elle est facturé sur ton compte.
- À chaque message, ton profil et ton historique sont envoyés à Anthropic.

#### Exemple de « Profil et consignes »

Copie-le dans le champ **Profil et consignes**, puis remplace chaque ligne par ce qui te correspond :

```text
Niveau : intermédiaire, 2 ans de CrossFit, 4 séances par semaine.
Repères : back squat 110 kg (1RM), deadlift 140 kg, clean & jerk 75 kg,
8 pull-ups stricts, double-unders OK, pas encore de muscle-up. 5 km en 24 min.
Matériel : box complète lundi, mercredi et vendredi. Le week-end à la maison :
kettlebells 16 et 24 kg, barre de traction, corde à sauter.
Durée : 60 minutes échauffement compris ; 30 minutes maximum le midi en semaine.
Contraintes : épaule gauche fragile, pas de kipping ni de snatch lourd.
Pas de gros volume de jambes la veille d'une sortie longue en course.
Objectifs : Hyrox en mars (Open), back squat à 120 kg, premier muscle-up.
Préférences : j'aime les AMRAP et les chippers, moins les EMOM longs.
Consignes : réponds en français, court et direct. Explique en une phrase
les mouvements techniques et donne une option plus facile pour chacun.
```

Inutile d'y décrire le format des WOD : l'appli le fournit au coach. Tes objectifs de **Suivi**, ton historique et ton programme lui sont aussi envoyés à chaque conversation : ici, mets ce que l'appli ne sait pas (ta box, tes horaires, tes douleurs, ta façon d'aimer t'entraîner…). Ton profil évolue ? Mets-le à jour dans les mêmes réglages.

Pour l'option B, le même texte va dans la partie « Mon profil » des instructions.

### Option B : un coach dans une autre appli d'IA

Si tu utilises déjà une appli d'IA, tu peux t'en servir comme coach, sans clé API :

1. Crée-y un projet, ou une conversation avec des instructions personnalisées, et colle-y le contenu de [docs/instructions-projet-claude.md](docs/instructions-projet-claude.md). Remplis la partie « Mon profil ».
2. Dans WODHARD : menu ☰ › **Réglages** › **Copier mon historique pour le coach**, et colle-le dans la conversation avec ta demande (« un WOD de 20 minutes pour ce soir », « mon programme de la semaine »…).
3. Copie le bloc JSON de sa réponse, puis dans WODHARD : onglet **WOD** › **Coller un WOD** › **Coller depuis le presse-papiers**.

### Que demander au coach ?

Parle-lui comme à un coach en box : dis-lui combien de temps tu as, le matériel du jour, ton état de forme et ce que tu veux travailler. Dans l'appli, il connaît déjà ton profil, ton historique, ton programme et tes objectifs : inutile de les répéter.

Quelques exemples :

- **Le WOD du jour** : « J'ai 30 minutes ce midi, juste des kettlebells et une corde à sauter. Quelque chose d'intense, mais j'ai les jambes lourdes de la course d'hier. »
- **De la force** : « Une séance de squat en montée de charge, puis un petit metcon de 10 minutes. »
- **En duo** : « Un WOD à deux pour samedi, avec ma copine qui débute. » Il te pose d'abord quelques questions sur votre niveau, puis il adapte la séance à chacun.
- **Un programme** : « Mon programme de la semaine prochaine : 4 séances, lundi, mardi, jeudi et samedi, avec du gym et du moteur. »
- **Préparer une course** : « Mon Hyrox est dans 8 semaines : prépare-moi les 2 prochaines semaines, avec une simulation. »
- **Une question** : « Comment progresser en double-unders ? », « Quelle charge prendre pour Fran ? », « Pourquoi mes temps stagnent sur les WOD longs ? »

Quand il propose une séance, touche **Voir la séance**, puis **Ajouter à mes WOD à faire**. Un programme s'ajoute de la même façon, avec ses dates.

Deux raccourcis :

- Après une séance, le bouton **Avis du coach** lui envoie ton score pour qu'il le commente.
- Dans **Suivi**, **Demander l'analyse au coach** lui envoie un résumé de ta période : ce qui progresse, ce qui coince, quoi faire ensuite.

Avec l'option B, le coach ne connaît que ce que tu lui colles : recopie ton historique de temps en temps pour qu'il reste à jour.

## 4. Premiers pas

1. **Ajoute ton premier WOD** : onglet **WOD** › **Créer un WOD** pour le saisir à la main, **Coller un WOD** pour la réponse d'un coach, ou demande-le à l'onglet **Coach**.
2. **Fais-le** : ouvre le WOD › **Lancer le chrono**. Le chrono te guide tour par tour et garde l'écran allumé quand le téléphone le permet.
3. **Note ton score** à la fin, avec ton **RPE** (effort ressenti, de 1 à 10). Le RPE est facultatif, mais c'est lui qui calcule ta charge d'entraînement dans Suivi.
4. **Planifie la suite** : sur la fiche d'un WOD, choisis une date › **Planifier**. Pour déplacer ou supprimer plusieurs WOD d'un coup : bouton **⋯** en haut à droite de l'écran WOD.
5. **Fixe-toi un objectif** : onglet **Suivi** › **+ Nouvel objectif** (une charge, un score sur un WOD, une course Hyrox, un semi…). Le plus proche s'affiche en haut de l'écran WOD.
6. **Note tes autres sports** (course, vélo, natation…) : onglet **Suivi** › **+ Ajouter une activité**. Le coach en tient compte.

## 5. Se repérer

| Où | Ce que tu y trouves |
|---|---|
| **WOD** | Ton programme, les WOD à faire, Coller / Créer un WOD, et le bouton ⋯ pour reprogrammer, retirer du programme ou supprimer plusieurs WOD. |
| **Coach** | La conversation avec le coach. |
| **Suivi** | Tes objectifs, ta semaine, ta régularité, ta charge d'entraînement, tes records… |
| **☰** | Chrono libre, Toutes mes séances (tout ton historique), Réglages (coach, sauvegarde, import). |

## 6. Bon à savoir

- **Sans réseau** : une fois installée, l'appli fonctionne hors ligne. Seul le coach de l'option A a besoin d'internet.
- **WOD de référence** (Fran, Cindy, un test maison…) : sur la fiche du WOD, **En faire un WOD de référence**. L'appli te rappelle de le refaire et trace ta courbe de progression.
- **Refaire un WOD déjà fait** : menu ☰ › **Toutes mes séances**, ouvre la séance › **Refaire ce WOD**. La recherche de l'écran WOD le trouve aussi.
- **Strava** : depuis une séance › **Récapitulatif**, enregistre l'image dans tes photos et ajoute-la à ton activité Strava.
- **Chrono sans WOD** (échauffement, Tabata, repos…) : menu ☰ › **Chrono libre**.

---

## Développement

Pour qui modifie l'appli (version de Node dans `.nvmrc`) :

```bash
npm ci          # installer
npm run dev     # lancer l'appli en local
npm test        # tests
npm run build   # version de production dans dist/
```

Chaque push sur `main` lance les tests, construit l'appli et la publie sur GitHub Pages (`.github/workflows/deploy.yml`).
