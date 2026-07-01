import { all, get, run, nowISO } from '../db/database.ts';
import { env } from '../env.ts';
import { createId } from '../lib/id.ts';

const META = 'https://graph.facebook.com/v19.0';
const IG   = 'https://graph.instagram.com/v19.0';

export const instagramConfigured = Boolean(env.META_APP_ID && env.META_APP_SECRET && env.INSTAGRAM_REDIRECT_URI);

// ─── OAuth ────────────────────────────────────────────────────────────────────

export function gerarUrlOAuth(clienteId: string): string {
  const p = new URLSearchParams({
    client_id:     env.META_APP_ID,
    redirect_uri:  env.INSTAGRAM_REDIRECT_URI,
    scope:         'instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement',
    response_type: 'code',
    state:         clienteId,
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${p.toString()}`;
}

export async function trocarCodePorToken(code: string, clienteId: string): Promise<void> {
  // 1. short-lived token
  const r1 = await fetch(`${META}/oauth/access_token?` + new URLSearchParams({
    client_id:     env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    redirect_uri:  env.INSTAGRAM_REDIRECT_URI,
    code,
  }));
  if (!r1.ok) throw new Error(`OAuth token: ${await r1.text()}`);
  const { access_token: shortToken } = await r1.json() as any;

  // 2. long-lived token (60 dias)
  const r2 = await fetch(`${META}/oauth/access_token?` + new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:         env.META_APP_ID,
    client_secret:     env.META_APP_SECRET,
    fb_exchange_token: shortToken,
  }));
  if (!r2.ok) throw new Error(`Long-lived token: ${await r2.text()}`);
  const { access_token: longToken } = await r2.json() as any;

  // 3. conta Instagram Business via Página do Facebook
  const r3 = await fetch(`${META}/me/accounts?` + new URLSearchParams({
    access_token: longToken,
    fields: 'instagram_business_account{id,username}',
  }));
  if (!r3.ok) throw new Error(`accounts: ${await r3.text()}`);
  const { data } = await r3.json() as any;

  const igData = data?.[0]?.instagram_business_account;
  if (!igData) {
    throw new Error(
      'Conta Instagram não encontrada. Confirme que é conta Business conectada a uma Página do Facebook.'
    );
  }

  const expiraEm = new Date();
  expiraEm.setDate(expiraEm.getDate() + 55); // renovar antes dos 60 dias

  const existing = await get<{ id: string }>('SELECT id FROM InstagramConexao WHERE clienteId = ?', [clienteId]);
  if (existing) {
    await run(
      `UPDATE InstagramConexao SET instagramUserId = ?, username = ?, accessToken = ?, tokenExpiraEm = ?, ultimaSincEm = NULL WHERE clienteId = ?`,
      [igData.id, igData.username, longToken, expiraEm.toISOString(), clienteId]
    );
  } else {
    await run(
      `INSERT INTO InstagramConexao (id, clienteId, instagramUserId, username, accessToken, tokenExpiraEm, conectadoEm) VALUES (?,?,?,?,?,?,?)`,
      [createId('ig'), clienteId, igData.id, igData.username, longToken, expiraEm.toISOString(), nowISO()]
    );
  }

  await sincronizarMetricas(clienteId);
}

// ─── Sincronização de métricas ────────────────────────────────────────────────

export async function sincronizarMetricas(clienteId: string): Promise<void> {
  const conn = await get<any>('SELECT * FROM InstagramConexao WHERE clienteId = ?', [clienteId]);
  if (!conn) return;

  // Perfil básico
  const rp = await fetch(`${IG}/${conn.instagramUserId}?` + new URLSearchParams({
    fields: 'followers_count,follows_count,media_count',
    access_token: conn.accessToken,
  }));
  if (!rp.ok) {
    console.error(`[instagram] perfil error ${clienteId}:`, await rp.text());
    return;
  }
  const perfil = await rp.json() as any;

  let alcanceSemana: number | null = null;
  let impressoesSem: number | null = null;
  let visitasPerfil: number | null = null;

  try {
    const ri = await fetch(`${IG}/${conn.instagramUserId}/insights?` + new URLSearchParams({
      metric: 'reach,impressions,profile_views',
      period: 'week',
      access_token: conn.accessToken,
    }));
    if (ri.ok) {
      const { data: ins } = await ri.json() as any;
      for (const item of (ins ?? [])) {
        const v = item.values?.[1]?.value ?? item.values?.[0]?.value ?? null;
        if (item.name === 'reach')         alcanceSemana = v;
        else if (item.name === 'impressions')  impressoesSem = v;
        else if (item.name === 'profile_views') visitasPerfil = v;
      }
    }
  } catch {
    // insights opcionais — conta pode não ter permissão
  }

  await run(
    `INSERT INTO InstagramMetrica (id, clienteId, coletadoEm, seguidores, seguindo, totalPosts, alcanceSemana, impressoesSem, visitasPerfil)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [createId('igm'), clienteId, nowISO(),
     perfil.followers_count ?? 0, perfil.follows_count ?? 0, perfil.media_count ?? 0,
     alcanceSemana, impressoesSem, visitasPerfil]
  );

  await run('UPDATE InstagramConexao SET ultimaSincEm = ? WHERE clienteId = ?', [nowISO(), clienteId]);
}

export async function sincronizarTodos(): Promise<void> {
  const conexoes = await all<{ clienteId: string; tokenExpiraEm: string }>(
    'SELECT clienteId, tokenExpiraEm FROM InstagramConexao'
  );
  for (const c of conexoes) {
    const dias = (new Date(c.tokenExpiraEm).getTime() - Date.now()) / 86_400_000;
    if (dias < 10) {
      console.warn(`[instagram] token do cliente ${c.clienteId} expira em ${Math.floor(dias)} dias — reconectar!`);
    }
    await sincronizarMetricas(c.clienteId).catch((e) =>
      console.error(`[instagram] sync ${c.clienteId}:`, e.message)
    );
  }
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

export interface InstagramStatus {
  conectado: boolean;
  username: string | null;
  tokenExpiraEm: string | null;
  ultimaSincEm: string | null;
  metrica: {
    seguidores: number;
    seguindo: number;
    totalPosts: number;
    alcanceSemana: number | null;
    impressoesSem: number | null;
    visitasPerfil: number | null;
    coletadoEm: string;
  } | null;
}

export async function buscarStatus(clienteId: string): Promise<InstagramStatus> {
  const [conn, metrica] = await Promise.all([
    get<any>('SELECT username, tokenExpiraEm, ultimaSincEm FROM InstagramConexao WHERE clienteId = ?', [clienteId]),
    get<any>('SELECT * FROM InstagramMetrica WHERE clienteId = ? ORDER BY coletadoEm DESC LIMIT 1', [clienteId]),
  ]);
  return {
    conectado:     !!conn,
    username:      conn?.username ?? null,
    tokenExpiraEm: conn?.tokenExpiraEm ?? null,
    ultimaSincEm:  conn?.ultimaSincEm ?? null,
    metrica:       metrica ?? null,
  };
}
