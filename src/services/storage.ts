import { mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { env } from '../env.ts';
import { createId } from '../lib/id.ts';

/**
 * Camada de storage isolada. Hoje grava local em UPLOAD_DIR e devolve uma URL
 * pública servida pelo backend (/uploads/...). Para trocar por S3/Supabase,
 * basta reimplementar `saveFile` mantendo a assinatura.
 */
export interface StoredFile {
  url: string;
  nomeArquivo: string;
  mime: string;
  tamanho: number;
}

export async function saveFile(
  originalName: string,
  mime: string,
  buffer: Buffer
): Promise<StoredFile> {
  mkdirSync(env.UPLOAD_DIR, { recursive: true });
  const safeExt = extname(originalName).slice(0, 10);
  const filename = `${createId('f')}${safeExt}`;
  const fullPath = join(env.UPLOAD_DIR, filename);
  writeFileSync(fullPath, buffer);
  return {
    url: `/uploads/${filename}`,
    nomeArquivo: originalName,
    mime,
    tamanho: buffer.length,
  };
}
