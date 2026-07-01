import OpenAI from 'openai';
import { env } from '../env.ts';
import type { DNAInput } from './art-prompt-builder.ts';

const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 60_000 }) : null;

export interface ItemPlanoVideo {
  titulo: string;
  objetivo: string;
  descricaoBrief: string;
  copyHook: string;
  formato: string;
}

export async function gerarRoteiro(item: ItemPlanoVideo, dna: DNAInput): Promise<string> {
  if (!openai) throw new Error('OPENAI_API_KEY não configurada');

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    max_tokens: 1500,
    messages: [
      {
        role: 'system',
        content: `Você é roteirista profissional de vídeos para redes sociais, especialista em Reels de alta performance no Instagram.
Cliente: ${dna.nome}. Tom de voz: ${dna.tomDeVoz || 'profissional e direto'}.
Objetivo do vídeo: ${item.objetivo}. Formato: ${item.formato} (30-60 segundos).`,
      },
      {
        role: 'user',
        content: `Crie roteiro COMPLETO e PRONTO para gravar:
Título: ${item.titulo}
Gancho: ${item.copyHook}
Brief: ${item.descricaoBrief}

ESTRUTURA OBRIGATÓRIA:
[GANCHO 0-3s]: exatamente o que aparece na tela + fala (se houver)
[DESENVOLVIMENTO 3-25s]: cenas detalhadas, texto na tela por cena, falas exatas
[CTA 25-30s]: chamada para ação exata que o apresentador fala
[NOTAS DE PRODUÇÃO]: enquadramento, iluminação, ritmo de edição, música sugerida
[CHECKLIST]: o que preparar antes de gravar`,
      },
    ],
  });

  return resp.choices[0].message.content ?? '';
}
