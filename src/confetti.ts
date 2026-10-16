/** Confettis de fin de WOD : deux salves depuis les coins bas de l'écran, dessinées sur un canvas. */

const COLORS = ['#ffed00', '#5cc8ff', '#ff9f43', '#c79bff', '#4ade80', '#ffffff'];
const DURATION_MS = 3200;
const FADE_MS = 800;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  width: number;
  height: number;
  color: string;
}

const random = (min: number, max: number) => min + Math.random() * (max - min);

export function confetti(count = 140): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) return;

  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  // Taille affichée en pixels CSS, résolution en pixels réels : nets sur un écran haute densité.
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);
  document.body.append(canvas);

  const pieces: Piece[] = Array.from({ length: count }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? random(-10, width * 0.1) : random(width * 0.9, width + 10),
      y: height + random(0, 20),
      vx: (fromLeft ? 1 : -1) * random(2, 9),
      vy: -random(11, 19),
      angle: random(0, Math.PI * 2),
      spin: random(-0.25, 0.25),
      width: random(6, 10),
      height: random(10, 16),
      color: COLORS[i % COLORS.length] ?? '#ffed00',
    };
  });

  const started = performance.now();
  let last = started;
  const frame = (now: number) => {
    const elapsed = now - started;
    // Pas de temps en « images à 60 Hz », pour la même chute quelle que soit la fréquence d'affichage.
    const step = Math.min((now - last) / 16.67, 3);
    last = now;
    context.clearRect(0, 0, width, height);
    context.globalAlpha = elapsed > DURATION_MS - FADE_MS ? Math.max(0, (DURATION_MS - elapsed) / FADE_MS) : 1;
    for (const piece of pieces) {
      piece.vy += 0.35 * step;
      piece.vx *= 0.99 ** step;
      piece.x += piece.vx * step;
      piece.y += piece.vy * step;
      piece.angle += piece.spin * step;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.angle);
      context.fillStyle = piece.color;
      context.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height * Math.abs(Math.cos(piece.angle)));
      context.restore();
    }
    if (elapsed < DURATION_MS) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
