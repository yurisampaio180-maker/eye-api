import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import { applySchema, exec, run, get, closeDb, nowISO } from './database.ts';
import { hashPassword } from '../auth/password.ts';
import { createId } from '../lib/id.ts';

/**
 * SEED DE PRODUÇÃO — usuários reais (secretarias do Governo + equipe).
 * - Remove os usuários de DEMO e as transações antigas.
 * - Gera senha temporária ALEATÓRIA por usuário (só o hash vai pro banco).
 * - Grava email+senha em `credenciais-iniciais.txt` (fora do git) para você
 *   repassar com segurança. Todos trocam a senha no 1º login.
 *
 * Uso (com DATABASE_URL apontando para o Supabase):
 *   node --experimental-strip-types src/db/seed-prod.ts
 */

// ⚠️ Confirme seu e-mail de CEO aqui antes de rodar:
const CEO_EMAIL = 'yuri@eye.com';

function genSenha(): string {
  const up = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lo = 'abcdefghijkmnpqrstuvwxyz';
  const di = '23456789';
  const sy = '!@#$%&*';
  const all = up + lo + di + sy;
  const pick = (s: string) => s[randomInt(s.length)];
  let p = pick(up) + pick(lo) + pick(di) + pick(sy);
  for (let i = 0; i < 8; i++) p += pick(all);
  // embaralha
  return p.split('').sort(() => randomInt(3) - 1).join('');
}

const credenciais: { nome: string; email: string; papel: string; senha: string }[] = [];

async function upsertUnidade(id: string, nome: string) {
  const ex = await get(`SELECT id FROM Unidade WHERE id = ?`, [id]);
  if (ex) await run(`UPDATE Unidade SET nome = ? WHERE id = ?`, [nome, id]);
  else await run(`INSERT INTO Unidade (id, clienteId, nome, tipo, createdAt) VALUES (?,?,?,?,?)`, [id, 'governo-moraujo', nome, 'secretaria', nowISO()]);
}

async function criarUsuario(opts: {
  id: string; nome: string; email: string; role: string; papelLabel: string;
  clienteId?: string | null; unidadeId?: string | null; gestor?: boolean; cor?: string;
}) {
  const senha = genSenha();
  const senhaHash = await hashPassword(senha);
  const now = nowISO();
  await run(
    `INSERT INTO "User" (id, nome, email, senhaHash, role, clienteId, unidadeId, gestorCliente, avatarColor, ativo, mustChangePassword, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,1,1,?,?)`,
    [opts.id, opts.nome, opts.email.toLowerCase(), senhaHash, opts.role, opts.clienteId ?? null, opts.unidadeId ?? null, opts.gestor ? 1 : 0, opts.cor ?? '#047857', now, now]
  );
  credenciais.push({ nome: opts.nome, email: opts.email.toLowerCase(), papel: opts.papelLabel, senha });
}

async function main() {
  await applySchema();

  // garante o cliente Governo (caso banco zerado)
  const gov = await get(`SELECT id FROM Cliente WHERE id = ?`, ['governo-moraujo']);
  if (!gov) await run(`INSERT INTO Cliente (id, nome, segmento, status, corPrimaria, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)`,
    ['governo-moraujo', 'Governo Municipal de Moraújo', 'Setor Público', 'em_dia', '#047857', nowISO(), nowISO()]);

  // limpa transações (demo) e TODOS os usuários (demo)
  for (const t of ['HistoricoEvento', 'Notificacao', 'EventoAgenda', 'Anexo', 'Tarefa', 'Solicitacao']) {
    await exec(`DELETE FROM ${t};`);
  }
  await exec(`DELETE FROM "User";`);

  // ---------- Secretarias (unidades) do Governo ----------
  await upsertUnidade('sec-educacao', 'Educação');
  await upsertUnidade('sec-assistencia', 'Desenvolvimento Humano e Assistência Social');
  await upsertUnidade('sec-esporte', 'Esporte e Lazer');
  await upsertUnidade('sec-cultura', 'Cultura');
  await upsertUnidade('sec-saude', 'Saúde');
  // mantidas como unidades sem usuário ainda:
  await upsertUnidade('sec-obras', 'Obras');
  await upsertUnidade('sec-comunicacao', 'Comunicação');
  await upsertUnidade('sec-administracao', 'Administração');

  // ---------- Governo: secretários (role cliente, isolado por unidade) ----------
  await criarUsuario({ id: 'sec-u-educacao', nome: 'Hugo Moreira', email: 'hugosme@eye.com', role: 'cliente', papelLabel: 'Secretário · Educação', clienteId: 'governo-moraujo', unidadeId: 'sec-educacao' });
  await criarUsuario({ id: 'sec-u-assistencia', nome: 'Carol Carvalho', email: 'carolsedhas@eye.com', role: 'cliente', papelLabel: 'Secretária · Desenv. Humano e Assistência Social', clienteId: 'governo-moraujo', unidadeId: 'sec-assistencia' });
  await criarUsuario({ id: 'sec-u-esporte', nome: 'Bida Araújo', email: 'bidasel@eye.com', role: 'cliente', papelLabel: 'Secretário · Esporte e Lazer', clienteId: 'governo-moraujo', unidadeId: 'sec-esporte' });
  await criarUsuario({ id: 'sec-u-cultura', nome: 'Danielle Nascimento', email: 'danisecult@eye.com', role: 'cliente', papelLabel: 'Secretária · Cultura', clienteId: 'governo-moraujo', unidadeId: 'sec-cultura' });
  await criarUsuario({ id: 'sec-u-saude', nome: 'Iramar Moreira', email: 'iramarsms@eye.com', role: 'cliente', papelLabel: 'Secretário · Saúde', clienteId: 'governo-moraujo', unidadeId: 'sec-saude' });

  // ---------- Governo: Prefeito (gestor do cliente — vê tudo, não aprova) ----------
  await criarUsuario({ id: 'gestor-governo', nome: 'Ruan Lima', email: 'ruanlima@eye.com', role: 'gestor_cliente', papelLabel: 'Prefeito · Gestor do Governo', clienteId: 'governo-moraujo', gestor: true, cor: '#FACC15' });

  // ---------- Equipe da EYE Agência ----------
  await criarUsuario({ id: 'ceo', nome: 'Yuri Sampaio', email: CEO_EMAIL, role: 'ceo', papelLabel: 'CEO', cor: '#E11D2A' });
  await criarUsuario({ id: 'eduarda', nome: 'Eduarda', email: 'eduarda@eyea.com', role: 'social', papelLabel: 'Social Media', cor: '#EC4899' });
  await criarUsuario({ id: 'henrique', nome: 'Henrique', email: 'henrique@eye.com', role: 'designer_governo', papelLabel: 'Designer (Governo)', cor: '#22C55E' });
  await criarUsuario({ id: 'lourenco', nome: 'Lourenço', email: 'lourenco@eye.com', role: 'designer_governo', papelLabel: 'Designer (Governo)', cor: '#F59E0B' });
  await criarUsuario({ id: 'alyson', nome: 'Alyson', email: 'alyson@eye.com', role: 'videomaker', papelLabel: 'Videomaker', cor: '#6366F1' });
  await criarUsuario({ id: 'pedro', nome: 'Pedro Alysson', email: 'pa@eye.com', role: 'videomaker', papelLabel: 'Videomaker', cor: '#0EA5E9' });

  // ---------- Grava credenciais localmente (fora do git) ----------
  const linhas = [
    'EYE Agência — Credenciais iniciais (senha temporária, troca no 1º login)',
    'Gerado em: ' + new Date().toLocaleString('pt-BR'),
    'NÃO compartilhe este arquivo inteiro; repasse cada linha à pessoa certa.',
    ''.padEnd(70, '='),
    ...credenciais.map((c) => `${c.papel}\n  ${c.nome}\n  login: ${c.email}\n  senha temporária: ${c.senha}\n`),
  ];
  const arquivo = join(process.cwd(), 'credenciais-iniciais.txt');
  writeFileSync(arquivo, linhas.join('\n'), 'utf8');

  console.log('✅ Seed de PRODUÇÃO concluído.');
  console.log(`   ${credenciais.length} usuários reais criados (senha temporária, troca obrigatória no 1º login).`);
  console.log('   Secretarias atualizadas: Educação, Desenv. Humano e Assist. Social, Esporte e Lazer, Cultura, Saúde (+ Obras, Comunicação, Administração).');
  console.log('   📄 Credenciais salvas em: ' + arquivo);
  console.log('   (as senhas NÃO aparecem aqui no terminal — só no arquivo)');
  await closeDb();
}

main();
