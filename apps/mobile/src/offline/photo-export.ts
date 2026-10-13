import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import type { OfflineStore, DurablePhoto } from './store';
import { installationStoragePrefix } from '../installation';

/** Called only from an owner's explicit tap. Never uploads the image or opens sharing automatically. */
export async function shareRetainedPhoto(photo: DurablePhoto) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error(
      'Saving a copy is unavailable on this device. Your image remains in app document storage.',
    );
  await Sharing.shareAsync(photo.uri, {
    mimeType: 'image/jpeg',
    UTI: 'public.jpeg',
    dialogTitle: 'Save a copy of your retained food photo',
  });
}
export async function exportRecoveryFiles(store: OfflineStore): Promise<string> {
  const directory = new Directory(
    Paths.document,
    'recovery',
    installationStoragePrefix(store.partitionKey),
    Crypto.randomUUID(),
  );
  directory.create({ intermediates: true, idempotent: true });
  const images = [];
  for (const photo of await store.photos()) {
    if (photo.status === 'synced') continue;
    const file = new File(directory, `${photo.id}.jpg`);
    new File(photo.uri).copy(file);
    const bytes = await file.bytes();
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
      '',
    );
    if (bytes.length !== photo.size || sha256 !== photo.sha256)
      throw new Error(
        'A retained image failed its checksum check. The original remains on this device.',
      );
    images.push({
      id: photo.id,
      entryId: photo.entryId,
      file: `${photo.id}.jpg`,
      size: photo.size,
      sha256,
    });
  }
  new File(directory, 'manifest.json').write(
    JSON.stringify({ data: JSON.parse(await store.exportPending()), images }, null, 2),
  );
  return directory.uri;
}
