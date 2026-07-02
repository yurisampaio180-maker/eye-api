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

const supabaseConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);

/**
 * Salva uma imagem WebP gerada por IA.
 * - Produção (Render): envia para Supabase Storage (permanente) e devolve URL absoluta.
 * - Dev local: salva em disco e devolve path relativo (/uploads/geradas/...).
 *
 * O frontend deve usar `resolveImageUrl()` para lidar com ambos os formatos.
 */
export async function salvarImagemGerada(
  b64: string,
  clienteId?: string,
): Promise<string> {
  const filename = `${createId('img')}.webp`;
  const buffer = Buffer.from(b64, 'base64');

  if (supabaseConfigured) {
    const path = clienteId ? `geradas/${clienteId}/${filename}` : `geradas/${filename}`;
    const sb = getClient();

    const { error } = await sb.storage.from(BUCKET).upload(path, buffer, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    });

    if (error) throw new Error(`Supabase Storage: ${error.message}`);

    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  // Fallback local (dev sem Supabase)
  const dir = join(process.cwd(), env.UPLOAD_DIR, 'geradas');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), buffer);
  return `/uploads/geradas/${filename}`;
}
