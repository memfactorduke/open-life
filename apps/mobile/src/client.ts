import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';
import { installationStoragePrefix } from './installation';
import type { NativeOfflineClient } from './offline-client';
import { ApiErrorSchema } from '@mems-life/domain';

export function createInstallationClient(baseURL: string) {
  const auth = createAuthClient({
    baseURL,
    plugins: [
      expoClient({
        scheme: 'memslife',
        storagePrefix: installationStoragePrefix(baseURL),
        storage: SecureStore,
        disableCache: true,
      }),
    ],
  });

  async function request(
    path: string,
    body?: unknown,
    method: 'PUT' | 'POST' | 'DELETE' = 'PUT',
    options: { expectedEpoch?: string } = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (path === '/api/me') {
        const session = await auth.getSession({
          query: { disableCookieCache: true },
          fetchOptions: { signal: controller.signal },
        });
        if (session.error) {
          if (session.error.status === 401 || session.error.status === 403)
            throw new SessionExpiredError();
          if (isTransportFailure(session.error))
            throw new NetworkUnavailableError(
              'The installation could not be reached. Saved work is available on this device.',
            );
          throw new Error(
            session.error.message ?? 'The installation could not verify your session.',
          );
        }
        if (!session.data) throw new SessionExpiredError();
      }
      const cookie = await auth.getCookie();
      const response = await fetch(`${baseURL}${path}`, {
        method: method === 'DELETE' ? method : body === undefined ? 'GET' : method,
        credentials: 'omit',
        headers: {
          Cookie: cookie ?? '',
          ...(options.expectedEpoch ? { 'X-Mems-Life-Epoch': options.expectedEpoch } : {}),
          ...(body === undefined && method !== 'DELETE'
            ? {}
            : { 'Content-Type': 'application/json', Origin: 'memslife://' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401) throw new SessionExpiredError();
        const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
        throw new RequestRejectedError(
          response.status,
          parsed.success
            ? parsed.data.error.message
            : `The installation could not complete this request (${response.status}). Try again.`,
          parsed.success ? parsed.data.error.code : undefined,
          parsed.success ? parsed.data.error.details : undefined,
        );
      }
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError'))
        throw new NetworkUnavailableError(
          'The installation took too long to respond. Check your connection and try again.',
        );
      if (isTransportFailure(error))
        throw new NetworkUnavailableError(
          'The installation could not be reached. Check your connection; saved local work is retained.',
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return { auth, request, baseURL, offline: undefined as NativeOfflineClient | undefined };
}

// Expo's FetchError is an Error (not TypeError). Better Fetch propagates a rejected
// transport promise, whereas HTTP errors return { data: null, error: { status } }.
// A missing status alone is never evidence that cached identity may be used.
function isTransportFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof value.status === 'number' && value.status > 0) return false;
  if (typeof value.code === 'string' && /unauthor|forbidden|auth.*required/i.test(value.code))
    return false;
  if (typeof value.message !== 'string') return false;
  return /network request failed|failed to fetch|network error|load failed|fetch failed:.*(?:could not connect|network|connection|internet|offline|timed out)|^fetch failed$/i.test(
    value.message,
  );
}

export class NetworkUnavailableError extends Error {
  readonly code = 'NETWORK_UNAVAILABLE';
}

export class SessionExpiredError extends Error {
  readonly status = 401;
  readonly code = 'UNAUTHORIZED';
  constructor() {
    super('Your session has ended. Sign in again to continue.');
  }
}

export class RequestRejectedError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  get epoch(): string | undefined {
    return (this.details as { epoch?: string } | undefined)?.epoch;
  }
}

export type InstallationClient = ReturnType<typeof createInstallationClient>;
