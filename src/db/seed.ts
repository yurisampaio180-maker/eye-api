import { applySchema, exec, run, closeDb, nowISO } from './database.ts';
import { hashPassword } from '../auth/password.ts';
import { createId } from '../lib/id.ts';
import { env } from '../env.ts';

const now = nowISO();

async function cliente(id: string, nome: string, segmento: string, cor: string) {
  await run(`INSERT INTO Cliente (id, nome, segmento, status, corPrimaria, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)`,
    [id, nome, segmento, 'em_dia', cor, now, now]);
}

async function unidade(id: string, clienteId: string, nome: string) {
  await run(`INSERT INTO Unidade (id, clienteId, nome, tipo, createdAt) VALUES (?,?,?,?,?)`, [id, clienteId, nome, 'secretaria', now]);
}

async function user(opts: {
  id?: string; nome: string; email: string; role: string;
  clienteId?: string | null; unidadeId?: string | null; gestor?: boolean; cor?: string; mustChange?: boolean;
}) {
  const senhaHash = await hashPassword(env.SEED_DEFAULT_PASSWORD);
  const id = opts.id ?? createId('u');
  await run(
    `INSERT INTO "User" (id, nome, email, senhaHash, role, clienteId, unidadeId, gestorCliente, avatarColor, ativo, mustChangePassword, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    [id, opts.nome, opts.email.toLowerCase(), senhaHash, opts.role, opts.clienteId ?? null, opts.unidadeId ?? null,
     opts.gestor ? 1 : 0, opts.cor ?? '#E11D2A', opts.mustChange ? 1 : 0, now, now]
  );
  return id;
}

async function dna(clienteId: string, configurado: boolean, posicionamento: string, tom: string, paleta: any[], refs: string[]) {
  await run(
    `INSERT INTO ClienteDNA (id, clienteId, configurado, posicionamento, tomDeVoz, paletaJson, tipografiaJson, referenciasJson, frameworksJson, proibicoesJson)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [createId('dna'), clienteId, configurado ? 1 : 0, posicionamento, tom, JSON.stringify(paleta), '{}', JSON.stringify(refs), '[]', '[]']
  );
}

async function solicitacao(opts: {
  clienteId: string; unidadeId?: string | null; solicitanteId: string; tipo: 'arte' | 'video';
  titulo: string; descricao: string; prioridade?: string; status: string;
  formato?: string; tipoVideo?: string; localGravacao?: string; roteiroNecessario?: boolean;
}) {
  const id = createId('s');
  await run(
    `INSERT INTO Solicitacao (id, clienteId, unidadeId, solicitanteId, tipo, titulo, descricao, prioridade, prazoDesejado, status, formato, textosDesejados, informacoes, tipoVideo, localGravacao, dataEvento, precisaEquipeNoLocal, roteiroNecessario, motivoReprovacao, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, opts.clienteId, opts.unidadeId ?? null, opts.solicitanteId, opts.tipo, opts.titulo, opts.descricao,
     opts.prioridade ?? 'normal', null, opts.status, opts.formato ?? null, null, null, opts.tipoVideo ?? null,
     opts.localGravacao ?? null, null, 0, opts.roteiroNecessario ? 1 : 0, null, now, now]
  );
  await run(`INSERT INTO HistoricoEvento (id, solicitacaoId, autorId, acao, de, para, detalhe, createdAt) VALUES (?,?,?,?,?,?,?,?)`,
    [createId('h'), id, opts.solicitanteId, 'criada', null, opts.status, null, now]);
  return id;
}

export async function seedDatabase(seedExemplos = false) {
  await applySchema();
  // limpa (ordem respeitando FKs)
  for (const t of ['HistoricoEvento', 'Notificacao', 'EventoAgenda', 'Anexo', 'Tarefa', 'Solicitacao', 'Campanha', 'ClienteDNA', '"User"', 'Unidade', 'Cliente']) {
    await exec(`DELETE FROM ${t};`);
  }

  // ---------- Clientes ----------
  await cliente('junior-univel', 'Junior Unível Automóveis', 'Automotivo', '#CC0000');
  await cliente('nutrileve', 'Nutri Leve', 'Saúde / Nutrição', '#1B4332');
  await cliente('governo-moraujo', 'Governo Municipal de Moraújo', 'Setor Público', '#047857');
  await cliente('verso-nosso', 'Verso Nosso', 'Presente / Música', '#D95F27');
  await cliente('siara', 'Siara', 'Moda / Varejo', '#DB2777');

  // ---------- Secretarias ----------
  await unidade('sec-saude', 'governo-moraujo', 'Secretaria de Saúde');
  await unidade('sec-educacao', 'governo-moraujo', 'Secretaria de Educação');
  await unidade('sec-obras', 'governo-moraujo', 'Secretaria de Obras');
  await unidade('sec-esporte', 'governo-moraujo', 'Secretaria de Esporte');
  await unidade('sec-assistencia', 'governo-moraujo', 'Secretaria de Assistência Social');
  await unidade('sec-comunicacao', 'governo-moraujo', 'Secretaria de Comunicação');
  await unidade('sec-administracao', 'governo-moraujo', 'Secretaria de Administração');

  // ---------- DNA ----------
  await dna('verso-nosso', true, 'Presente que vira música — emoção acima de tudo.', 'Poético, afetivo, cinematográfico.', [{ nome: 'Preto', hex: '#0A0705' }, { nome: 'Laranja', hex: '#D95F27' }], ['A24 films', 'Spotify Wrapped']);
  await dna('junior-univel', true, 'Autoridade automotiva em Sobral.', 'Direto, confiante, potente.', [{ nome: 'Preto', hex: '#0A0A0A' }, { nome: 'Vermelho', hex: '#CC0000' }], ['Honda', 'Toyota', 'Caterpillar']);
  await dna('nutrileve', true, 'Os melhores produtos pelo melhor preço de Sobral.', 'Performático e premium.', [{ nome: 'Verde', hex: '#1B4332' }, { nome: 'Dourado', hex: '#C8A96E' }], ['Nike', 'Optimum Nutrition']);
  await dna('governo-moraujo', true, 'Um Novo Tempo — gestão humanizada.', 'Humanizado, positivo.', [{ nome: 'Verde', hex: '#047857' }, { nome: 'Dourado', hex: '#FACC15' }], ['Campanhas institucionais humanizadas']);
  await dna('siara', false, '', '', [], []);

  // ---------- Equipe real ----------
  await user({ id: 'ceo', nome: 'Yuri Sampaio', email: 'yuri@eye.com', role: 'ceo', cor: '#E11D2A' });
  await user({ id: 'eduarda', nome: 'Eduarda', email: 'eduarda@eye.com', role: 'social', cor: '#EC4899' });
  await user({ id: 'henrique', nome: 'Henrique', email: 'henrique@eye.com', role: 'designer_governo', cor: '#22C55E' });
  await user({ id: 'lourenco', nome: 'Lourenço', email: 'lourenco@eye.com', role: 'designer_governo', cor: '#F59E0B' });
  await user({ id: 'alysson', nome: 'Alysson', email: 'alysson@eye.com', role: 'videomaker', cor: '#6366F1' });
  await user({ id: 'pedro', nome: 'Pedro Alysson', email: 'pedro@eye.com', role: 'videomaker', cor: '#0EA5E9' });

  // ---------- Secretarias de teste ----------
  const saude = await user({ id: 'sol-saude', nome: 'Secretaria de Saúde', email: 'saude@moraujo.gov.br', role: 'cliente', clienteId: 'governo-moraujo', unidadeId: 'sec-saude', cor: '#047857' });
  const comunic = await user({ id: 'sol-comunicacao', nome: 'Secretaria de Comunicação', email: 'comunicacao@moraujo.gov.br', role: 'cliente', clienteId: 'governo-moraujo', unidadeId: 'sec-comunicacao', cor: '#047857' });

  if (seedExemplos) {
    await solicitacao({ clienteId: 'governo-moraujo', unidadeId: 'sec-saude', solicitanteId: saude, tipo: 'arte', titulo: 'Mutirão de saúde no sábado', descricao: 'Arte do mutirão no Centro, sábado 8h-12h.', prioridade: 'alta', status: 'em_aprovacao', formato: 'feed' });
    await solicitacao({ clienteId: 'governo-moraujo', unidadeId: 'sec-comunicacao', solicitanteId: comunic, tipo: 'video', titulo: 'Cobertura da inauguração da praça', descricao: 'Reels da inauguração, quinta 16h.', prioridade: 'urgente', status: 'em_aprovacao', tipoVideo: 'cobertura', localGravacao: 'Praça Central', roteiroNecessario: true });
  }

  console.log('✅ Seed concluído (senha inicial = ' + env.SEED_DEFAULT_PASSWORD + ').');
  console.log('   Equipe: yuri@eye.com (CEO) · eduarda@eye.com (social) · henrique@/lourenco@eye.com (designer) · alysson@/pedro@eye.com (videomaker)');
  console.log('   Teste secretaria: saude@moraujo.gov.br · comunicacao@moraujo.gov.br');
  console.log(seedExemplos ? '   (com solicitações de exemplo)' : '   (sistema limpo)');
}

// auto-executa quando rodado como script (CLI)
const isCli = process.argv[1]?.replace(/\\/g, '/').endsWith('/db/seed.ts');
if (isCli) {
  await seedDatabase(process.argv.includes('--exemplos'));
  await closeDb();
}
