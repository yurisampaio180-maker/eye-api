import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, run, nowISO } from '../db/database.ts';
import { createId } from '../lib/id.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { assertTransition, PROD_ORDER, VISIVEIS_EQUIPE, type SolicitacaoStatus } from '../lib/stateMachine.ts';
import type { AuthUser } from '../auth/auth.plugin.ts';
import { notificar } from '../services/notificacoes.ts';
import { saveFile } from '../services/storage.ts';
import { sugerirPromptArte, sugerirLegenda, sugerirRoteiro } from '../services/openai.ts';
import { enviarWhatsAppCeo } from '../services/whatsapp.service.ts';

interface SolicRow {
  id: string;
  clienteId: string;
  unidadeId: string | null;
  solicitanteId: string;
  tipo: string;
  titulo: string;
  descricao: string;
  prioridade: string;
  prazoDesejado: string | null;
  status: string;
  formato: string | null;
  textosDesejados: string | null;
  informacoes: string | null;
  tipoVideo: string | null;
  localGravacao: string | null;
  dataEvento: string | null;
  precisaEquipeNoLocal: number;
  roteiroNecessario: number;
  horaEvento: string | null;
  tipoCobertura: string | null;
  coberturaReels: number;
  coberturaFotos: number;
  coberturaStories: number;
  tipoReels: string | null;
  motivoReprovacao: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- helpers reutilizáveis ----------
export async function getSolic(id: string): Promise<SolicRow> {
  const s = await get<SolicRow>(`SELECT * FROM Solicitacao WHERE id = ?`, [id]);
  if (!s) throw notFound('Solicitação não encontrada.');
  return s;
}

/** isolamento multi-cliente: o solicitante só enxerga o que é dele. */
export function assertPodeVer(user: AuthUser, s: SolicRow) {
  if (user.role === 'ceo') return;
  if (user.role === 'social') {
    if (s.solicitanteId === user.id) return; // vê sempre as próprias
    if (!VISIVEIS_EQUIPE.includes(s.status as SolicitacaoStatus)) throw forbidden();
    return;
  }
  if (['designer_governo', 'videomaker'].includes(user.role)) {
    if (user.role === 'designer_governo' && s.clienteId !== 'governo-moraujo') throw forbidden();
    if (!VISIVEIS_EQUIPE.includes(s.status as SolicitacaoStatus)) throw forbidden();
    return;
  }
  if (s.clienteId !== user.clienteId) throw forbidden('Sem acesso a este cliente.');
  // gestor do cliente (ex.: Prefeito) vê todas as secretarias do seu cliente
  if (user.gestorCliente || user.role === 'gestor_cliente') return;
  const ehMinha = s.solicitanteId === user.id || (s.unidadeId && s.unidadeId === user.unidadeId);
  if (!ehMinha) throw forbidden('Você só vê as solicitações da sua unidade.');
}

async function registrarHistorico(solicId: string, autorId: string | null, acao: string, de?: string, para?: string, detalhe?: string) {
  await run(
    `INSERT INTO HistoricoEvento (id, solicitacaoId, autorId, acao, de, para, detalhe, createdAt) VALUES (?,?,?,?,?,?,?,?)`,
    [createId('h'), solicId, autorId, acao, de ?? null, para ?? null, detalhe ?? null, nowISO()]
  );
}

/** muda status validando a máquina de estados + registra histórico + rastreia SLA. */
export async function transicionar(s: SolicRow, para: SolicitacaoStatus, autorId: string | null, acao: string, detalhe?: string) {
  assertTransition(s.status as SolicitacaoStatus, para);
  const now = nowISO();
  // fecha transição em andamento
  await run(`UPDATE TransicaoStatus SET finalizadoEm = ? WHERE solicitacaoId = ? AND finalizadoEm IS NULL`, [now, s.id]);
  // abre nova (busca responsável atual na tarefa, se já existir)
  const tarefa = await get<{ responsavelId: string | null }>(`SELECT responsavelId FROM Tarefa WHERE solicitacaoId = ?`, [s.id]);
  await run(
    `INSERT INTO TransicaoStatus (id, solicitacaoId, status, responsavelId, iniciadoEm) VALUES (?,?,?,?,?)`,
    [createId('ts'), s.id, para, tarefa?.responsavelId ?? null, now]
  );
  await run(`UPDATE Solicitacao SET status = ?, updatedAt = ? WHERE id = ?`, [para, now, s.id]);
  await registrarHistorico(s.id, autorId, acao, s.status, para, detalhe);
  s.status = para;
}

/** avança a solicitação na fase de produção até o alvo (passo a passo válido). */
export async function avancarProducao(s: SolicRow, alvo: SolicitacaoStatus, autorId: string | null) {
  const from = PROD_ORDER.indexOf(s.status as SolicitacaoStatus);
  const to = PROD_ORDER.indexOf(alvo);
  if (from === -1 || to === -1 || to <= from) return;
  for (let i = from + 1; i <= to; i++) {
    await transicionar(s, PROD_ORDER[i], autorId, `produção: ${PROD_ORDER[i]}`);
  }
}

async function enriquecer(s: SolicRow) {
  const [anexos, historico, cliente, solicitante, tarefa, transicoes] = await Promise.all([
    all(`SELECT * FROM Anexo WHERE solicitacaoId = ? ORDER BY createdAt`, [s.id]),
    all(
      `SELECT h.*, u.nome AS autorNome FROM HistoricoEvento h LEFT JOIN "User" u ON u.id = h.autorId WHERE h.solicitacaoId = ? ORDER BY h.createdAt`,
      [s.id]
    ),
    get<{ nome: string }>(`SELECT nome FROM Cliente WHERE id = ?`, [s.clienteId]),
    get<{ nome: string }>(`SELECT nome FROM "User" WHERE id = ?`, [s.solicitanteId]),
    get(`SELECT * FROM Tarefa WHERE solicitacaoId = ?`, [s.id]),
    all<{ id: string; status: string; responsavelId: string | null; iniciadoEm: string; finalizadoEm: string | null; responsavelNome: string | null }>(
      `SELECT ts.*, u.nome AS responsavelNome FROM TransicaoStatus ts LEFT JOIN "User" u ON u.id = ts.responsavelId WHERE ts.solicitacaoId = ? ORDER BY ts.iniciadoEm`,
      [s.id]
    ),
  ]);
  const unidade = s.unidadeId ? await get<{ nome: string }>(`SELECT nome FROM Unidade WHERE id = ?`, [s.unidadeId]) : null;

  const agora = Date.now();
  const sla = transicoes.map((t) => ({
    ...t,
    duracaoMinutos: Math.floor(
      ((t.finalizadoEm ? new Date(t.finalizadoEm).getTime() : agora) - new Date(t.iniciadoEm).getTime()) / 60000
    ),
    emAndamento: !t.finalizadoEm,
  }));

  return {
    ...s,
    precisaEquipeNoLocal: Boolean(s.precisaEquipeNoLocal),
    roteiroNecessario: Boolean(s.roteiroNecessario),
    coberturaReels: Boolean(s.coberturaReels),
    coberturaFotos: Boolean(s.coberturaFotos),
    coberturaStories: Boolean(s.coberturaStories),
    clienteNome: cliente?.nome,
    unidadeNome: unidade?.nome ?? null,
    solicitanteNome: solicitante?.nome,
    anexos,
    historico,
    tarefa: tarefa ?? null,
    sla,
  };
}

export async function solicitacoesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // -------- LISTAR --------
  app.get('/', async (req) => {
    const user = req.authUser;
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    let rows: SolicRow[];
    const visiveis = VISIVEIS_EQUIPE.map((v) => `'${v}'`).join(',');
    if (user.role === 'ceo') {
      rows = await all<SolicRow>(`SELECT * FROM Solicitacao ORDER BY createdAt DESC`);
    } else if (user.role === 'designer_governo') {
      rows = await all<SolicRow>(
        `SELECT * FROM Solicitacao WHERE tipo = 'arte' AND clienteId = 'governo-moraujo' AND status IN (${visiveis}) ORDER BY createdAt DESC`
      );
    } else if (user.role === 'social') {
      rows = await all<SolicRow>(
        `SELECT * FROM Solicitacao WHERE status IN (${visiveis}) OR solicitanteId = ? ORDER BY createdAt DESC`,
        [user.id],
      );
    } else if (user.role === 'videomaker') {
      // só vê vídeos atribuídos a ele ou ainda sem atribuição
      rows = await all<SolicRow>(
        `SELECT s.* FROM Solicitacao s
         LEFT JOIN Tarefa t ON t.solicitacaoId = s.id
         WHERE s.tipo = 'video' AND s.status IN (${visiveis})
           AND (t.responsavelId = ? OR t.responsavelId IS NULL)
         ORDER BY s.createdAt DESC`,
        [user.id]
      );
    } else if (user.gestorCliente || user.role === 'gestor_cliente') {
      rows = await all<SolicRow>(`SELECT * FROM Solicitacao WHERE clienteId = ? ORDER BY createdAt DESC`, [user.clienteId]);
    } else {
      rows = await all<SolicRow>(
        `SELECT * FROM Solicitacao WHERE clienteId = ? AND (solicitanteId = ? OR unidadeId = ?) ORDER BY createdAt DESC`,
        [user.clienteId, user.id, user.unidadeId]
      );
    }
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    return Promise.all(rows.map(enriquecer));
  });

  // -------- DETALHE --------
  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSolic(id);
    assertPodeVer(req.authUser, s);
    return enriquecer(s);
  });

  // -------- CRIAR --------
  const createBody = z.object({
    tipo: z.enum(['arte', 'video']),
    titulo: z.string().min(2),
    descricao: z.string().default(''),
    prioridade: z.enum(['baixa', 'normal', 'alta', 'urgente']).default('normal'),
    prazoDesejado: z.string().datetime().optional(),
    unidadeId: z.string().optional(),
    formato: z.enum(['feed', 'stories', 'carrossel', 'outro']).optional(),
    textosDesejados: z.string().optional(),
    informacoes: z.string().optional(),
    tipoVideo: z.enum(['reels', 'institucional', 'cobertura', 'depoimento']).optional(),
    localGravacao: z.string().optional(),
    dataEvento: z.string().datetime().optional(),
    horaEvento: z.string().optional(),
    tipoCobertura: z.enum(['reels', 'reels_fotos', 'reels_fotos_stories']).optional(),
    coberturaReels: z.boolean().default(false),
    coberturaFotos: z.boolean().default(false),
    coberturaStories: z.boolean().default(false),
    tipoReels: z.enum(['informativo', 'evento']).optional(),
    precisaEquipeNoLocal: z.boolean().default(false),
    roteiroNecessario: z.boolean().default(false),
    enviarAgora: z.boolean().default(false),
  });

  app.post('/', { preHandler: app.authorize('cliente', 'ceo', 'social') }, async (req, reply) => {
    const body = createBody.parse(req.body);
    if (body.tipo === 'video' && (!body.dataEvento || !body.horaEvento)) {
      throw badRequest('Para solicitações de vídeo, informe a data e o horário do evento.');
    }
    const user = req.authUser;
    const clienteId = user.role === 'ceo' || user.role === 'social' ? (req.body as any).clienteId : user.clienteId;
    if (!clienteId) throw badRequest('Informe o cliente da solicitação.');
    const unidadeId = body.unidadeId ?? user.unidadeId ?? null;
    const id = createId('s');
    const now = nowISO();
    const status = body.enviarAgora ? 'em_aprovacao' : 'rascunho';

    await run(
      `INSERT INTO Solicitacao (id, clienteId, unidadeId, solicitanteId, tipo, titulo, descricao, prioridade, prazoDesejado, status, formato, textosDesejados, informacoes, tipoVideo, localGravacao, dataEvento, precisaEquipeNoLocal, roteiroNecessario, horaEvento, tipoCobertura, coberturaReels, coberturaFotos, coberturaStories, tipoReels, motivoReprovacao, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, clienteId, unidadeId, user.id, body.tipo, body.titulo, body.descricao, body.prioridade,
        body.prazoDesejado ?? null, status, body.formato ?? null, body.textosDesejados ?? null,
        body.informacoes ?? null, body.tipoVideo ?? null, body.localGravacao ?? null, body.dataEvento ?? null,
        body.precisaEquipeNoLocal ? 1 : 0, body.roteiroNecessario ? 1 : 0,
        body.horaEvento ?? null, body.tipoCobertura ?? null,
        body.coberturaReels ? 1 : 0, body.coberturaFotos ? 1 : 0, body.coberturaStories ? 1 : 0, body.tipoReels ?? null,
        null, now, now,
      ]
    );
    await registrarHistorico(id, user.id, 'criada', undefined, status);
    // Inicia rastreio de SLA desde o status inicial
    await run(
      `INSERT INTO TransicaoStatus (id, solicitacaoId, status, responsavelId, iniciadoEm) VALUES (?,?,?,?,?)`,
      [createId('ts'), id, status, null, now]
    );
    if (status === 'em_aprovacao') {
      notificar({ titulo: 'Nova solicitação para aprovação', destinatarioId: 'ceo', solicitacaoId: id, mensagem: body.titulo });
    }
    // Quando social/CEO cria gravação com data, entra direto na agenda do CEO
    if (body.tipo === 'video' && body.dataEvento && ['social', 'ceo'].includes(user.role)) {
      await run(
        `INSERT INTO EventoAgenda (id, clienteId, solicitacaoId, titulo, dataHora, plataforma, tipo, status, responsavelId, localEvento, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [createId('ev'), clienteId, id, body.titulo, body.dataEvento, null, 'evento', 'agendado', null, body.localGravacao ?? null, now],
      );
    }
    reply.code(201);
    return enriquecer(await getSolic(id));
  });

  // -------- EDITAR --------
  // CEO: qualquer status. social: qualquer status (com auditoria pós-aprovação). demais: só rascunho/reprovada.
  const ESTADOS_LIVRES: SolicitacaoStatus[] = ['rascunho', 'enviada', 'em_aprovacao', 'reprovada'];

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSolic(id);
    assertPodeVer(req.authUser, s);
    const podeEditarTudo = ['ceo', 'social'].includes(req.authUser.role);
    if (!podeEditarTudo && !ESTADOS_LIVRES.includes(s.status as SolicitacaoStatus)) {
      throw badRequest('Só dá para editar rascunho ou solicitação reprovada.');
    }
    const patch = createBody.partial().parse(req.body);
    const campos: string[] = [];
    const valores: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'enviarAgora') continue;
      campos.push(`${k} = ?`);
      valores.push(typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null);
    }
    if (campos.length) {
      valores.push(nowISO(), id);
      await run(`UPDATE Solicitacao SET ${campos.join(', ')}, updatedAt = ? WHERE id = ?`, valores);
    }
    // Notifica responsável quando social edita demanda já em produção
    if (req.authUser.role === 'social' && !ESTADOS_LIVRES.includes(s.status as SolicitacaoStatus)) {
      const tarefa = await get<{ responsavelId: string | null }>(`SELECT responsavelId FROM Tarefa WHERE solicitacaoId = ?`, [id]);
      if (tarefa?.responsavelId) {
        notificar({ titulo: 'Demanda em produção foi alterada', destinatarioId: tarefa.responsavelId, solicitacaoId: id, mensagem: `"${s.titulo}" foi editada pela Social Media. Confira as mudanças.` });
      }
    }
    return enriquecer(await getSolic(id));
  });

  // -------- EXCLUIR (CEO ou social — social só pode excluir em ESTADOS_LIVRES) --------
  app.delete('/:id', { preHandler: app.authorize('ceo', 'social') }, async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSolic(id);
    assertPodeVer(req.authUser, s);
    if (req.authUser.role === 'social' && s.solicitanteId !== req.authUser.id) {
      throw forbidden('Você só pode excluir solicitações que você criou.');
    }
    // Social só pode excluir antes da aprovação
    if (req.authUser.role === 'social' && !ESTADOS_LIVRES.includes(s.status as SolicitacaoStatus)) {
      throw forbidden('Demanda já em produção não pode ser excluída. Solicite ao CEO se necessário.');
    }
    if (['postada', 'cancelada'].includes(s.status)) {
      throw badRequest('Não é possível excluir uma solicitação já finalizada.');
    }
    await transicionar(s, 'cancelada', req.authUser.id, 'excluída pelo usuário');
    return enriquecer(await getSolic(id));
  });

  // -------- ENVIAR --------
  app.post('/:id/enviar', async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSolic(id);
    assertPodeVer(req.authUser, s);
    await transicionar(s, 'em_aprovacao', req.authUser.id, 'enviada para aprovação');
    notificar({ titulo: 'Nova solicitação para aprovação', destinatarioId: 'ceo', solicitacaoId: id, mensagem: s.titulo });
    return enriquecer(await getSolic(id));
  });

  // -------- REENVIAR --------
  app.post('/:id/reenviar', async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSolic(id);
    assertPodeVer(req.authUser, s);
    await transicionar(s, 'em_aprovacao', req.authUser.id, 'reenviada após ajustes');
    await run(`UPDATE Solicitacao SET motivoReprovacao = NULL WHERE id = ?`, [id]);
    notificar({ titulo: 'Solicitação reenviada', destinatarioId: 'ceo', solicitacaoId: id, mensagem: s.titulo });
    return enriquecer(await getSolic(id));
  });

  // -------- CANCELAR --------
  app.post('/:id/cancelar', async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSolic(id);
    assertPodeVer(req.authUser, s);
    await transicionar(s, 'cancelada', req.authUser.id, 'cancelada');
    return enriquecer(await getSolic(id));
  });

  // -------- APROVAR (só CEO) → cria Tarefa + agenda --------
  const aprovarBody = z.object({
    responsavelId: z.string().optional(),
    prazoProducao: z.string().datetime().optional(),
  });
  app.post('/:id/aprovar', { preHandler: app.authorize('ceo') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = aprovarBody.parse(req.body ?? {});
    const s = await getSolic(id);
    await transicionar(s, 'aprovada', req.authUser.id, 'aprovada pelo CEO');

    const cliente = await get<{ nome: string }>(`SELECT nome FROM Cliente WHERE id = ?`, [s.clienteId]);
    const dnaRow = await get<{ posicionamento: string; tomDeVoz: string; paletaJson: string; referenciasJson: string }>(
      `SELECT posicionamento, tomDeVoz, paletaJson, referenciasJson FROM ClienteDNA WHERE clienteId = ?`,
      [s.clienteId]
    );
    const dna = dnaRow
      ? {
          posicionamento: dnaRow.posicionamento,
          tomDeVoz: dnaRow.tomDeVoz,
          paleta: JSON.parse(dnaRow.paletaJson || '[]'),
          referencias: JSON.parse(dnaRow.referenciasJson || '[]'),
        }
      : undefined;

    let promptSugerido: string | null = null;
    let legendaSugerida: string | null = null;
    if (s.tipo === 'arte') {
      promptSugerido = sugerirPromptArte({ clienteNome: cliente?.nome ?? '', briefing: s.descricao, formato: s.formato, textos: s.textosDesejados, dna });
      legendaSugerida = sugerirLegenda({ clienteNome: cliente?.nome ?? '', briefing: s.descricao, tom: dna?.tomDeVoz });
    } else if (s.roteiroNecessario) {
      const r = sugerirRoteiro({ clienteNome: cliente?.nome ?? '', tema: s.titulo, tipoVideo: s.tipoVideo });
      promptSugerido = `ROTEIRO\nGancho: ${r.hook}\nDesenvolvimento: ${r.development}\nCTA: ${r.cta}\nDuração: ${r.estimatedDuration}`;
    }

    const statusProducao = s.tipo === 'video' ? 'roteiro' : 'ideia';
    const now = nowISO();
    await run(
      `INSERT INTO Tarefa (id, solicitacaoId, tipo, titulo, responsavelId, prazoProducao, statusProducao, entregaUrl, promptSugerido, legendaSugerida, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [createId('t'), id, s.tipo, s.titulo, body.responsavelId ?? null, body.prazoProducao ?? null, statusProducao, null, promptSugerido, legendaSugerida, now, now]
    );

    const dataHora = s.prazoDesejado ?? s.dataEvento ?? new Date(Date.now() + 3 * 864e5).toISOString();
    await run(
      `INSERT INTO EventoAgenda (id, clienteId, solicitacaoId, titulo, dataHora, plataforma, tipo, status, responsavelId, localEvento, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        createId('e'), s.clienteId, id, s.titulo, dataHora,
        s.tipo === 'arte' ? 'instagram' : null,
        s.tipo === 'arte' ? 'post' : 'evento',
        'agendado',
        body.responsavelId ?? null,
        s.tipo === 'video' ? (s.localGravacao ?? null) : null,
        now,
      ]
    );

    if (body.responsavelId) {
      notificar({ titulo: 'Nova tarefa atribuída', destinatarioId: body.responsavelId, solicitacaoId: id, mensagem: s.titulo });
      if (s.tipo === 'video' && s.dataEvento) {
        const dataStr = new Date(s.dataEvento).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const localStr = s.localGravacao ? ` · ${s.localGravacao}` : '';
        notificar({ titulo: `Filmagem agendada: ${dataStr}${s.horaEvento ? ' às ' + s.horaEvento : ''}${localStr}`, destinatarioId: body.responsavelId, solicitacaoId: id, mensagem: s.titulo });
      }
    }
    notificar({ titulo: 'Sua solicitação foi aprovada ✅', destinatarioId: s.solicitanteId, clienteId: s.clienteId, solicitacaoId: id, mensagem: s.titulo });

    return enriquecer(await getSolic(id));
  });

  // -------- REPROVAR (só CEO; motivo obrigatório) --------
  const reprovarBody = z.object({ motivo: z.string().min(3, 'Motivo é obrigatório.') });
  app.post('/:id/reprovar', { preHandler: app.authorize('ceo') }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = reprovarBody.parse(req.body);
    const s = await getSolic(id);
    await transicionar(s, 'reprovada', req.authUser.id, 'reprovada pelo CEO', motivo);
    await run(`UPDATE Solicitacao SET motivoReprovacao = ? WHERE id = ?`, [motivo, id]);
    notificar({ titulo: 'Solicitação reprovada ❌', destinatarioId: s.solicitanteId, clienteId: s.clienteId, solicitacaoId: id, mensagem: motivo });
    return enriquecer(await getSolic(id));
  });

  // -------- CONFIRMAR (só CEO) --------
  app.post('/:id/confirmar', { preHandler: app.authorize('ceo') }, async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSolic(id);
    await transicionar(s, 'confirmada', req.authUser.id, 'confirmada pelo CEO — liberada para postar');
    const tarefa = await get<{ responsavelId: string | null }>(`SELECT responsavelId FROM Tarefa WHERE solicitacaoId = ?`, [id]);
    notificar({ titulo: 'Peça confirmada — pode postar ✅', destinatarioId: 'eduarda', solicitacaoId: id, mensagem: s.titulo });
    notificar({ titulo: 'Sua solicitação foi confirmada', destinatarioId: s.solicitanteId, clienteId: s.clienteId, solicitacaoId: id, mensagem: s.titulo });
    if (tarefa?.responsavelId) notificar({ titulo: 'Peça aprovada pelo CEO', destinatarioId: tarefa.responsavelId, solicitacaoId: id, mensagem: s.titulo });
    return enriquecer(await getSolic(id));
  });

  // -------- DEVOLVER --------
  app.post('/:id/devolver', { preHandler: app.authorize('ceo') }, async (req) => {
    const { id } = req.params as { id: string };
    const motivo = z.object({ motivo: z.string().min(3) }).parse(req.body).motivo;
    const s = await getSolic(id);
    await transicionar(s, 'em_producao', req.authUser.id, 'devolvida para ajustes', motivo);
    const tarefa = await get<{ responsavelId: string | null }>(`SELECT responsavelId FROM Tarefa WHERE solicitacaoId = ?`, [id]);
    if (tarefa?.responsavelId) notificar({ titulo: 'Ajustes solicitados pelo CEO', destinatarioId: tarefa.responsavelId, solicitacaoId: id, mensagem: motivo });
    return enriquecer(await getSolic(id));
  });

  // -------- POSTAR (CEO ou social) --------
  app.post('/:id/postar', { preHandler: app.authorize('ceo', 'social') }, async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSolic(id);
    if (s.status === 'confirmada' || s.status === 'agendada') await transicionar(s, 'postada', req.authUser.id, 'postada');
    else throw badRequest('A peça precisa estar confirmada pelo CEO antes de postar.');
    notificar({ titulo: 'Postado! 🎉', destinatarioId: s.solicitanteId, clienteId: s.clienteId, solicitacaoId: id, mensagem: s.titulo });
    return enriquecer(await getSolic(id));
  });

  // -------- LEMBRETE WHATSAPP (CEO ou social) --------
  app.post('/:id/lembrete-whatsapp', { preHandler: app.authorize('ceo', 'social') }, async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSolic(id);
    assertPodeVer(req.authUser, s);
    const clienteRow = await get<{ nome: string }>(`SELECT nome FROM Cliente WHERE id = ?`, [s.clienteId]);
    const dataStr = s.dataEvento
      ? new Date(s.dataEvento).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'Data a confirmar';
    const horaStr = s.horaEvento ? ` às ${s.horaEvento}` : '';
    const localStr = s.localGravacao ? `\n📍 Local: ${s.localGravacao}` : '';
    const msg =
      `🎬 *Lembrete EYE Agência*\n\n` +
      `Gravação agendada:\n*${s.titulo}*\n` +
      `👥 Cliente: ${clienteRow?.nome ?? s.clienteId}\n` +
      `📅 ${dataStr}${horaStr}${localStr}`;
    const enviado = await enviarWhatsAppCeo(msg);
    return { enviado };
  });

  // -------- ANEXOS --------
  app.post('/:id/anexos', async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSolic(id);
    assertPodeVer(req.authUser, s);
    const parts = req.parts();
    const salvos: unknown[] = [];
    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        const stored = await saveFile(part.filename, part.mimetype, buffer);
        const anexoId = createId('a');
        await run(
          `INSERT INTO Anexo (id, solicitacaoId, categoria, nomeArquivo, url, mime, tamanho, createdAt) VALUES (?,?,?,?,?,?,?,?)`,
          [anexoId, id, 'referencia', stored.nomeArquivo, stored.url, stored.mime, stored.tamanho, nowISO()]
        );
        salvos.push({ id: anexoId, ...stored });
      }
    }
    if (!salvos.length) throw badRequest('Nenhum arquivo enviado.');
    return { anexos: salvos };
  });
}
