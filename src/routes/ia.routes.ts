import type { FastifyInstance } from 'fastify';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../env.ts';
import { gerarImagem, openaiConfigured } from '../services/openai.ts';
import { createId } from '../lib/id.ts';
import { badRequest } from '../lib/errors.ts';

export async function iaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /**
   * POST /api/v1/ia/gerar-imagem
   *
   * Multipart form-data:
   *   promptTecnico  string  — prompt técnico completo (8 seções do Motor de Criação)
   *   clienteId      string  — id do cliente (para log)
   *   formato        string  — feed | stories | carrossel_slide
   *   referencia     file?   — imagem de referência opcional (JPG/PNG/WebP, máx 20MB)
   *
   * A chave OpenAI fica SOMENTE no servidor. O frontend nunca a vê.
   */
  app.post(
    '/gerar-imagem',
    {
      preHandler: app.authorize('ceo', 'social', 'designer_governo'),
      config: { rateLimit: { max: 8, timeWindow: '2 minutes' } },
    },
    async (req, reply) => {
      if (!openaiConfigured) {
        throw badRequest(
          'OpenAI não configurada no servidor. Configure OPENAI_API_KEY no Render e faça redeploy.'
        );
      }

      // Parsear multipart
      let promptTecnico = '';
      let clienteId = '';
      let formato = 'feed';
      let referenciaBuffer: Buffer | undefined;
      let referenciaMime: string | undefined;

      const parts = req.parts({ limits: { fileSize: 20 * 1024 * 1024 } });
      for await (const part of parts) {
        if (part.type === 'field') {
          const val = part.value as string;
          if (part.fieldname === 'promptTecnico') promptTecnico = val;
          else if (part.fieldname === 'clienteId') clienteId = val;
          else if (part.fieldname === 'formato') formato = val;
        } else if (part.type === 'file' && part.fieldname === 'referencia') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk as Buffer);
          referenciaBuffer = Buffer.concat(chunks);
          referenciaMime = part.mimetype;
        }
      }

      if (!promptTecnico || promptTecnico.length < 10) {
        throw badRequest('promptTecnico ausente ou muito curto.');
      }

      // Chamar OpenAI (pode levar 10-30s) — erros já mapeados em openai.errors.ts
      req.log.info({ clienteId, formato, temReferencia: !!referenciaBuffer }, 'ia:gerar-imagem inicio');
      const resultado = await gerarImagem({
        promptTecnico,
        formato,
        referenciaBuffer,
        referenciaMime,
      });
      req.log.info({ clienteId }, 'ia:gerar-imagem concluido');

      // Salvar em /uploads/geradas/ para retornar URL permanente
      const geradasDir = join(process.cwd(), env.UPLOAD_DIR, 'geradas');
      await mkdir(geradasDir, { recursive: true });
      const filename = `${createId('img')}.webp`;
      await writeFile(join(geradasDir, filename), Buffer.from(resultado.b64, 'base64'));

      reply.code(201);
      return {
        imagemUrl: `/uploads/geradas/${filename}`,
        modeloUsado: 'gpt-image-1',
        geradoEm: new Date().toISOString(),
        clienteId,
      };
    }
  );
}
