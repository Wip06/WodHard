import { copyText, h, toast } from '../dom';
import { addDays, dateLabel, mondayOf, plural, today } from '../format';
import type { View } from '../router';
import { buildHistory } from '../store';
import { pageHead } from './parts';

/** Nombre de séances jointes à la demande : assez pour adapter, sans noyer la conversation. */
const HISTORY_LIMIT = 30;

export function askView(): View {
  const nextMonday = addDays(mondayOf(today()), 7);
  const requests = [
    { label: 'Mon prochain WOD', text: 'Donne-moi mon prochain WOD.' },
    {
      label: 'Programme de la semaine prochaine',
      text: `Donne-moi un programme pour la semaine prochaine, à partir du lundi ${nextMonday}.`,
    },
    { label: 'Une séance type Hyrox', text: 'Donne-moi une séance au format Hyrox.' },
    { label: 'Une séance de force', text: 'Donne-moi une séance de force.' },
  ];

  const history = buildHistory(HISTORY_LIMIT);
  const planned = history.planned?.length ?? 0;
  const hasHistory = history.entries.length > 0 || planned > 0;
  const attached = hasHistory
    ? `Jointes à la demande : ${plural(history.entries.length, 'séance')} et ${planned} WOD encore au programme.`
    : 'Aucune séance enregistrée pour l’instant : seule la demande sera copiée.';

  const detail = h('input', {
    type: 'text',
    placeholder: '45 min maximum, pas de course…',
    'aria-label': 'Précision',
  });
  const done = h(
    'div',
    { class: 'stack', role: 'status', hidden: true },
    h('p', { class: 'lead' }, 'Demande copiée. Colle-la dans ton projet Claude, puis reviens coller sa réponse.'),
    h('a', { class: 'btn primary block', href: '#/add' }, 'Coller la réponse de Claude'),
  );

  // La copie part directement du clic, sans étape intermédiaire : iOS refuse le presse-papiers sinon.
  const ask = async (request: string) => {
    const extra = detail.value.trim();
    const parts = [extra ? `${request} Précision : ${extra}` : request];
    if (hasHistory) parts.push(JSON.stringify(history));
    if (!(await copyText(parts.join('\n\n')))) return toast('Copie impossible');
    done.hidden = false;
    done.scrollIntoView({ block: 'nearest' });
  };

  const el = h(
    'section',
    { class: 'page' },
    pageHead('Demander à Claude', { href: '#/', label: 'WOD' }),
    h('p', { class: 'lead' }, 'Choisis ta demande : elle est copiée avec ton historique, prête à coller dans ton projet Claude.'),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Précision (facultatif)'),
      detail,
    ),
    h(
      'div',
      { class: 'stack' },
      requests.map(({ label, text }) => h('button', { class: 'btn block', onclick: () => void ask(text) }, label)),
    ),
    h('p', { class: 'hint' }, attached),
    h('p', { class: 'hint' }, `Semaine prochaine : à partir du ${dateLabel(nextMonday)}`),
    done,
  );
  return { el, tab: 'wods' };
}
