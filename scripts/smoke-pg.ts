// Smoke test no caminho POSTGRES, usando o emulador pg-mem (sem precisar de um
// Postgres real). Valida que o mesmo código funciona no Supabase.
import { newDb } from 'pg-mem';

// força o driver pg ANTES de importar a camada de banco
process.env.DATABASE_URL = 'postgresql://pg-mem/test';

const mem = newDb({ autoCreateForeignKeyIndices: true });
const pgAdapter = mem.adapters.createPg();
const pool = new pgAdapter.Pool();

const dbmod = await import('../src/db/database.ts');
console.log('driver =', dbmod.driver);
dbmod._setPgPool(pool);

const { seedDatabase } = await import('../src/db/seed.ts');
await seedDatabase(false);

const { buildApp } = await import('../src/app.ts');
const app = await buildApp();

const { runSmoke } = await import('./smokeFlow.ts');
const { fail } = await runSmoke(app);

await app.close();
process.exit(fail ? 1 : 0);
