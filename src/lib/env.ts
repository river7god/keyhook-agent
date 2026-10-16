import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Parsed lazily so `next build` and unit tests don't need a database URL. */
export function getEnv(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}
