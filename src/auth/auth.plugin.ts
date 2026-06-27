import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import { env } from '../env.ts';
import { unauthorized, forbidden } from '../lib/errors.ts';

export type Role = 'ceo' | 'cliente' | 'social' | 'designer_governo' | 'videomaker';

export interface AuthUser {
  id: string;
  role: Role;
  nome: string;
  clienteId: string | null;
  unidadeId: string | null;
  gestorCliente: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (
      ...roles: Role[]
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    signTokens: (user: AuthUser) => { accessToken: string; refreshToken: string };
    verifyRefresh: (token: string) => { sub: string; typ: string };
  }
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_TTL },
  });

  app.decorate('signTokens', (user: AuthUser) => {
    const payload = {
      sub: user.id,
      role: user.role,
      nome: user.nome,
      clienteId: user.clienteId,
      unidadeId: user.unidadeId,
      gestorCliente: user.gestorCliente,
    };
    const accessToken = app.jwt.sign(payload);
    const refreshToken = app.jwt.sign(
      { sub: user.id, typ: 'refresh' },
      { expiresIn: env.JWT_REFRESH_TTL }
    );
    return { accessToken, refreshToken };
  });

  app.decorate('verifyRefresh', (token: string) => {
    const decoded = app.jwt.verify<{ sub: string; typ?: string }>(token);
    if (decoded.typ !== 'refresh') throw unauthorized('Token de refresh inválido.');
    return { sub: decoded.sub, typ: 'refresh' };
  });

  // preHandler: exige autenticação válida e popula req.authUser
  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      const decoded = await req.jwtVerify<{
        sub: string;
        role: Role;
        nome: string;
        clienteId: string | null;
        unidadeId: string | null;
        gestorCliente: boolean;
      }>();
      req.authUser = {
        id: decoded.sub,
        role: decoded.role,
        nome: decoded.nome,
        clienteId: decoded.clienteId ?? null,
        unidadeId: decoded.unidadeId ?? null,
        gestorCliente: Boolean(decoded.gestorCliente),
      };
    } catch {
      throw unauthorized('Token ausente ou inválido.');
    }
  });

  // preHandler factory: exige um dos papéis
  app.decorate('authorize', (...roles: Role[]) => {
    return async (req: FastifyRequest) => {
      if (!req.authUser) throw unauthorized();
      if (roles.length && !roles.includes(req.authUser.role)) {
        throw forbidden('Seu papel não tem acesso a este recurso.');
      }
    };
  });
}
