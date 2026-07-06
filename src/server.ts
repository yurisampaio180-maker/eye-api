import { buildApp } from './app.ts';
import { env } from './env.ts';
import { get, driver } from './db/database.ts';
import { seedDatabase } from './db/seed.ts';
import { sincronizarTodos, instagramConfigured } from './services/instagram.ts';
import { executarTodosOsClientes } from './services/marketing-engine.service.ts';
import { iniciarCronDisparo } from './jobs/disparo-postagem.ts';

const app = await buildApp({ logger: true });

// Auto-seed só fora de produção (em produção os usuários reais vêm do db:seed-prod;
// nunca criar usuários de demo em produção).
if (process.env.NODE_ENV !== 'production') {
  try {
    const row = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM "User"`);
    if (Number(row?.n ?? 0) === 0) {
      app.log.info('Banco vazio (dev) — rodando seed de demonstração...');
      await seedDatabase(false);
    }
  } catch (e) {
    app.log.error(e, 'Falha no auto-seed (seguindo mesmo assim)');
  }
}

// Em produção (Render/Railway/Docker) é obrigatório escutar em 0.0.0.0.
const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

app
  .listen({ port: env.PORT, host })
  .then(() => {
    console.log(`🚀 EYE API (${driver}) em http://${host}:${env.PORT}  (CORS: ${env.CORS_ORIGIN})`);

    // Sincronização Instagram a cada 6 horas (apenas se configurado)
    if (instagramConfigured) {
      const SEIS_HORAS = 6 * 60 * 60 * 1000;
      setInterval(() => {
        sincronizarTodos().catch((e) => app.log.error(e, 'instagram:sync-cron erro'));
      }, SEIS_HORAS);
    }

    // Disparo WhatsApp no horário da postagem (a cada 5 min)
    iniciarCronDisparo();

    // Motor de marketing: verifica a cada hora se é dia 25, 09h (Fortaleza) → gera plano do mês seguinte
    // Usa TZ explícito para blindar contra servidor sem TZ=America/Fortaleza configurado
    setInterval(() => {
      const agoraBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
      if (agoraBRT.getDate() === 25 && agoraBRT.getHours() === 9 && agoraBRT.getMinutes() < 60) {
        app.log.info('[motor:cron] dia 25 às 09h BRT — iniciando geração mensal para todos os clientes');
        executarTodosOsClientes().catch((e: any) => app.log.error(e, '[motor:cron] erro'));
      }
    }, 60 * 60 * 1000);
  })
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
