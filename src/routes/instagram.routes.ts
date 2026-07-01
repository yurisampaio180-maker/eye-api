import type { FastifyInstance } from 'fastify';
import { all } from '../db/database.ts';
import { env } from '../env.ts';
import { badRequest } from '../lib/errors.ts';
import {
  instagramConfigured,
  gerarUrlOAuth,
  trocarCodePorToken,
  sincronizarMetricas,
  buscarStatus,
} from '../services/instagram.ts';

export async function instagramRoutes(app: FastifyInstance) {
  // CEO obtém a URL OAuth via AJAX → frontend faz window.location.href = url
  app.get('/url/:clienteId', {
    preHandler: [app.authenticate, app.authorize('ceo')],
  }, async (req) => {
    if (!instagramConfigured) {
      throw badRequest('META_APP_ID/META_APP_SECRET/INSTAGRAM_REDIRECT_URI não configurados no Render.');
    }
    const { clienteId } = req.params as { clienteId: string };
    return { url: gerarUrlOAuth(clienteId) };
  });

  // Callback OAuth — Meta redireciona aqui (sem JWT, autenticação via state/code)
  app.get('/callback', async (req, reply) => {
    const { code, state: clienteId, error } = req.query as Record<string, string>;
    const front = env.FRONTEND_URL;

    if (error || !code || !clienteId) {
      return reply.redirect(`${front}/clientes/${clienteId ?? ''}?instagram=erro`);
    }
    try {
      await trocarCodePorToken(code, clienteId);
      return reply.redirect(`${front}/clientes/${clienteId}?instagram=conectado`);
    } catch (err: any) {
      app.log.error(err, 'instagram:callback erro');
      return reply.redirect(
        `${front}/clientes/${clienteId}?instagram=erro&msg=${encodeURIComponent(err.message)}`
      );
    }
  });

  // Métricas de um cliente
  app.get('/metricas/:clienteId', {
    preHandler: [app.authenticate, app.authorize('ceo', 'social')],
  }, async (req) => {
    const { clienteId } = req.params as { clienteId: string };
    return buscarStatus(clienteId);
  });

  // Métricas de todos os clientes (dashboard CEO)
  app.get('/metricas', {
    preHandler: [app.authenticate, app.authorize('ceo', 'social')],
  }, async () => {
    const clientes = await all<{ id: string }>('SELECT id FROM Cliente');
    const resultado = await Promise.all(
      clientes.map(async (c) => ({ clienteId: c.id, ...(await buscarStatus(c.id)) }))
    );
    return resultado;
  });

  // Sincronização manual (CEO)
  app.post('/sincronizar/:clienteId', {
    preHandler: [app.authenticate, app.authorize('ceo')],
  }, async (req) => {
    if (!instagramConfigured) throw badRequest('Instagram não configurado no servidor.');
    const { clienteId } = req.params as { clienteId: string };
    await sincronizarMetricas(clienteId);
    return buscarStatus(clienteId);
  });
}
