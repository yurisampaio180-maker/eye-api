import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, run, nowISO } from '../db/database.ts';
import { createId } from '../lib/id.ts';
import { hashPassword } from '../auth/password.ts';
import { badRequest, conflict } from '../lib/errors.ts';

const ROLES = ['ceo', 'social', 'designer_governo', 'videomaker', 'cliente'] as const;

export async function usersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // LISTAR usuários (só CEO)
  app.get('/', { preHandler: app.authorize('ceo') }, async () => {
    return all(
      `SELECT u.id, u.nome, u.email, u.role, u.clienteId, u.unidadeId, u.gestorCliente, u.ativo, u.mustChangePassword,
              c.nome AS clienteNome, un.nome AS unidadeNome
       FROM "User" u
       LEFT JOIN Cliente c ON c.id = u.clienteId
       LEFT JOIN Unidade un ON un.id = u.unidadeId
       ORDER BY u.role, u.nome`
    );
  });

  // CRIAR usuário — somente CEO cria (inclusive usuários de secretaria)
  const createBody = z.object({
    nome: z.string().min(2),
    email: z.string().email(),
    role: z.enum(ROLES),
    senhaProvisoria: z.string().min(6, 'Senha provisória de no mínimo 6 caracteres.'),
    clienteId: z.string().optional(),
    unidadeId: z.string().optional(),
    gestorCliente: z.boolean().default(false),
  });

  app.post('/', { preHandler: app.authorize('ceo') }, async (req, reply) => {
    const body = createBody.parse(req.body);
    const existe = await get(`SELECT id FROM "User" WHERE email = ?`, [body.email.toLowerCase()]);
    if (existe) throw conflict('Já existe um usuário com este e-mail.');
    if (body.role === 'cliente' && !body.clienteId) throw badRequest('Usuário solicitante precisa de um cliente.');

    const id = createId('u');
    const senhaHash = await hashPassword(body.senhaProvisoria);
    const now = nowISO();
    await run(
      `INSERT INTO "User" (id, nome, email, senhaHash, role, clienteId, unidadeId, gestorCliente, avatarColor, ativo, mustChangePassword, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,1,1,?,?)`,
      [
        id, body.nome, body.email.toLowerCase(), senhaHash, body.role,
        body.clienteId ?? null, body.unidadeId ?? null, body.gestorCliente ? 1 : 0, '#047857', now, now,
      ]
    );
    reply.code(201);
    return { id, nome: body.nome, email: body.email.toLowerCase(), role: body.role, mustChangePassword: true };
  });

  // ATIVAR/DESATIVAR (só CEO)
  app.patch('/:id', { preHandler: app.authorize('ceo') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ ativo: z.boolean() }).parse(req.body);
    await run(`UPDATE "User" SET ativo = ?, updatedAt = ? WHERE id = ?`, [body.ativo ? 1 : 0, nowISO(), id]);
    return { ok: true };
  });
}
