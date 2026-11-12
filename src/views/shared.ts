import { copyText, h, isInstalledApp, toast } from '../dom';
import { workKey } from '../records';
import type { View } from '../router';
import { decodeShared } from '../share';
import { getWods } from '../store';
import { parseWod } from '../validate';
import { pageHead, wodSheet } from './parts';
import { saveImport } from './wods';

/**
 * Un WOD reçu par lien : on le montre, puis on l'ajoute. Il passe la même vérification qu'un WOD
 * collé ; un lien abîmé ou modifié est refusé.
 */
export function sharedWodView(data: string): View {
  const text = decodeShared(data);
  const checked = text === null ? null : parseWod(text);
  if (!checked?.ok) {
    const el = h(
      'section',
      { class: 'page' },
      pageHead('WOD partagé', { href: '#/', label: 'WOD' }),
      h('p', { class: 'empty' }, 'Ce lien est abîmé ou incomplet : demande à la personne qui te l’a envoyé de partager le WOD à nouveau.'),
      h('a', { class: 'btn block', href: '#/' }, 'Voir mes WOD'),
    );
    return { el, tab: 'wods' };
  }

  const wod = checked.value;
  const existing = getWods().find((saved) => workKey(saved.wod) === workKey(wod));
  const copyLink = async () => toast((await copyText(location.href)) ? 'Lien copié' : 'Copie impossible');
  const el = h(
    'section',
    { class: 'page' },
    pageHead('WOD partagé', { href: '#/', label: 'WOD' }),
    h('p', { class: 'lead' }, 'On t’a envoyé ce WOD. Ajoute-le à tes WOD pour le faire ou le planifier.'),
    wodSheet(wod),
    h(
      'div',
      { class: 'stack' },
      existing
        ? [
            h('p', { class: 'proposal-status added' }, '✓ Déjà dans tes WOD'),
            h('a', { class: 'btn primary big block', href: `#/wod/${existing.id}` }, 'Ouvrir dans mes WOD'),
          ]
        : h('button', { class: 'btn primary big block', onclick: () => saveImport({ kind: 'wod', wod }) }, 'Ajouter à mes WOD à faire'),
      // Sur iPhone, l'appli installée garde ses données à part : un lien ouvert dans Safari n'y ajoute rien.
      !isInstalledApp() && [
        h('p', { class: 'hint left' }, 'Tu as installé WODHARD sur ton écran d’accueil ? Sur iPhone, l’appli installée ne voit pas ce que tu ajoutes ici : copie plutôt ce lien, puis dans l’appli, WOD › Coller un WOD.'),
        h('button', { class: 'btn block', onclick: () => void copyLink() }, 'Copier le lien'),
      ],
    ),
  );
  return { el, tab: 'wods' };
}
