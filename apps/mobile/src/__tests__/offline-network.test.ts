import {
  createInstallationClient,
  NetworkUnavailableError,
  RequestRejectedError,
  SessionExpiredError,
} from '../client';
const mockSession = jest.fn();
jest.mock('better-auth/react', () => ({
  createAuthClient: () => ({ getSession: mockSession, getCookie: () => '' }),
}));
jest.mock('@better-auth/expo/client', () => ({ expoClient: () => ({}) }));
jest.mock('expo-secure-store', () => ({}));
beforeEach(() => {
  mockSession.mockReset().mockResolvedValue({ data: { user: { id: 'fictional' } }, error: null });
});
afterEach(() => jest.restoreAllMocks());
test('network transport failure is classified separately for cached identity recovery', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
  await expect(
    createInstallationClient('https://fictional.example').request('/api/me'),
  ).rejects.toBeInstanceOf(NetworkUnavailableError);
});
test('expired authentication cannot use the network-only recovery path', async () => {
  mockSession.mockResolvedValue({ data: null, error: { status: 401, message: 'Session expired' } });
  await expect(
    createInstallationClient('https://fictional.example').request('/api/me'),
  ).rejects.toBeInstanceOf(SessionExpiredError);
});
test('permission rejection cannot use network-only recovery', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 403,
    json: async () => ({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }),
  });
  await expect(
    createInstallationClient('https://fictional.example').request('/api/me'),
  ).rejects.toBeInstanceOf(RequestRejectedError);
});

test('native replay sends a persisted epoch guard alongside secure cookie transport', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ saved: true }) });
  await createInstallationClient('https://fictional.example').request(
    '/api/food/commands',
    {},
    'POST',
    { expectedEpoch: 'fictional-epoch' },
  );
  expect(global.fetch).toHaveBeenCalledWith(
    'https://fictional.example/api/food/commands',
    expect.objectContaining({
      headers: expect.objectContaining({ 'X-Mems-Life-Epoch': 'fictional-epoch' }),
    }),
  );
});
