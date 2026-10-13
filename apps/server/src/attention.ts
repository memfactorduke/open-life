import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  AttentionResponseSchema,
  NotificationPreferencesRecordSchema,
  defaultNotificationPreferences,
  buildTaskAttention,
  attentionDate,
  type AttentionItem,
  type NotificationPreferences,
  type AgentAttempt,
  type AgentResult,
  type TaskStep,
} from '@mems-life/domain';
import { taskFromRow } from './tasks.js';
import { readPreferences, requireOwner, type OwnerPrincipal } from './operations.js';
import { transaction } from './database.js';
import { ApplicationError } from './errors.js';
import { beginMaintenanceWrite, withMaintenanceWrite } from './portability.js';
export async function readAttention(
  pool: Pool,
  actor: OwnerPrincipal,
  now = new Date().toISOString(),
) {
  await requireOwner(pool, actor.userId);
  const timezone = (await readPreferences(pool, actor)).value.timeZone;
  const date = attentionDate(now, timezone);
  const [tasks, steps, attempts, results, sessions, food] = await Promise.all([
    pool.query(
      "SELECT * FROM tasks WHERE owner_id=$1 AND deleted_at IS NULL AND archived_at IS NULL AND phase<>'completed'",
      [actor.userId],
    ),
    pool.query('SELECT value FROM task_steps WHERE owner_id=$1 AND deleted_at IS NULL', [
      actor.userId,
    ]),
    pool.query('SELECT value FROM agent_attempts WHERE owner_id=$1', [actor.userId]),
    pool.query('SELECT value FROM agent_results WHERE owner_id=$1', [actor.userId]),
    pool.query("SELECT value FROM workout_sessions WHERE owner_id=$1 AND status='active'", [
      actor.userId,
    ]),
    pool.query(
      'SELECT value FROM food_entries WHERE owner_id=$1 AND deleted_at IS NULL AND (occurred_at AT TIME ZONE $2)::date=$3::date ORDER BY occurred_at',
      [actor.userId, timezone, date],
    ),
  ]);
  return AttentionResponseSchema.parse({
    now,
    timezone,
    date,
    items: buildTaskAttention(
      tasks.rows.map(taskFromRow),
      steps.rows.map((r) => r.value as TaskStep),
      attempts.rows.map((r) => r.value as AgentAttempt),
      results.rows.map((r) => r.value as AgentResult),
      now,
    ),
    activeSession: sessions.rows[0]?.value ?? null,
    food: { entries: food.rows.map((r) => r.value), count: food.rowCount, route: '/food' },
  });
}
export async function readNotificationPreferences(pool: Pool, actor: OwnerPrincipal) {
  await requireOwner(pool, actor.userId);
  return NotificationPreferencesRecordSchema.parse(
    (
      await pool.query('SELECT revision,value FROM notification_preferences WHERE owner_id=$1', [
        actor.userId,
      ])
    ).rows[0] ?? { revision: 0, value: defaultNotificationPreferences },
  );
}
export async function updateNotificationPreferences(
  pool: Pool,
  actor: OwnerPrincipal,
  command: { operationId: string; expectedRevision: number; value: NotificationPreferences },
  authorize: (client: PoolClient) => Promise<void>,
) {
  return transaction(pool, async (client) => {
    await beginMaintenanceWrite(client);
    await client.query('SELECT id FROM installation WHERE owner_id=$1 FOR UPDATE', [actor.userId]);
    await requireOwner(client, actor.userId);
    await authorize(client);
    const request = { type: 'notifications.preferences', command };
    const receipt = (
      await client.query(
        'SELECT response,request=$3::jsonb AS matches FROM operation_receipts WHERE actor_id=$1 AND operation_id=$2',
        [actor.userId, command.operationId, JSON.stringify(request)],
      )
    ).rows[0];
    if (receipt) {
      if (!receipt.matches)
        throw new ApplicationError(
          409,
          'OPERATION_ID_REUSED',
          'This operation was reused with different content.',
        );
      return receipt.response;
    }
    await client.query(
      'INSERT INTO notification_preferences(owner_id) VALUES($1) ON CONFLICT DO NOTHING',
      [actor.userId],
    );
    const current = (
      await client.query(
        'SELECT revision FROM notification_preferences WHERE owner_id=$1 FOR UPDATE',
        [actor.userId],
      )
    ).rows[0];
    if (current.revision !== command.expectedRevision)
      throw new ApplicationError(
        409,
        'REVISION_CONFLICT',
        'Notification preferences changed. Refresh first.',
      );
    const record = { revision: current.revision + 1, value: command.value };
    await client.query(
      'UPDATE notification_preferences SET revision=$2,value=$3 WHERE owner_id=$1',
      [actor.userId, record.revision, record.value],
    );
    // Disabling retires tokens. Re-enabling requires current-session registration.
    if (!record.value.enabled)
      await client.query('UPDATE notification_devices SET active=false WHERE owner_id=$1', [
        actor.userId,
      ]);
    await client.query(
      "INSERT INTO audit_events(actor_id,actor_type,operation_id,event_type,record_id,revision,value) VALUES($1,'owner',$2,'notifications.preferences',$1,$3,$4)",
      [actor.userId, command.operationId, record.revision, record],
    );
    await client.query(
      'INSERT INTO operation_receipts(actor_id,operation_id,request,response) VALUES($1,$2,$3,$4)',
      [actor.userId, command.operationId, request, record],
    );
    return record;
  });
}
export async function registerNotificationDevice(
  pool: Pool,
  actor: OwnerPrincipal,
  sessionId: string,
  input: { deviceId: string; token: string; expectedPreferenceRevision: number },
  authorize: (client: PoolClient) => Promise<void>,
) {
  return transaction(pool, async (client) => {
    await beginMaintenanceWrite(client);
    await client.query('SELECT id FROM installation WHERE owner_id=$1 FOR UPDATE', [actor.userId]);
    await requireOwner(client, actor.userId);
    await authorize(client);
    const session = (
      await client.query(
        'SELECT id FROM session WHERE id=$1 AND "userId"=$2 AND "expiresAt">now() FOR SHARE',
        [sessionId, actor.userId],
      )
    ).rows[0];
    if (!session)
      throw new ApplicationError(
        401,
        'SESSION_REQUIRED',
        'Sign in again before registering notifications.',
      );
    const preferences = (
      await client.query('SELECT revision,value FROM notification_preferences WHERE owner_id=$1', [
        actor.userId,
      ])
    ).rows[0];
    if (!preferences?.value.enabled || preferences.revision !== input.expectedPreferenceRevision)
      throw new ApplicationError(
        409,
        'NOTIFICATIONS_DISABLED',
        'Enable notifications using the current preferences first.',
      );
    const foreign = (
      await client.query(
        'SELECT id FROM notification_devices WHERE (id=$1 OR token=$2) AND owner_id<>$3',
        [input.deviceId, input.token, actor.userId],
      )
    ).rowCount;
    if (foreign)
      throw new ApplicationError(
        403,
        'DEVICE_OWNERSHIP',
        'This notification device belongs to another owner.',
      );
    const existing = (
      await client.query('SELECT id FROM notification_devices WHERE token=$1 AND id<>$2', [
        input.token,
        input.deviceId,
      ])
    ).rowCount;
    if (existing)
      throw new ApplicationError(
        409,
        'TOKEN_REGISTERED',
        'This token is registered to another device.',
      );
    await client.query(
      'INSERT INTO notification_devices(id,owner_id,session_id,token) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id,token=excluded.token,active=true,registered_at=now() WHERE notification_devices.owner_id=excluded.owner_id',
      [input.deviceId, actor.userId, sessionId, input.token],
    );
    return { deviceId: input.deviceId, active: true };
  });
}
export async function deactivateNotificationDevice(
  pool: Pool,
  actor: OwnerPrincipal,
  id: string,
  authorize: (client: PoolClient) => Promise<void>,
) {
  return transaction(pool, async (client) => {
    await beginMaintenanceWrite(client);
    await requireOwner(client, actor.userId);
    await authorize(client);
    await client.query('UPDATE notification_devices SET active=false WHERE owner_id=$1 AND id=$2', [
      actor.userId,
      id,
    ]);
    return { deviceId: id, active: false };
  });
}
export function notificationCategory(item: AttentionItem): 'due' | 'handoff' | 'failure' | null {
  return item.kind === 'due'
    ? 'due'
    : ['handoff', 'review'].includes(item.kind)
      ? 'handoff'
      : ['failure', 'outcome-unknown'].includes(item.kind)
        ? 'failure'
        : null;
}
export function privateNotification(item: AttentionItem, token: string) {
  return {
    to: token,
    title: 'Mem’s Life',
    body: 'An item needs your attention. Open the app to review it.',
    data: { route: item.route },
    sound: 'default' as const,
  };
}
export interface PushProvider {
  send(messages: ReturnType<typeof privateNotification>[]): Promise<PushResult[]>;
  receipts(ids: string[]): Promise<Record<string, PushResult>>;
}
export type PushResult = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};
export class ExpoPushProvider implements PushProvider {
  constructor(
    private accessToken?: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetcher(`https://exp.host/--/api/v2/push/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = new Error(`Expo HTTP ${response.status}`) as Error & { retryable?: boolean };
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    const result = (await response.json()) as { data?: unknown; errors?: unknown };
    if (result.errors || !result.data) throw new Error('Expo returned an invalid response.');
    return result.data;
  }
  async send(messages: ReturnType<typeof privateNotification>[]) {
    if (messages.length > 100) throw new Error('Expo batches must contain at most 100 messages.');
    const data = await this.request('send', messages);
    if (!Array.isArray(data) || data.length !== messages.length)
      throw new Error('Expo ticket count does not match message count.');
    return validatePushResults(data);
  }
  async receipts(ids: string[]) {
    if (ids.length > 100) throw new Error('Receipt batch exceeds 100.');
    const data = await this.request('getReceipts', { ids });
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('Invalid Expo receipts.');
    const entries = Object.entries(data);
    return Object.fromEntries(
      entries.map(([id, result]) => [id, validatePushResults([result])[0]!]),
    );
  }
}
function validatePushResults(values: unknown[]): PushResult[] {
  return values.map((value) => {
    const result = value as PushResult;
    if (
      !result ||
      !['ok', 'error'].includes(result.status) ||
      (result.id !== undefined && typeof result.id !== 'string')
    )
      throw new Error('Invalid Expo ticket or receipt.');
    return result;
  });
}
/** Durable events exist independently of provider configuration, permission and delivery. */
export async function reconcileAttention(
  pool: Pool,
  provider?: PushProvider,
  now = new Date().toISOString(),
) {
  return withMaintenanceWrite(pool, () => reconcileAttentionUnlocked(pool, provider, now));
}
async function reconcileAttentionUnlocked(
  pool: Pool,
  provider: PushProvider | undefined,
  now: string,
) {
  const owner = (await pool.query('SELECT owner_id,id FROM installation')).rows[0];
  if (!owner) return;
  const attention = await readAttention(
    pool,
    { userId: owner.owner_id, installationId: owner.id },
    now,
  );
  await transaction(pool, async (client) => {
    await beginMaintenanceWrite(client);
    await client.query('SELECT pg_advisory_xact_lock(7311026)');
    await client.query('UPDATE attention_events SET active=false WHERE owner_id=$1', [
      owner.owner_id,
    ]);
    for (const item of attention.items.filter((item) => notificationCategory(item)))
      await client.query(
        'INSERT INTO attention_events(id,owner_id,dedupe_key,source_id,source_revision,value) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,dedupe_key) DO UPDATE SET active=true,source_id=excluded.source_id,source_revision=excluded.source_revision,value=excluded.value',
        [randomUUID(), owner.owner_id, item.dedupeKey, item.sourceId, item.sourceRevision, item],
      );
    await client.query(
      'UPDATE notification_devices d SET active=false WHERE owner_id=$1 AND active AND NOT EXISTS(SELECT 1 FROM session s WHERE s.id=d.session_id AND s."userId"=d.owner_id AND s."expiresAt">now())',
      [owner.owner_id],
    );
  });
  if (!provider) return;
  const preferences = await readNotificationPreferences(pool, {
    userId: owner.owner_id,
    installationId: owner.id,
  });
  if (preferences.value.enabled) {
    const devices = (
      await pool.query('SELECT id FROM notification_devices WHERE owner_id=$1 AND active', [
        owner.owner_id,
      ])
    ).rows;
    const events = (
      await pool.query('SELECT id,value FROM attention_events WHERE owner_id=$1 AND active', [
        owner.owner_id,
      ])
    ).rows;
    for (const event of events) {
      const category = notificationCategory(event.value);
      if (!category || !preferences.value[category]) continue;
      for (const device of devices)
        await pool.query(
          "INSERT INTO notification_deliveries(event_id,device_id,status,next_attempt_at) VALUES($1,$2,'pending',$3) ON CONFLICT DO NOTHING",
          [event.id, device.id, now],
        );
    }
  }
  await deliverNotifications(pool, provider, now);
}
export async function deliverNotifications(
  pool: Pool,
  provider: PushProvider,
  now = new Date().toISOString(),
) {
  // One worker per installation; hold a transaction lock across a bounded provider request.
  return transaction(pool, async (client) => {
    await beginMaintenanceWrite(client);
    if (!(await client.query('SELECT pg_try_advisory_xact_lock(7311028) AS locked')).rows[0].locked)
      return;
    await client.query(
      "UPDATE notification_deliveries n SET status='suppressed' FROM notification_devices d,attention_events e WHERE n.device_id=d.id AND n.event_id=e.id AND n.status='pending' AND e.owner_id=d.owner_id AND EXISTS(SELECT 1 FROM installation i WHERE i.owner_id=d.owner_id) AND (NOT d.active OR NOT e.active)",
    );
    const pending = (
      await client.query(
        'SELECT n.*,d.token,e.value,p.value AS preferences FROM notification_deliveries n JOIN notification_devices d ON d.id=n.device_id JOIN attention_events e ON e.id=n.event_id AND e.owner_id=d.owner_id JOIN notification_preferences p ON p.owner_id=d.owner_id JOIN session s ON s.id=d.session_id AND s."userId"=d.owner_id AND s."expiresAt">now() WHERE n.status=\'pending\' AND d.active AND e.active AND EXISTS(SELECT 1 FROM installation i WHERE i.owner_id=d.owner_id) AND n.next_attempt_at<=$1 LIMIT 100 FOR UPDATE OF n FOR SHARE OF d,p,s',
        [now],
      )
    ).rows;
    const allowed = pending.filter(
      (r) => r.preferences.enabled && r.preferences[notificationCategory(r.value)!],
    );
    for (const row of pending.filter((r) => !allowed.includes(r)))
      await client.query(
        "UPDATE notification_deliveries SET status='suppressed' WHERE event_id=$1 AND device_id=$2",
        [row.event_id, row.device_id],
      );
    if (allowed.length) {
      try {
        const tickets = await provider.send(
          allowed.map((r) => privateNotification(r.value, r.token)),
        );
        if (tickets.length !== allowed.length)
          throw new Error('Provider returned mismatched ticket count.');
        if (
          tickets.some(
            (ticket) =>
              !ticket ||
              !['ok', 'error'].includes(ticket.status) ||
              (ticket.status === 'ok' && !ticket.id),
          )
        )
          throw new Error('Provider returned an invalid ticket.');
        for (let i = 0; i < allowed.length; i++) {
          const row = allowed[i]!,
            ticket = tickets[i]!;
          if (ticket.status === 'ok' && !ticket.id)
            throw new Error('Provider accepted ticket without receipt ID.');
          await saveDelivery(
            client,
            row,
            ticket,
            ticket.status === 'ok' ? 'accepted' : 'errored',
            now,
          );
        }
      } catch (error) {
        for (const row of allowed) await retryDelivery(client, row, error, now);
      }
    }
    const accepted = (
      await client.query(
        "SELECT n.* FROM notification_deliveries n JOIN attention_events e ON e.id=n.event_id JOIN installation i ON i.owner_id=e.owner_id WHERE n.status='accepted' AND n.next_attempt_at<=$1 LIMIT 100 FOR UPDATE OF n",
        [now],
      )
    ).rows;
    if (accepted.length)
      try {
        const receipts = await provider.receipts(accepted.map((r) => r.ticket_id));
        for (const row of accepted) {
          const receipt = receipts[row.ticket_id];
          if (!receipt) {
            if (row.attempts >= 6)
              await saveDelivery(
                client,
                row,
                { status: 'error', message: 'Receipt unavailable after repeated checks.' },
                'errored',
                now,
              );
            else
              await client.query(
                "UPDATE notification_deliveries SET attempts=attempts+1,next_attempt_at=$3::timestamptz+interval '15 minutes' WHERE event_id=$1 AND device_id=$2",
                [row.event_id, row.device_id, now],
              );
          } else
            await saveDelivery(
              client,
              row,
              receipt,
              receipt.status === 'ok' ? 'provider-accepted' : 'errored',
              now,
            );
        }
      } catch (error) {
        for (const row of accepted) await retryDelivery(client, row, error, now, true);
      }
  });
}
async function saveDelivery(
  client: PoolClient,
  row: Record<string, unknown>,
  result: PushResult,
  status: string,
  now: string,
) {
  await client.query(
    "UPDATE notification_deliveries SET status=$3,attempts=attempts+1,ticket_id=COALESCE($4,ticket_id),error=$5,next_attempt_at=$6::timestamptz+interval '15 minutes' WHERE event_id=$1 AND device_id=$2",
    [
      row.event_id,
      row.device_id,
      status,
      result.id ?? null,
      result.details?.error ?? result.message ?? null,
      now,
    ],
  );
  if (result.details?.error === 'DeviceNotRegistered')
    await client.query('UPDATE notification_devices SET active=false,token=$2 WHERE id=$1', [
      row.device_id,
      `retired:${randomUUID()}`,
    ]);
}
async function retryDelivery(
  client: PoolClient,
  row: Record<string, unknown>,
  error: unknown,
  now: string,
  receipt = false,
) {
  const retryable =
    !(error instanceof Error) ||
    !('retryable' in error) ||
    (error as Error & { retryable: boolean }).retryable;
  const attempts = Number(row.attempts) + 1;
  await client.query(
    "UPDATE notification_deliveries SET status=$3,attempts=$4,error=$5,next_attempt_at=$6::timestamptz+($7::integer * interval '1 second') WHERE event_id=$1 AND device_id=$2",
    [
      row.event_id,
      row.device_id,
      retryable && attempts < 6 ? (receipt ? 'accepted' : 'pending') : 'errored',
      attempts,
      error instanceof Error ? error.message : 'Provider request failed',
      now,
      Math.min(3600, 30 * 2 ** attempts),
    ],
  );
}
