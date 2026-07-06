import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, run, nowISO } from '../db/database.ts';
import { createId } from '../lib/id.ts';
import { notFound, badRequest } from '../lib/errors.ts';
import { getSolic, avancarProducao } from './solicitacoes.routes.ts';
import { saveFile } from '../services/storage.ts';
import { notificar } from '../services/notificacoes.ts';
import type { SolicitacaoStatus } from '../lib/stateMachine.ts';

interface TarefaRow {
  id: string;
  solicitacaoId: string;
  tipo: string;
  titulo: string;
  responsavelId: string | null;
  prazoProducao: string | null;
  statusProducao: string;
  entregaUrl: string | null;
  videoLink: string | null;
  videoLinkTipo: string | null;
  promptSugerido: string | null;
  legendaSugerida: string | null;
}

const DOMINIOS_VIDEO_PERMITIDOS = ['drive.google.com', 'wetransfer.com', 'we.tl', 'dropbox.com'];

function detectarTipoVideoLink(url: string): string {
  if (url.includes('drive.google.com')) return 'google_drive';
  if (url.includes('wetransfer.com') || url.includes('we.tl')) return 'wetransfer';
  if (url.includes('dropbox.com')) return 'dropbox';
  return 'outro';
}

/**
 * Mapeia coluna do kanban → status da solicitação na fase de produção.
 * O kanban vai só até "pronto" (= aguardando_confirmacao). Postar é ação do CEO.
 */
function statusProducaoParaSolic(status: string): SolicitacaoStatus {
  switch (status) {
    case 'roteiro':
    case 'ideia':
      return 'aprovada';
    case 'gravacao':
    case 'edicao':
    case 'producao':
      return 'em_producao';
    case 'aprovacao':
    case 'revisao':
      return 'em_revisao';
    case 'pronto':
      return 'aguardando_confirmacao';
    default:
      return 'aprovada';
  }
}

async function enriquecer(t: TarefaRow) {
  const s = await get<{ clienteId: string; status: string; tipo: string }>(`SELECT clienteId, status, tipo FROM Solicitacao WHERE id = ?`, [t.solicitacaoId]);
  const cliente = s ? await get<{ nome: string }>(`SELECT nome FROM Cliente WHERE id = ?`, [s.clienteId]) : null;
  const resp = t.responsavelId ? await get<{ nome: string; avatarColor: string }>(`SELECT nome, avatarColor FROM "User" WHERE id = ?`, [t.responsavelId]) : null;
  return { ...t, clienteNome: cliente?.nome ?? null, solicitacaoStatus: s?.status, responsavelNome: resp?.nome ?? null, responsavelCor: resp?.avatarColor ?? null };
}

export async function tarefasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // LISTAR (por papel)
  app.get('/', async (req) => {
    const user = req.authUser;
    let rows: TarefaRow[];
    if (user.role === 'ceo' || user.role === 'social') {
      rows = await all<TarefaRow>(`SELECT * FROM Tarefa ORDER BY createdAt DESC`);
    } else if (user.role === 'designer_governo') {
      rows = await all<TarefaRow>(
        `SELECT t.* FROM Tarefa t JOIN Solicitacao s ON s.id = t.solicitacaoId
         WHERE t.tipo = 'arte' AND s.clienteId = 'governo-moraujo' AND (t.responsavelId = ? OR t.responsavelId IS NULL)
         ORDER BY t.createdAt`,
        [user.id]
      );
    } else if (user.role === 'videomaker') {
      rows = await all<TarefaRow>(`SELECT * FROM Tarefa WHERE tipo = 'video' AND (responsavelId = ? OR responsavelId IS NULL) ORDER BY createdAt DESC`, [user.id]);
    } else {
      rows = [];
    }
    return Promise.all(rows.map(enriquecer));
  });

  // ATUALIZAR (mover no kanban / atribuir)
  const patchBody = z.object({
    statusProducao: z.string().optional(),
    responsavelId: z.string().nullable().optional(),
    prazoProducao: z.string().datetime().nullable().optional(),
  });
  app.patch('/:id', { preHandler: app.authorize('ceo', 'social', 'designer_governo', 'videomaker') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = patchBody.parse(req.body ?? {});
    const t = await get<TarefaRow>(`SELECT * FROM Tarefa WHERE id = ?`, [id]);
    if (!t) throw notFound('Tarefa não encontrada.');

    const campos: string[] = [];
    const valores: unknown[] = [];
    if (body.statusProducao !== undefined) { campos.push('statusProducao = ?'); valores.push(body.statusProducao); }
    if (body.responsavelId !== undefined) { campos.push('responsavelId = ?'); valores.push(body.responsavelId); }
    if (body.prazoProducao !== undefined) { campos.push('prazoProducao = ?'); valores.push(body.prazoProducao); }
    if (campos.length) {
      valores.push(nowISO(), id);
      await run(`UPDATE Tarefa SET ${campos.join(', ')}, updatedAt = ? WHERE id = ?`, valores);
    }

    if (body.statusProducao) {
      const s = await getSolic(t.solicitacaoId);
      await avancarProducao(s, statusProducaoParaSolic(body.statusProducao), req.authUser.id);
    }
    if (body.responsavelId) {
      notificar({ titulo: 'Tarefa atribuída a você', destinatarioId: body.responsavelId, solicitacaoId: t.solicitacaoId, mensagem: t.titulo });
    }
    return enriquecer((await get<TarefaRow>(`SELECT * FROM Tarefa WHERE id = ?`, [id]))!);
  });

  // ENTREGA POR LINK EXTERNO (vídeos — Google Drive / WeTransfer / Dropbox)
  app.post('/:id/entrega-link', { preHandler: app.authorize('ceo', 'videomaker') }, async (req) => {
    const { id } = req.params as { id: string };
    const { videoLink } = z.object({ videoLink: z.string().url('URL inválida.') }).parse(req.body ?? {});

    let urlObj: URL;
    try { urlObj = new URL(videoLink); } catch { throw badRequest('URL inválida.'); }
    const dominioOk = DOMINIOS_VIDEO_PERMITIDOS.some(
      (d) => urlObj.hostname === d || urlObj.hostname.endsWith(`.${d}`)
    );
    if (!dominioOk) throw badRequest('Link não permitido. Use Google Drive, WeTransfer ou Dropbox.');

    const t = await get<TarefaRow>(`SELECT * FROM Tarefa WHERE id = ?`, [id]);
    if (!t) throw notFound('Tarefa não encontrada.');

    const tipo = detectarTipoVideoLink(videoLink);
    await run(
      `UPDATE Tarefa SET videoLink = ?, videoLinkTipo = ?, statusProducao = 'pronto', updatedAt = ? WHERE id = ?`,
      [videoLink, tipo, nowISO(), id],
    );
    const s = await getSolic(t.solicitacaoId);
    await avancarProducao(s, 'aguardando_confirmacao', req.authUser.id);
    notificar({ titulo: 'Vídeo entregue — aguardando confirmação', destinatarioId: 'ceo', solicitacaoId: s.id, mensagem: t.titulo });
    return enriquecer((await get<TarefaRow>(`SELECT * FROM Tarefa WHERE id = ?`, [id]))!);
  });

  // ENTREGA (upload da peça final → vai para a CONFIRMAÇÃO do CEO)
  app.post('/:id/entrega', { preHandler: app.authorize('ceo', 'social', 'designer_governo', 'videomaker') }, async (req) => {
    const { id } = req.params as { id: string };
    const t = await get<TarefaRow>(`SELECT * FROM Tarefa WHERE id = ?`, [id]);
    if (!t) throw notFound('Tarefa não encontrada.');

    const parts = req.parts();
    let entregaUrl: string | null = null;
    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        const stored = await saveFile(part.filename, part.mimetype, buffer);
        entregaUrl = stored.url;
        await run(`INSERT INTO Anexo (id, solicitacaoId, categoria, nomeArquivo, url, mime, tamanho, createdAt) VALUES (?,?,?,?,?,?,?,?)`,
          [createId('a'), t.solicitacaoId, 'entrega', stored.nomeArquivo, stored.url, stored.mime, stored.tamanho, nowISO()]);
      }
    }
    if (!entregaUrl) throw badRequest('Envie o arquivo da entrega.');

    await run(`UPDATE Tarefa SET entregaUrl = ?, statusProducao = 'pronto', updatedAt = ? WHERE id = ?`, [entregaUrl, nowISO(), id]);
    const s = await getSolic(t.solicitacaoId);
    await avancarProducao(s, 'aguardando_confirmacao', req.authUser.id);
    notificar({ titulo: 'Peça pronta — aguardando sua confirmação', destinatarioId: 'ceo', solicitacaoId: s.id, mensagem: t.titulo });
    return enriquecer((await get<TarefaRow>(`SELECT * FROM Tarefa WHERE id = ?`, [id]))!);
  });
}
