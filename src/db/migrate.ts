import { applySchema, closeDb } from './database.ts';

await applySchema();
console.log('✅ Schema aplicado ao banco.');
await closeDb();
