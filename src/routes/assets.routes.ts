import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, run, get, nowISO } from '../db/database.ts';
import { createId } from '../lib/id.ts';
import { notFound, badRequest } from '../lib/errors.ts';
import { salvarAsset } from '../services/supabase-storage.ts';

const TIPOS_VALIDOS = ['logo', 'referencia'] as const;
const MIMES_VALIDOS = ['image/png', 'image/jpeg', 'image/webp'];

export async function assetsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // GET /clientes/:clienteId/assets
  app.get('/clientes/:clienteId/assets', { preHandler: app.authorize('ceo', 'social') }, async (req) => {
    const { clienteId } = req.params as { clienteId: string };
    return all(`SELECT * FROM ClienteAsset WHERE clienteId = ? ORDER BY tipo, createdAt`, [clienteId]);
  });

  // POST /clientes/:clienteId/assets  (multipart)
  app.post(
    '/clientes/:clienteId/assets',
    { preHandler: app.authorize('ceo', 'social'), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { clienteId } = req.params as { clienteId: string };

      let tipo: 'logo' | 'referencia' = 'referencia';
      let nome = '';
      let fileBuffer: Buffer | null = null;
      let fileMime = 'image/png';
      let fileOriginalName = '';

      const parts = req.parts({ limits: { fileSize: 10 * 1024 * 1024 } });
      for await (const part of parts) {
        if (part.type === 'field') {
          const v = part.value as string;
          if (part.fieldname === 'tipo' && TIPOS_VALIDOS.includes(v as any)) tipo = v as any;
          if (part.fieldname === 'nome') nome = v;
        } else if (part.type === 'file' && part.fieldname === 'arquivo') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk as Buffer);
          fileBuffer = Buffer.concat(chunks);
          fileMime = part.mimetype;
          fileOriginalName = part.filename;
        }
      }

      if (!fileBuffer) throw badRequest('Envie o arquivo no campo "arquivo".');
      if (!MIMES_VALIDOS.includes(fileMime)) throw badRequest('Use PNG, JPG ou WebP.');
      if (tipo === 'logo' && fileMime !== 'image/png') throw badRequest('Logo deve ser PNG (com fundo transparente).');

      const url = await salvarAsset(fileBuffer, fileMime, clienteId, tipo, fileOriginalName);
      const id = createId('ast');
      const now = nowISO();
      await run(
        `INSERT INTO ClienteAsset (id, clienteId, tipo, url, nome, createdAt) VALUES (?,?,?,?,?,?)`,
        [id, clienteId, tipo, url, nome || fileOriginalName, now],
      );
      reply.code(201);
      return { id, clienteId, tipo, url, nome: nome || fileOriginalName, createdAt: now };
    },
  );

  // DELETE /clientes/:clienteId/assets/:assetId
  app.delete('/clientes/:clienteId/assets/:assetId', { preHandler: app.authorize('ceo', 'social') }, async (req, reply) => {
    const { clienteId, assetId } = req.params as { clienteId: string; assetId: string };
    const asset = await get(`SELECT id FROM ClienteAsset WHERE id = ? AND clienteId = ?`, [assetId, clienteId]);
    if (!asset) throw notFound('Asset não encontrado.');
    await run(`DELETE FROM ClienteAsset WHERE id = ?`, [assetId]);
    return reply.code(204).send();
  });
}
