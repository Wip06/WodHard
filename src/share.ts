import type { Wod } from './types';

/** Chemin d'un WOD partagé : le WOD lui-même, encodé dans le lien. Aucun serveur ne le voit. */
export const SHARE_PATH = '/partage/';
/** Au-delà, ce n'est pas un lien que l'appli a créé. */
const MAX_LENGTH = 20_000;

/** JSON → UTF-8 → base64 sans « + », « / » ni « = », pour tenir dans un lien. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** Le lien à envoyer : l'adresse de l'appli, suivie du WOD encodé. */
export function shareUrl(wod: Wod, base = `${location.origin}${location.pathname}`): string {
  return `${base}#${SHARE_PATH}${toBase64Url(JSON.stringify(wod))}`;
}

/**
 * Le texte JSON d'un WOD partagé, à partir de la partie encodée du lien, ou null si elle est
 * illisible. Le WOD doit ensuite passer la vérification habituelle.
 */
export function decodeShared(data: string): string | null {
  if (data.length > MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(data)) return null;
  try {
    return fromBase64Url(data);
  } catch {
    return null;
  }
}

/**
 * Un lien de partage collé dans « Coller un WOD » : le JSON qu'il contient. Tout autre texte est
 * rendu tel quel.
 */
export function unwrapSharedLink(text: string): string {
  const match = new RegExp(`#${SHARE_PATH}([A-Za-z0-9_-]+)`).exec(text);
  return (match?.[1] && decodeShared(match[1])) ?? text;
}
