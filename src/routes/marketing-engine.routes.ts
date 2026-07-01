import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/errors.ts';
import {
  iniciarGeracao,
  executarGeracaoCompleta,
  buscarGeracao,
  listarGeracoes,
  listarGeracoesAtivas,
} from '../services/marketing-engine.service.ts';

export async function marketingEngineRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // POST /gerar/:clienteId — inicia geração em background
  app.post(
    '/gerar/:clienteId',
    {
      preHandler: app.authorize('ceo'),
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const { clienteId } = req.params as { clienteId: string };
      const { mes } = req.query as { mes?: string };

      const geracaoId = await iniciarGeracao(clienteId, mes);

      setImmediate(() => {
        executarGeracaoCompleta(clienteId, geracaoId).catch((e: any) =>
          app.log.error(e, `[motor] erro geração ${geracaoId}`),
        );
      });

      return reply.code(202).send({ geracaoId, mensagem: 'Geração iniciada em background.' });
    },
  );

  // GET /status/:geracaoId — poll do progresso
  app.get(
    '/status/:geracaoId',
    { preHandler: app.authorize('ceo', 'social') },
    async (req) => {
      const { geracaoId } = req.params as { geracaoId: string };
      const geracao = await buscarGeracao(geracaoId);
      if (!geracao) throw notFound('Geração não encontrada');
      return geracao;
    },
  );

  // GET /historico/:clienteId — últimas 10 gerações do cliente
  app.get(
    '/historico/:clienteId',
    { preHandler: app.authorize('ceo', 'social') },
    async (req) => {
      const { clienteId } = req.params as { clienteId: string };
      return listarGeracoes(clienteId);
    },
  );

  // GET /ativas — gerações em andamento (CEO dashboard)
  app.get(
    '/ativas',
    { preHandler: app.authorize('ceo') },
    async () => listarGeracoesAtivas(),
  );
}
