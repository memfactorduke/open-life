import { useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { RequestRejectedError, type InstallationClient } from '../client';

export function messageOf(error: unknown): string {
  if (error instanceof Error && !(error instanceof RequestRejectedError)) {
    const code = 'code' in error ? error.code : undefined;
    if (
      code === 'SQLITE_FULL' ||
      /\bSQLITE_FULL\b|\bdatabase or disk is full\b/i.test(error.message)
    )
      return 'This device could not save the change. Keep this screen open, check free space, and retry.';
    if (
      code === 'ERR_INTERNAL_SQLITE_ERROR' ||
      /\bcannot rollback - no transaction is active\b/i.test(error.message)
    )
      return 'This device could not save the change. Keep this screen open and retry.';
  }
  return error instanceof Error
    ? error.message
    : 'The request could not be completed. Your edits are still here.';
}

export function numericInput(value: string, label: string, integer = false): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value.trim()))
    throw new Error(`${label} must be a nonnegative number.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)))
    throw new Error(`${label} must be ${integer ? 'a whole' : 'a valid'} number.`);
  return parsed;
}

export function useCommand(client: InstallationClient) {
  const pending = useRef<{ path: string; body: Record<string, unknown> } | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send<T>(
    path: string,
    command: Record<string, unknown>,
    parse: (value: unknown) => T,
    validate?: (value: unknown) => unknown,
  ): Promise<T | null> {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    setError('');
    const request = pending.current ?? {
      path,
      body: { ...command, operationId: Crypto.randomUUID() },
    };
    try {
      if (!pending.current && validate) validate(request.body);
      pending.current = request;
      const result = parse(await client.request(request.path, request.body, 'POST'));
      pending.current = null;
      return result;
    } catch (failure) {
      if (failure instanceof RequestRejectedError && failure.status >= 400 && failure.status < 500)
        pending.current = null;
      setError(messageOf(failure));
      return null;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { send, busy, error, setError, pending: pending.current !== null };
}
