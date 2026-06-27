import type { FastifyInstance } from 'fastify';

/** Roda o fluxo completo de testes contra um app já construído (e banco já seedado). */
export async function runSmoke(app: FastifyInstance): Promise<{ pass: number; fail: number }> {
  let pass = 0;
  let fail = 0;
  const check = (label: string, cond: boolean, extra?: unknown) => {
    if (cond) { pass++; console.log('  ✅', label); }
    else { fail++; console.log('  ❌', label, extra ?? ''); }
  };
  const login = async (email: string) => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'eye123' } });
    return r.json();
  };
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  console.log('\n== AUTH + PAPÉIS ==');
  const ceo = await login('yuri@eye.com');
  const saude = await login('saude@moraujo.gov.br');
  const comunic = await login('comunicacao@moraujo.gov.br');
  const henrique = await login('henrique@eye.com');
  const alysson = await login('alysson@eye.com');
  const eduarda = await login('eduarda@eye.com');
  check('CEO login', ceo.user?.role === 'ceo', ceo);
  check('Henrique = designer_governo', henrique.user?.role === 'designer_governo');

  console.log('\n== CRIAÇÃO DE USUÁRIO (só CEO) ==');
  const criarNaoCeo = await app.inject({ method: 'POST', url: '/api/v1/users', headers: auth(saude.accessToken), payload: { nome: 'X', email: 'x@y.com', role: 'cliente', senhaProvisoria: 'temp123', clienteId: 'governo-moraujo' } });
  check('Secretaria não cria usuário (403)', criarNaoCeo.statusCode === 403, criarNaoCeo.statusCode);
  const criar = await app.inject({ method: 'POST', url: '/api/v1/users', headers: auth(ceo.accessToken), payload: { nome: 'Sec. Obras', email: `obras${Date.now()}@moraujo.gov.br`, role: 'cliente', senhaProvisoria: 'temp123', clienteId: 'governo-moraujo', unidadeId: 'sec-obras' } });
  check('CEO cria usuário (201)', criar.statusCode === 201, criar.statusCode);

  console.log('\n== ISOLAMENTO + COBERTURA ==');
  const cobertura = await app.inject({ method: 'POST', url: '/api/v1/solicitacoes', headers: auth(comunic.accessToken), payload: { tipo: 'video', titulo: 'Cobertura', descricao: 'x', tipoVideo: 'cobertura', dataEvento: new Date(Date.now()+3*864e5).toISOString(), horaEvento: '16:00', tipoCobertura: 'reels_fotos_stories', coberturaReels: true, coberturaStories: true, enviarAgora: true } });
  check('Cobertura criada (201)', cobertura.statusCode === 201, cobertura.statusCode);
  check('Flags de cobertura persistidas', cobertura.json().coberturaReels === true && cobertura.json().coberturaStories === true, cobertura.json());
  const arte = await app.inject({ method: 'POST', url: '/api/v1/solicitacoes', headers: auth(saude.accessToken), payload: { tipo: 'arte', titulo: 'Card vacinação', descricao: 'campanha', formato: 'feed', enviarAgora: true } });
  const arteId = arte.json().id;
  const cross = await app.inject({ method: 'GET', url: `/api/v1/solicitacoes/${cobertura.json().id}`, headers: auth(saude.accessToken) });
  check('Saúde NÃO vê solicitação da Comunicação (403)', cross.statusCode === 403, cross.statusCode);

  console.log('\n== GATE DO CEO ==');
  const aprovar = await app.inject({ method: 'POST', url: `/api/v1/solicitacoes/${arteId}/aprovar`, headers: auth(ceo.accessToken), payload: { responsavelId: 'henrique' } });
  check('CEO aprova e cria tarefa', aprovar.json().status === 'aprovada' && !!aprovar.json().tarefa, aprovar.json());
  const tarefaId = aprovar.json().tarefa.id;
  const tH = await app.inject({ method: 'GET', url: '/api/v1/tarefas', headers: auth(henrique.accessToken) });
  check('Designer vê a tarefa', tH.json().some((t: any) => t.id === tarefaId), tH.json());
  await app.inject({ method: 'PATCH', url: `/api/v1/tarefas/${tarefaId}`, headers: auth(henrique.accessToken), payload: { statusProducao: 'producao' } });
  await app.inject({ method: 'PATCH', url: `/api/v1/tarefas/${tarefaId}`, headers: auth(henrique.accessToken), payload: { statusProducao: 'pronto' } });
  const aposPronto = await app.inject({ method: 'GET', url: `/api/v1/solicitacoes/${arteId}`, headers: auth(ceo.accessToken) });
  check('Peça pronta → aguardando_confirmacao', aposPronto.json().status === 'aguardando_confirmacao', aposPronto.json().status);
  const semConfirmar = await app.inject({ method: 'POST', url: `/api/v1/solicitacoes/${arteId}/postar`, headers: auth(ceo.accessToken) });
  check('Não posta sem confirmar (400)', semConfirmar.statusCode === 400, semConfirmar.statusCode);
  const confirmar = await app.inject({ method: 'POST', url: `/api/v1/solicitacoes/${arteId}/confirmar`, headers: auth(ceo.accessToken) });
  check('CEO confirma → confirmada', confirmar.json().status === 'confirmada', confirmar.json().status);
  const postar = await app.inject({ method: 'POST', url: `/api/v1/solicitacoes/${arteId}/postar`, headers: auth(ceo.accessToken) });
  check('CEO posta → postada', postar.json().status === 'postada', postar.json().status);

  console.log('\n== CALENDÁRIO (post + confirmação) ==');
  const novoPost = await app.inject({ method: 'POST', url: '/api/v1/agenda', headers: auth(eduarda.accessToken), payload: { clienteId: 'nutrileve', titulo: 'Promo whey', legenda: 'oferta', dataHora: new Date(Date.now()+2*864e5).toISOString() } });
  check('Social cria post (201)', novoPost.statusCode === 201 && novoPost.json().status === 'aguardando_confirmacao', novoPost.json());
  const postId = novoPost.json().id;
  const pend = await app.inject({ method: 'GET', url: '/api/v1/agenda/pendentes', headers: auth(ceo.accessToken) });
  check('CEO vê pendentes', pend.json().some((p: any) => p.id === postId), pend.json());
  const confPost = await app.inject({ method: 'POST', url: `/api/v1/agenda/${postId}/confirmar`, headers: auth(ceo.accessToken) });
  check('CEO confirma post → confirmado', confPost.json().status === 'confirmado', confPost.json());

  console.log('\n== STATS + NOTIFICAÇÕES ==');
  const stats = await app.inject({ method: 'GET', url: '/api/v1/stats', headers: auth(ceo.accessToken) });
  check('Stats (CEO) ok', typeof stats.json().pendentesAprovacao === 'number', stats.json());
  const statsNaoCeo = await app.inject({ method: 'GET', url: '/api/v1/stats', headers: auth(henrique.accessToken) });
  check('Stats bloqueado p/ não-CEO (403)', statsNaoCeo.statusCode === 403, statsNaoCeo.statusCode);
  const notifs = await app.inject({ method: 'GET', url: '/api/v1/notificacoes', headers: auth(ceo.accessToken) });
  check('Notificações chegaram', notifs.json().length > 0, notifs.json().length);

  console.log(`\n== RESULTADO: ${pass} ok, ${fail} falhas ==\n`);
  return { pass, fail };
}
