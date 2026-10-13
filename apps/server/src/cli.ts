import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Pool } from 'pg';
import { z } from 'zod';
import { readConfig } from './config.js';
import { bootstrapOwner, migrate, recoverOwner } from './database.js';

async function passwordPrompt(): Promise<string> {
  if (!stdin.isTTY) {
    let input = '';
    for await (const chunk of stdin) {
      input += String(chunk);
      if (input.length > 1024) throw new Error('Password input exceeds the allowed length.');
    }
    return z
      .string()
      .min(12)
      .max(128)
      .parse(input.replace(/\r?\n$/, ''));
  }
  stdout.write('Password (hidden): ');
  stdin.setRawMode(true);
  stdin.resume();
  try {
    const password = await new Promise<string>((resolve, reject) => {
      let value = '';
      const read = (chunk: Buffer) => {
        for (const character of chunk.toString('utf8')) {
          if (character === '\u0003') {
            stdin.off('data', read);
            reject(new Error('Cancelled.'));
            return;
          }
          if (character === '\r' || character === '\n') {
            stdin.off('data', read);
            resolve(value);
            return;
          }
          if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
          else if (character >= ' ' && value.length < 129) value += character;
        }
      };
      stdin.on('data', read);
    });
    return z.string().min(12).max(128).parse(password);
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write('\n');
  }
}
async function main() {
  const command = process.argv[2];
  if (!['migrate', 'bootstrap', 'recover'].includes(command ?? ''))
    throw new Error('Use migrate, bootstrap, or recover.');
  const config = readConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  try {
    if (command === 'migrate') {
      await migrate(pool, config);
      console.log('Migrations applied.');
      return;
    }
    if (command === 'recover') {
      await recoverOwner(pool, config, await passwordPrompt());
      console.log('Owner password replaced and all human sessions revoked.');
      return;
    }
    let email = process.env.OWNER_EMAIL;
    let name = process.env.OWNER_NAME;
    if (stdin.isTTY && (!email || !name)) {
      const prompt = createInterface({ input: stdin, output: stdout });
      try {
        email ??= await prompt.question('Owner email: ');
        name ??= await prompt.question('Owner name: ');
      } finally {
        prompt.close();
      }
    }
    const identity = z
      .object({ email: z.email(), name: z.string().trim().min(1).max(80) })
      .parse({ email, name });
    await bootstrapOwner(pool, config, { ...identity, password: await passwordPrompt() });
    console.log('Private owner created. Public signup remains disabled.');
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    'Administrator command failed. Check configuration, input requirements, and whether an owner already exists. No credentials were logged.',
  );
  process.exitCode = 1;
});
