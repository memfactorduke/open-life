import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function contains(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

export function pathsOverlap(left, right) {
  return contains(left, right) || contains(right, left);
}

export function assertDisjoint(left, right) {
  if (pathsOverlap(left, right)) {
    throw new Error('Archive, media, and backup paths must not overlap.');
  }
}

export function plainDatabaseName(databaseUrl) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('Database name must be a plain identifier.');
  }
  return name;
}

export async function createPrivateDirectory(path) {
  const resolved = resolve(path);
  const parent = dirname(resolved);
  const parentInfo = await lstat(parent);
  if (parentInfo.isSymbolicLink() || (await realpath(parent)) !== resolve(parent)) {
    throw new Error('Destination parent cannot contain symlinks.');
  }
  await mkdir(resolved, { mode: 0o700 });
  const created = await lstat(resolved);
  if (
    !created.isDirectory() ||
    created.isSymbolicLink() ||
    (await realpath(resolved)) !== resolved
  ) {
    throw new Error('Destination must be a new real directory.');
  }
  await chmod(resolved, 0o700);
  return resolved;
}

export async function copyOperatorFile(source, target) {
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.mode & 0o077) {
      throw new Error('Secret inputs must be regular operator-only files (0600).');
    }
    await writeFile(target, await handle.readFile(), { mode: 0o600, flag: 'wx' });
  } finally {
    await handle.close();
  }
  await chmod(target, 0o600);
}

export async function fsyncTree(root) {
  const resolved = resolve(root);
  if ((await realpath(resolved)) !== resolved)
    throw new Error('Refusing to publish through a symlink.');
  async function visit(directory) {
    const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await handle.stat()).isDirectory())
        throw new Error('Archive entry must be a directory.');
      for (const name of await readdir(directory)) {
        const path = join(directory, name);
        const info = await lstat(path);
        if (info.isSymbolicLink()) throw new Error('Symlinks cannot be published.');
        if (info.isDirectory()) await visit(path);
        else if (info.isFile()) {
          const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            await file.sync();
          } finally {
            await file.close();
          }
        } else throw new Error('Unsupported archive entry.');
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  await visit(resolved);
}
