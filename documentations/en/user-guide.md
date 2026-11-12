# WODHARD user guide

*[Version française](../fr/guide-utilisateur.md)*

Your WOD logbook on your phone: your program, the timer, your scores, your progress and, if you like, a coach who prepares your sessions. This guide takes you from installing the app to your first sessions.

The app's interface is in French. Buttons are written as they appear in the app, followed by their meaning in brackets.

## 1. Open and install the app

Open this link on your phone: **https://wip06.github.io/WodHard/**

Then add it to your home screen:

- **iPhone** (Safari): Share button › **Add to Home Screen**.
- **Android** (Chrome): ⋮ menu › **Install app** (or **Add to Home screen**).

Don't skip this step: once installed, the app opens full screen, and Safari no longer wipes its data after 7 days without opening it. Updates arrive on their own, the next time you open the app.

## 2. The golden rule: your data stays on your phone

- No account, no server: your WODs, scores and goals are saved **only on this phone**. Nobody else can see them, not even the person who gave you the link.
- Nothing is shared between devices: the app on your phone and the one on your computer are two separate logbooks.
- **Export a backup regularly**: ☰ menu › **Réglages** (Settings) › **Exporter mes données** (Export my data), then **Enregistrer un fichier** (Save a file) or **Copier dans le presse-papiers** (Copy to clipboard), to paste into a note or an email. The app reminds you on the WOD screen when some sessions aren't in any backup.
- Removing the app from your home screen or clearing the browser's data also deletes your sessions: export first.
- **New phone**: export on the old one, then on the new one, ☰ menu › **Réglages** › **Importer une sauvegarde** (Import a backup). You then choose to **merge** with what's already there or to **replace everything**.

## 3. The coach (optional)

The app works fine without a coach: you can create your WODs by hand. The coach prepares sessions and programs tailored to your profile and history. Two ways to use it:

### Option A: the coach in the app (paid, pay as you go)

You need your own Anthropic API key. Each message is billed to your account, and API use isn't included in Anthropic's Pro or Max plans. The built-in coach answers in French; for a coach in English, use option B.

1. On [console.anthropic.com](https://console.anthropic.com/), add credit (Billing) and **set a monthly spend limit**: you can never go over it.
2. Create a key (API keys › Create key). It starts with `sk-ant-`.
3. In the app: **Coach** tab › **Configurer le coach** (Set up the coach). Paste your key, pick a model, fill in your profile, then **Enregistrer** (Save).

Tips:

- **The model**: Opus is the most capable, the best for a program over several weeks. Sonnet is faster and about half the price. Haiku is very cheap, for simple questions.
- **The profile** makes all the difference: the more precise it is, the more the sessions fit you. An example just below.
- Your key stays on your phone and isn't part of backups. Don't share it: any message sent with it is billed to your account.
- With each message, your profile and history are sent to Anthropic.
- **Your spending**: the app estimates what the coach has cost you this month, under "Coach" in the conversation and in its settings. The exact amount is on console.anthropic.com.

#### Example of "Profil et consignes" (Profile and instructions)

Copy it into the **Profil et consignes** field, then replace each line with what fits you:

```text
Level: intermediate, 2 years of CrossFit, 4 sessions a week.
Benchmarks: back squat 110 kg (1RM), deadlift 140 kg, clean & jerk 75 kg,
8 strict pull-ups, double-unders OK, no muscle-up yet. 5 km in 24 min.
Equipment: full box on Monday, Wednesday and Friday. At home on weekends:
16 and 24 kg kettlebells, pull-up bar, jump rope.
Duration: 60 minutes including the warm-up; 30 minutes max at lunchtime on weekdays.
Constraints: fragile left shoulder, no kipping or heavy snatches.
No big leg volume the day before a long run.
Goals: Hyrox in March (Open), back squat at 120 kg, first muscle-up.
Preferences: I like AMRAPs and chippers, less so long EMOMs.
Instructions: short and to the point. Explain technical movements in one sentence
and give an easier option for each.
```

No need to describe the WOD format: the app gives it to the coach. Your goals (**Exploits** page), your history and your program are also sent at each conversation: here, put what the app doesn't know (your gym, your schedule, your aches, the way you like to train…). Your profile changes? Update it in the same settings.

For option B, this same text goes at the top of your project's instructions, before the coach rules.

### Option B: a coach in another AI app

If you already use an AI app, you can use it as your coach, without an API key:

1. Create a project there, or a conversation with custom instructions. In its instructions, write your profile (the example above), then paste below it the whole content of [coach-rules.md](coach-rules.md): the same rules the built-in coach follows, in English.
2. In WODHARD: ☰ menu › **Réglages** › **Copier mon historique pour le coach** (Copy my history for the coach), and paste it into the conversation with your request ("a 20-minute WOD for tonight", "my program for the week"…).
3. Copy its reply, then in WODHARD: **WOD** tab › **Coller un WOD** (Paste a WOD) › **Coller depuis le presse-papiers** (Paste from clipboard). The app finds the JSON block in the reply.

### What to ask the coach

Talk to it like a coach at the gym: tell it how much time you have, the equipment of the day, how you feel and what you want to work on. In the app, it already knows your profile, history, program and goals: no need to repeat them.

A few examples:

- **Today's WOD**: "I have 30 minutes at lunch, just kettlebells and a jump rope. Something intense, but my legs are heavy from yesterday's run."
- **Strength**: "A squat session building up in load, then a short 10-minute metcon."
- **With a partner**: "A partner WOD for Saturday, with my girlfriend who's a beginner." It first asks a few questions about your levels, then adapts the session to each of you.
- **A program**: "My program for next week: 4 sessions, Monday, Tuesday, Thursday and Saturday, with gymnastics and engine work."
- **Preparing a race**: "My Hyrox is in 8 weeks: prepare the next 2 weeks for me, with a simulation."
- **A question**: "How do I get better at double-unders?", "What load should I use for Fran?", "Why are my times stalling on long WODs?"

When it suggests a session, tap **Voir la séance** (See the session), then **Ajouter à mes WOD à faire** (Add to my WODs to do). A program is added the same way, with its dates.

Two shortcuts:

- After a session, the **Avis du coach** (Coach's take) button sends it your score so it can comment.
- In **Suivi**, **Demander l'analyse au coach** (Ask the coach for an analysis) sends it a summary of your period: what's improving, what's stuck, what to do next.

With option B, the coach only knows what you paste: copy your history again from time to time so it stays up to date.

## 4. First steps

1. **Add your first WOD**: **WOD** tab › **Créer un WOD** (Create a WOD) to enter it by hand, **Coller un WOD** for a coach's reply, ask the **Coach** tab, or pick a classic (Fran, Cindy, Murph…) from the ☰ menu › **Bibliothèque de WOD** (WOD library).
2. **Do it**: open the WOD › **Lancer le chrono** (Start the timer). The timer guides you round by round and keeps the screen on when the phone allows it.
3. **Log your score** at the end, with your **RPE** (rate of perceived exertion, from 1 to 10). The RPE is optional, but it's what computes your training load in Suivi.
4. **Plan what's next**: on a WOD's page, pick a date › **Planifier** (Schedule). To move or delete several WODs at once: **⋯** button at the top right of the WOD screen.
5. **Set yourself a goal**: ☰ menu › **Exploits** (Achievements) › **+ Nouvel objectif** (New goal): a load, a score on a WOD, a Hyrox race, a half marathon… The nearest one shows at the top of the WOD screen.
6. **Log your other sports** (running, cycling, swimming…): **Suivi** tab › **+ Ajouter une activité** (Add an activity). The coach takes them into account.

## 5. Finding your way

| Where | What you'll find |
|---|---|
| **WOD** | Your program, the WODs to do, Coller / Créer un WOD (Paste / Create a WOD), and the ⋯ button to reschedule, unplan or delete several WODs. |
| **Coach** | The conversation with the coach. |
| **Suivi** (Progress) | Your week, your consistency, your training load, your workout mix, your other sports… |
| **☰** | Chrono libre (Free timer), Toutes mes séances (All my sessions, your whole history), Exploits (Achievements: your goals and records), Bibliothèque de WOD (WOD library: the classics), Réglages (Settings: coach, backup, import). |

## 6. Good to know

- **Offline**: once installed, the app works offline. Only option A's coach needs the internet.
- **Benchmark WODs** (Fran, Cindy, a home-made test…): on the WOD's page, **⋯** button at the top right › **En faire un WOD de référence** (Make it a benchmark WOD). The app reminds you to redo it and draws your progress chart.
- **Redo a WOD you've already done**: ☰ menu › **Toutes mes séances**, open the session › **Refaire ce WOD** (Redo this WOD). The search on the WOD screen finds it too.
- **Strava**: from a session › **Récapitulatif** (Recap), save the image to your photos and add it to your Strava activity.
- **Your records** (5 km, 10 km, bike ride, Hyrox stations, loads, repeated WODs…): ☰ menu › **Exploits**. Tap a record to open the session it comes from. You'll also find your predicted race times and your ideal Hyrox, and your milestones (sessions, kilometers, hours, tonnage), this year or since the start. A record beaten in the last 30 days gets a **Nouveau** (New) badge.
- **Share a WOD**: on its page, **⋯** button › **Partager ce WOD** (Share this WOD) sends a link. The same menu lets you edit, duplicate or delete the WOD, or set a goal on it. Your friend opens it and adds the WOD in one tap. If they use the installed app on an iPhone, they copy the link and paste it into **Coller un WOD**.
- **Timer without a WOD** (warm-up, Tabata, rest…): ☰ menu › **Chrono libre**.
