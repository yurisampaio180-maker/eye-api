import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().default('file:./dev.db'),
  PORT: z.coerce.number().default(3333),
  CORS_ORIGIN: z.string().default('http://localhost:5190'),
  JWT_ACCESS_SECRET: z.string().min(16, 'Defina JWT_ACCESS_SECRET no .env (>=16 chars)'),
  JWT_REFRESH_SECRET: z.string().min(16, 'Defina JWT_REFRESH_SECRET no .env (>=16 chars)'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  UPLOAD_DIR: z.string().default('./uploads'),
  OPENAI_API_KEY: z.string().optional().default(''),
  SEED_DEFAULT_PASSWORD: z.string().default('eye123'),
  META_APP_ID: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  INSTAGRAM_REDIRECT_URI: z.string().optional().default(''),
  FRONTEND_URL: z.string().optional().default('http://localhost:5190'),
  TAVILY_API_KEY: z.string().optional().default(''),
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_SERVICE_KEY: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
