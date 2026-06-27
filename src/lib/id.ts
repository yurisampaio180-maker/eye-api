import { randomBytes } from 'node:crypto';

/** id curto, ordenável por tempo (prefixo + base36 do tempo + aleatório). */
export function createId(prefix = 'c'): string {
  const time = Date.now().toString(36);
  const rand = randomBytes(6).toString('hex');
  return `${prefix}${time}${rand}`;
}
