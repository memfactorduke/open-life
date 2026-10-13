import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { readConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { bootstrapOwner, migrate, recoverOwner } from '../src/database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mems_life_test')
  throw new Error('TEST_DATABASE_URL must point to the isolated mems_life_test database.');
const config = readConfig({
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: 'fictional-test-secret-for-isolated-tests-only',
  BETTER_AUTH_URL: 'http://localhost:3001',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
});

test('private installation, transactional preferences, recovery, and restart persistence', async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await migrate(pool, config);
  await migrate(pool, config);
  const identity = {
    email: 'owner@example.test',
    name: 'Fictional Owner',
    password: 'fictional-password-12345',
  };
  await assert.rejects(bootstrapOwner(pool, config, { ...identity, name: ' ' }));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM "user"')).rows[0].n, 0);
  const installationId = await bootstrapOwner(pool, config, identity);
  await assert.rejects(bootstrapOwner(pool, config, identity), /owner already exists/i);
  let service = await createApp(config, pool);
  const signIn = async (
    email = identity.email,
    password = identity.password,
    origin = config.WEB_ORIGIN,
  ) => {
    const response = await service.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin },
      payload: { email, password },
    });
    assert.equal(response.statusCode, 200, response.body);
    const cookies = response.headers['set-cookie'];
    const cookie = (Array.isArray(cookies) ? cookies : [cookies])
      .filter(Boolean)
      .map((value) => value!.split(';')[0])
      .join('; ');
    assert.ok(cookie.includes('session_token'));
    return cookie;
  };
  const request = (
    method: 'GET' | 'PUT',
    url: string,
    cookie?: string,
    payload?: unknown,
    origin = config.WEB_ORIGIN,
  ) =>
    service.app.inject({
      method,
      url,
      headers: { ...(cookie ? { cookie } : {}), origin },
      ...(payload === undefined ? {} : { payload }),
    });
  try {
    assert.equal((await request('GET', '/api/me')).statusCode, 401);
    for (const path of [
      'sign-up/email',
      'admin/create-user',
      'request-password-reset',
      'reset-password',
    ]) {
      const response = await service.app.inject({
        method: 'POST',
        url: `/api/auth/${path}`,
        headers: { origin: config.WEB_ORIGIN },
        payload: identity,
      });
      assert.equal(response.statusCode, 403);
    }
    assert.equal(
      (
        await service.app.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          headers: { origin: 'https://untrusted.example' },
          payload: identity,
        })
      ).statusCode,
      403,
    );
    const cookie = await signIn();
    const nativeLogin = await service.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'expo-origin': 'memslife://' },
      payload: { email: identity.email, password: identity.password },
    });
    assert.equal(nativeLogin.statusCode, 200, nativeLogin.body);
    const nativeCookies = nativeLogin.headers['set-cookie'];
    const nativeCookie = (Array.isArray(nativeCookies) ? nativeCookies : [nativeCookies])
      .filter(Boolean)
      .map((value) => value!.split(';')[0])
      .join('; ');
    const fakeNative = await service.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'expo-origin': 'untrusted://' },
      payload: { email: identity.email, password: identity.password },
    });
    assert.equal(fakeNative.statusCode, 403);
    assert.equal(
      (await request('GET', '/api/me', nativeCookie, undefined, 'memslife://')).statusCode,
      200,
    );
    const me = (await request('GET', '/api/me', cookie)).json();
    assert.equal(me.installationId, installationId);
    const sessionId = (await request('GET', '/api/auth/get-session', cookie)).json().session.id;
    await pool.query(
      `UPDATE session SET "expiresAt"=now()+interval '5 days', "updatedAt"=now()-interval '2 days' WHERE id=$1`,
      [sessionId],
    );
    const agingSession = (
      await pool.query('SELECT "expiresAt" FROM session WHERE id=$1', [sessionId])
    ).rows[0];
    assert.equal((await request('GET', '/api/me', cookie)).statusCode, 200);
    assert.equal(
      (
        await pool.query('SELECT "expiresAt" FROM session WHERE id=$1', [sessionId])
      ).rows[0].expiresAt.valueOf(),
      agingSession.expiresAt.valueOf(),
      'Authorization checks must not consume a refresh without delivering its cookie.',
    );
    const renewed = await request('GET', '/api/auth/get-session', cookie);
    assert.equal(renewed.statusCode, 200, renewed.body);
    const renewedCookies = renewed.headers['set-cookie'];
    assert.match(
      (Array.isArray(renewedCookies) ? renewedCookies : [renewedCookies]).join('; '),
      /session_token=.*Max-Age=604800/i,
    );
    const renewedExpiry = new Date(renewed.json().session.expiresAt).valueOf();
    assert.ok(renewedExpiry > agingSession.expiresAt.valueOf() + 24 * 60 * 60 * 1000);
    assert.equal(
      (
        await pool.query('SELECT "expiresAt" FROM session WHERE id=$1', [sessionId])
      ).rows[0].expiresAt.valueOf(),
      renewedExpiry,
    );
    const initial = (await request('GET', '/api/preferences', cookie)).json();
    assert.equal(initial.revision, 0);
    const command = {
      operationId: randomUUID(),
      expectedRevision: 0,
      value: { ...initial.value, displayName: 'Updated Owner', weightUnit: 'lb' },
    };
    const first = await request('PUT', '/api/preferences', cookie, command);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().revision, 1);
    assert.deepEqual(
      (await request('PUT', '/api/preferences', cookie, command)).json(),
      first.json(),
    );
    assert.equal(
      (
        await request('PUT', '/api/preferences', cookie, {
          ...command,
          value: { ...command.value, theme: 'dark' },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (await request('PUT', '/api/preferences', cookie, { ...command, operationId: randomUUID() }))
        .statusCode,
      409,
    );
    assert.equal(
      (
        await service.app.inject({
          method: 'PUT',
          url: '/api/preferences',
          headers: { cookie },
          payload: command,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request('PUT', '/api/preferences', cookie, {
          ...command,
          value: { ...command.value, timeZone: 'Invalid/Timezone' },
        })
      ).statusCode,
      400,
    );
    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE event_type='preferences.updated'",
    );
    assert.equal(audit.rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM change_feed')).rows[0].n, 1);
    const unrelated = await service.auth.api.createUser({
      body: {
        email: 'unrelated@example.test',
        name: 'Unrelated Fixture',
        password: identity.password,
      },
    });
    const otherCookie = await signIn(unrelated.user.email);
    assert.equal((await request('GET', '/api/preferences', otherCookie)).statusCode, 403);
    assert.equal((await request('PUT', '/api/preferences', otherCookie, command)).statusCode, 403);
    await service.app.close();
    service = await createApp(config, pool);
    assert.deepEqual((await request('GET', '/api/preferences', cookie)).json(), first.json());
    await assert.rejects(recoverOwner(pool, config, 'short'));
    assert.equal((await request('GET', '/api/me', cookie)).statusCode, 200);
    await recoverOwner(pool, config, 'replacement-fictional-password');
    assert.equal((await request('GET', '/api/me', cookie)).statusCode, 401);
    assert.equal((await request('GET', '/api/auth/get-session', cookie)).statusCode, 401);
    assert.equal((await request('PUT', '/api/preferences', cookie, command)).statusCode, 401);
    assert.equal((await request('GET', '/api/me', nativeCookie)).statusCode, 401);
    const oldLogin = await service.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.WEB_ORIGIN },
      payload: { email: identity.email, password: identity.password },
    });
    assert.equal(oldLogin.statusCode, 401);
    const productionConfig = {
      ...config,
      NODE_ENV: 'production' as const,
      BETTER_AUTH_URL: 'https://private.example.test',
      WEB_ORIGIN: 'https://private.example.test',
    };
    const productionAuth = createAuth(productionConfig, pool);
    const secureResponse = await productionAuth.handler(
      new Request('https://private.example.test/api/auth/sign-in/email', {
        method: 'POST',
        headers: { Origin: productionConfig.WEB_ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identity.email, password: 'replacement-fictional-password' }),
      }),
    );
    assert.equal(secureResponse.status, 200);
    const secureCookie = secureResponse.headers.getSetCookie().join('; ');
    assert.match(secureCookie, /HttpOnly/i);
    assert.match(secureCookie, /Secure/i);
    const recoveredCookie = await signIn(identity.email, 'replacement-fictional-password');
    await pool.query(
      'UPDATE session SET "expiresAt"=now()-interval \'1 minute\' WHERE "userId"=$1',
      [me.user.id],
    );
    assert.equal((await request('GET', '/api/me', recoveredCookie)).statusCode, 401);
    const freshCookie = await signIn(identity.email, 'replacement-fictional-password');
    await pool.query(
      "CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='preferences.updated' THEN RAISE EXCEPTION 'injected database write failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_test_audit();",
    );
    const failedCommand = { operationId: randomUUID(), expectedRevision: 1, value: command.value };
    assert.equal(
      (await request('PUT', '/api/preferences', freshCookie, failedCommand)).statusCode,
      500,
    );
    assert.equal((await request('GET', '/api/preferences', freshCookie)).json().revision, 1);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM operation_receipts WHERE operation_id=$1',
          [failedCommand.operationId],
        )
      ).rows[0].n,
      0,
    );
    await pool.query(
      'DROP TRIGGER reject_test_audit ON audit_events; DROP FUNCTION reject_test_audit()',
    );
    const competing = [0, 1].map(() => ({
      operationId: randomUUID(),
      expectedRevision: 1,
      value: command.value,
    }));
    const responses = await Promise.all(
      competing.map((payload) => request('PUT', '/api/preferences', freshCookie, payload)),
    );
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409]);
    const saturated = await Promise.all(
      Array.from({ length: 20 }, () =>
        request('PUT', '/api/preferences', freshCookie, {
          operationId: randomUUID(),
          expectedRevision: 2,
          value: command.value,
        }),
      ),
    );
    assert.equal(saturated.filter((response) => response.statusCode === 200).length, 1);
    assert.equal(saturated.filter((response) => response.statusCode === 409).length, 19);
    assert.equal((await request('GET', '/api/preferences', freshCookie)).json().revision, 3);
  } finally {
    await service.app.close();
    await pool.end();
  }
});
