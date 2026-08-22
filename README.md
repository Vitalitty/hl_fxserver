# HL FXServer

A small Linux Docker image for Cfx.re FXServer, usable for FiveM or RedM. The repository checks the official artifact index hourly, tracks the latest and labeled release channels, and publishes images to GitHub Container Registry (GHCR).

## Automation

The workflow in `.github/workflows/fxserver-image.yml` runs at minute 28 of every hour. It:

1. tests the parser;
2. reads the Cfx.re Linux artifact index;
3. records `latest`, `recommended`, and `optional` when available;
4. updates the Dockerfile's pinned default artifact;
5. commits changed state and creates an immutable numeric Git tag for a new latest build;
6. publishes channel images to `ghcr.io/<owner>/<repository>`.

Published container tags are:

- `<build-number>` and `latest` for the newest artifact;
- `recommended` for the Cfx.re recommended artifact;
- `optional` only while Cfx.re provides an optional artifact.

The parser does not assume that optional exists, and it keeps `latest` separate from `recommended`.
If Cfx.re removes the optional channel, the workflow stops updating that alias; it does not delete an older `optional` tag from GHCR.

## GitHub setup

No registry secret is required. The workflow uses `GITHUB_TOKEN`. In the repository settings:

1. enable GitHub Actions;
2. allow workflows read/write access if the organization restricts `GITHUB_TOKEN`;
3. allow the workflow to push to the default branch, or add an appropriate branch-protection exception;
4. configure the published GHCR package visibility as required.

The initial push to `main` or `master`, or a manual workflow run with `force_publish`, publishes the tracked versions.

## Run FiveM

```console
docker run --rm -it \
  -p 30120:30120/tcp \
  -p 30120:30120/udp \
  -v ./server.cfg:/opt/cfx-server/server.cfg:ro \
  -v ./resources:/opt/cfx-server/resources \
  ghcr.io/<owner>/<repository>:recommended \
  +exec server.cfg
```

## Run RedM

```console
docker run --rm -it \
  -p 30120:30120/tcp \
  -p 30120:30120/udp \
  -v ./server.cfg:/opt/cfx-server/server.cfg:ro \
  -v ./resources:/opt/cfx-server/resources \
  ghcr.io/<owner>/<repository>:recommended \
  +exec server.cfg +set gamename rdr3
```

Expose `40120/tcp` as well when using the txAdmin web interface.

## Local checks

```console
node --test
node scripts/check-fxserver-versions.mjs --json
```

The checker is read-only by default. To update the tracked state and Dockerfile intentionally:

```console
node scripts/check-fxserver-versions.mjs --write
```

To build a particular artifact instead of the pinned latest URL:

```console
docker build \
  --build-arg FXSERVER_ARTIFACT_URL=https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/<build>/fx.tar.xz \
  -t hl-fxserver .
```

This repository packages the upstream server binary; it does not provide `server.cfg`, resources, a Cfx.re license key, or a database.
