import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  WhoopCommandSchema,
  WhoopStateSchema,
  whoopWindow,
  type WhoopCommand,
  type WhoopResource,
} from '@mems-life/domain';
import { transaction } from './database.js';
import { assertOperationIdAvailable, requireOwner, type OwnerPrincipal } from './operations.js';
import { ApplicationError } from './errors.js';
export type WhoopConfig = {
  WHOOP_CLIENT_ID?: string | undefined;
  WHOOP_CLIENT_SECRET?: string | undefined;
  WHOOP_REDIRECT_URI?: string | undefined;
  WHOOP_TOKEN_KEY?: string | undefined;
  NATIVE_SCHEME?: string | undefined;
};
type WhoopConnectionRow = {
  owner_id: string;
  account_id: string;
  provider_account_id: string;
  status: string;
  tokens: string | null;
  next_refresh_at: Date | string | null;
  connected_at: Date | string;
};
export const WHOOP_SCOPES =
  'read:profile read:workout read:cycles read:recovery read:sleep offline';
const BASE = 'https://api.prod.whoop.com/developer/v2/';
const TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
const paths: Record<WhoopResource, string> = {
  workout: 'activity/workout',
  cycle: 'cycle',
  recovery: 'recovery',
  sleep: 'activity/sleep',
};
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;
export function whoopConfigured(c: WhoopConfig) {
  return Boolean(
    c.WHOOP_CLIENT_ID &&
    c.WHOOP_CLIENT_SECRET &&
    c.WHOOP_REDIRECT_URI?.startsWith('https://') &&
    c.WHOOP_TOKEN_KEY?.match(/^[a-f\d]{64}$/i),
  );
}
export function encryptWhoopTokens(value: unknown, key: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((v) => v.toString('base64')).join('.');
}
function decrypt(value: string, key: string) {
  const [iv, tag, data] = value.split('.').map((v) => Buffer.from(v, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv!);
  cipher.setAuthTag(tag!);
  return JSON.parse(Buffer.concat([cipher.update(data!), cipher.final()]).toString()) as {
    access_token: string;
    refresh_token: string;
  };
}
class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly retry = 3600,
  ) {
    super(
      status === 401
        ? 'WHOOP consent must be renewed.'
        : status === 429
          ? 'WHOOP rate limit reached.'
          : 'WHOOP could not refresh observations.',
    );
  }
}
export class WhoopService {
  constructor(
    readonly pool: Pool,
    readonly config: WhoopConfig,
    readonly fetcher: typeof fetch = fetch,
    readonly now: () => Date = () => new Date(),
  ) {}
  private async request(path: string, token: string, method = 'GET') {
    const r = await this.fetcher(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok)
      throw new ProviderError(
        r.status,
        Math.max(3600, Number(r.headers.get('retry-after')) || 3600),
      );
    return r.status === 204 ? null : ((await r.json()) as Record<string, unknown>);
  }
  private async token(params: Record<string, string>) {
    const r = await this.fetcher(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...params,
        client_id: this.config.WHOOP_CLIENT_ID!,
        client_secret: this.config.WHOOP_CLIENT_SECRET!,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const failure = (await r.json().catch(() => null)) as { error?: string } | null;
      throw new ProviderError(failure?.error === 'invalid_grant' ? 401 : r.status);
    }
    const t = (await r.json()) as Record<string, unknown>;
    if (
      typeof t.access_token !== 'string' ||
      typeof t.refresh_token !== 'string' ||
      typeof t.expires_in !== 'number' ||
      t.expires_in <= 0
    )
      throw new ProviderError(502);
    return t as { access_token: string; refresh_token: string; expires_in: number };
  }
  private async access(_client: PoolClient, row: WhoopConnectionRow) {
    const credentials = (
      await this.pool.query('SELECT * FROM whoop_credentials WHERE owner_id=$1 AND account_id=$2', [
        row.owner_id,
        row.account_id,
      ])
    ).rows[0];
    if (!credentials) throw new ProviderError(401);
    let t = decrypt(credentials.tokens, this.config.WHOOP_TOKEN_KEY!);
    if (new Date(credentials.expires_at).getTime() <= this.now().getTime() + 30000) {
      const rotated = await this.token({
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
        scope: 'offline',
      });
      // Connection-row lock serializes all refresh/disconnect/replacement. The independent credential update
      // commits rotated tokens before observation writes, so a later observation rollback cannot lose them.
      await this.pool.query(
        'UPDATE whoop_credentials SET tokens=$3,expires_at=$4 WHERE owner_id=$1 AND account_id=$2',
        [
          row.owner_id,
          row.account_id,
          encryptWhoopTokens(rotated, this.config.WHOOP_TOKEN_KEY!),
          new Date(this.now().getTime() + rotated.expires_in * 1000),
        ],
      );
      t = rotated;
    }
    return t.access_token;
  }

  async read(actor: OwnerPrincipal) {
    await requireOwner(this.pool, actor.userId);
    return this.state(this.pool, actor.userId);
  }
  private async state(client: Pool | PoolClient, ownerId: string) {
    const row = (await client.query('SELECT * FROM whoop_connection WHERE owner_id=$1', [ownerId]))
      .rows[0];
    const observations = (
      await client.query(
        'SELECT * FROM whoop_observations WHERE owner_id=$1 ORDER BY retrieved_at DESC,provider_id',
        [ownerId],
      )
    ).rows.map((r) => ({
      accountId: r.account_id,
      providerAccountId: r.provider_account_id,
      resource: r.resource,
      providerId: r.provider_id,
      revision: r.revision,
      providerUpdatedAt: iso(r.payload.updated_at) ?? '',
      start: iso(r.payload.start),
      end: iso(r.payload.end),
      timezoneOffset: r.payload.timezone_offset ?? null,
      retrievedAt: iso(r.retrieved_at),
      scoreState: r.payload.score_state ?? 'MISSING',
      score: r.payload.score_state === 'SCORED' ? (r.payload.score ?? null) : null,
      available: r.available,
      currentAccount: row?.status === 'connected' && row.account_id === r.account_id,
      linkedSessionId: r.linked_session_id,
    }));
    return WhoopStateSchema.parse({
      configured: whoopConfigured(this.config),
      revision: row?.revision ?? 0,
      status: whoopConfigured(this.config) ? (row?.status ?? 'disconnected') : 'unconfigured',
      accountId: row?.account_id ?? null,
      providerAccountId: row?.provider_account_id ?? null,
      lastSuccessAt: iso(row?.last_success_at),
      lastAttemptAt: iso(row?.last_attempt_at),
      nextRefreshAt: iso(row?.next_refresh_at),
      error: row?.error ?? null,
      stale:
        !row?.last_success_at ||
        this.now().getTime() - new Date(row.last_success_at).getTime() > 3600000,
      observations,
    });
  }
  private async saveObservation(
    client: PoolClient,
    row: WhoopConnectionRow,
    resource: WhoopResource,
    payload: Record<string, unknown>,
  ) {
    const id = resource === 'recovery' ? payload.cycle_id : payload.id;
    if (id === undefined || String(payload.user_id) !== row.provider_account_id)
      throw new ProviderError(502);
    await client.query(
      `INSERT INTO whoop_observations(owner_id,account_id,provider_account_id,resource,provider_id,payload,retrieved_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,account_id,resource,provider_id) DO UPDATE SET payload=CASE WHEN excluded.payload->>'updated_at'>=whoop_observations.payload->>'updated_at' THEN excluded.payload ELSE whoop_observations.payload END,revision=whoop_observations.revision+1,retrieved_at=excluded.retrieved_at,available=true`,
      [
        row.owner_id,
        row.account_id,
        row.provider_account_id,
        resource,
        String(id),
        payload,
        this.now(),
      ],
    );
  }
  private targeted(resource: WhoopResource, id: string) {
    return resource === 'recovery'
      ? `cycle/${encodeURIComponent(id)}/recovery`
      : `${paths[resource]}/${encodeURIComponent(id)}`;
  }
  private async sync(
    client: PoolClient,
    row: WhoopConnectionRow,
    target?: { resource: WhoopResource; providerId: string },
  ) {
    if (row.status !== 'connected' || !row.tokens)
      throw new ApplicationError(409, 'WHOOP_DISCONNECTED', 'Connect WHOOP before refreshing.');
    if (row.next_refresh_at && new Date(row.next_refresh_at) > this.now())
      throw new ApplicationError(429, 'WHOOP_THROTTLED', 'Refresh is limited to once an hour.');
    const next = new Date(this.now().getTime() + 3600000);
    await client.query(
      'UPDATE whoop_connection SET last_attempt_at=$2,next_refresh_at=$3 WHERE owner_id=$1',
      [row.owner_id, this.now(), next],
    );
    try {
      const token = await this.access(client, row);
      const profile = await this.request('user/profile/basic', token);
      if (String(profile?.user_id) !== row.provider_account_id) throw new ProviderError(401);
      if (target) {
        try {
          await this.saveObservation(
            client,
            row,
            target.resource,
            (await this.request(
              this.targeted(target.resource, target.providerId),
              token,
            )) as Record<string, unknown>,
          );
        } catch (e) {
          if (e instanceof ProviderError && e.status === 404) {
            await client.query(
              'UPDATE whoop_observations SET available=false,linked_session_id=null,revision=revision+1,retrieved_at=$5 WHERE owner_id=$1 AND account_id=$2 AND resource=$3 AND provider_id=$4',
              [row.owner_id, row.account_id, target.resource, target.providerId, this.now()],
            );
          } else throw e;
        }
      } else {
        const lower = whoopWindow(new Date(row.connected_at), this.now());
        for (const resource of Object.keys(paths) as WhoopResource[]) {
          let cursor: string | undefined;
          const seen = new Set<string>();
          let pages = 0;
          do {
            if (++pages > 100) throw new ProviderError(502);
            const q = new URLSearchParams({
              limit: '25',
              start: lower.toISOString(),
              end: this.now().toISOString(),
              ...(cursor ? { nextToken: cursor } : {}),
            });
            const data = (await this.request(`${paths[resource]}?${q}`, token)) as {
              records: Record<string, unknown>[];
              next_token?: string;
            };
            if (!Array.isArray(data.records)) throw new ProviderError(502);
            for (const p of data.records) await this.saveObservation(client, row, resource, p);
            cursor = data.next_token;
            if (cursor) {
              if (seen.has(cursor)) throw new ProviderError(502);
              seen.add(cursor);
            }
          } while (cursor);
        }
        // Latest cycle can start before the bounded window; never backfill other collections.
        const current = (await this.request('cycle?limit=1', token)) as {
          records: Record<string, unknown>[];
        };
        if (current.records?.[0])
          await this.saveObservation(client, row, 'cycle', current.records[0]);
        const known = (
          await client.query(
            "SELECT resource,provider_id FROM whoop_observations WHERE owner_id=$1 AND account_id=$2 AND (payload->>'start'>=$3 OR resource='recovery' AND payload->>'updated_at'>=$3)",
            [row.owner_id, row.account_id, lower.toISOString()],
          )
        ).rows;
        for (const item of known) {
          try {
            await this.saveObservation(
              client,
              row,
              item.resource,
              (await this.request(this.targeted(item.resource, item.provider_id), token)) as Record<
                string,
                unknown
              >,
            );
          } catch (e) {
            if (e instanceof ProviderError && e.status === 404)
              await client.query(
                'UPDATE whoop_observations SET available=false,linked_session_id=null,revision=revision+1,retrieved_at=$5 WHERE owner_id=$1 AND account_id=$2 AND resource=$3 AND provider_id=$4',
                [row.owner_id, row.account_id, item.resource, item.provider_id, this.now()],
              );
            else throw e;
          }
        }
      }
      await client.query(
        'UPDATE whoop_connection SET last_success_at=$2,error=null WHERE owner_id=$1',
        [row.owner_id, this.now()],
      );
    } catch (e) {
      const status = e instanceof ProviderError && e.status === 401 ? 'reconnect' : 'connected';
      await client.query(
        'UPDATE whoop_connection SET status=$2,error=$3,next_refresh_at=$4 WHERE owner_id=$1',
        [
          row.owner_id,
          status,
          e instanceof ProviderError ? e.message : 'WHOOP could not refresh observations.',
          new Date(this.now().getTime() + (e instanceof ProviderError ? e.retry : 3600) * 1000),
        ],
      );
    }
  }
  private async event(
    client: PoolClient,
    ownerId: string,
    operationId: string,
    type: string,
    actorType = 'owner',
  ) {
    const state = await this.state(client, ownerId);
    await client.query(
      'INSERT INTO whoop_history(owner_id,actor_type,operation_id,event_type,value) VALUES($1,$2,$3,$4,$5)',
      [ownerId, actorType, operationId, type, state],
    );
    const feed = (
      await client.query(
        'UPDATE installation SET feed_position=feed_position+1 WHERE owner_id=$1 RETURNING feed_position',
        [ownerId],
      )
    ).rows[0].feed_position as string;
    await client.query(
      "INSERT INTO change_feed(owner_id,position,operation_id,record_type,record_id,revision,value) VALUES($1,$2,$3,'connection',$1,$4,$5)",
      [ownerId, feed, operationId, state.revision, state],
    );
    await client.query(
      'INSERT INTO audit_events(actor_id,actor_type,operation_id,event_type,record_id,revision,value) VALUES($1,$2,$3,$4,$1,$5,$6)',
      [ownerId, actorType, operationId, type, state.revision, state],
    );
    return { state, feedPosition: feed, operationId };
  }
  async command(
    actor: OwnerPrincipal,
    input: WhoopCommand,
    sessionId: string,
    authorize: (client: PoolClient) => Promise<void>,
  ) {
    const command = WhoopCommandSchema.parse(input);
    return transaction(this.pool, async (client) => {
      await requireOwner(client, actor.userId);
      await authorize(client);
      await requireOwner(client, actor.userId, actor.expectedEpoch);
      const receipt = (
        await client.query(
          'SELECT response,request=$3::jsonb AS matches FROM operation_receipts WHERE actor_id=$1 AND operation_id=$2',
          [actor.userId, command.operationId, JSON.stringify(command)],
        )
      ).rows[0];
      if (receipt) {
        if (!receipt.matches)
          throw new ApplicationError(
            409,
            'OPERATION_ID_REUSED',
            'Operation ID was used for another change.',
          );
        return receipt.response;
      }
      await assertOperationIdAvailable(client, actor.userId, command.operationId);
      if (
        !(
          await client.query('SELECT owner_id FROM whoop_connection WHERE owner_id=$1', [
            actor.userId,
          ])
        ).rowCount
      )
        await client.query(
          'INSERT INTO whoop_connection(owner_id) VALUES($1) ON CONFLICT DO NOTHING',
          [actor.userId],
        );
      const row = (
        await client.query(
          'SELECT * FROM whoop_connection WHERE owner_id=$1 FOR UPDATE SKIP LOCKED',
          [actor.userId],
        )
      ).rows[0];
      if (!row)
        throw new ApplicationError(
          409,
          'WHOOP_BUSY',
          'Another WHOOP operation is in progress. Retry shortly.',
        );
      if (row.revision !== command.expectedRevision)
        throw new ApplicationError(
          409,
          'REVISION_CONFLICT',
          'WHOOP changed. Reload before saving.',
        );
      let authorizationUrl: string | undefined,
        revocation: 'succeeded' | 'failed' | 'not-connected' | undefined;
      if (command.type === 'whoop.connect') {
        if (!whoopConfigured(this.config))
          throw new ApplicationError(
            409,
            'WHOOP_UNCONFIGURED',
            'The operator must configure WHOOP privately first.',
          );
        const state = randomBytes(6).toString('base64url');
        await client.query('DELETE FROM whoop_states WHERE owner_id=$1 OR expires_at<now()', [
          actor.userId,
        ]);
        await client.query(
          'INSERT INTO whoop_states(state_hash,owner_id,session_id,channel,expires_at) VALUES($1,$2,$3,$4,$5)',
          [
            createHash('sha256').update(state).digest('hex'),
            actor.userId,
            sessionId,
            command.channel,
            new Date(this.now().getTime() + 600000),
          ],
        );
        await client.query('UPDATE whoop_connection SET pending_state=$2 WHERE owner_id=$1', [
          actor.userId,
          createHash('sha256').update(state).digest('hex'),
        ]);
        const q = new URLSearchParams({
          client_id: this.config.WHOOP_CLIENT_ID!,
          redirect_uri: this.config.WHOOP_REDIRECT_URI!,
          response_type: 'code',
          scope: WHOOP_SCOPES,
          state,
        });
        authorizationUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?${q}`;
      } else if (command.type === 'whoop.disconnect') {
        revocation = 'not-connected';
        if (row.tokens) {
          try {
            const token = await this.access(client, row);
            await this.request('user/access', token, 'DELETE');
            revocation = 'succeeded';
          } catch {
            revocation = 'failed';
          }
        }
        await client.query(
          "UPDATE whoop_connection SET status='disconnected',pending_state=null,tokens=null,expires_at=null,next_refresh_at=null,error=$2 WHERE owner_id=$1",
          [
            actor.userId,
            revocation === 'failed'
              ? 'Disconnected locally; remote revocation failed. Remove access in WHOOP settings.'
              : null,
          ],
        );
        await client.query('DELETE FROM whoop_states WHERE owner_id=$1', [actor.userId]);
        await client.query('DELETE FROM whoop_credentials WHERE owner_id=$1', [actor.userId]);
      } else if (command.type === 'whoop.delete-cache') {
        await client.query('DELETE FROM whoop_observations WHERE owner_id=$1', [actor.userId]);
      } else if (command.type === 'whoop.link') {
        if (row.status !== 'connected')
          throw new ApplicationError(409, 'WHOOP_DISCONNECTED', 'Reconnect before linking.');
        if (
          command.sessionId &&
          !(
            await client.query('SELECT id FROM workout_sessions WHERE owner_id=$1 AND id=$2', [
              actor.userId,
              command.sessionId,
            ])
          ).rowCount
        )
          throw new ApplicationError(404, 'NOT_FOUND', 'Session not found.');
        if (
          command.sessionId &&
          (
            await client.query(
              'SELECT provider_id FROM whoop_observations WHERE owner_id=$1 AND account_id=$2 AND linked_session_id=$3 AND provider_id<>$4',
              [actor.userId, row.account_id, command.sessionId, command.providerId],
            )
          ).rowCount
        )
          throw new ApplicationError(
            409,
            'WHOOP_LINK_EXISTS',
            'This session is already linked to another WHOOP workout. Unlink it first.',
          );
        const changed = await client.query(
          "UPDATE whoop_observations SET linked_session_id=$4,revision=revision+1 WHERE owner_id=$1 AND account_id=$2 AND resource='workout' AND provider_id=$3 AND available=true",
          [actor.userId, row.account_id, command.providerId, command.sessionId],
        );
        if (!changed.rowCount)
          throw new ApplicationError(404, 'NOT_FOUND', 'WHOOP workout not found.');
      } else
        await this.sync(
          client,
          row,
          command.type === 'whoop.refresh-observation' ? command : undefined,
        );
      await client.query('UPDATE whoop_connection SET revision=revision+1 WHERE owner_id=$1', [
        actor.userId,
      ]);
      const result = {
        ...(await this.event(client, actor.userId, command.operationId, command.type)),
        ...(authorizationUrl ? { authorizationUrl } : {}),
        ...(revocation ? { revocation } : {}),
      };
      await client.query(
        'INSERT INTO operation_receipts(actor_id,operation_id,request,response) VALUES($1,$2,$3,$4)',
        [actor.userId, command.operationId, command, result],
      );
      return result;
    });
  }
  async nativeReturn(state: string, code: string) {
    const valid = (
      await this.pool.query(
        "SELECT state_hash FROM whoop_states WHERE state_hash=$1 AND channel='native' AND expires_at>$2",
        [createHash('sha256').update(state).digest('hex'), this.now()],
      )
    ).rowCount;
    if (!valid) return null;
    return `${this.config.NATIVE_SCHEME ?? 'memslife'}://whoop-callback?${new URLSearchParams({ state, code })}`;
  }
  async callback(
    actor: OwnerPrincipal,
    sessionId: string,
    state: string,
    code: string,
    authorize: (client: PoolClient) => Promise<void>,
  ) {
    // Commit nonce consumption before contacting the provider. Any failed exchange requires new consent.
    await transaction(this.pool, async (client) => {
      await requireOwner(client, actor.userId);
      await authorize(client);
      await requireOwner(client, actor.userId, actor.expectedEpoch);
      const valid = await client.query(
        'DELETE FROM whoop_states WHERE state_hash=$1 AND owner_id=$2 AND session_id=$3 AND expires_at>$4 RETURNING owner_id',
        [createHash('sha256').update(state).digest('hex'), actor.userId, sessionId, this.now()],
      );
      if (!valid.rowCount)
        throw new ApplicationError(
          400,
          'WHOOP_STATE_INVALID',
          'WHOOP consent expired or belongs to another session.',
        );
    });
    return transaction(this.pool, async (client) => {
      await requireOwner(client, actor.userId);
      await authorize(client);
      await requireOwner(client, actor.userId, actor.expectedEpoch);
      const pending = (
        await client.query(
          'SELECT pending_state FROM whoop_connection WHERE owner_id=$1 FOR UPDATE SKIP LOCKED',
          [actor.userId],
        )
      ).rows[0];
      if (pending?.pending_state !== createHash('sha256').update(state).digest('hex'))
        throw new ApplicationError(
          409,
          'WHOOP_CONSENT_CANCELLED',
          'WHOOP consent was cancelled. Start a new connection.',
        );
      const t = await this.token({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.WHOOP_REDIRECT_URI!,
      });
      const profile = await this.request('user/profile/basic', t.access_token);
      if (!profile || typeof profile.user_id !== 'number') throw new ProviderError(502);
      // Consent can outlive the session while the provider responds. Recheck before
      // replacing the connected account or storing the newly issued credentials.
      await authorize(client);
      await requireOwner(client, actor.userId, actor.expectedEpoch);
      await client.query(
        "UPDATE whoop_connection SET revision=revision+1,status='connected',pending_state=null,account_id=$2,provider_account_id=$3,connected_at=$4,tokens=$5,expires_at=$6,last_success_at=null,last_attempt_at=null,next_refresh_at=null,error=null WHERE owner_id=$1",
        [
          actor.userId,
          randomUUID(),
          String(profile.user_id),
          this.now(),
          encryptWhoopTokens(t, this.config.WHOOP_TOKEN_KEY!),
          new Date(this.now().getTime() + t.expires_in * 1000),
        ],
      );
      const connected = (
        await client.query('SELECT account_id FROM whoop_connection WHERE owner_id=$1', [
          actor.userId,
        ])
      ).rows[0];
      await client.query(
        'INSERT INTO whoop_credentials(owner_id,account_id,tokens,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO UPDATE SET account_id=excluded.account_id,tokens=excluded.tokens,expires_at=excluded.expires_at',
        [
          actor.userId,
          connected.account_id,
          encryptWhoopTokens(t, this.config.WHOOP_TOKEN_KEY!),
          new Date(this.now().getTime() + t.expires_in * 1000),
        ],
      );
      return this.event(client, actor.userId, randomUUID(), 'whoop.connected');
    });
  }

  async poll() {
    if (!whoopConfigured(this.config)) return;
    const rows = (
      await this.pool.query(
        "SELECT owner_id FROM whoop_connection WHERE status='connected' AND (next_refresh_at IS NULL OR next_refresh_at<=now())",
      )
    ).rows;
    for (const { owner_id } of rows)
      await transaction(this.pool, async (client) => {
        await requireOwner(client, owner_id);
        const row = (
          await client.query(
            'SELECT * FROM whoop_connection WHERE owner_id=$1 FOR UPDATE SKIP LOCKED',
            [owner_id],
          )
        ).rows[0];
        if (
          !row ||
          row.status !== 'connected' ||
          (row.next_refresh_at && new Date(row.next_refresh_at) > this.now())
        )
          return;
        await this.sync(client, row);
        await client.query('UPDATE whoop_connection SET revision=revision+1 WHERE owner_id=$1', [
          owner_id,
        ]);
        await this.event(client, owner_id, randomUUID(), 'whoop.polled', 'system');
      });
  }
}
export function startWhoopPolling(pool: Pool, config: WhoopConfig) {
  const service = new WhoopService(pool, config);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void service
      .poll()
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  }, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
