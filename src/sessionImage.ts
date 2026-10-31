import type { SessionCard, Tone } from './sessionCard';

/**
 * Image d'une séance, dessinée sur un canvas aux couleurs de l'appli : gros contrastes et texte
 * net, pour qu'on la lise d'un coup d'œil et que l'import photo de Strava la déchiffre sans peine.
 */

/** Largeur de l'image, et hauteur minimale : le format portrait 4:5 qu'affiche Strava. */
const WIDTH = 1080;
const MIN_HEIGHT = 1350;
const PAD = 72;
const INNER = WIDTH - 2 * PAD;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const COLORS = {
  bg: '#0d0e10',
  surface: '#17191d',
  line: '#2c313a',
  text: '#f3f4f6',
  muted: '#9ba3af',
  accent: '#ffed00',
  good: '#4ade80',
  warn: '#ffb72e',
};
const TONES: Record<Tone, string> = {
  amrap: COLORS.accent,
  emom: '#5cc8ff',
  for_time: '#ff9f43',
  hyrox: '#c79bff',
  strength: '#ff7aa8',
  session: COLORS.text,
  accent: COLORS.accent,
  good: COLORS.good,
  warn: COLORS.warn,
  muted: COLORS.muted,
};

const font = (size: number, weight = 400) => `${weight} ${size}px ${FONT}`;

type Op =
  | { kind: 'text'; text: string; x: number; y: number; font: string; color: string; align?: CanvasTextAlign }
  | { kind: 'box'; x: number; y: number; w: number; h: number; radius: number; fill: string; stroke?: string }
  | { kind: 'rule'; y: number };

/** Découpe un texte en lignes qui tiennent dans `width`, mot par mot. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, fontSpec: string): string[] {
  ctx.font = fontSpec;
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > width) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

/** Plus grande taille (entre `max` et `min`) à laquelle le texte tient sur une ligne. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, width: number, max: number, min: number, weight: number): number {
  for (let size = max; size > min; size -= 4) {
    ctx.font = font(size, weight);
    if (ctx.measureText(text).width <= width) return size;
  }
  return min;
}

/** Place tout le contenu et renvoie les opérations de dessin, avec la hauteur totale. */
function layout(ctx: CanvasRenderingContext2D, card: SessionCard): { ops: Op[]; height: number } {
  const ops: Op[] = [];
  let y = PAD;
  const text = (value: string, x: number, size: number, color: string, weight = 400, align: CanvasTextAlign = 'left') =>
    ops.push({ kind: 'text', text: value, x, y, font: font(size, weight), color, align });
  const paragraph = (value: string, size: number, color: string, weight = 400, lineHeight = 1.2, width = INNER, x = PAD) => {
    for (const line of wrap(ctx, value, width, font(size, weight))) {
      text(line, x, size, color, weight);
      y += Math.round(size * lineHeight);
    }
  };

  // En-tête : la marque et la date.
  ctx.font = font(46, 800);
  text('WOD', PAD, 46, COLORS.text, 800);
  text('HARD', PAD + ctx.measureText('WOD').width, 46, COLORS.accent, 800);
  text(card.date, WIDTH - PAD, 30, COLORS.muted, 500, 'right');
  y += 46 + 44;

  // Étiquettes : type, duo, Rx, record, hors cap.
  let x = PAD;
  for (const tag of card.tags) {
    const label = tag.text.toUpperCase();
    ctx.font = font(28, 800);
    const w = ctx.measureText(label).width + 40;
    if (x + w > WIDTH - PAD) {
      x = PAD;
      y += 64;
    }
    const color = TONES[tag.tone];
    ops.push({ kind: 'box', x, y, w, h: 52, radius: 26, fill: `${color}2e` });
    ops.push({ kind: 'text', text: label, x: x + 20, y: y + 12, font: font(28, 800), color });
    x += w + 14;
  }
  y += 52 + 40;

  paragraph(card.title, 76, COLORS.text, 800, 1.12);
  y += 6;
  paragraph(card.format, 38, COLORS.muted, 500);
  y += 36;

  // Le score, en grand, dans un encadré comme sur l'appli.
  const boxTop = y;
  const boxIndex = ops.length;
  const boxPad = 40;
  y += boxPad;
  text('SCORE', PAD + boxPad, 28, COLORS.muted, 800);
  y += 28 + 18;
  const scoreWidth = INNER - 2 * boxPad;
  const scoreSize = fitSize(ctx, card.score, scoreWidth, 116, 64, 800);
  paragraph(card.score, scoreSize, COLORS.accent, 800, 1.08, scoreWidth, PAD + boxPad);
  for (const detail of card.details) {
    y += 10;
    paragraph(detail.text, 34, TONES[detail.tone], 600, 1.25, scoreWidth, PAD + boxPad);
  }
  y += boxPad - 8;
  // L'encadré se dessine sous le score : il est inséré avant, une fois sa hauteur connue.
  ops.splice(boxIndex, 0, {
    kind: 'box',
    x: PAD,
    y: boxTop,
    w: INNER,
    h: y - boxTop,
    radius: 28,
    fill: COLORS.surface,
    stroke: `${COLORS.accent}66`,
  });
  y += 52;

  // Sections : temps par tour, mouvements, adaptations.
  for (const section of card.sections) {
    text(section.title.toUpperCase(), PAD, 28, COLORS.muted, 800);
    y += 28 + 20;
    section.rows.forEach((row, i) => {
      if (i > 0) ops.push({ kind: 'rule', y: y - 12 });
      // Une valeur (temps) s'aligne à droite ; le texte s'arrête avant elle.
      let valueWidth = 0;
      if (row.value) {
        ctx.font = font(36, 700);
        valueWidth = ctx.measureText(row.value).width + 32;
        text(row.value, WIDTH - PAD, 36, COLORS.text, 700, 'right');
      }
      paragraph(row.text, 36, COLORS.text, 400, 1.25, INNER - valueWidth);
      y += 12;
    });
    y += 40;
  }

  if (card.notes) {
    text('NOTES', PAD, 28, COLORS.muted, 800);
    y += 28 + 20;
    const lines = wrap(ctx, card.notes, INNER, font(34, 400)).slice(0, 6);
    for (const line of lines) {
      text(line, PAD, 34, COLORS.text, 400);
      y += 44;
    }
    y += 40;
  }

  // Pied : la marque, toujours en bas de l'image.
  const footer = 26;
  const height = Math.max(MIN_HEIGHT, y + 48 + footer + PAD);
  ops.push({ kind: 'text', text: 'Séance enregistrée avec WODHARD', x: WIDTH / 2, y: height - PAD - footer, font: font(footer, 500), color: COLORS.muted, align: 'center' });
  return { ops, height };
}

/** Dessine l'image d'une séance. */
export function renderSessionImage(card: SessionCard): HTMLCanvasElement {
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('Canvas indisponible');
  const { ops, height } = layout(measure, card);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = 'top';
  for (const op of ops) {
    if (op.kind === 'box') {
      ctx.beginPath();
      ctx.roundRect(op.x, op.y, op.w, op.h, op.radius);
      ctx.fillStyle = op.fill;
      ctx.fill();
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else if (op.kind === 'rule') {
      ctx.fillStyle = COLORS.line;
      ctx.fillRect(PAD, op.y, INNER, 2);
    } else {
      ctx.font = op.font;
      ctx.fillStyle = op.color;
      ctx.textAlign = op.align ?? 'left';
      ctx.fillText(op.text, op.x, op.y);
    }
  }
  return canvas;
}

/** L'image au format PNG, prête à être partagée ou enregistrée. */
export function sessionImageFile(card: SessionCard, name: string): Promise<File> {
  const canvas = renderSessionImage(card);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(new File([blob], name, { type: 'image/png' })) : reject(new Error('Image impossible'))), 'image/png');
  });
}
