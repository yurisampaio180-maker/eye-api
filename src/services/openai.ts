import { env } from '../env.ts';

/**
 * Integração OpenAI isolada (placeholder). Quando aprovamos uma solicitação,
 * o backend já pré-monta sugestões usando o DNA do cliente. Sem OPENAI_API_KEY,
 * devolve um mock plausível; com a chave, aqui entraria a chamada real.
 */
const hasKey = Boolean(env.OPENAI_API_KEY);

interface DNALike {
  posicionamento?: string;
  tomDeVoz?: string;
  paleta?: { nome: string; hex: string }[];
  referencias?: string[];
}

export function sugerirPromptArte(opts: {
  clienteNome: string;
  briefing: string;
  formato?: string | null;
  textos?: string | null;
  dna?: DNALike;
}): string {
  const paleta = opts.dna?.paleta?.map((p) => `${p.nome} ${p.hex}`).join(', ') || 'paleta da marca';
  const refs = opts.dna?.referencias?.join('; ') || 'referências da marca';
  return [
    `PROMPT DALL·E 3 — ${opts.clienteNome} (${opts.formato ?? 'feed'})`,
    `① 1080×1440px (4:5). ② Brand: ${opts.clienteNome}. Palette: ${paleta}. References: ${refs}.`,
    `③ Scene: ${opts.briefing || 'arte para o feed'}. ④ Cinematic key + rim light.`,
    `⑤ Typography: DOMINANT headline "${(opts.textos || opts.briefing || 'DESTAQUE').toUpperCase()}".`,
    `⑥ On-brand decorative depth. ⑦ MOOD: ${opts.dna?.posicionamento ?? 'autoridade e performance'}.`,
    `⑧ DO NOTs: no solid box behind text; max 5 text elements; no generic stock.`,
  ].join('\n');
}

export function sugerirLegenda(opts: { clienteNome: string; briefing: string; tom?: string }): string {
  const tom = opts.tom?.split('.')[0] ?? 'tom da marca';
  return `${opts.briefing || 'Novidade'} — com a essência da ${opts.clienteNome}. ${tom}.\n\n👉 Saiba mais!\n\n#${opts.clienteNome.replace(/\s/g, '')} #EYEAgencia`;
}

export function sugerirRoteiro(opts: { clienteNome: string; tema: string; tipoVideo?: string | null }) {
  return {
    hook: `${opts.tema || opts.clienteNome}? Olha isso! 👀`,
    development: `Estrutura de Reels (${opts.tipoVideo ?? 'reels'}): 0-3s gancho → 3-15s contexto → 15-25s transformação → 25-28s impacto.`,
    cta: '28-30s: CTA — siga e compartilhe!',
    scenes: ['Gancho', 'Contexto', 'Transformação', 'CTA'],
    estimatedDuration: '30s',
  };
}

export const openaiConfigured = hasKey;
