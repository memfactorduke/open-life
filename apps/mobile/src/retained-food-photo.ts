import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { fetch } from 'expo/fetch';
import type { InstallationClient } from './client';
import { installationStoragePrefix } from './installation';

type CachedPhoto = { uri: string; size: number; sha256: string };
const maximumBytes = 8388608;
async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function verifiedUri(photo: CachedPhoto, directory: Directory): Promise<string | null> {
  const prefix = `${directory.uri.replace(/\/$/, '')}/`;
  // iOS can relocate an app container on reinstall. Rebase only the exact private directory,
  // retaining the owner/installation namespace and a single filename; verify bytes afterward.
  const documents = prefix.indexOf('/Documents/');
  const oldDocuments = photo.uri.indexOf('/Documents/');
  const privateSuffix = documents >= 0 ? prefix.slice(documents) : null;
  const candidate = photo.uri.startsWith(prefix)
    ? photo.uri
    : privateSuffix && oldDocuments >= 0 && photo.uri.slice(oldDocuments).startsWith(privateSuffix)
      ? prefix + photo.uri.slice(oldDocuments + privateSuffix.length)
      : null;
  if (
    !candidate ||
    !candidate.slice(prefix.length) ||
    candidate.slice(prefix.length).includes('/') ||
    candidate.slice(prefix.length) === '..'
  )
    return null;
  try {
    const file = new File(candidate);
    if (!file.exists || file.size !== photo.size || photo.size <= 0 || photo.size > maximumBytes)
      return null;
    const bytes = await file.bytes();
    if (bytes.length !== photo.size || (await checksum(bytes)) !== photo.sha256) return null;
    return file.uri;
  } catch {
    return null;
  }
}

/** Confirmed photo display cache, separate from capture files and the upload outbox. */
export async function retainedFoodPhotoUri(
  client: InstallationClient,
  entryId: string,
  uploadId: string,
): Promise<string | null> {
  const store = client.offline?.store;
  if (!store || !/^[a-f0-9-]{36}$/i.test(uploadId)) return null;
  async function visible() {
    if (!store || client.offline?.store !== store || (await store.state()).signedOut) return false;
    const record = (await store.records('food')).find((row) => row.id === entryId);
    const entry = record?.value as { photoIds?: string[]; deletedAt?: string | null } | undefined;
    return !!entry && !entry.deletedAt && !!entry.photoIds?.includes(uploadId);
  }
  if (!(await visible())) return null;
  const captured = (await store.photos()).find(
    (row) => row.entryId === entryId && row.uploadId === uploadId && row.status === 'synced',
  );
  const captureDirectory = new Directory(
    Paths.document,
    'food',
    installationStoragePrefix(`${client.baseURL}/${store.partition.ownerId}`),
  );
  if (captured) {
    const uri = await verifiedUri(captured, captureDirectory);
    if (uri && (await visible())) return uri;
  }
  const namespace = await checksum(
    new TextEncoder().encode(
      `${client.baseURL}/${store.partition.installationId}/${store.partition.ownerId}`,
    ),
  );
  const directory = new Directory(Paths.document, 'food-view-cache', namespace);
  const key = `food-view-cache:${uploadId}`;
  const cached = await store.getDraft<CachedPhoto>(key);
  if (cached) {
    const uri = await verifiedUri(cached, directory);
    if (uri && (await visible())) return uri;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const cookie = await client.auth.getCookie();
    if (!(await visible())) return null;
    const response = await fetch(`${client.baseURL}/api/media/${uploadId}`, {
      headers: { Cookie: cookie ?? '' },
      signal: controller.signal,
      credentials: 'omit',
    });
    if (
      response.status !== 200 ||
      !/^image\/(jpeg|png)(;|$)/i.test(response.headers.get('content-type') ?? '')
    )
      return null;
    const advertised = Number(response.headers.get('content-length'));
    if (advertised > maximumBytes) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
    if (!size || !(await visible())) return null;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    // Check the image signature as well as the protected response's MIME type.
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
    if (!jpeg && !png) return null;
    const sha256 = await checksum(bytes);
    directory.create({ intermediates: true, idempotent: true });
    const temporary = new File(directory, `${Crypto.randomUUID()}.tmp`);
    const temporaryUri = temporary.uri;
    const target = new File(directory, `${uploadId}-${sha256}.${jpeg ? 'jpg' : 'png'}`);
    try {
      temporary.write(bytes);
      if (!target.exists) temporary.move(target);
      else temporary.delete();
      if (!(await visible())) return null;
      await store.setDraft(key, { uri: target.uri, size, sha256 });
      const uri = await verifiedUri({ uri: target.uri, size, sha256 }, directory);
      return (await visible()) ? uri : null;
    } finally {
      const leftover = new File(temporaryUri);
      if (leftover.exists) leftover.delete();
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
