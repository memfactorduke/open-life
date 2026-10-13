FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS toolchain
RUN test "$(node --version)" = v24.21.0 && test "$(npm --version)" = 11.19.0
WORKDIR /app

FROM toolchain AS build-dependencies
COPY package.json package-lock.json ./
COPY packages/domain/package.json ./packages/domain/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
RUN npm ci --no-audit --no-fund
# npm ci verifies the unchanged lock, including sharp's target-platform optional packages.
RUN node --input-type=module -e "import assert from 'node:assert/strict'; import fs from 'node:fs'; const lock = JSON.parse(fs.readFileSync('package-lock.json')); const sharp = JSON.parse(fs.readFileSync('node_modules/sharp/package.json')); assert.equal(process.platform, 'linux'); assert.ok(process.report.getReport().header.glibcVersionRuntime, 'Bookworm requires glibc'); for (const name of ['@img/sharp-linux-' + process.arch, '@img/sharp-libvips-linux-' + process.arch]) { const entry = lock.packages['node_modules/' + name]; assert.ok(entry?.integrity && entry.resolved, 'Missing locked binary ' + name); assert.equal(entry.version, sharp.optionalDependencies[name]); assert.equal(JSON.parse(fs.readFileSync('node_modules/' + name + '/package.json')).version, entry.version); assert.ok(entry.os.includes('linux') && entry.cpu.includes(process.arch) && entry.libc.includes('glibc')); fs.cpSync('node_modules/' + name, '.runtime/sharp/node_modules/' + name, { recursive: true }); console.log('Locked sharp runtime package: ' + name + '@' + entry.version); }"

FROM build-dependencies AS build
COPY tsconfig.base.json LICENSE ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
RUN npm run notices
RUN npm run build --workspace @mems-life/domain && npm run build --workspace @mems-life/server && npm run build --workspace @mems-life/web

FROM toolchain AS runtime-dependencies
COPY package.json package-lock.json ./
COPY packages/domain/package.json ./packages/domain/package.json
COPY apps/server/package.json ./apps/server/package.json
RUN npm ci --workspace @mems-life/server --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
COPY --from=build-dependencies /app/.runtime/sharp/node_modules ./node_modules
RUN node --input-type=module -e "await import('better-auth'); await import('@better-auth/expo'); await import('pg'); await import('sharp'); await import('@modelcontextprotocol/sdk/server/mcp.js')"
RUN node --input-type=module -e "import fs from 'node:fs'; const pkg = JSON.parse(fs.readFileSync('package.json')); pkg.scripts = { 'db:migrate': 'node apps/server/dist/cli.js migrate', bootstrap: 'node apps/server/dist/cli.js bootstrap', recover: 'node apps/server/dist/cli.js recover' }; fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n')"

# One-shot maintenance tools retain PostgreSQL's complete matching library closure.
# Keep runtime last: a normal build still produces the minimal application image.
FROM postgres:16.14-bookworm@sha256:64154d0babcb1741988719e703419af0382b19953706149f9872fbd0f438efa8 AS operator
WORKDIR /app
COPY --from=toolchain /usr/local/bin/node /usr/local/bin/node
COPY --from=runtime-dependencies /app/package.json /app/package-lock.json ./
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=runtime-dependencies /app/packages/domain ./packages/domain
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/LICENSE /app/.runtime/THIRD-PARTY-NOTICES.txt ./
COPY --from=build /app/.runtime/native-licenses ./native-licenses
COPY scripts/backup.mjs scripts/export.mjs scripts/restore.mjs ./scripts/
RUN sed -i 's|apps/server/src/|apps/server/dist/|g; s|\.ts|.js|g' scripts/*.mjs \
    && test "$(node --version)" = v24.21.0 \
    && pg_dump --version | grep '16.14' \
    && pg_restore --version | grep '16.14' \
    && node --input-type=module -e "await import('./apps/server/dist/portability.js'); await import('./apps/server/dist/operations.js')"
# Intentionally privileged local operator: reads service-owned private media and
# writes protected host archives. No PostgreSQL server entrypoint or daemon.
ENTRYPOINT ["node"]
CMD ["--help"]

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --from=runtime-dependencies /app/package.json /app/package-lock.json ./
COPY --from=build /app/LICENSE /app/.runtime/THIRD-PARTY-NOTICES.txt ./
COPY --from=build /app/.runtime/native-licenses ./native-licenses
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=runtime-dependencies /app/packages/domain ./packages/domain
COPY --from=runtime-dependencies /app/apps/server ./apps/server
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /var/lib/mems-life/media && chown -R node:node /var/lib/mems-life
USER node
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]
