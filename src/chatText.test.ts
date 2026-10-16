import { describe, expect, it } from 'vitest';
import { demoUrl, inline, parseReply } from './chatText';

describe('réponses du coach', () => {
  it('découpe paragraphes, listes à puces et listes numérotées', () => {
    const reply = parseReply('Le wall ball se fait en 3 temps :\n1. Squat profond\n2. **Pousse** avec les jambes\n\nÀ surveiller :\n- dos droit\n- regard devant\nBon courage !');
    expect(reply.blocks).toEqual([
      { kind: 'p', lines: [[{ text: 'Le wall ball se fait en 3 temps :', bold: false }]] },
      { kind: 'ol', lines: [[{ text: 'Squat profond', bold: false }], [{ text: 'Pousse', bold: true }, { text: ' avec les jambes', bold: false }]] },
      { kind: 'p', lines: [[{ text: 'À surveiller :', bold: false }]] },
      { kind: 'ul', lines: [[{ text: 'dos droit', bold: false }], [{ text: 'regard devant', bold: false }]] },
      { kind: 'p', lines: [[{ text: 'Bon courage !', bold: false }]] },
    ]);
  });

  it('extrait les lignes « Démo : » en liens de démonstration, sans doublon', () => {
    const reply = parseReply('Voici la technique.\nDémo : Wall ball\ndemo : Wall ball\nDémo : Thruster');
    expect(reply.demos).toEqual(['Wall ball', 'Thruster']);
    expect(reply.blocks).toHaveLength(1);
    expect(demoUrl('Wall ball')).toBe('https://www.youtube.com/results?search_query=Wall%20ball%20technique');
  });

  it('sépare la séance proposée du texte', () => {
    const wod = { schema_version: 1, type: 'amrap', title: 'Court', duration_sec: 300, movements: [{ name: 'Burpee', reps: 5 }] };
    const reply = parseReply(`Voici ta séance.\n\n\`\`\`json\n${JSON.stringify(wod)}\n\`\`\``);
    expect(reply.proposal).toMatchObject({ ok: true, value: { kind: 'wod' } });
    expect(reply.blocks).toEqual([{ kind: 'p', lines: [[{ text: 'Voici ta séance.', bold: false }]] }]);
    expect(parseReply('Pas de séance ici.').proposal).toBeNull();
  });

  it('enlève les titres Markdown et garde le texte autour du gras', () => {
    expect(parseReply('## Conseils\nRespire').blocks[0]?.lines[0]).toEqual([{ text: 'Conseils', bold: false }]);
    expect(inline('a **b** c')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c', bold: false },
    ]);
  });
});
