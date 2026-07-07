import type { FastifyInstance } from 'fastify';
import { gerarImagem, openaiConfigured } from '../services/openai.ts';
import { salvarImagemGerada } from '../services/supabase-storage.ts';
import { buscarAssetsParaGeracao } from '../services/assets.service.ts';
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
      preHandler: app.authorize('ceo', 'social', 'designer_governo', 'gestor_cliente', 'cliente'),
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

      // Secretarias só podem gerar imagens para o próprio cliente
      const user = req.authUser;
      if (user.role === 'gestor_cliente' || user.role === 'cliente') {
        clienteId = user.clienteId ?? clienteId;
        if (!clienteId) throw badRequest('Usuário sem cliente associado.');
      }

      if (!promptTecnico || promptTecnico.length < 10) {
        throw badRequest('promptTecnico ausente ou muito curto.');
      }

      // Banco de imagens do cliente: logo + referências curadas/aprovadas
      const { buffers } = clienteId ? await buscarAssetsParaGeracao(clienteId) : { buffers: [] };

      // Chamar OpenAI (pode levar 10-30s) — erros já mapeados em openai.errors.ts
      req.log.info({ clienteId, formato, temReferencia: !!referenciaBuffer, assetsBanco: buffers.length }, 'ia:gerar-imagem inicio');
      const resultado = await gerarImagem({
        promptTecnico,
        formato,
        referenciaBuffer,
        referenciaMime,
        assets: buffers.length > 0 ? buffers : undefined,
      });
      req.log.info({ clienteId }, 'ia:gerar-imagem concluido');

      const imagemUrl = await salvarImagemGerada(resultado.b64, clienteId || undefined);

      reply.code(201);
      return {
        imagemUrl,
        modeloUsado: 'gpt-image-1',
        geradoEm: new Date().toISOString(),
        clienteId,
      };
    }
  );
}
