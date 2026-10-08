type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, string | number | boolean | null | undefined | ((event: Event) => void)>;

/**
 * Crée un élément. Les enfants texte passent par des nœuds texte, jamais par innerHTML :
 * le contenu d'un WOD collé ne peut donc pas injecter de HTML.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, ''), value);
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false && value != null) el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child !== false && child != null) el.append(typeof child === 'number' ? String(child) : child);
  }
  return el;
}

let toastTimer = 0;

export function toast(message: string): void {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' });
    document.body.append(el);
  }
  const target = el;
  target.textContent = message;
  target.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => target.classList.remove('show'), 2800);
}

export function dismissToast(): void {
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.classList.remove('show');
}

export interface Choice<T> {
  label: string;
  value: T;
  kind?: 'primary' | 'danger';
}

/** Boîte de dialogue modale. Renvoie null si elle est fermée sans choix (Échap, clic à côté). */
export function choose<T>(title: string, message: string, choices: Choice<T>[]): Promise<T | null> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog' });
    const close = (value: T | null) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.append(
      h('h2', null, title),
      h('p', null, message),
      h(
        'div',
        { class: 'dialog-actions' },
        choices.map((choice) =>
          h('button', { class: `btn block ${choice.kind ?? ''}`, onclick: () => close(choice.value) }, choice.label),
        ),
      ),
    );
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(null);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close(null);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Presse-papiers refusé ou indisponible : repli sur la sélection d'un champ caché.
    const area = h('textarea', { class: 'offscreen', readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}
