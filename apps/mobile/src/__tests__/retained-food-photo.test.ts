import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { retainedFoodPhotoUri } from '../retained-food-photo';
import { installationStoragePrefix } from '../installation';
import type { InstallationClient } from '../client';
import { Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID(),
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digest: async (_: string, bytes: Uint8Array) =>
    new Uint8Array(
      jest
        .requireActual<typeof import('node:crypto')>('node:crypto')
        .createHash('sha256')
        .update(bytes)
        .digest(),
    ).buffer,
}));
jest.mock('expo-file-system', () => {
  const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    create() {
      fs.mkdirSync(this.uri, { recursive: true });
    }
  }
  class File extends Directory {
    get exists() {
      return fs.existsSync(this.uri);
    }
    get size() {
      return fs.statSync(this.uri).size;
    }
    async bytes() {
      return new Uint8Array(fs.readFileSync(this.uri));
    }
    write(bytes: Uint8Array) {
      fs.writeFileSync(this.uri, bytes);
    }
    move(target: File) {
      fs.renameSync(this.uri, target.uri);
      this.uri = target.uri;
    }
    delete() {
      fs.unlinkSync(this.uri);
    }
  }
  return { Directory, File, Paths: { document: '' } };
});
const id = randomUUID();
const entryId = randomUUID();
const bytes = new Uint8Array([255, 216, 255, 224, 5, 6]);
const sha256 = createHash('sha256').update(bytes).digest('hex');
let root: string;
let photos: unknown[];
let signedOut: boolean;
function client(ownerId = 'owner-a', attached = true): InstallationClient {
  // Metadata survives a new store/client object, like the existing partition-scoped draft table.
  const draftFile = join(root, `${ownerId}.json`);
  return {
    baseURL: 'https://example.test',
    auth: { getCookie: jest.fn(async () => 'private-cookie') },
    offline: {
      store: {
        partition: { ownerId, installationId: 'installation-a' },
        state: async () => ({ signedOut }),
        records: async () => [
          { id: entryId, value: { photoIds: attached ? [id] : [], deletedAt: null } },
        ],
        photos: async () => (ownerId === 'owner-a' ? photos : []),
        getDraft: async () =>
          existsSync(draftFile) ? JSON.parse(readFileSync(draftFile, 'utf8')) : null,
        setDraft: async (_key: string, value: unknown) =>
          writeFileSync(draftFile, JSON.stringify(value)),
      },
    },
  } as unknown as InstallationClient;
}
function capture(oldContainer = false) {
  const folder = join(
    String(Paths.document),
    'food',
    installationStoragePrefix('https://example.test/owner-a'),
  );
  mkdirSync(folder, { recursive: true });
  const uri = join(folder, 'captured.jpg');
  writeFileSync(uri, bytes);
  photos = [
    {
      uri: oldContainer ? uri.replace(root, '/previous-container') : uri,
      entryId,
      uploadId: id,
      status: 'synced',
      size: bytes.length,
      sha256,
    },
  ];
  return uri;
}
function remote(content = bytes) {
  jest.mocked(fetch).mockResolvedValue({
    status: 200,
    headers: new Headers({ 'content-type': 'image/jpeg' }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(content);
        controller.close();
      },
    }),
  } as unknown as Awaited<ReturnType<typeof fetch>>);
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'private-food-'));
  (Paths as unknown as { document: string }).document = join(root, 'Documents');
  photos = [];
  signedOut = false;
  jest.mocked(fetch).mockReset();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
test('confirmed captured bytes display without HTTP and survive safe container rebasing', async () => {
  const uri = capture(true);
  expect(await retainedFoodPhotoUri(client(), entryId, id)).toBe(uri);
  expect(fetch).not.toHaveBeenCalled();
});
test('authenticated bounded download survives a fresh client and unavailable network', async () => {
  remote();
  const first = await retainedFoodPhotoUri(client(), entryId, id);
  expect(first).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining(id),
    expect.objectContaining({ headers: { Cookie: 'private-cookie' } }),
  );
  jest.mocked(fetch).mockRejectedValue(new Error('offline'));
  expect(await retainedFoodPhotoUri(client(), entryId, id)).toBe(first);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(readFileSync(join(root, 'owner-a.json'), 'utf8')).not.toContain('private-cookie');
});
test('another owner cannot read captured or downloaded owner bytes', async () => {
  capture();
  remote();
  const first = await retainedFoodPhotoUri(client(), entryId, id);
  expect(first).toBeTruthy();
  jest.mocked(fetch).mockRejectedValue(new Error('offline'));
  expect(await retainedFoodPhotoUri(client('owner-b'), entryId, id)).toBeNull();
});
test('signed out or detached entries cannot read retained photos or start HTTP', async () => {
  capture();
  signedOut = true;
  expect(await retainedFoodPhotoUri(client(), entryId, id)).toBeNull();
  signedOut = false;
  expect(await retainedFoodPhotoUri(client('owner-a', false), entryId, id)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
test('changed bytes fail checksum and bad protected payload never enters cache', async () => {
  const uri = capture();
  writeFileSync(uri, new Uint8Array([1, 2, 3, 4, 5, 6]));
  remote(new Uint8Array([1, 2]));
  expect(await retainedFoodPhotoUri(client(), entryId, id)).toBeNull();
  expect(existsSync(join(root, 'owner-a.json'))).toBe(false);
});
test('logout during a protected download does not publish or persist the image', async () => {
  jest.mocked(fetch).mockImplementation(async () => {
    signedOut = true;
    return {
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      body: new ReadableStream({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      }),
    } as unknown as Awaited<ReturnType<typeof fetch>>;
  });
  expect(await retainedFoodPhotoUri(client(), entryId, id)).toBeNull();
  expect(existsSync(join(root, 'owner-a.json'))).toBe(false);
});
