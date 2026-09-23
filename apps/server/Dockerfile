# char.pub 服务端镜像：api、admin、worker 三个进程和迁移命令共用这一个镜像。
#   docker build -f apps/server/Dockerfile -t charpub-server .
#   docker run charpub-server api|admin|worker|migrate
#
# 构建阶段在完整的 workspace 中编译所有包，再用 `pnpm deploy` 取出 server 及其生产依赖，
# 运行阶段只包含编译产物、生产依赖和迁移 SQL，以非 root 用户运行。

FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @char-pub/server... build
RUN pnpm --filter @char-pub/server deploy --prod /out

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
ENTRYPOINT ["node", "dist/main.js"]
CMD ["api"]
