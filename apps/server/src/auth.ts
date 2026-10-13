import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { expo } from '@better-auth/expo';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { type Config, trustedOrigins } from './config.js';

export function createAuth(
  config: Config,
  database: Pool | { db: Kysely<unknown>; type: 'postgres'; transaction: false },
  localReset?: (token: string) => void,
) {
  return betterAuth({
    database,
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    trustedOrigins: trustedOrigins(config),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      ...(localReset
        ? { sendResetPassword: async ({ token }: { token: string }) => localReset(token) }
        : {}),
    },
    session: { cookieCache: { enabled: false } },
    advanced: { useSecureCookies: config.NODE_ENV === 'production' },
    logger: { disabled: true },
    plugins: [admin(), expo({ disableOriginOverride: true })],
  });
}
export type Auth = ReturnType<typeof createAuth>;
