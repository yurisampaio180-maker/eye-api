// Smoke test no SQLite local (usa o banco já seedado por `npm run db:seed`).
import { buildApp } from '../src/app.ts';
import { runSmoke } from './smokeFlow.ts';

const app = await buildApp();
const { fail } = await runSmoke(app);
await app.close();
process.exit(fail ? 1 : 0);
