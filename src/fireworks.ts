/**
 * Feux d'artifice de fin de WOD, dessinés sur un canvas par-dessus l'écran. Ils durent tant que
 * l'on reste sur les écrans de la fête, et s'éteignent dès qu'on en sort.
 */

const COLORS = ['#ffed00', '#5cc8ff', '#ff9f43', '#c79bff', '#4ade80', '#ff6b60'];
const GLITTER = '#ffffff';
/** Délai entre deux fusées, en millisecondes. */
const LAUNCH_MIN_MS = 350;
const LAUNCH_MAX_MS = 950;
/** Au-delà, les nouvelles explosions attendent : l'animation reste fluide sur téléphone. */
const MAX_SPARKS = 900;
const FADE_OUT_MS = 500;
const GRAVITY = 0.16;
const SPARK_GRAVITY = 0.05;
const DRAG = 0.985;

interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
}

interface Spark {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
}

const random = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)] as T;
const currentPath = () => location.hash.replace(/^#/, '') || '/';

let show: { stop: () => void } | null = null;
/** Écrans sur lesquels la fête continue. */
let screens: string[] = [];

function onRoute(): void {
  if (!screens.includes(currentPath())) stopFireworks();
}

function start(): { stop: () => void } | null {
  const canvas = document.createElement('canvas');
  canvas.className = 'fireworks';
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) return null;

  let width = 0;
  let height = 0;
  let scale = 1;
  const resize = () => {
    // Résolution limitée à 2× : au-delà, le coût de dessin augmente sans gain visible.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    scale = Math.max(0.8, Math.min(width, height) / 390);
    // Taille affichée en pixels CSS, résolution en pixels réels.
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);
  document.body.append(canvas);

  const rockets: Rocket[] = [];
  const sparks: Spark[] = [];
  let nextLaunch = 0;
  let stoppedAt: number | null = null;
  let last = performance.now();

  const launch = () => {
    // Vitesse de départ calculée pour éclater entre le quart et la moitié haute de l'écran.
    const rise = height * random(0.45, 0.75);
    rockets.push({
      x: width * random(0.12, 0.88),
      y: height + 4,
      vx: random(-0.6, 0.6) * scale,
      vy: -Math.sqrt(2 * GRAVITY * rise),
      color: pick(COLORS),
    });
  };

  const explode = (rocket: Rocket) => {
    const count = Math.round(random(55, 90));
    const power = random(2.6, 4.6) * scale;
    for (let i = 0; i < count && sparks.length < MAX_SPARKS; i++) {
      const angle = (i / count) * Math.PI * 2 + random(-0.08, 0.08);
      const speed = power * random(0.55, 1);
      const max = random(55, 95);
      sparks.push({
        x: rocket.x,
        y: rocket.y,
        px: rocket.x,
        py: rocket.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: max,
        max,
        color: Math.random() < 0.18 ? GLITTER : rocket.color,
      });
    }
  };

  const frame = (now: number) => {
    // Pas de temps en « images à 60 Hz », pour le même rendu quelle que soit la fréquence d'affichage.
    const step = Math.min((now - last) / 16.67, 3);
    last = now;
    const fading = stoppedAt === null ? 1 : Math.max(0, 1 - (now - stoppedAt) / FADE_OUT_MS);

    if (stoppedAt === null && now >= nextLaunch) {
      launch();
      if (Math.random() < 0.25) launch();
      nextLaunch = now + random(LAUNCH_MIN_MS, LAUNCH_MAX_MS);
    }

    // Efface en partie l'image précédente : les étincelles laissent une courte traînée.
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = 'rgba(0, 0, 0, 0.28)';
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';

    for (let i = rockets.length - 1; i >= 0; i--) {
      const rocket = rockets[i];
      if (!rocket) continue;
      const fromX = rocket.x;
      const fromY = rocket.y;
      rocket.vy += GRAVITY * step;
      rocket.x += rocket.vx * step;
      rocket.y += rocket.vy * step;
      context.globalAlpha = fading;
      context.strokeStyle = rocket.color;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.lineTo(rocket.x, rocket.y);
      context.stroke();
      if (rocket.vy >= 0) {
        rockets.splice(i, 1);
        if (stoppedAt === null) explode(rocket);
      }
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      if (!spark) continue;
      spark.px = spark.x;
      spark.py = spark.y;
      spark.vx *= DRAG ** step;
      spark.vy = spark.vy * DRAG ** step + SPARK_GRAVITY * step;
      spark.x += spark.vx * step;
      spark.y += spark.vy * step;
      spark.life -= step;
      if (spark.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      const flicker = spark.color === GLITTER ? random(0.4, 1) : 1;
      context.globalAlpha = Math.min(1, (spark.life / spark.max) * 1.4) * flicker * fading;
      context.strokeStyle = spark.color;
      context.lineWidth = 2.2;
      context.beginPath();
      context.moveTo(spark.px, spark.py);
      context.lineTo(spark.x, spark.y);
      context.stroke();
    }
    context.globalAlpha = 1;

    if (fading > 0) requestAnimationFrame(frame);
    else {
      window.removeEventListener('resize', resize);
      canvas.remove();
    }
  };
  requestAnimationFrame(frame);

  return {
    stop() {
      stoppedAt ??= performance.now();
    },
  };
}

/**
 * Lance les feux d'artifice, ou les prolonge s'ils sont déjà en cours, tant que l'écran affiché
 * fait partie de `stayOn`. Ils s'arrêtent d'eux-mêmes dès que l'on va sur un autre écran.
 */
export function celebrate(stayOn: string[]): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  screens = stayOn;
  if (!screens.includes(currentPath())) return;
  if (!show) {
    show = start();
    if (show) window.addEventListener('hashchange', onRoute);
  }
}

export function stopFireworks(): void {
  window.removeEventListener('hashchange', onRoute);
  show?.stop();
  show = null;
  screens = [];
}
