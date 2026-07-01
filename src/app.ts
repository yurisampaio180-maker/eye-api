import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { env } from './env.ts';
import { applySchema } from './db/database.ts';
import { AppError } from './lib/errors.ts';
import { registerAuth } from './auth/auth.plugin.ts';
import { authRoutes } from './routes/auth.routes.ts';
import { solicitacoesRoutes } from './routes/solicitacoes.routes.ts';
import { tarefasRoutes } from './routes/tarefas.routes.ts';
import { miscRoutes } from './routes/misc.routes.ts';
import { usersRoutes } from './routes/users.routes.ts';
import { agendaRoutes } from './routes/agenda.routes.ts';
import { iaRoutes } from './routes/ia.routes.ts';

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  await applySchema();
  mkdirSync(env.UPLOAD_DIR, { recursive: true });

  const app = Fastify({ logger: opts.logger ? { level: 'info' } : false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'VALIDATION', message: 'Dados inválidos.', details: err.flatten() } });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    app.log.error(err);
    return reply.code((err as any).statusCode ?? 500).send({ error: { code: 'INTERNAL', message: err.message || 'Erro interno.' } });
  });

  await app.register(cors, { origin: env.CORS_ORIGIN.split(','), credentials: true });
  await app.register(rateLimit, { global: false, max: 200, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(fastifyStatic, { root: join(process.cwd(), env.UPLOAD_DIR), prefix: '/uploads/' });
  await registerAuth(app);

  app.get('/health', async () => ({ ok: true, service: 'eye-api', ts: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(solicitacoesRoutes, { prefix: '/api/v1/solicitacoes' });
  await app.register(tarefasRoutes, { prefix: '/api/v1/tarefas' });
  await app.register(usersRoutes, { prefix: '/api/v1/users' });
  await app.register(agendaRoutes, { prefix: '/api/v1/agenda' });
  await app.register(iaRoutes, { prefix: '/api/v1/ia' });
  await app.register(miscRoutes, { prefix: '/api/v1' });

  return app;
}
