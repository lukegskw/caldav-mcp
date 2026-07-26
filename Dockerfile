FROM node:24-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.25.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm prune --prod

FROM node:24-bookworm-slim

ENV NODE_ENV=production

RUN groupadd --gid 10001 caldav \
    && useradd --create-home --uid 10001 --gid 10001 caldav
WORKDIR /app

COPY --from=builder --chown=caldav:caldav /app/node_modules ./node_modules
COPY --from=builder --chown=caldav:caldav /app/dist ./dist
COPY --from=builder --chown=caldav:caldav /app/package.json ./package.json

USER caldav
EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=3s --retries=3 --start-period=10s \
  CMD ["node", "-e", "const net=require('node:net');const socket=net.createConnection({host:'127.0.0.1',port:8100},()=>{socket.end();process.exit(0)});socket.setTimeout(2000,()=>{socket.destroy();process.exit(1)});socket.on('error',()=>process.exit(1))"]

ENTRYPOINT ["node", "dist/main.js"]
