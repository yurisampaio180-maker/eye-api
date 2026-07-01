import OpenAI, { toFile } from 'openai';
import { env } from '../env.ts';

export const openaiConfigured = Boolean(env.OPENAI_API_KEY);

// Cliente lazy: criado apenas se a chave existir
const openai = openaiConfigured
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 90_000 })
  : null;

// ─── Mapeamento de formato → tamanho ────────────────────────────────────────

const SIZES: Record<string, '1024x1024' | '1024x1792'> = {
  feed: '1024x1024',
  stories: '1024x1792',
  carrossel_slide: '1024x1024',
};

// ─── Geração real de imagem ─────────────────────────────────────────────────

export async function gerarImagem(opts: {
  promptTecnico: string;
  formato: string;
  referenciaBuffer?: Buffer;
  referenciaMime?: string;
}): Promise<{ b64: string }> {
  if (!openai) throw new Error('OPENAI_API_KEY não configurada no servidor.');

  const size = SIZES[opts.formato] ?? '1024x1024';

  // Prefixo e sufixo de qualidade profissional — encapsulam o prompt técnico
  const promptFinal = [
    'Professional marketing design, advertising agency quality, Instagram-ready, brand-consistent.',
    opts.promptTecnico,
    'Photorealistic where photography is used. Ultra-high detail. Commercial photography and graphic design hybrid quality.',
  ].join('\n\n');

  if (opts.referenciaBuffer) {
    // Edição com imagem de referência (gpt-image-1 suporta image input)
    const imagemFile = await toFile(opts.referenciaBuffer, 'referencia.webp', {
      type: opts.referenciaMime ?? 'image/webp',
    });
    const res = await (openai.images as any).edit({
      model: 'gpt-image-1',
      image: imagemFile,
      prompt: promptFinal,
      size,
      quality: 'high',
      n: 1,
    });
    return { b64: res.data[0].b64_json as string };
  }

  // Geração pura
  const res = await (openai.images as any).generate({
    model: 'gpt-image-1',
    prompt: promptFinal,
    size,
    quality: 'high',
    n: 1,
    output_format: 'webp',
  });
  return { b64: res.data[0].b64_json as string };
}

// ─── Helpers determinísticos (usados pelo backend para pré-montar prompts) ──

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
    `PROMPT — ${opts.clienteNome} (${opts.formato ?? 'feed'})`,
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
