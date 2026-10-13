import {
  MeSchema,
  PreferencesRecordSchema,
  type MeResponse,
  type PreferencesRecord,
} from '@mems-life/domain';
import {
  NetworkUnavailableError,
  RequestRejectedError,
  SessionExpiredError,
  type InstallationClient,
} from './client';
import { installationStoragePrefix } from './installation';

export type BootstrapSession = {
  me: MeResponse;
  preferences: PreferencesRecord;
  authentication: 'verified' | 'offline';
};
export const verifiedSessionKey = (origin: string) =>
  `${installationStoragePrefix(origin)}_verified_profile`;
type ProfileStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export async function loadInstallationSession(
  client: InstallationClient,
  storage: ProfileStorage,
): Promise<BootstrapSession> {
  const key = verifiedSessionKey(client.baseURL);
  let verifiedMe: MeResponse | undefined;
  try {
    // Resolve authentication first: a concurrent preferences transport failure must
    // not outrun a definitive rejection of this owner's session.
    const me = MeSchema.parse(await client.request('/api/me'));
    verifiedMe = me;
    const preferences = PreferencesRecordSchema.parse(await client.request('/api/preferences'));
    await storage.setItemAsync(key, JSON.stringify({ origin: client.baseURL, me, preferences }));
    return { me, preferences, authentication: 'verified' };
  } catch (error) {
    if (
      error instanceof SessionExpiredError ||
      (error instanceof RequestRejectedError && error.status === 403)
    )
      await storage.deleteItemAsync(key);
    if (!(error instanceof NetworkUnavailableError)) throw error;
    try {
      const saved = await storage.getItemAsync(key);
      const cached: unknown = saved ? JSON.parse(saved) : null;
      if (!cached || typeof cached !== 'object' || !('me' in cached) || !('preferences' in cached))
        throw error;
      // Legacy profiles are already bound to the requested origin by their secure
      // storage key. New profiles also carry an explicit origin for validation.
      if ('origin' in cached && cached.origin !== client.baseURL) throw error;
      const me = MeSchema.parse(cached.me);
      // A reachable identity endpoint takes precedence over the cached profile,
      // even if preferences subsequently lose connectivity. Retain old local work
      // without allowing the newly verified identity to open its partition.
      if (
        verifiedMe &&
        (me.user.id !== verifiedMe.user.id || me.installationId !== verifiedMe.installationId)
      )
        throw error;
      return {
        me,
        preferences: PreferencesRecordSchema.parse(cached.preferences),
        authentication: 'offline',
      };
    } catch {
      throw error;
    }
  }
}
