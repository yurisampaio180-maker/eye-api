import { buildApp } from './app.ts';
import { env } from './env.ts';
import { get, driver } from './db/database.ts';
import { seedDatabase } from './db/seed.ts';

const app = await buildApp({ logger: true });

// Auto-seed na primeira subida (banco vazio) — cria clientes, secretarias e equipe.
try {
  const row = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM "User"`);
  if (Number(row?.n ?? 0) === 0) {
    app.log.info('Banco vazio — rodando seed inicial...');
    await seedDatabase(false);
    app.log.info('Seed inicial concluído.');
  }
} catch (e) {
  app.log.error(e, 'Falha no auto-seed (seguindo mesmo assim)');
}

// Em produção (Render/Railway/Docker) é obrigatório escutar em 0.0.0.0.
const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

app
  .listen({ port: env.PORT, host })
  .then(() => {
    console.log(`🚀 EYE API (${driver}) em http://${host}:${env.PORT}  (CORS: ${env.CORS_ORIGIN})`);
  })
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
