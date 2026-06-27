import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { get, run, nowISO } from '../db/database.ts';
import { verifyPassword, hashPassword } from '../auth/password.ts';
import { unauthorized, badRequest } from '../lib/errors.ts';
import type { AuthUser, Role } from '../auth/auth.plugin.ts';

interface UserRow {
  id: string;
  nome: string;
  email: string;
  senhaHash: string;
  role: string;
  clienteId: string | null;
  unidadeId: string | null;
  gestorCliente: number;
  ativo: number;
  mustChangePassword: number;
}

const toAuthUser = (u: UserRow): AuthUser => ({
  id: u.id,
  role: u.role as Role,
  nome: u.nome,
  clienteId: u.clienteId,
  unidadeId: u.unidadeId,
  gestorCliente: Boolean(u.gestorCliente),
});

export async function authRoutes(app: FastifyInstance) {
  const loginBody = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { email, password } = loginBody.parse(req.body);
    const userRow = await get<UserRow>(`SELECT * FROM "User" WHERE email = ?`, [email.toLowerCase()]);
    if (!userRow || !userRow.ativo) throw unauthorized('Credenciais inválidas.');
    const ok = await verifyPassword(password, userRow.senhaHash);
    if (!ok) throw unauthorized('Credenciais inválidas.');

    const authUser = toAuthUser(userRow);
    const tokens = app.signTokens(authUser);
    return { ...tokens, user: { ...authUser, email: userRow.email, mustChangePassword: Boolean(userRow.mustChangePassword) } };
  });

  app.post('/refresh', async (req) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    const { sub } = app.verifyRefresh(refreshToken);
    const userRow = await get<UserRow>(`SELECT * FROM "User" WHERE id = ?`, [sub]);
    if (!userRow || !userRow.ativo) throw unauthorized('Usuário inválido.');
    const tokens = app.signTokens(toAuthUser(userRow));
    return tokens;
  });

  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    const userRow = await get<UserRow>(`SELECT * FROM "User" WHERE id = ?`, [req.authUser.id]);
    if (!userRow) throw unauthorized();
    return { user: { ...toAuthUser(userRow), email: userRow.email, mustChangePassword: Boolean(userRow.mustChangePassword) } };
  });

  // Troca de senha (1º acesso ou voluntária)
  app.post('/change-password', { preHandler: app.authenticate }, async (req) => {
    const { senhaAtual, novaSenha } = z
      .object({ senhaAtual: z.string().min(1), novaSenha: z.string().min(6, 'Mínimo 6 caracteres.') })
      .parse(req.body);
    const userRow = await get<UserRow>(`SELECT * FROM "User" WHERE id = ?`, [req.authUser.id]);
    if (!userRow) throw unauthorized();
    const ok = await verifyPassword(senhaAtual, userRow.senhaHash);
    if (!ok) throw badRequest('Senha atual incorreta.');
    const hash = await hashPassword(novaSenha);
    await run(`UPDATE "User" SET senhaHash = ?, mustChangePassword = 0, updatedAt = ? WHERE id = ?`, [hash, nowISO(), req.authUser.id]);
    return { ok: true };
  });
}
