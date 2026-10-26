import { choose, h, toast } from '../dom';
import { clock, dateLabel, today } from '../format';
import { coachReady, loadCoach } from '../claude';
import { navigate, type View } from '../router';
import { activityLine, activityName, distanceText, paceText, SPORT_INFO } from '../sports';
import { deleteActivity, findActivity, newId, saveActivity } from '../store';
import type { Activity, Sport } from '../types';
import { SPORTS, validateActivity } from '../validate';
import { field, openChat, pageHead } from './parts';

/** Dernier sport choisi, proposé par défaut à la saisie suivante. */
let lastSport: Sport = 'run';

const FIELD_LABELS: Record<string, string> = {
  title: 'Nom',
  date: 'Date',
  duration_sec: 'Durée',
  distance_m: 'Distance',
  rpe: 'RPE',
  notes: 'Notes',
};

const PLACEHOLDERS: Record<Sport, string> = {
  run: 'Footing, fractionné, trail… (facultatif)',
  bike: 'Sortie route, home trainer… (facultatif)',
  swim: 'Technique, longueurs… (facultatif)',
  row: 'Endurance, intervalles… (facultatif)',
  walk: 'Rando, marche active… (facultatif)',
  other: 'Quel sport ? Padel, yoga, escalade…',
};

const number = (input: HTMLInputElement) => {
  const text = input.value.trim().replace(',', '.');
  return text === '' ? undefined : Number(text);
};

function numberInput(label: string, value: number | string | undefined, decimal = false): HTMLInputElement {
  return h('input', {
    type: 'text',
    inputmode: decimal ? 'decimal' : 'numeric',
    autocomplete: 'off',
    'aria-label': label,
    value: value === undefined ? '' : String(value).replace('.', ','),
  });
}

/** Saisie d'une activité d'un autre sport : nouvelle, ou modification de `id`. */
export function activityFormView(id?: string): View | null {
  const editing = id === undefined ? undefined : findActivity(id);
  if (id !== undefined && !editing) return null;
  let sport: Sport = editing?.sport ?? lastSport;
  let rpe = editing?.rpe;

  const total = editing?.duration_sec;
  const hours = numberInput('Heures', total === undefined ? undefined : Math.floor(total / 3600) || undefined);
  const minutes = numberInput('Minutes', total === undefined ? undefined : Math.floor((total % 3600) / 60));
  const seconds = numberInput('Secondes', total === undefined ? undefined : total % 60 || undefined);
  const distance = numberInput('Distance', undefined, true);
  const distanceUnit = h('span');
  const pace = h('p', { class: 'hint left', 'aria-live': 'polite' });
  const title = h('input', { type: 'text', autocomplete: 'off', maxlength: 60, 'aria-label': 'Nom', value: editing?.title ?? '' });
  const date = h('input', { type: 'date', value: editing?.date ?? today(), max: today(), 'aria-label': 'Date' });
  const notes = h('textarea', { rows: 3, 'aria-label': 'Notes', placeholder: 'Parcours, sensations… (facultatif)' });
  notes.value = editing?.notes ?? '';
  const errorBox = h('div', { class: 'errors', role: 'alert', hidden: true });

  /** Distance en mètres, d'après l'unité du sport choisi. */
  const meters = () => {
    const value = number(distance);
    return value === undefined ? undefined : SPORT_INFO[sport].unit === 'km' ? Math.round(value * 1000) : value;
  };
  const duration = () => {
    const parts = [hours, minutes, seconds].map(number);
    if (parts.every((part) => part === undefined)) return undefined;
    const [h = 0, m = 0, s = 0] = parts.map((part) => part ?? 0);
    return Math.round(h * 3600 + m * 60 + s);
  };
  const showDistance = (meters: number | undefined) => {
    const unit = SPORT_INFO[sport].unit;
    distanceUnit.textContent = unit;
    distance.value = meters === undefined ? '' : String(unit === 'km' ? meters / 1000 : meters).replace('.', ',');
  };
  const refreshPace = () => {
    const sec = duration();
    const m = meters();
    const text = sec && m ? paceText({ id: '', date: '', sport, duration_sec: sec, distance_m: m }) : null;
    pace.textContent = text ? `${sport === 'bike' ? 'Vitesse' : 'Allure'} : ${text}` : '';
  };
  for (const input of [hours, minutes, seconds, distance]) input.addEventListener('input', refreshPace);

  const sportButtons = SPORTS.map((value) =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'aria-pressed': String(value === sport),
        onclick: () => {
          // La distance saisie est gardée en mètres quand l'unité change (km ↔ m).
          const kept = meters();
          sport = value;
          sportButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(SPORTS[i] === sport)));
          title.placeholder = PLACEHOLDERS[sport];
          showDistance(kept);
          refreshPace();
        },
      },
      value === 'other' ? 'Autre' : SPORT_INFO[value].label,
    ),
  );
  title.placeholder = PLACEHOLDERS[sport];
  showDistance(editing?.distance_m);
  refreshPace();

  const rpeButtons = Array.from({ length: 10 }, (_, i) => i + 1).map((value) =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'aria-pressed': String(value === rpe),
        onclick: () => {
          rpe = rpe === value ? undefined : value;
          rpeButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i + 1 === rpe)));
        },
      },
      value,
    ),
  );

  const submit = (event: Event) => {
    event.preventDefault();
    const raw: Record<string, unknown> = { id: editing?.id ?? newId(), date: date.value, sport, duration_sec: duration() };
    if (title.value.trim() !== '') raw.title = title.value.trim();
    if (distance.value.trim() !== '') raw.distance_m = meters();
    if (rpe !== undefined) raw.rpe = rpe;
    if (notes.value.trim() !== '') raw.notes = notes.value.trim();
    const checked = validateActivity(raw);
    if (!checked.ok) {
      errorBox.replaceChildren(
        h(
          'ul',
          null,
          checked.errors.map((error) => {
            const [key = '', ...rest] = error.split(' : ');
            const message = rest.join(' : ');
            const readable = message === 'champ manquant' || message.startsWith('doit être un entier') ? 'à remplir' : message;
            return h('li', null, rest.length > 0 ? `${FIELD_LABELS[key] ?? key} : ${readable}` : error);
          }),
        ),
      );
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (checked.value.date > today()) {
      errorBox.replaceChildren(h('p', null, 'Date : une activité se saisit une fois faite.'));
      errorBox.hidden = false;
      return;
    }
    lastSport = sport;
    saveActivity(checked.value);
    toast(editing ? 'Activité modifiée' : 'Activité enregistrée');
    navigate(`/activity/${checked.value.id}`, true);
  };

  const back = editing ? `#/activity/${editing.id}` : '#/progress';
  const el = h(
    'section',
    { class: 'page' },
    pageHead(editing ? 'Modifier l’activité' : 'Ajouter une activité', { href: back, label: editing ? 'Retour' : 'Progrès' }),
    h(
      'form',
      { class: 'form', novalidate: true, onsubmit: submit },
      h('div', { class: 'sports' }, sportButtons),
      field('Nom', title),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Date'), date),
      field('Durée', hours, 'h', minutes, 'min', seconds, 's'),
      field('Distance (facultatif)', distance, distanceUnit),
      pace,
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'RPE : effort ressenti de 1 à 10 (facultatif)'),
        h('div', { class: 'rpe' }, rpeButtons),
      ),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Notes (facultatif)'), notes),
      errorBox,
      h('button', { type: 'submit', class: 'btn primary big block' }, 'Enregistrer'),
      h('a', { class: 'btn ghost block', href: back }, 'Annuler'),
    ),
  );
  return { el, tab: 'progress' };
}

/** Message qui demande au coach son avis sur une activité. */
function adviceRequest(activity: Activity): string {
  const name = activityName(activity);
  const what = activity.sport !== 'other' && activity.title ? `${name} « ${activity.title} »` : name;
  const facts = [activityLine(activity)];
  if (activity.rpe !== undefined) facts.push(`RPE ${activity.rpe}/10`);
  if (activity.notes) facts.push(`Mes notes : ${activity.notes}`);
  return [
    `Donne-moi ton avis sur ma séance du ${dateLabel(activity.date)} : ${what}.`,
    `${facts.join('. ')}.`,
    'Qu’en penses-tu, et comment l’articuler avec mes WOD ?',
  ].join('\n');
}

export function activityView(id: string): View | null {
  const activity = findActivity(id);
  if (!activity) return null;
  const name = activityName(activity);

  const remove = async () => {
    const confirmed = await choose('Supprimer cette activité ?', `${name}, ${dateLabel(activity.date)}.`, [
      { label: 'Supprimer', value: true, kind: 'danger' },
      { label: 'Annuler', value: false },
    ]);
    if (!confirmed) return;
    deleteActivity(id);
    toast('Activité supprimée');
    navigate('/progress', true);
  };

  const pace = paceText(activity);
  const el = h(
    'section',
    { class: 'page' },
    pageHead(dateLabel(activity.date), { href: '#/progress', label: 'Progrès' }),
    h(
      'div',
      { class: 'scoreboard' },
      h('span', { class: 'badge sport' }, activity.sport === 'other' ? SPORT_INFO.other.label : name),
      h('strong', { class: 'score' }, activity.sport === 'other' ? name : (activity.title ?? name)),
      h(
        'dl',
        { class: 'facts' },
        activity.distance_m !== undefined && [h('dt', null, 'Distance'), h('dd', null, distanceText(activity.distance_m, activity.sport))],
        h('dt', null, 'Durée'),
        h('dd', null, clock(activity.duration_sec)),
        pace && [h('dt', null, activity.sport === 'bike' ? 'Vitesse' : 'Allure'), h('dd', null, pace)],
        activity.rpe !== undefined && [h('dt', null, 'RPE'), h('dd', null, `${activity.rpe}/10`)],
      ),
      activity.notes && h('p', { class: 'description' }, activity.notes),
    ),
    h(
      'div',
      { class: 'stack' },
      coachReady(loadCoach()) && h('button', { class: 'btn primary block', onclick: () => openChat(adviceRequest(activity)) }, 'Avis du coach'),
      h('a', { class: 'btn block', href: `#/activity/${id}/edit` }, 'Modifier'),
      h('button', { class: 'btn ghost danger block', onclick: () => void remove() }, 'Supprimer cette activité'),
    ),
  );
  return { el, tab: 'progress' };
}
