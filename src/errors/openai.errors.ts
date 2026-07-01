import { AppError } from '../lib/errors.ts';

export class OpenAIBillingError extends AppError {
  constructor() {
    super(
      402,
      'OPENAI_BILLING_LIMIT',
      'Créditos OpenAI esgotados. Acesse platform.openai.com → Billing → Add to credit balance para adicionar saldo.'
    );
  }
}

export class OpenAIAuthError extends AppError {
  constructor() {
    super(
      500,
      'OPENAI_AUTH_ERROR',
      'Chave da OpenAI inválida ou revogada. Verifique a variável OPENAI_API_KEY no Render.'
    );
  }
}

export class OpenAIAccessError extends AppError {
  constructor() {
    super(
      403,
      'OPENAI_ACCESS_DENIED',
      'Conta OpenAI sem acesso à API de imagens. Configure um método de pagamento em platform.openai.com.'
    );
  }
}

export class OpenAIContentError extends AppError {
  constructor() {
    super(
      422,
      'OPENAI_CONTENT_REJECTED',
      'O prompt foi rejeitado pelos filtros de segurança da OpenAI. Reformule o contexto e tente novamente.'
    );
  }
}

export class OpenAIRateLimitError extends AppError {
  constructor() {
    super(
      429,
      'OPENAI_RATE_LIMIT',
      'Muitas gerações em sequência. Aguarde 1 minuto e tente novamente.'
    );
  }
}

export class OpenAIUnavailableError extends AppError {
  constructor() {
    super(
      503,
      'OPENAI_UNAVAILABLE',
      'Serviço de IA temporariamente indisponível. Tente novamente em alguns minutos.'
    );
  }
}

export class OpenAIGenericError extends AppError {
  constructor(detalhe: string) {
    super(
      500,
      'OPENAI_UNKNOWN',
      `Erro ao gerar imagem. Detalhe: ${detalhe}`
    );
  }
}

/** Converte qualquer erro do SDK da OpenAI numa classe de erro tipada. */
export function mapOpenAIError(err: any): AppError {
  const status: number = err?.status ?? err?.response?.status ?? 0;
  const msg: string = err?.message ?? '';
  const msgL = msg.toLowerCase();

  // Billing / saldo esgotado (400 com mensagem de billing)
  if (status === 400 && (msgL.includes('billing') || msgL.includes('hard limit') || msgL.includes('credit'))) {
    return new OpenAIBillingError();
  }
  // Chave inválida / não autorizada
  if (status === 401 || msgL.includes('incorrect api key') || msgL.includes('invalid_api_key')) {
    return new OpenAIAuthError();
  }
  // Sem acesso ao modelo / conta sem pagamento
  if (status === 403) {
    return new OpenAIAccessError();
  }
  // Conteúdo rejeitado pelo filtro de segurança
  if ((status === 400 || status === 422) && (msgL.includes('safety') || msgL.includes('content_policy') || msgL.includes('rejected') || msgL.includes('violat'))) {
    return new OpenAIContentError();
  }
  // Rate limit
  if (status === 429 || msgL.includes('rate limit')) {
    return new OpenAIRateLimitError();
  }
  // Serviço indisponível / timeout
  if (status === 500 || status === 503 || err?.code === 'ETIMEDOUT' || msgL.includes('timeout')) {
    return new OpenAIUnavailableError();
  }

  return new OpenAIGenericError(msg || `HTTP ${status}`);
}
