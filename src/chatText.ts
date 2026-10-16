import { extractJson, parseImport, type Import, type Validation } from './validate';

/** Un morceau de ligne, en gras ou non. */
export interface Inline {
  text: string;
  bold: boolean;
}

/** Un paragraphe ou une liste d'une réponse du coach ; chaque ligne est une suite de morceaux. */
export interface Block {
  kind: 'p' | 'ul' | 'ol';
  lines: Inline[][];
}

/** Réponse du coach découpée pour l'affichage, sans jamais passer par du HTML. */
export interface CoachReply {
  blocks: Block[];
  /** Mouvements à illustrer par un lien vers des vidéos de démonstration. */
  demos: string[];
  /** WOD ou programme proposé, valide ou non ; null si la réponse n'en contient pas. */
  proposal: Validation<Import> | null;
}

const DEMO_LINE = /^D[ée]mo\s*:\s*(.+?)\s*$/i;
const BULLET = /^[-*•]\s+/;
const NUMBER = /^\d+[.)]\s+/;

/** Vrai si la réponse contient un WOD ou un programme, valide ou non. */
export const proposesWod = (text: string) => /"(schema_version|wodhard_program)"/.test(text);

/** « **gras** » devient un morceau en gras ; le reste est du texte simple. */
export function inline(line: string): Inline[] {
  return line
    .split(/\*\*(.+?)\*\*/)
    .map((text, i) => ({ text, bold: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}

export function parseReply(text: string): CoachReply {
  const proposal = proposesWod(text) ? parseImport(text) : null;
  const prose = (proposal ? text.replace(extractJson(text), '') : text).replace(/```(?:json)?/g, '');
  const demos: string[] = [];
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const raw of prose.split('\n')) {
    const line = raw.trim();
    const demo = DEMO_LINE.exec(line);
    if (demo?.[1]) {
      demos.push(demo[1]);
      continue;
    }
    if (line === '') {
      current = null;
      continue;
    }
    const kind: Block['kind'] = BULLET.test(line) ? 'ul' : NUMBER.test(line) ? 'ol' : 'p';
    if (!current || current.kind !== kind) {
      current = { kind, lines: [] };
      blocks.push(current);
    }
    current.lines.push(inline(line.replace(BULLET, '').replace(NUMBER, '').replace(/^#+\s*/, '')));
  }
  return { blocks, demos: [...new Set(demos)], proposal };
}

/** Recherche de vidéos de démonstration : de vrais gestes plutôt qu'une image générée, souvent fausse. */
export const demoUrl = (movement: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${movement} technique`)}`;
