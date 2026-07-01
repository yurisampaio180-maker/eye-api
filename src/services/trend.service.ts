import { env } from '../env.ts';

interface TavilyResponse {
  answer?: string;
  results?: { title: string; content: string }[];
}

async function buscarTavily(query: string): Promise<string> {
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
        topic: 'news',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return '';
    const data = (await resp.json()) as TavilyResponse;
    return data.answer ?? data.results?.slice(0, 3).map((r) => r.content).join('\n') ?? '';
  } catch {
    return '';
  }
}

function fallbackSazonal(segmento: string, mes: string): string {
  const [ano, mesNum] = mes.split('-').map(Number);
  const nomeMes = new Date(ano, mesNum - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });

  const dicas: Record<number, string[]> = {
    1: ['Janeiro: início de ano, metas pessoais, renovação. Academias lotadas. Férias escolares no nordeste.'],
    2: ['Fevereiro: Carnaval (alta em entretenimento). Verão prolongado no nordeste. Pós-carnaval queda de consumo.'],
    3: ['Março: pós-Carnaval, volta às aulas. Dia Internacional da Mulher (8/3). Início do ano real para negócios.'],
    4: ['Abril: Páscoa e Semana Santa. Feriados prolongados. Alta em alimentação, família e presentes.'],
    5: ['Maio: Dia das Mães (segunda quinzena — maior data do varejo). Período emocional, alta em vendas de presente.'],
    6: ['Junho: Festas Juninas, maior festivo do nordeste. Forró, arraiá, ambiente celebrativo e comunitário.'],
    7: ['Julho: férias escolares de inverno. Turismo interno. Consumo de serviços e lazer em alta.'],
    8: ['Agosto: preparação para o Dia dos Pais (segundo domingo). Alta em compras masculinas e presentes.'],
    9: ['Setembro: Dia dos Pais passou. Primavera. Semana do Brasil (Black Friday antecipada). Q4 começa.'],
    10: ['Outubro: Dia das Crianças (12/10). Halloween crescente no Brasil. Início oficial de vendas de fim de ano.'],
    11: ['Novembro: Black Friday (última sexta). Cyber Monday. Maior mês de vendas online do ano.'],
    12: ['Dezembro: Natal (25), Réveillon (31). Confraternizações. Alta em presentes, celebração e encerramento.'],
  };

  const contextoDicas = dicas[mesNum] ?? [`${nomeMes}: sem sazonalidade específica mapeada.`];
  return `CONTEXTO SAZONAL — ${nomeMes.toUpperCase()}:
${contextoDicas.join('\n')}
SEGMENTO: ${segmento} — adaptar toda comunicação ao que o consumidor está vivendo neste momento.
RECOMENDAÇÃO: conteúdo relevante ao momento emocional e comportamental do público agora.`;
}

export async function buscarTendencias(clienteId: string, segmento: string, mes: string): Promise<string> {
  if (!env.TAVILY_API_KEY) {
    return fallbackSazonal(segmento, mes);
  }

  const [ano, mesNum] = mes.split('-').map(Number);
  const nomeMes = new Date(ano, mesNum - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const queries = [
    `tendências marketing digital ${segmento} ${nomeMes}`,
    `trending instagram brasil ${segmento} ${ano}`,
  ];

  const resultados = await Promise.all(queries.map((q) => buscarTavily(q)));
  const validos = resultados.filter(Boolean);

  if (!validos.length) return fallbackSazonal(segmento, mes);
  return `TENDÊNCIAS — ${nomeMes.toUpperCase()}:\n` + validos.join('\n\n');
}
