# HL FXServer

A small Linux Docker image for Cfx.re FXServer, usable for FiveM or RedM. The repository checks the official Server Download page hourly, tracks its latest and recommended Linux branches, and publishes images to GitHub Container Registry (GHCR).

## Automation

The workflow in `.github/workflows/fxserver-image.yml` runs at minute 28 of every hour. It:

1. tests the parser;
2. reads the legacy Linux `latest` and `recommended` channel data used by the
   Cfx.re Server Download page;
3. records both channel versions and validated archive URLs;
4. updates the Dockerfile's pinned default artifact;
5. commits changed state and creates an immutable numeric Git tag for a new latest build;
6. publishes changed channels to `ghcr.io/<owner>/<repository>`; repository
   pushes and forced manual runs rebuild every available channel.

Published container tags are:

- `<build-number>` and `latest` for the newest artifact;
- `<build-number>` and `recommended` for the Cfx.re recommended artifact.

The checker keeps `latest` separate from `recommended`, because Cfx.re can
recommend an older build than the newest available artifact.
An hourly run publishes nothing when no channel changed. When only one channel
changes, unchanged channels are not rebuilt or pushed.

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
