import type { FastifyInstance } from 'fastify';
import { all, get } from '../db/database.ts';
import { listarNotificacoes, marcarLida } from '../services/notificacoes.ts';

export async function miscRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // ---- Clientes ----
  app.get('/clientes', async (req) => {
    const u = req.authUser;
    if (u.role === 'ceo' || ['social', 'designer_governo', 'videomaker'].includes(u.role)) {
      return all(`SELECT * FROM Cliente ORDER BY nome`);
    }
    return all(`SELECT * FROM Cliente WHERE id = ?`, [u.clienteId]);
  });

  app.get('/clientes/:id/unidades', async (req) => {
    const { id } = req.params as { id: string };
    return all(`SELECT * FROM Unidade WHERE clienteId = ? ORDER BY nome`, [id]);
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
