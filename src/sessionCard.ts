import { adjustmentText, clock, duration, load, quantity, scoreLine, setsLine, teamLabel, typeLabel, wodSummary } from './format';
import { isRest } from './movements';
import { beyondPrescribed, isOverCap, scoreDelta } from './records';
import type { Movement, Result, Score, Wod, WodType } from './types';

/** Couleur d'une étiquette : celle du type de WOD, ou un sens (record, Rx, hors cap…). */
export type Tone = WodType | 'accent' | 'good' | 'warn' | 'muted';

export interface Row {
  text: string;
  /** Valeur alignée à droite : temps d'un tour ou d'un segment. */
  value?: string;
}

export interface Section {
  title: string;
  rows: Row[];
}

/** Contenu de l'image d'une séance, prêt à dessiner : tout est déjà en texte. */
export interface SessionCard {
  date: string;
  tags: { text: string; tone: Tone }[];
  title: string;
  format: string;
  score: string;
  /** RPE, et écart avec la séance précédente du même WOD. */
  details: { text: string; tone: Tone }[];
  sections: Section[];
  notes?: string;
}

const fullDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** « 15 Wall ball · 9 kg », « 21-15-9 Thruster · 43 kg », « Repos 1 min ». */
function movementRow(movement: Movement, scheme?: string): string {
  if (isRest(movement)) return `Repos ${duration(movement.duration_sec ?? 0)}`;
  const amount = quantity(movement) ?? scheme;
  const weight = load(movement);
  return [amount, movement.name].filter(Boolean).join(' ') + (weight ? ` · ${weight}` : '');
}

function movementSection(wod: Wod, score: Score, splits: number[]): Section {
  switch (wod.type) {
    case 'strength': {
      // Les séries réellement faites, exercice par exercice.
      const done = 'exercises' in score ? score.exercises : [];
      return {
        title: 'Séries',
        rows: wod.exercises.map((exercise, i) => ({ text: `${exercise.name} : ${setsLine(done[i] ?? [], exercise.load_count)}` })),
      };
    }
    case 'amrap':
      return { title: 'Mouvements', rows: wod.movements.map((movement) => ({ text: movementRow(movement) })) };
    case 'for_time':
      return { title: 'Mouvements', rows: wod.movements.map((movement) => ({ text: movementRow(movement, wod.rep_scheme?.join('-')) })) };
    case 'emom': {
      const looping = wod.slots.length > 1;
      const unit = wod.interval_sec === 60 ? 'Minute' : 'Intervalle';
      return {
        title: 'Mouvements',
        rows: wod.slots.flatMap((slot, i) => {
          const prefix = looping ? `${unit} ${i + 1} : ` : '';
          if (slot.length === 0) return [{ text: `${prefix}Repos` }];
          return slot.map((movement) => ({ text: `${prefix}${movementRow(movement)}` }));
        }),
      };
    }
    case 'hyrox':
      // En Hyrox, chaque segment porte son temps : la séance se lit d'un coup d'œil.
      return {
        title: 'Segments',
        rows: wod.segments.map((segment, i) => {
          const sec = splits[i];
          return sec === undefined ? { text: movementRow(segment) } : { text: movementRow(segment), value: clock(sec) };
        }),
      };
  }
}

/**
 * Contenu de l'image d'une séance, pour l'import photo de Strava. `previous` est la séance
 * précédente du même WOD, s'il y en a une ; `record` dit si celle-ci détient le record.
 */
export function sessionCard(result: Result, previous?: Result, record = false): SessionCard {
  const { wod, score } = result;
  const splits = 'splits_sec' in score ? (score.splits_sec ?? []) : [];

  const tags: SessionCard['tags'] = [{ text: typeLabel(wod.type), tone: wod.type }];
  if (wod.team_size) tags.push({ text: teamLabel(wod.team_size), tone: 'good' });
  tags.push(score.rx ? { text: beyondPrescribed(wod, score) ? 'Rx+' : 'Rx', tone: 'good' } : { text: 'Scaled', tone: 'muted' });
  if (record) tags.push({ text: 'Record', tone: 'accent' });
  if (isOverCap(wod, score)) tags.push({ text: 'Hors cap', tone: 'warn' });

  const details: SessionCard['details'] = [];
  if (score.rpe !== undefined) details.push({ text: `RPE ${score.rpe}/10`, tone: 'muted' });
  const delta = previous ? scoreDelta(wod, score, previous.score) : null;
  if (previous && delta) {
    details.push({
      text: `${delta.text} vs ${shortDate(previous.date)} (${scoreLine(previous.wod, previous.score)})`,
      tone: delta.better === null ? 'muted' : delta.better ? 'good' : 'warn',
    });
  }

  const sections: Section[] = [];
  if (wod.type !== 'hyrox' && splits.length > 0) {
    const scheme = wod.type === 'for_time' ? wod.rep_scheme : undefined;
    sections.push({
      title: 'Temps par tour',
      rows: splits.map((sec, i) => {
        const reps = scheme?.[i];
        return { text: reps === undefined ? `Tour ${i + 1}` : `Tour ${i + 1} (${reps} reps)`, value: clock(sec) };
      }),
    });
  }
  sections.push(movementSection(wod, score, splits));
  if (score.adjustments && score.adjustments.length > 0) {
    sections.push({ title: 'Adapté', rows: score.adjustments.map((adjustment) => ({ text: adjustmentText(wod, adjustment) })) });
  }

  return {
    date: fullDate(result.date),
    tags,
    title: wod.title,
    format: wodSummary(wod),
    score: scoreLine(wod, score),
    details,
    sections,
    ...(score.notes && { notes: score.notes }),
  };
}

/** Nom du fichier image : « wodhard-2026-10-31-fran.png ». */
export function sessionFileName(result: Result): string {
  const slug = result.wod.title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `wodhard-${result.date}${slug ? `-${slug}` : ''}.png`;
}
