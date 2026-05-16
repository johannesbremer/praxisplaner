# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update -qq \
  && apt-get install --no-install-recommends -y ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

ARG UID=10001

RUN adduser \
  --disabled-password \
  --gecos "" \
  --home "/app" \
  --shell "/sbin/nologin" \
  --uid "${UID}" \
  appuser

RUN chown -R appuser:appuser /app

USER appuser

ENV NODE_ENV=production

CMD ["pnpm", "start:telefonki"]
