import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { all, get, run, nowISO } from '../db/database.ts';
import { createId } from '../lib/id.ts';
import { env } from '../env.ts';
import { buscarTendencias } from './trend.service.ts';
import { gerarPlanoMensal } from './strategy.service.ts';
import { montarPromptProfissional, type DNAInput } from './art-prompt-builder.ts';
import { gerarImagem } from './openai.ts';
import { gerarRoteiro } from './script.service.ts';

export interface GeracaoMarketing {
  id: string;
  clienteId: string;
  mes: string;
  status: 'processando' | 'concluido' | 'erro';
  totalItens: number;
  itensGerados: number;
  erros: number;
  iniciadoEm: string;
  concluidoEm: string | null;
}

function proxMes(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function salvarImagem(b64: string, imageId: string): string {
  const dir = join(process.cwd(), env.UPLOAD_DIR, 'geradas');
  mkdirSync(dir, { recursive: true });
  const filename = `${imageId}.webp`;
  writeFileSync(join(dir, filename), Buffer.from(b64, 'base64'));
  return `/uploads/geradas/${filename}`;
}

export async function iniciarGeracao(clienteId: string, mes?: string): Promise<string> {
  const mesAlvo = mes ?? proxMes();

  // Não iniciar nova geração se já há uma em processamento para o mesmo cliente/mês
  const em_processamento = await get<{ id: string }>(
    `SELECT id FROM GeracaoMarketing WHERE clienteId = ? AND mes = ? AND status = 'processando'`,
    [clienteId, mesAlvo],
  );
  if (em_processamento) return em_processamento.id;

  const id = createId('gm');
  await run(
    `INSERT INTO GeracaoMarketing (id, clienteId, mes, status, totalItens, itensGerados, erros, iniciadoEm)
     VALUES (?, ?, ?, 'processando', 0, 0, 0, ?)`,
    [id, clienteId, mesAlvo, nowISO()],
  );
  return id;
}

export async function executarGeracaoCompleta(clienteId: string, geracaoId: string): Promise<void> {
  try {
    const geracao = await get<GeracaoMarketing>(`SELECT * FROM GeracaoMarketing WHERE id = ?`, [geracaoId]);
    if (!geracao) throw new Error('Geração não encontrada');
    const mes = geracao.mes;

    const cliente = await get<{ id: string; nome: string; segmento: string }>(
      `SELECT id, nome, segmento FROM Cliente WHERE id = ?`,
      [clienteId],
    );
    if (!cliente) throw new Error(`Cliente ${clienteId} não encontrado`);

    const dnaRow = await get<any>(`SELECT * FROM ClienteDNA WHERE clienteId = ?`, [clienteId]);
    const dna: DNAInput = {
      nome: cliente.nome,
      posicionamento: dnaRow?.posicionamento ?? '',
      tomDeVoz: dnaRow?.tomDeVoz ?? '',
      paleta: JSON.parse(dnaRow?.paletaJson ?? '[]'),
      tipografia: JSON.parse(dnaRow?.tipografiaJson ?? '{}'),
      referencias: JSON.parse(dnaRow?.referenciasJson ?? '[]'),
      proibicoes: JSON.parse(dnaRow?.proibicoesJson ?? '[]'),
    };

    const tendencias = await buscarTendencias(clienteId, cliente.segmento, mes);
    const plano = await gerarPlanoMensal(clienteId, tendencias, mes);

    await run(`UPDATE GeracaoMarketing SET totalItens = ? WHERE id = ?`, [plano.length, geracaoId]);

    const [ano, mesNum] = mes.split('-').map(Number);
    let gerados = 0;
    let erros = 0;

    for (const item of plano) {
      try {
        let imagemUrl: string | null = null;
        let roteiro: string | null = null;

        if (item.tipo === 'arte') {
          try {
            const { promptFinal } = montarPromptProfissional({ item, dna });
            const { b64 } = await gerarImagem({ promptTecnico: promptFinal, formato: item.formato });
            imagemUrl = salvarImagem(b64, createId('img'));
          } catch (e: any) {
            console.warn(`[motor] arte falhou para "${item.titulo}": ${e.message}`);
          }
        } else {
          roteiro = await gerarRoteiro(item, dna).catch((e: any) => {
            console.warn(`[motor] roteiro falhou para "${item.titulo}": ${e.message}`);
            return null;
          });
        }

        const dataHora = new Date(ano, mesNum - 1, item.dia);
        const [h, m] = item.horario.split(':').map(Number);
        dataHora.setHours(h ?? 11, m ?? 0, 0, 0);

        await run(
          `INSERT INTO EventoAgenda
           (id, clienteId, titulo, dataHora, plataforma, tipo, status,
            legenda, imagemUrl, hashtags, roteiro, geradoPorIA, justificativa, formato, objetivo, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, 'aguardando_confirmacao', ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            createId('ev'),
            clienteId,
            item.titulo,
            dataHora.toISOString(),
            item.plataforma ?? 'instagram',
            item.tipo === 'video' ? 'video' : 'post',
            item.copyLegenda,
            imagemUrl,
            item.hashtags.join(' '),
            roteiro,
            item.justificativa,
            item.formato,
            item.objetivo,
            nowISO(),
          ],
        );

        gerados++;
        await run(`UPDATE GeracaoMarketing SET itensGerados = ? WHERE id = ?`, [gerados, geracaoId]);
      } catch (e: any) {
        console.error(`[motor] item "${item.titulo}" falhou:`, e.message);
        erros++;
        await run(`UPDATE GeracaoMarketing SET erros = ? WHERE id = ?`, [erros, geracaoId]);
      }
    }

    await run(
      `UPDATE GeracaoMarketing SET status = 'concluido', concluidoEm = ?, itensGerados = ?, erros = ? WHERE id = ?`,
      [nowISO(), gerados, erros, geracaoId],
    );
  } catch (e: any) {
    await run(
      `UPDATE GeracaoMarketing SET status = 'erro', concluidoEm = ? WHERE id = ?`,
      [nowISO(), geracaoId],
    ).catch(() => {});
    throw e;
  }
}

export async function buscarGeracao(id: string): Promise<GeracaoMarketing | undefined> {
  return get<GeracaoMarketing>(`SELECT * FROM GeracaoMarketing WHERE id = ?`, [id]);
}

export async function listarGeracoes(clienteId: string): Promise<GeracaoMarketing[]> {
  return all<GeracaoMarketing>(
    `SELECT * FROM GeracaoMarketing WHERE clienteId = ? ORDER BY iniciadoEm DESC LIMIT 10`,
    [clienteId],
  );
}

export async function listarGeracoesAtivas(): Promise<GeracaoMarketing[]> {
  return all<GeracaoMarketing>(`SELECT * FROM GeracaoMarketing WHERE status = 'processando'`);
}

export async function executarTodosOsClientes(): Promise<void> {
  const clientes = await all<{ id: string }>(`SELECT id FROM Cliente ORDER BY nome`);
  for (const { id } of clientes) {
    const geracaoId = await iniciarGeracao(id);
    await executarGeracaoCompleta(id, geracaoId).catch((e: any) =>
      console.error(`[motor:cron] erro no cliente ${id}:`, e.message),
    );
    await new Promise((r) => setTimeout(r, 30_000));
  }
}
