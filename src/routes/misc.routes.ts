import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, run, nowISO } from '../db/database.ts';
import { createId } from '../lib/id.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { listarNotificacoes, marcarLida } from '../services/notificacoes.ts';

export async function miscRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // ---- Clientes ----
  const SELECT_CLIENTE = `SELECT c.*, EXISTS(SELECT 1 FROM ClienteAsset a WHERE a.clienteId = c.id AND a.tipo = 'logo') AS temLogo FROM Cliente c`;
  app.get('/clientes', async (req) => {
    const u = req.authUser;
    if (u.role === 'ceo' || ['social', 'designer_governo', 'videomaker'].includes(u.role)) {
      return all(`${SELECT_CLIENTE} ORDER BY c.nome`);
    }
    return all(`${SELECT_CLIENTE} WHERE c.id = ?`, [u.clienteId]);
  });

  app.get('/clientes/:id/unidades', async (req) => {
    const { id } = req.params as { id: string };
    return all(`SELECT * FROM Unidade WHERE clienteId = ? ORDER BY nome`, [id]);
  });

  // ---- Reset completo de cliente (SÓ CEO, confirmação pelo nome exato) ----
  // Apaga dados transacionais; MANTÉM Cliente, DNA, Unidades, usuários,
  // conexão Instagram e (salvo apagarAssets) o Banco de Imagens.
  app.post('/clientes/:id/reset', { preHandler: app.authorize('ceo') }, async (req) => {
    const { id } = req.params as { id: string };
    const { confirmacao, apagarAssets } = z
      .object({ confirmacao: z.string(), apagarAssets: z.boolean().default(false) })
      .parse(req.body ?? {});

    const cliente = await get<{ id: string; nome: string }>(`SELECT id, nome FROM Cliente WHERE id = ?`, [id]);
    if (!cliente) throw notFound('Cliente não encontrado.');
    if (confirmacao !== cliente.nome) {
      throw badRequest(`Confirmação incorreta. Digite exatamente: ${cliente.nome}`);
    }

    const contar = async (sql: string, params: unknown[] = [id]) =>
      Number((await get<{ n: number }>(sql, params))?.n ?? 0);

    // Contagens antes (Anexo/Tarefa/Historico/Transicao caem por CASCADE de Solicitacao)
    const removidos = {
      eventos:       await contar(`SELECT COUNT(*) AS n FROM EventoAgenda WHERE clienteId = ?`),
      solicitacoes:  await contar(`SELECT COUNT(*) AS n FROM Solicitacao WHERE clienteId = ?`),
      tarefas:       await contar(`SELECT COUNT(*) AS n FROM Tarefa WHERE solicitacaoId IN (SELECT id FROM Solicitacao WHERE clienteId = ?)`),
      campanhas:     await contar(`SELECT COUNT(*) AS n FROM Campanha WHERE clienteId = ?`),
      metricas:      await contar(`SELECT COUNT(*) AS n FROM InstagramMetrica WHERE clienteId = ?`),
      geracoes:      await contar(`SELECT COUNT(*) AS n FROM GeracaoMarketing WHERE clienteId = ?`),
      notificacoes:  await contar(`SELECT COUNT(*) AS n FROM Notificacao WHERE clienteId = ? OR solicitacaoId IN (SELECT id FROM Solicitacao WHERE clienteId = ?)`, [id, id]),
      assets:        apagarAssets ? await contar(`SELECT COUNT(*) AS n FROM ClienteAsset WHERE clienteId = ?`) : 0,
    };

    // Ordem respeita FKs sem cascade (Notificacao/EventoAgenda referenciam Solicitacao)
    await run(`DELETE FROM Notificacao WHERE clienteId = ? OR solicitacaoId IN (SELECT id FROM Solicitacao WHERE clienteId = ?)`, [id, id]);
    await run(`DELETE FROM EventoAgenda WHERE clienteId = ?`, [id]);
    await run(`DELETE FROM Solicitacao WHERE clienteId = ?`, [id]);
    await run(`DELETE FROM Campanha WHERE clienteId = ?`, [id]);
    await run(`DELETE FROM InstagramMetrica WHERE clienteId = ?`, [id]);
    await run(`DELETE FROM GeracaoMarketing WHERE clienteId = ?`, [id]);
    if (apagarAssets) await run(`DELETE FROM ClienteAsset WHERE clienteId = ?`, [id]);

    // Auditoria — reset é ação grave, sempre registrada
    const resumo = Object.entries(removidos).map(([k, v]) => `${v} ${k}`).join(', ');
    await run(
      `INSERT INTO HistoricoEvento (id, solicitacaoId, autorId, acao, detalhe, createdAt) VALUES (?,?,?,?,?,?)`,
      [createId('hist'), null, req.authUser.id, 'reset_cliente', `RESET COMPLETO do cliente ${cliente.nome}${apagarAssets ? ' (incluindo assets)' : ''}. Removidos: ${resumo}.`, nowISO()],
    );

    return { mensagem: `Cliente ${cliente.nome} resetado com sucesso.`, removidos };
  });

  // ---- Equipe (membros internos) ----
  app.get('/equipe', { preHandler: app.authorize('ceo', 'social', 'designer_governo', 'videomaker') }, async () => {
    return all(
      `SELECT id, nome, role, avatarColor, ativo FROM "User" WHERE role IN ('ceo','social','designer_governo','videomaker') ORDER BY nome`
    );
  });

  // ---- Campanhas ----
  app.get('/campanhas', { preHandler: app.authorize('ceo', 'social') }, async () => {
    return all(`SELECT * FROM Campanha ORDER BY nome`);
  });

  // ---- Notificações (próprias) ----
  app.get('/notificacoes', async (req) => listarNotificacoes(req.authUser.id));
  app.post('/notificacoes/:id/lida', async (req) => {
    const { id } = req.params as { id: string };
    await marcarLida(id);
    return { ok: true };
  });

  // ---- Stats do Dashboard (exclusivo do CEO) ----
  app.get('/stats', { preHandler: app.authorize('ceo') }, async () => {
    const num = (v: unknown) => Number(v ?? 0);
    const pend = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM Solicitacao WHERE status = 'em_aprovacao'`);
    const porClienteRaw = await all<{ cliente: string; total: unknown; pendentes: unknown }>(
      `SELECT c.nome AS cliente, COUNT(s.id) AS total,
              SUM(CASE WHEN s.status = 'em_aprovacao' THEN 1 ELSE 0 END) AS pendentes
       FROM Cliente c LEFT JOIN Solicitacao s ON s.clienteId = c.id
       GROUP BY c.id, c.nome ORDER BY total DESC`
    );
    const producaoRaw = await all<{ coluna: string; total: unknown }>(
      `SELECT statusProducao AS coluna, COUNT(*) AS total FROM Tarefa GROUP BY statusProducao`
    );
    const porStatusRaw = await all<{ status: string; total: unknown }>(`SELECT status, COUNT(*) AS total FROM Solicitacao GROUP BY status`);
    return {
      pendentesAprovacao: num(pend?.n),
      porCliente: porClienteRaw.map((c) => ({ cliente: c.cliente, total: num(c.total), pendentes: num(c.pendentes) })),
      producao: producaoRaw.map((p) => ({ coluna: p.coluna, total: num(p.total) })),
      porStatus: porStatusRaw.map((s) => ({ status: s.status, total: num(s.total) })),
    };
  });
}
