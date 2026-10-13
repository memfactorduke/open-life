import { createAuthClient } from 'better-auth/react';
import { ApiErrorSchema } from '@mems-life/domain';
import type { z } from 'zod';

export const auth = createAuthClient();

export class RequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    if (path === '/api/me') {
      const session = await auth.getSession({ query: { disableCookieCache: true } });
      if (session.error)
        throw new RequestError(
          session.error.status,
          session.error.message ?? 'The session could not be verified.',
        );
      if (!session.data) throw new RequestError(401, 'Your session has ended. Sign in again.');
    }
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(
      0,
      'The service could not be reached. Check your connection and try again.',
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new RequestError(
      response.status,
      parsed.success
        ? parsed.data.error.message
        : 'The request could not be completed. Please try again.',
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new RequestError(502, 'The service returned an unexpected response. Please try again.');
  return parsed.data;
}
