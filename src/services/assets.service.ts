import { all, get, run, nowISO } from '../db/database.ts';
import { createId } from '../lib/id.ts';
import { AppError } from '../lib/errors.ts';

export interface AssetRow {
  id: string;
  clienteId: string;
  tipo: 'logo' | 'referencia';
  origem: 'manual' | 'auto_aprovada';
  url: string;
  nome: string | null;
  usos: number;
  createdAt: string;
}

export interface AssetBuffer {
  buffer: Buffer;
  mime: string;
  tipo: string;
}

/** Erro específico para o fluxo guiado do frontend (code LOGO_AUSENTE). */
export const logoAusente = (clienteId: string) =>
  new AppError(422, 'LOGO_AUSENTE', 'Este cliente não tem logomarca cadastrada. Envie o PNG da logo antes de gerar artes.', { clienteId });

async function baixarBuffer(url: string): Promise<{ buffer: Buffer; mime: string } | null> {
  if (url.startsWith('data:')) {
    const m = url.match(/^data:(image\/\w+);base64,(.+)$/);
    return m ? { buffer: Buffer.from(m[2], 'base64'), mime: m[1] } : null;
  }
  if (url.startsWith('http')) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const mime = resp.headers.get('content-type') ?? 'image/png';
      return { buffer: Buffer.from(await resp.arrayBuffer()), mime };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Seleção inteligente para a geração: 1 logo (mais recente) + até 3 referências,
 * priorizando as curadas manualmente (2) e completando com aprovadas (2).
 * Baixa os buffers e contabiliza uso de cada asset anexado.
 */
export async function buscarAssetsParaGeracao(clienteId: string): Promise<{
  temLogo: boolean;
  buffers: AssetBuffer[];
}> {
  const [logos, refsManuais, refsAuto] = await Promise.all([
    all<AssetRow>(
      `SELECT * FROM ClienteAsset WHERE clienteId = ? AND tipo = 'logo' ORDER BY createdAt DESC LIMIT 1`,
      [clienteId],
    ),
    all<AssetRow>(
      `SELECT * FROM ClienteAsset WHERE clienteId = ? AND tipo = 'referencia' AND origem = 'manual' ORDER BY createdAt DESC LIMIT 2`,
      [clienteId],
    ),
    all<AssetRow>(
      `SELECT * FROM ClienteAsset WHERE clienteId = ? AND tipo = 'referencia' AND origem = 'auto_aprovada' ORDER BY createdAt DESC LIMIT 2`,
      [clienteId],
    ),
  ]);

  const selecionados = [...logos, ...[...refsManuais, ...refsAuto].slice(0, 3)];
  const buffers: AssetBuffer[] = [];
  for (const asset of selecionados) {
    const baixado = await baixarBuffer(asset.url);
    if (!baixado) continue;
    buffers.push({ ...baixado, tipo: asset.tipo });
    run(`UPDATE ClienteAsset SET usos = usos + 1 WHERE id = ?`, [asset.id]).catch(() => {});
  }

  return { temLogo: logos.length > 0, buffers };
}

/**
 * Auto-alimentação: arte aprovada vira referência automática.
 * Mantém no máximo 10 auto-referências por cliente (as mais recentes).
 * Nunca lança — falha aqui não pode quebrar a aprovação.
 */
export async function registrarReferenciaAprovada(clienteId: string, imagemUrl: string, titulo: string): Promise<void> {
  try {
    const jaExiste = await get<{ id: string }>(
      `SELECT id FROM ClienteAsset WHERE clienteId = ? AND url = ?`,
      [clienteId, imagemUrl],
    );
    if (jaExiste) return;

    const autoRefs = await all<{ id: string }>(
      `SELECT id FROM ClienteAsset WHERE clienteId = ? AND tipo = 'referencia' AND origem = 'auto_aprovada' ORDER BY createdAt DESC`,
      [clienteId],
    );
    if (autoRefs.length >= 10) {
      await run(`DELETE FROM ClienteAsset WHERE id = ?`, [autoRefs[autoRefs.length - 1].id]);
    }

    await run(
      `INSERT INTO ClienteAsset (id, clienteId, tipo, origem, url, nome, createdAt) VALUES (?,?,?,?,?,?,?)`,
      [createId('ast'), clienteId, 'referencia', 'auto_aprovada', imagemUrl, `Aprovada: ${titulo}`.slice(0, 120), nowISO()],
    );
  } catch (e: any) {
    console.warn(`[assets] auto-referencia falhou para ${clienteId}: ${e.message}`);
  }
}
