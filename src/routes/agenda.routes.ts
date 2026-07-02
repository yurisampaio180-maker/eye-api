import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, run, nowISO } from '../db/database.ts';
import { createId } from '../lib/id.ts';
import { notFound, badRequest } from '../lib/errors.ts';
import { notificar } from '../services/notificacoes.ts';

interface EventoRow {
  id: string;
  clienteId: string;
  solicitacaoId: string | null;
  titulo: string;
  dataHora: string;
  plataforma: string | null;
  tipo: string;
  status: string;
  legenda: string;
  imagemUrl: string | null;
  hashtags: string;
  criadoPorId: string | null;
  postarPorId: string | null;
  responsavelId: string | null;
  localEvento: string | null;
  geradoPorIA: number;
  roteiro: string | null;
  justificativa: string | null;
  formato: string | null;
  objetivo: string | null;
}

async function enriquecer(e: EventoRow) {
  const [cliente, criador, postador, responsavel] = await Promise.all([
    get<{ nome: string }>(`SELECT nome FROM Cliente WHERE id = ?`, [e.clienteId]),
    e.criadoPorId ? get<{ nome: string }>(`SELECT nome FROM "User" WHERE id = ?`, [e.criadoPorId]) : null,
    e.postarPorId ? get<{ nome: string }>(`SELECT nome FROM "User" WHERE id = ?`, [e.postarPorId]) : null,
    e.responsavelId ? get<{ nome: string }>(`SELECT nome FROM "User" WHERE id = ?`, [e.responsavelId]) : null,
  ]);
  const atrasado = e.status !== 'postado' && new Date(e.dataHora) < new Date() && e.status !== 'rascunho';
  return {
    ...e,
    clienteNome: cliente?.nome ?? null,
    criadoPorNome: criador?.nome ?? null,
    postarPorNome: postador?.nome ?? null,
    responsavelNome: responsavel?.nome ?? null,
    atrasado,
  };
}

const byId = (id: string) => get<EventoRow>(`SELECT * FROM EventoAgenda WHERE id = ?`, [id]);

export async function agendaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const user = req.authUser;
    const { clienteId } = z.object({ clienteId: z.string().optional() }).parse(req.query);
    let rows: EventoRow[];
    if (user.role === 'ceo' || user.role === 'social') {
      rows = await all<EventoRow>(`SELECT * FROM EventoAgenda ${clienteId ? 'WHERE clienteId = ?' : ''} ORDER BY dataHora`, clienteId ? [clienteId] : []);
    } else if (user.role === 'videomaker') {
      // videomaker só vê filmagens (tipo=evento) atribuídas a ele
      rows = await all<EventoRow>(
        `SELECT * FROM EventoAgenda WHERE tipo = 'evento' AND responsavelId = ? ORDER BY dataHora`,
        [user.id]
      );
    } else if (user.role === 'designer_governo') {
      rows = await all<EventoRow>(`SELECT * FROM EventoAgenda WHERE clienteId = 'governo-moraujo' ORDER BY dataHora`);
    } else {
      rows = await all<EventoRow>(`SELECT * FROM EventoAgenda WHERE clienteId = ? ORDER BY dataHora`, [user.clienteId]);
    }
    return Promise.all(rows.map(enriquecer));
  });

  const createBody = z.object({
    clienteId: z.string(),
    titulo: z.string().min(1),
    dataHora: z.string().datetime({ message: 'Informe data e HORA da postagem.' }),
    plataforma: z.string().optional(),
    legenda: z.string().default(''),
    imagemUrl: z.string().optional(),
    hashtags: z.string().default(''),
  });
  app.post('/', { preHandler: app.authorize('ceo', 'social', 'videomaker', 'designer_governo') }, async (req, reply) => {
    const body = createBody.parse(req.body);
    if (req.authUser.role === 'designer_governo' && body.clienteId !== 'governo-moraujo') throw badRequest('Designer do Governo só publica para o Governo Municipal.');
    const id = createId('ev');
    await run(
      `INSERT INTO EventoAgenda (id, clienteId, solicitacaoId, titulo, dataHora, plataforma, tipo, status, legenda, imagemUrl, hashtags, criadoPorId, postarPorId, createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, body.clienteId, null, body.titulo, body.dataHora, body.plataforma ?? 'instagram', 'post', 'aguardando_confirmacao', body.legenda, body.imagemUrl ?? null, body.hashtags, req.authUser.id, null, nowISO()]
    );
    notificar({ titulo: 'Novo post aguardando sua confirmação', destinatarioId: 'ceo', clienteId: body.clienteId, mensagem: body.titulo });
    reply.code(201);
    return enriquecer((await byId(id))!);
  });

  const patchBody = z.object({
    titulo: z.string().optional(),
    dataHora: z.string().datetime().optional(),
    plataforma: z.string().optional(),
    legenda: z.string().optional(),
    hashtags: z.string().optional(),
  });
  app.patch('/:id', { preHandler: app.authorize('ceo', 'social', 'videomaker', 'designer_governo') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = patchBody.parse(req.body ?? {});
    const ev = await byId(id);
    if (!ev) throw notFound('Post não encontrado.');
    const campos: string[] = [];
    const valores: unknown[] = [];
    for (const [k, v] of Object.entries(body)) { campos.push(`${k} = ?`); valores.push(v); }
    if (campos.length) { valores.push(id); await run(`UPDATE EventoAgenda SET ${campos.join(', ')} WHERE id = ?`, valores); }
    return enriquecer((await byId(id))!);
  });

  app.post('/:id/confirmar', { preHandler: app.authorize('ceo') }, async (req) => {
    const { id } = req.params as { id: string };
    const ev = await byId(id);
    if (!ev) throw notFound('Post não encontrado.');
    if (ev.status !== 'aguardando_confirmacao') throw badRequest('Este post não está aguardando confirmação.');
    await run(`UPDATE EventoAgenda SET status = 'confirmado' WHERE id = ?`, [id]);
    notificar({ titulo: 'Post confirmado — pode postar ✅', destinatarioId: 'eduarda', clienteId: ev.clienteId, mensagem: ev.titulo });
    if (ev.criadoPorId) notificar({ titulo: 'Seu post foi confirmado pelo CEO', destinatarioId: ev.criadoPorId, mensagem: ev.titulo });
    return enriquecer((await byId(id))!);
  });

  app.post('/:id/devolver', { preHandler: app.authorize('ceo') }, async (req) => {
    const { id } = req.params as { id: string };
    const motivo = z.object({ motivo: z.string().min(3) }).parse(req.body).motivo;
    const ev = await byId(id);
    if (!ev) throw notFound('Post não encontrado.');
    await run(`UPDATE EventoAgenda SET status = 'rascunho' WHERE id = ?`, [id]);
    if (ev.criadoPorId) notificar({ titulo: 'Ajuste solicitado no post', destinatarioId: ev.criadoPorId, mensagem: motivo });
    return enriquecer((await byId(id))!);
  });

  app.post('/:id/postar', { preHandler: app.authorize('ceo', 'social') }, async (req) => {
    const { id } = req.params as { id: string };
    const ev = await byId(id);
    if (!ev) throw notFound('Post não encontrado.');
    if (ev.status !== 'confirmado') throw badRequest('O post precisa ser confirmado pelo CEO antes de postar.');
    await run(`UPDATE EventoAgenda SET status = 'postado', postarPorId = ? WHERE id = ?`, [req.authUser.id, id]);
    notificar({ titulo: 'Post publicado! 🎉', destinatarioId: 'ceo', clienteId: ev.clienteId, mensagem: ev.titulo });
    return enriquecer((await byId(id))!);
  });

  app.get('/pendentes', { preHandler: app.authorize('ceo', 'social') }, async (req) => {
    const { clienteId } = z.object({ clienteId: z.string().optional() }).parse(req.query);
    const rows = await all<EventoRow>(
      `SELECT * FROM EventoAgenda WHERE status = 'aguardando_confirmacao'${clienteId ? ' AND clienteId = ?' : ''} ORDER BY dataHora`,
      clienteId ? [clienteId] : []
    );
    return Promise.all(rows.map(enriquecer));
  });

  app.delete('/:id', { preHandler: app.authorize('ceo') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ev = await byId(id);
    if (!ev) throw notFound('Post não encontrado.');
    await run(`DELETE FROM EventoAgenda WHERE id = ?`, [id]);
    return reply.code(204).send();
  });
}
