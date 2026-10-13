import { normalizeInstallationUrl, installationStoragePrefix } from '../src/installation';

test('accepts a private HTTPS installation and normalizes trailing slash', () => {
  expect(normalizeInstallationUrl(' https://life.example.com/ ')).toBe('https://life.example.com');
});
test('rejects unencrypted remote sign-in and embedded credentials', () => {
  expect(() => normalizeInstallationUrl('http://life.example.com')).toThrow('Use HTTPS');
  expect(() => normalizeInstallationUrl('https://owner:password@life.example.com')).toThrow(
    'without credentials',
  );
});
test('permits the loopback simulator service but rejects paths', () => {
  expect(normalizeInstallationUrl('http://localhost:3001/')).toBe('http://localhost:3001');
  expect(() => normalizeInstallationUrl('https://life.example.com/api')).toThrow(
    'without credentials, paths',
  );
});
test('different installation addresses cannot share secure credential keys', () => {
  const first = installationStoragePrefix('https://a.b');
  const second = installationStoragePrefix('https://a-b');
  expect(first).not.toBe(second);
  expect(first).toMatch(/^[a-zA-Z0-9_.-]+$/);
});
