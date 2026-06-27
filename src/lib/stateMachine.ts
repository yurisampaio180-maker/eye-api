import { conflict } from './errors.ts';

// Estados da Solicitação
export const STATUS = [
  'rascunho',
  'enviada',
  'em_aprovacao',
  'aprovada',
  'reprovada',
  'em_producao',
  'em_revisao',
  'aguardando_confirmacao', // peça pronta — aguarda confirmação do CEO
  'confirmada', // CEO liberou para postar
  'agendada',
  'postada',
  'cancelada',
] as const;

export type SolicitacaoStatus = (typeof STATUS)[number];

/**
 * Transições válidas (além de "qualquer não-terminal → cancelada").
 * Regra inquebrável: nada sai de produção para postagem sem passar por
 * `aguardando_confirmacao` → `confirmada` (ação exclusiva do CEO).
 */
const TRANSITIONS: Record<SolicitacaoStatus, SolicitacaoStatus[]> = {
  rascunho: ['enviada', 'cancelada'],
  enviada: ['em_aprovacao', 'cancelada'],
  em_aprovacao: ['aprovada', 'reprovada', 'cancelada'],
  reprovada: ['em_aprovacao', 'cancelada'], // reenviar volta para aprovação
  aprovada: ['em_producao', 'cancelada'],
  em_producao: ['em_revisao', 'aguardando_confirmacao', 'cancelada'],
  em_revisao: ['aguardando_confirmacao', 'em_producao', 'cancelada'],
  aguardando_confirmacao: ['confirmada', 'em_producao', 'cancelada'], // CEO confirma ou devolve
  confirmada: ['agendada', 'postada', 'cancelada'],
  agendada: ['postada', 'cancelada'],
  postada: [], // terminal
  cancelada: [], // terminal
};

export const TERMINAIS: SolicitacaoStatus[] = ['postada', 'cancelada'];

/** status já aprovados (visíveis para a equipe interna). */
export const VISIVEIS_EQUIPE: SolicitacaoStatus[] = [
  'aprovada',
  'em_producao',
  'em_revisao',
  'aguardando_confirmacao',
  'confirmada',
  'agendada',
  'postada',
];

export function canTransition(from: SolicitacaoStatus, to: SolicitacaoStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** valida a transição ou lança 409; centraliza a regra de negócio. */
export function assertTransition(from: SolicitacaoStatus, to: SolicitacaoStatus): void {
  if (!canTransition(from, to)) {
    throw conflict(`Transição inválida: ${from} → ${to}.`);
  }
}

export function isStatus(v: string): v is SolicitacaoStatus {
  return (STATUS as readonly string[]).includes(v);
}

/**
 * Ordem da fase de produção (kanban). Vai só até `aguardando_confirmacao`:
 * a partir daí, apenas o CEO libera (`confirmada` → `postada`).
 */
export const PROD_ORDER: SolicitacaoStatus[] = [
  'aprovada',
  'em_producao',
  'em_revisao',
  'aguardando_confirmacao',
];

// Status de produção (kanban) por tipo de tarefa
export const PRODUCAO_VIDEO = ['roteiro', 'gravacao', 'edicao', 'aprovacao', 'pronto'] as const;
export const PRODUCAO_ARTE = ['ideia', 'producao', 'revisao', 'pronto'] as const;
