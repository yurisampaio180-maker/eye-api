import { all, run } from '../db/database.ts';
import { enviarWhatsAppCeo } from '../services/whatsapp.service.ts';
import { env } from '../env.ts';

interface PostRow {
  id: string;
  titulo: string;
  dataHora: string;
  plataforma: string | null;
  legenda: string;
  imagemUrl: string | null;
  clienteId: string;
  clienteNome: string | null;
  hashtags: string;
}

async function verificarDisparos(): Promise<void> {
  const agora = new Date();
  const em15min = new Date(agora.getTime() + 15 * 60 * 1000);

  const posts = await all<PostRow>(
    `SELECT e.id, e.titulo, e.dataHora, e.plataforma, e.legenda, e.imagemUrl, e.clienteId, e.hashtags,
            c.nome AS clienteNome
     FROM EventoAgenda e
     JOIN Cliente c ON c.id = e.clienteId
     WHERE e.status = 'confirmado'
       AND e.dataHora >= ?
       AND e.dataHora <= ?
       AND e.notificadoDisparo = 0`,
    [agora.toISOString(), em15min.toISOString()],
  );

  for (const post of posts) {
    const horaBRT = new Date(post.dataHora).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Fortaleza',
    });
    const frontendUrl = env.FRONTEND_URL?.replace(/\/$/, '') ?? 'https://eyeagencia.vercel.app';
    const imgLinha = post.imagemUrl?.startsWith('http') ? `\n🖼️ ${post.imagemUrl}` : '';
    const legendaTrunc = (post.legenda ?? '').slice(0, 500);

    const msg = [
      `📤 *HORA DE POSTAR — ${post.clienteNome ?? post.clienteId}*`,
      ``,
      `🕐 ${horaBRT} · ${post.plataforma ?? 'Instagram'}`,
      `📌 ${post.titulo}`,
      ``,
      `📝 *Legenda:*`,
      legendaTrunc || '(sem legenda)',
      imgLinha,
      ``,
      `👉 Ver: ${frontendUrl}/calendario`,
    ]
      .filter((l) => l !== undefined)
      .join('\n');

    const ok = await enviarWhatsAppCeo(msg);
    if (ok) {
      await run(`UPDATE EventoAgenda SET notificadoDisparo = 1 WHERE id = ?`, [post.id]);
      console.log(`[disparo] WhatsApp enviado: ${post.titulo}`);
    } else {
      console.warn(`[disparo] Falha ao enviar WhatsApp para: ${post.titulo}`);
    }
  }
}

/** Inicia o cron a cada 5 minutos para verificar posts a despachar. */
export function iniciarCronDisparo(): void {
  // Roda de imediato na inicialização (pega posts que ficaram no intervalo de reinicialização)
  verificarDisparos().catch((e) => console.error('[disparo] erro inicial:', e));
  setInterval(
    () => verificarDisparos().catch((e) => console.error('[disparo] erro cron:', e)),
    5 * 60 * 1000,
  );
}
