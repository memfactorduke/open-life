import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundedPort, fixtureDatabase, fixturePorts } from '../rc-web-fixture.mjs';

test('browser fixture ports stay bounded and the database name is fixed', () => {
  assert.equal(fixtureDatabase, 'mems_life_ci_web');
  assert.deepEqual(fixturePorts({ RC_WEB_APP_PORT: '3661', RC_WEB_TLS_PORT: '3663' }), {
    appPort: 3661,
    tlsPort: 3663,
  });
  assert.deepEqual(fixturePorts({}), { appPort: 3631, tlsPort: 3643 });
  assert.throws(() => boundedPort('80', 'RC_WEB_APP_PORT'), /1024/);
  assert.throws(() => boundedPort('70000', 'RC_WEB_TLS_PORT'), /65535/);
  assert.throws(
    () => fixturePorts({ RC_WEB_APP_PORT: '3661', RC_WEB_TLS_PORT: '3661' }),
    /different/,
  );
});
