import { all, get, run, nowISO } from '../db/database.ts';
import { createId } from '../lib/id.ts';

/**
 * Serviço de notificações. Persiste internamente (tabela Notificacao) e loga.
 * Pronto para plugar WhatsApp/e-mail/webhook depois (deliverExternal).
 */
export interface NotificarInput {
  destinatarioId?: string | null;
  clienteId?: string | null;
  solicitacaoId?: string | null;
  titulo: string;
  mensagem?: string;
  canal?: 'interno' | 'whatsapp' | 'email' | 'webhook';
}

/** fire-and-forget seguro: nunca rejeita (não derruba o handler). */
export function notificar(input: NotificarInput): void {
  const id = createId('n');
  run(
    `INSERT INTO Notificacao (id, destinatarioId, clienteId, solicitacaoId, titulo, mensagem, canal, lida, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, input.destinatarioId ?? null, input.clienteId ?? null, input.solicitacaoId ?? null, input.titulo, input.mensagem ?? '', input.canal ?? 'interno', nowISO()]
  ).catch((e) => console.error('[NOTIF erro]', e?.message));
  // eslint-disable-next-line no-console
  console.info('[NOTIFICAÇÃO]', input.titulo, '→', input.destinatarioId ?? input.clienteId ?? 'broadcast');
}

export function listarNotificacoes(destinatarioId: string) {
  return all(
    `SELECT * FROM Notificacao WHERE destinatarioId = ? OR destinatarioId IS NULL ORDER BY createdAt DESC LIMIT 100`,
    [destinatarioId]
  );
}

export async function marcarLida(id: string) {
  const n = await get(`SELECT id FROM Notificacao WHERE id = ?`, [id]);
  if (n) await run(`UPDATE Notificacao SET lida = 1 WHERE id = ?`, [id]);
}
