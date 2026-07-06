import { env } from '../env.ts';

export async function enviarWhatsAppCeo(mensagem: string): Promise<boolean> {
  const ceo = env.CEO_WHATSAPP;
  if (!ceo) return false;

  // Tenta Meta Cloud API primeiro
  if (env.WHATSAPP_META_TOKEN && env.WHATSAPP_PHONE_ID) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_META_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: ceo,
            type: 'text',
            text: { body: mensagem },
          }),
        },
      );
      if (res.ok) return true;
      const err = await res.json().catch(() => ({}));
      console.warn('[whatsapp] Meta API falhou:', JSON.stringify(err));
    } catch (e: any) {
      console.warn('[whatsapp] Meta API indisponível:', e.message);
    }
  }

  // Fallback: CallMeBot (requer ativação: o CEO deve enviar "I allow callmebot to send me messages" para +34 644 97 44 22)
  if (env.CALLMEBOT_APIKEY) {
    try {
      const encoded = encodeURIComponent(mensagem);
      const url = `https://api.callmebot.com/whatsapp.php?phone=${ceo}&apikey=${env.CALLMEBOT_APIKEY}&text=${encoded}`;
      const res = await fetch(url);
      if (res.ok) return true;
      console.warn('[whatsapp] CallMeBot status:', res.status);
    } catch (e: any) {
      console.warn('[whatsapp] CallMeBot indisponível:', e.message);
    }
  }

  return false;
}
