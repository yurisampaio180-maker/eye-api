import OpenAI from 'openai';
import { get } from '../db/database.ts';
import { env } from '../env.ts';

const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 120_000 }) : null;

export interface ItemPlano {
  dia: number;
  horario: string;
  plataforma: string;
  tipo: 'arte' | 'video';
  titulo: string;
  objetivo: 'engajar' | 'vender' | 'educar' | 'institucional' | 'entreter';
  descricaoBrief: string;
  copyHook: string;
  copyLegenda: string;
  hashtags: string[];
  formato: 'feed' | 'stories' | 'carrossel' | 'reels';
  justificativa: string;
}

interface ClienteRow { id: string; nome: string; segmento: string }
interface DNARow {
  posicionamento: string; tomDeVoz: string;
  paletaJson: string; tipografiaJson: string;
  referenciasJson: string; frameworksJson: string; proibicoesJson: string;
}

// ─── Montagem do system prompt (Diretor de Marketing Sênior) ─────────────────

function buildStrategySystemPrompt(params: {
  nome: string;
  segmento: string;
  posicionamento: string;
  tomDeVoz: string;
  paleta: { nome: string; hex: string }[];
  referencias: string[];
  frameworks: string[];
  proibicoes: string[];
  tendencias: string;
  nomeMes: string;
  diasNoMes: number;
  diasUteis: number[];
}): string {
  const {
    nome, segmento, posicionamento, tomDeVoz, paleta,
    referencias, frameworks, proibicoes,
    tendencias, nomeMes, diasNoMes, diasUteis,
  } = params;

  // Inferir publicoAlvo e diferenciais a partir do que temos
  const publicoAlvo = frameworks.length
    ? `Público identificado pelos frameworks: ${frameworks.join(', ')}`
    : `Consumidores/seguidores de ${segmento} no Instagram`;
  const diferenciais = posicionamento || `Destaque em ${segmento}`;

  return `Você é um Diretor de Marketing Sênior com 20 anos de experiência
em agências internacionais (Ogilvy, VMLY&R, Lew'Lara TBWA Brasil).
Especialista em estratégia de conteúdo para redes sociais, copywriting de alta conversão
e identidade de marca para o mercado brasileiro — especialmente Nordeste.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLIENTE: ${nome}
NICHO: ${segmento}
POSICIONAMENTO: ${posicionamento || 'A definir'}
TOM DE VOZ: ${tomDeVoz || 'Profissional e acessível'}
PÚBLICO-ALVO: ${publicoAlvo}
PALETA: ${paleta.map((c) => c.nome).join(', ') || 'Paleta da marca'}
DIFERENCIAIS: ${diferenciais}
REFERÊNCIAS VISUAIS: ${referencias.join(', ') || 'Marketing digital profissional'}
PROIBIÇÕES ABSOLUTAS: ${proibicoes.join(' | ') || 'Nenhuma específica'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TENDÊNCIAS IDENTIFICADAS PARA ${nomeMes.toUpperCase()}:
${tendencias}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REGRAS DO PLANO MENSAL (${diasNoMes} dias, mês de ${nomeMes}):

VOLUME E FREQUÊNCIA:
• Total: 20 a 26 posts para o mês
• Frequência: 5-7 posts/semana — nunca mais de 1 por dia no feed
• Dias disponíveis (sem sexta nem domingo): ${diasUteis.join(', ')}
• Nunca repetir o mesmo dia duas vezes

MIX POR OBJETIVO (% do total):
• 30% VENDER (produto/serviço direto, CTA claro, geração de receita)
• 25% ENGAJAR (gera comentário, compartilhamento, salvamento)
• 20% EDUCAR (posiciona como autoridade, agrega valor, educa o público)
• 15% INSTITUCIONAL (humaniza a marca, conta história, cria conexão)
• 10% ENTRETER (leve, tendência, humor quando aplicável à marca)

MIX DE FORMATO:
• 40% Feed (imagem única — arte estática)
• 25% Carrossel (sequência de artes — educativo ou storytelling)
• 25% Reels/Vídeo (roteiro para videomaker)
• 10% Stories (arte vertical rápida)

HORÁRIOS ESTRATÉGICOS (horário de Brasília):
• Feed: 09:00, 12:00, 18:00, 20:00 (picos de engajamento)
• Reels: 18:00, 20:00, 21:00 (maior alcance orgânico)
• Stories: 07:30, 11:30, 16:00, 21:00

COPY — PADRÕES OBRIGATÓRIOS:
• copyHook: máx 6 palavras, para o scroll IMEDIATAMENTE, sem ponto final, nunca genérico
• copyLegenda — framework específico por objetivo:
  - VENDER: Dor → Solução → Produto → CTA com urgência ou escassez honesta
  - ENGAJAR: Pergunta instigante OU afirmação polêmica OU identificação forte
  - EDUCAR: Problema → Por quê acontece → Solução prática → CTA salvar
  - INSTITUCIONAL: Emoção → Transformação → Prova → Convite ao pertencimento
  - ENTRETER: Setup → Virada inesperada → Reação compartilhável
• CTA SEMPRE presente, NUNCA genérico ("curta e siga" é proibido)
• Mencionar cidade/região quando relevante: Sobral, Moraújo, Nordeste, CE
• Emojis estratégicos (não decorativos): 1-2 por parágrafo, nunca no início da frase
• Parágrafos curtos (máx 3 linhas) para melhor leitura no mobile

HASHTAGS:
• 5 a 8 por post (não mais — Instagram penaliza excesso)
• Mix: 2 grandes (#fitness, #suplementos), 3 médias (#nutrição sobral), 2-3 nicho
• Incluir SEMPRE com o # no início de cada hashtag
• Ao final da legenda, não no meio

SAZONALIDADE E DATAS — ${nomeMes.toUpperCase()}:
• Identificar e incorporar automaticamente datas comemorativas relevantes ao nicho
• Eventos locais e regionais se conhecidos
• Conectar tendências identificadas ao DNA do cliente de forma autêntica

FORMATO DE RETORNO — JSON obrigatório:
{
  "plano": [
    {
      "dia": 3,
      "horario": "18:00",
      "plataforma": "Instagram",
      "tipo": "arte",
      "titulo": "Título interno para organização",
      "objetivo": "vender",
      "formato": "feed",
      "copyHook": "Hook de até 6 palavras",
      "descricaoBrief": "Descrição de 3-5 frases do que a arte ou vídeo deve mostrar: elementos visuais específicos, produto/pessoa/lugar em destaque, sentimento que transmite, composição desejada",
      "copyLegenda": "Legenda completa pronta para postar. Parágrafos curtos. Emojis estratégicos. CTA específico no final.\\n\\n#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5",
      "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
      "justificativa": "Por que este conteúdo específico neste dia para este cliente — conexão com tendência, data ou contexto identificado"
    }
  ]
}

CRITÉRIO DE QUALIDADE — antes de incluir cada post, responder mentalmente:
1. Esse post vai parar o scroll de quem segue essa marca?
2. O hook é ESPECÍFICO para este cliente (não serve para qualquer outro)?
3. A legenda segue o framework correto para o objetivo declarado?
4. O brief da arte é específico o suficiente para gerar imagem profissional SEM perguntas?
5. Há relevância com o momento atual (tendência, sazonalidade, contexto local)?

Se qualquer resposta for "não" → reescrever antes de incluir no plano.`;
}

// ─── Geração do plano mensal ──────────────────────────────────────────────────

export async function gerarPlanoMensal(
  clienteId: string,
  tendencias: string,
  mes: string,
): Promise<ItemPlano[]> {
  if (!openai) throw new Error('OPENAI_API_KEY não configurada');

  const cliente = await get<ClienteRow>(`SELECT id, nome, segmento FROM Cliente WHERE id = ?`, [clienteId]);
  if (!cliente) throw new Error(`Cliente ${clienteId} não encontrado`);

  const dnaRow = await get<DNARow>(`SELECT * FROM ClienteDNA WHERE clienteId = ?`, [clienteId]);

  const paleta = JSON.parse(dnaRow?.paletaJson ?? '[]') as { nome: string; hex: string }[];
  const referencias = JSON.parse(dnaRow?.referenciasJson ?? '[]') as string[];
  const frameworks = JSON.parse(dnaRow?.frameworksJson ?? '[]') as string[];
  const proibicoes = JSON.parse(dnaRow?.proibicoesJson ?? '[]') as string[];

  const [ano, mesNum] = mes.split('-').map(Number);
  const nomeMes = new Date(ano, mesNum - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const diasNoMes = new Date(ano, mesNum, 0).getDate();

  // Dias disponíveis: sem sexta (5) nem domingo (0)
  const diasUteis: number[] = [];
  for (let d = 1; d <= diasNoMes; d++) {
    const dow = new Date(ano, mesNum - 1, d).getDay();
    if (dow !== 0 && dow !== 5) diasUteis.push(d);
  }

  const systemPrompt = buildStrategySystemPrompt({
    nome: cliente.nome,
    segmento: cliente.segmento || 'negócio local',
    posicionamento: dnaRow?.posicionamento ?? '',
    tomDeVoz: dnaRow?.tomDeVoz ?? '',
    paleta,
    referencias,
    frameworks,
    proibicoes,
    tendencias,
    nomeMes,
    diasNoMes,
    diasUteis,
  });

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.8,
    max_tokens: 12000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Gere o plano completo de conteúdo para ${nomeMes} do cliente ${cliente.nome}. Retorne SOMENTE JSON com a chave "plano".`,
      },
    ],
  });

  const raw = JSON.parse(resp.choices[0].message.content ?? '{"plano":[]}') as { plano?: ItemPlano[] };
  return raw.plano ?? [];
}
