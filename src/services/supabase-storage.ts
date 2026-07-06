import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../env.ts';
import { createId } from '../lib/id.ts';

const BUCKET = 'eye-imagens';

let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!_client) {
    _client = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_KEY!);
  }
  return _client;
}

/**
 * Salva um asset de identidade visual (logo/referência) do cliente.
 * Mesmo esquema de fallback que salvarImagemGerada.
 */
export async function salvarAsset(
  buffer: Buffer,
  mimeType: string,
  clienteId: string,
  tipo: 'logo' | 'referencia',
  nomeOriginal: string,
): Promise<string> {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
  const filename = `${createId('asset')}.${ext}`;

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      const path = `assets/${clienteId}/${tipo}/${filename}`;
      const sb = getClient();
      const { error } = await sb.storage.from(BUCKET).upload(path, buffer, {
        contentType: mimeType,
        cacheControl: '31536000',
        upsert: false,
      });
      if (!error) return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      console.warn('[storage] asset upload falhou, usando base64:', error.message);
    } catch (err: any) {
      console.warn('[storage] Supabase indisponível para asset:', err.message);
    }
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  const dir = join(process.cwd(), env.UPLOAD_DIR, 'assets', clienteId, tipo);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), buffer);
  return `/uploads/assets/${clienteId}/${tipo}/${filename}`;
}

/**
 * Salva uma imagem WebP gerada por IA com três níveis de fallback:
 *   1. Supabase Storage (produção) → URL absoluta permanente
 *   2. Disco local (dev sem Supabase) → path relativo /uploads/geradas/...
 *   3. data URL base64 (Supabase configurado mas falhou) → funciona sem storage externo
 */
export async function salvarImagemGerada(
  b64: string,
  clienteId?: string,
): Promise<string> {
  const filename = `${createId('img')}.webp`;
  const buffer = Buffer.from(b64, 'base64');

  // Nível 1: Supabase (produção)
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      const path = clienteId ? `geradas/${clienteId}/${filename}` : `geradas/${filename}`;
      const sb = getClient();

      const { error } = await sb.storage.from(BUCKET).upload(path, buffer, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: false,
      });

      if (!error) {
        return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }
      console.warn('[storage] Supabase upload falhou, usando base64:', error.message);
    } catch (err: any) {
      console.warn('[storage] Supabase indisponível, usando base64:', err.message);
    }

    // Nível 3: data URL (Supabase configurado mas com erro)
    return `data:image/webp;base64,${b64}`;
  }

  // Nível 2: disco local (dev sem Supabase)
  const dir = join(process.cwd(), env.UPLOAD_DIR, 'geradas');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), buffer);
  return `/uploads/geradas/${filename}`;
}
