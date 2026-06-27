import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { env } from '../env.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Camada de banco ASSÍNCRONA e dual:
 *  - DATABASE_URL "file:..."        → SQLite embutido (node:sqlite) [dev/local/testes]
 *  - DATABASE_URL "postgres(ql)://" → Postgres (Supabase) via `pg`     [produção]
 *
 * As rotas usam `await all/get/run` com placeholders `?`. Para Postgres a camada
 * traduz `?` → `$n` e remapeia os nomes de coluna (o Postgres rebaixa
 * identificadores não citados para minúsculo).
 */

type Driver = 'sqlite' | 'pg';
const url = env.DATABASE_URL;
export const driver: Driver = /^postgres(ql)?:\/\//i.test(url) ? 'pg' : 'sqlite';

type Params = Record<string, unknown> | unknown[];

// ---------- coerção comum ----------
function coerce(v: unknown): unknown {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v === undefined) return null;
  return v;
}
function values(params: Params): unknown[] {
  return (Array.isArray(params) ? params : Object.values(params)).map(coerce);
}

export const nowISO = () => new Date().toISOString();

// =====================================================================
// SQLite
// =====================================================================
let DatabaseSyncCtor: any = null;
if (driver === 'sqlite') {
  ({ DatabaseSync: DatabaseSyncCtor } = await import('node:sqlite'));
}
let sqliteDb: any = null;
function sqlite() {
  if (!sqliteDb) {
    const path = url.startsWith('file:') ? join(process.cwd(), url.slice(5)) : join(process.cwd(), 'dev.db');
    sqliteDb = new DatabaseSyncCtor(path);
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
  }
  return sqliteDb;
}

// =====================================================================
// Postgres — nomes de coluna que precisam voltar para camelCase
// =====================================================================
const CAMEL = [
  'corPrimaria', 'createdAt', 'updatedAt', 'clienteId', 'tomDeVoz', 'paletaJson', 'tipografiaJson',
  'referenciasJson', 'frameworksJson', 'proibicoesJson', 'senhaHash', 'unidadeId', 'gestorCliente',
  'avatarColor', 'mustChangePassword', 'solicitanteId', 'prazoDesejado', 'textosDesejados', 'tipoVideo',
  'localGravacao', 'dataEvento', 'precisaEquipeNoLocal', 'roteiroNecessario', 'horaEvento', 'tipoCobertura',
  'coberturaReels', 'coberturaFotos', 'coberturaStories', 'tipoReels', 'motivoReprovacao', 'solicitacaoId',
  'nomeArquivo', 'responsavelId', 'prazoProducao', 'statusProducao', 'entregaUrl', 'promptSugerido',
  'legendaSugerida', 'dataHora', 'imagemUrl', 'criadoPorId', 'postarPorId', 'metricsJson', 'destinatarioId',
  'autorId', 'autorNome', 'clienteNome', 'unidadeNome', 'solicitanteNome', 'responsavelNome', 'responsavelCor',
  'criadoPorNome', 'postarPorNome',
];
const LC2CAMEL: Record<string, string> = Object.fromEntries(CAMEL.map((c) => [c.toLowerCase(), c]));

function remap<T>(row: any): T {
  if (!row) return row;
  const out: any = {};
  for (const k of Object.keys(row)) out[LC2CAMEL[k] ?? k] = row[k];
  return out as T;
}

/** `?` → `$1, $2, ...` (nosso SQL não tem `?` em literais). */
function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

let pgPool: any = null;
/** injeção para testes (pg-mem). */
export function _setPgPool(pool: any) { pgPool = pool; }
async function pg() {
  if (!pgPool) {
    const { Pool } = await import('pg');
    pgPool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pgPool;
}

// =====================================================================
// API pública (assíncrona)
// =====================================================================
export async function all<T = any>(sql: string, params: Params = []): Promise<T[]> {
  if (driver === 'pg') {
    const pool = await pg();
    const res = await pool.query(toPgPlaceholders(sql), values(params));
    return res.rows.map((r: any) => remap<T>(r));
  }
  return sqlite().prepare(sql).all(...values(params)) as T[];
}

export async function get<T = any>(sql: string, params: Params = []): Promise<T | undefined> {
  if (driver === 'pg') {
    const pool = await pg();
    const res = await pool.query(toPgPlaceholders(sql), values(params));
    return res.rows[0] ? remap<T>(res.rows[0]) : undefined;
  }
  return sqlite().prepare(sql).get(...values(params)) as T | undefined;
}

export async function run(sql: string, params: Params = []): Promise<void> {
  if (driver === 'pg') {
    const pool = await pg();
    await pool.query(toPgPlaceholders(sql), values(params));
    return;
  }
  sqlite().prepare(sql).run(...values(params));
}

/** executa DDL / múltiplos statements (sem parâmetros). */
export async function exec(sql: string): Promise<void> {
  if (driver === 'pg') {
    const pool = await pg();
    for (const stmt of splitStatements(sql)) {
      try {
        await pool.query(stmt);
      } catch (e: any) {
        const msg = String(e?.message);
        // ignora "já existe" (idempotência) e falhas de índice (otimização, não crítico)
        if (/already exists|exist/i.test(msg) || /^\s*CREATE\s+INDEX/i.test(stmt)) continue;
        throw e;
      }
    }
    return;
  }
  sqlite().exec(sql);
}

function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !/^\s*PRAGMA/i.test(l)) // PRAGMA é só do SQLite
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** aplica o schema (idempotente nos dois bancos). */
export async function applySchema(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await exec(sql);
}

export async function closeDb(): Promise<void> {
  if (driver === 'pg' && pgPool) await pgPool.end();
  else if (sqliteDb) sqliteDb.close?.();
}
