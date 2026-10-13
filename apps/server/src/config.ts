import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3001'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  NATIVE_SCHEME: z
    .string()
    .regex(/^[a-z][a-z0-9+.-]*$/)
    .default('memslife'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MEDIA_DIRECTORY: z.string().min(1).optional(),
  EXPO_PUSH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  EXPO_PUSH_ACCESS_TOKEN: z.string().min(1).optional(),
  WHOOP_CLIENT_ID: z.string().min(1).optional(),
  WHOOP_CLIENT_SECRET: z.string().min(1).optional(),
  WHOOP_REDIRECT_URI: z
    .url()
    .refine((value) => new URL(value).protocol === 'https:', 'WHOOP callback requires HTTPS.')
    .optional(),
  WHOOP_TOKEN_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export function readConfig(env = process.env): Config {
  const config = ConfigSchema.parse(env);
  if (config.NODE_ENV === 'production' && !config.BETTER_AUTH_URL.startsWith('https://')) {
    throw new Error('Production authentication requires HTTPS.');
  }
  return config;
}
export function trustedOrigins(config: Config): string[] {
  return [
    new URL(config.BETTER_AUTH_URL).origin,
    new URL(config.WEB_ORIGIN).origin,
    `${config.NATIVE_SCHEME}://`,
  ];
}
