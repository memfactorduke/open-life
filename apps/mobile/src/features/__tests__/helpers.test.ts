import { messageOf } from '../helpers';
import { NetworkUnavailableError, RequestRejectedError, SessionExpiredError } from '../../client';

jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));

test.each([
  new Error('SQLITE_FULL'),
  Object.assign(new Error('database or disk is full'), { errcode: 13 }),
  Object.assign(
    new Error(
      "Call to function 'NativeStatement.runAsync' has been rejected.\n→ Caused by: database or disk is full",
    ),
    { code: 'ERR_INTERNAL_SQLITE_ERROR' },
  ),
])('full storage failure gives recovery advice without promising a saved draft: %s', (error) => {
  expect(messageOf(error)).toBe(
    'This device could not save the change. Keep this screen open, check free space, and retry.',
  );
});

test.each([
  Object.assign(new Error('disk I/O error'), { code: 'ERR_INTERNAL_SQLITE_ERROR' }),
  new Error('cannot rollback - no transaction is active'),
])('other SQLite errors do not claim the disk is full: %s', (error) => {
  expect(messageOf(error)).toBe(
    'This device could not save the change. Keep this screen open and retry.',
  );
});

test.each([
  new SessionExpiredError(),
  new NetworkUnavailableError('The installation could not be reached.'),
  new RequestRejectedError(422, 'SQLITE_FULL is not a valid title.', 'INVALID_COMMAND'),
  new Error('Weight must be a nonnegative number.'),
  new Error('Unknown failure'),
])('authentication, network, validation and unknown errors retain their message: %s', (error) => {
  expect(messageOf(error)).toBe(error.message);
});
