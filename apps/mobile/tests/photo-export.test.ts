import { createHash as mockCreateHash } from 'node:crypto';
import { File } from 'expo-file-system';
import { exportRecoveryShareFile } from '../src/offline/photo-export';
import type { OfflineStore } from '../src/offline/store';

// Model actual file contents and an asynchronous native copy, rather than mocking the exporter.
const mockFiles = new Map<string, Buffer>();
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part.uri))
        .join('/')
        .replace(/\/$/, '');
    }
    create() {}
  }
  class File extends Directory {
    async copy(destination: File) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const bytes = mockFiles.get(this.uri);
      if (!bytes) throw new Error('Source image missing');
      mockFiles.set(destination.uri, Buffer.from(bytes));
    }
    async bytes() {
      const bytes = mockFiles.get(this.uri);
      if (!bytes) throw new Error('Copy has not completed');
      return new Uint8Array(bytes);
    }
    async text() {
      return Buffer.from(await this.bytes()).toString('utf8');
    }
    async base64() {
      return Buffer.from(await this.bytes()).toString('base64');
    }
    write(content: string) {
      mockFiles.set(this.uri, Buffer.from(content));
    }
  }
  return { Directory, File, Paths: { document: 'file:///documents' } };
});
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'export-id',
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digest: async (_algorithm: string, bytes: Uint8Array) => {
    const hash = mockCreateHash('sha256').update(bytes).digest();
    return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
  },
}));

function photoStore(checksum?: string) {
  const bytes = Buffer.from([0xff, 0xd8, 0x00, 0x80, 0xff, 0xd9]);
  const sha256 = mockCreateHash('sha256').update(bytes).digest('hex');
  const photo = {
    id: 'photo-1',
    entryId: 'entry-1',
    uri: 'file:///original.jpg',
    size: bytes.length,
    sha256: checksum ?? sha256,
    status: 'needs-attention',
  };
  mockFiles.clear();
  mockFiles.set(photo.uri, bytes);
  const data = { partition: { ownerId: 'fictional-owner' }, photos: [photo], outbox: [] };
  const store = {
    partitionKey: 'fictional-partition',
    photos: jest
      .fn()
      .mockResolvedValue([
        photo,
        { ...photo, id: 'synced', uri: 'missing-synced', status: 'synced' },
        { ...photo, id: 'discarded', uri: 'missing-discarded', status: 'discarded' },
      ]),
    exportPending: jest.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as OfflineStore;
  return { store, data, bytes, sha256 };
}

test('portable recovery includes copied image bytes and manifest after native copy completes', async () => {
  const { store, data, bytes, sha256 } = photoStore();
  const uri = await exportRecoveryShareFile(store);
  expect(uri).toMatch(/^file:\/\/\/documents\/recovery\/.*\/export-id\/recovery.json$/);
  const payload = JSON.parse(await new File(uri).text());
  expect(payload).toMatchObject({ format: 'mems-life-offline-recovery', version: 1, data });
  expect(payload.images).toEqual([
    {
      id: 'photo-1',
      entryId: 'entry-1',
      file: 'photo-1.jpg',
      size: bytes.length,
      sha256,
      encoding: 'base64',
      bytes: bytes.toString('base64'),
    },
  ]);
  // Portable contents reconstruct the exact image without resolving the source sandbox URI.
  expect(Buffer.from(payload.images[0].bytes, payload.images[0].encoding)).toEqual(bytes);
  expect(mockFiles.get('file:///original.jpg')).toEqual(bytes);
  const directory = uri.replace('/recovery.json', '');
  expect(mockFiles.get(`${directory}/photo-1.jpg`)).toEqual(bytes);
  expect(JSON.parse(await new File(`${directory}/manifest.json`).text()).images).toHaveLength(1);
});

test('checksum failure prevents a shareable export and preserves original bytes', async () => {
  const { store, bytes } = photoStore('incorrect-checksum');
  await expect(exportRecoveryShareFile(store)).rejects.toThrow('checksum check');
  expect(mockFiles.get('file:///original.jpg')).toEqual(bytes);
  expect([...mockFiles.keys()].some((path) => path.endsWith('/recovery.json'))).toBe(false);
});
