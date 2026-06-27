import { applySchema, exec, closeDb } from './database.ts';

/**
 * Reset transacional: apaga só as TABELAS DE TRANSAÇÃO, preservando as
 * estruturais (User, Cliente, Unidade, ClienteDNA) — inclusive senhas trocadas.
 *
 *   npm run db:reset-transacional
 */
await applySchema();

const transacionais = ['HistoricoEvento', 'Notificacao', 'EventoAgenda', 'Anexo', 'Tarefa', 'Solicitacao', 'Campanha'];
for (const t of transacionais) await exec(`DELETE FROM ${t};`);

console.log('🧹 Reset transacional concluído. Mantidos: usuários, clientes, unidades e DNAs.');
console.log('   Limpos:', transacionais.join(', '));
await closeDb();
