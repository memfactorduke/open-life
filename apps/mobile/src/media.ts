import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { fetch } from 'expo/fetch';
import type { InstallationClient } from './client';
import { RequestRejectedError, SessionExpiredError } from './client';
import { ApiErrorSchema } from '@mems-life/domain';
import { installationStoragePrefix } from './installation';
export type LocalFoodPhoto = {
  uri: string;
  size: number;
  sha256: string;
  uploadId?: string;
  operationId: string;
  allocationRevision?: number;
  finalizeRevision?: number;
};
export async function retainFoodPhoto(uri: string, partition: string): Promise<LocalFoodPhoto> {
  const image = await ImageManipulator.manipulate(uri).resize({ width: 2400 }).renderAsync();
  const normalized = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const directory = new Directory(Paths.document, 'food', installationStoragePrefix(partition));
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `${Crypto.randomUUID()}.jpg`);
  new File(normalized.uri).copy(file);
  const bytes = await file.bytes();
  if (!bytes.length || bytes.length > 8388608) {
    file.delete();
    throw new Error('The photo must be no larger than 8 MB. Choose a smaller photo.');
  }
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return {
    uri: file.uri,
    size: bytes.length,
    sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    ),
    operationId: Crypto.randomUUID(),
  };
}
export async function uploadFoodPhoto(
  client: InstallationClient,
  photo: LocalFoodPhoto,
  id: string,
  expectedEpoch?: string,
) {
  const cookie = await client.auth.getCookie();
  const response = await fetch(`${client.baseURL}/api/media/${id}/content`, {
    method: 'PUT',
    headers: {
      Cookie: cookie ?? '',
      Origin: 'memslife://',
      'Content-Type': 'application/octet-stream',
      ...(expectedEpoch ? { 'X-Mems-Life-Epoch': expectedEpoch } : {}),
    },
    body: await new File(photo.uri).bytes(),
  });
  if (!response.ok) {
    if (response.status === 401) throw new SessionExpiredError();
    const value = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    throw new RequestRejectedError(
      response.status,
      value.success
        ? value.data.error.message
        : 'Photo upload failed. Your local photo is retained.',
      value.success ? value.data.error.code : undefined,
      value.success ? value.data.error.details : undefined,
    );
  }
}
