import { createInstallationClient, SessionExpiredError } from '../src/client';

const mockGetSession = jest.fn();
const mockGetCookie = jest.fn();
jest.mock('better-auth/react', () => ({
  createAuthClient: () => ({ getCookie: mockGetCookie, getSession: mockGetSession }),
}));
beforeEach(() => {
  mockGetSession
    .mockReset()
    .mockResolvedValue({ data: { session: { id: 'fictional' } }, error: null });
  mockGetCookie.mockReset().mockReturnValue('better-auth.session_token=fictional');
});
jest.mock('@better-auth/expo/client', () => ({ expoClient: () => ({}) }));
jest.mock('expo-secure-store', () => ({}));

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
afterEach(() => jest.restoreAllMocks());

test('native mutation sends its cookie and explicit trusted origin', async () => {
  const request = jest.fn().mockResolvedValue(response(200, { revision: 1 }));
  global.fetch = request;
  const client = createInstallationClient('https://life.example.com');
  expect(await client.request('/api/preferences', { operationId: 'fictional' })).toEqual({
    revision: 1,
  });
  expect(request).toHaveBeenCalledWith(
    'https://life.example.com/api/preferences',
    expect.objectContaining({
      method: 'PUT',
      credentials: 'omit',
      body: '{"operationId":"fictional"}',
      headers: {
        Cookie: 'better-auth.session_token=fictional',
        'Content-Type': 'application/json',
        Origin: 'memslife://',
      },
    }),
  );
});
test('expired sessions ask for sign-in while a permission error stays distinct', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(response(401, {}))
    .mockResolvedValueOnce(
      response(403, { error: { code: 'FORBIDDEN', message: 'This operation is not permitted.' } }),
    );
  const client = createInstallationClient('https://life.example.com');
  await expect(client.request('/api/me')).rejects.toBeInstanceOf(SessionExpiredError);
  await expect(client.request('/api/preferences', {})).rejects.toThrow(
    'This operation is not permitted.',
  );
});

test('session validation persists renewal through the auth client before reading its cookie', async () => {
  mockGetSession.mockImplementation(async () => {
    mockGetCookie.mockReturnValue('better-auth.session_token=renewed');
    return { data: { session: { id: 'fictional' } }, error: null };
  });
  const request = jest
    .fn()
    .mockResolvedValue(response(200, { installationId: 'fixture-installation' }));
  global.fetch = request;
  const client = createInstallationClient('https://life.example.com');
  expect(await client.request('/api/me')).toEqual({ installationId: 'fixture-installation' });
  expect(mockGetSession).toHaveBeenCalledWith({
    query: { disableCookieCache: true },
    fetchOptions: { signal: expect.any(AbortSignal) },
  });
  expect(request).toHaveBeenCalledWith(
    'https://life.example.com/api/me',
    expect.objectContaining({
      headers: { Cookie: 'better-auth.session_token=renewed' },
    }),
  );
});

test('revoked sessions fail validation before the protected request', async () => {
  mockGetSession.mockResolvedValue({ data: null, error: null });
  const request = jest.fn();
  global.fetch = request;
  const client = createInstallationClient('https://life.example.com');
  await expect(client.request('/api/me')).rejects.toBeInstanceOf(SessionExpiredError);
  expect(request).not.toHaveBeenCalled();
});

test('native commands can select POST and preserve the trusted origin', async () => {
  const request = jest.fn().mockResolvedValue(response(200, { status: 'created' }));
  global.fetch = request;
  const client = createInstallationClient('https://life.example.com');
  expect(await client.request('/api/tasks', { title: 'Fixture task' }, 'POST')).toEqual({
    status: 'created',
  });
  expect(request).toHaveBeenCalledWith(
    'https://life.example.com/api/tasks',
    expect.objectContaining({
      method: 'POST',
      body: '{"title":"Fixture task"}',
      headers: {
        Cookie: 'better-auth.session_token=fictional',
        'Content-Type': 'application/json',
        Origin: 'memslife://',
      },
    }),
  );
});
