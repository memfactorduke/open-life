import { uploadFoodPhoto } from '../media';
import { NetworkUnavailableError, type InstallationClient } from '../client';
import { fetch } from 'expo/fetch';
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn() }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: jest.fn() }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: class {
    async bytes() {
      return new Uint8Array([1, 2, 3]);
    }
  },
}));
jest.mock('expo-image-manipulator', () => ({}));
const client = {
  baseURL: 'https://fictional.example',
  auth: { getCookie: async () => 'fictional-cookie' },
} as unknown as InstallationClient;
const photo = {
  uri: 'file:///fictional/Documents/meal.jpg',
  operationId: 'fictional-operation',
  size: 3,
  sha256: 'a'.repeat(64),
};
afterEach(() => {
  jest.useRealTimers();
  jest.mocked(fetch).mockReset();
});
test('an unresponsive media transfer times out so later synchronization can resume', async () => {
  jest.useFakeTimers();
  jest.mocked(fetch).mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
        );
      }),
  );
  const upload = uploadFoodPhoto(client, photo, 'fictional-upload', 'fictional-epoch');
  const rejected = expect(upload).rejects.toBeInstanceOf(NetworkUnavailableError);
  await jest.advanceTimersByTimeAsync(15000);
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
});
test('private media upload uses explicit secure cookie transport and clears its deadline', async () => {
  jest.useFakeTimers();
  jest.mocked(fetch).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof fetch>>);
  await uploadFoodPhoto(client, photo, 'fictional-upload', 'fictional-epoch');
  expect(fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      credentials: 'omit',
      signal: expect.any(AbortSignal),
      headers: expect.objectContaining({
        Cookie: 'fictional-cookie',
        'X-Mems-Life-Epoch': 'fictional-epoch',
      }),
    }),
  );
  expect(jest.getTimerCount()).toBe(0);
});
