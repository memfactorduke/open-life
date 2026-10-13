export function normalizeInstallationUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter the full installation address, beginning with https://.');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(
      'Use the installation address without credentials, paths, or query parameters.',
    );
  }
  const development =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && development)) {
    throw new Error(
      'Use HTTPS to protect your sign-in. Localhost HTTP is supported for simulator development only.',
    );
  }
  return url.origin;
}

export function installationStoragePrefix(url: string): string {
  return `memslife_${Array.from(url, (character) => character.codePointAt(0)!.toString(16)).join('_')}`;
}
