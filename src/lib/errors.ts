/** Erro de aplicação com status HTTP e código — formato de erro padronizado. */
export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Não autenticado') =>
  new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Sem permissão') =>
  new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Não encontrado') =>
  new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);
