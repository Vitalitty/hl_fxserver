# FXServer image automation

## Objective

Maintain a self-contained Docker image repository for the Linux FXServer artifact used by FiveM and RedM. The repository must discover Cfx.re artifact changes, record the selected versions, update the pinned Docker build, create immutable version tags, and publish channel images without relying on a second repository.

## Source of truth

- Read artifacts from `https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/`.
- Accept only archive links whose final path is `<numeric-build>-<40-hex-commit>/fx.tar.xz` on the configured Cfx.re origin.
- Derive `latest` from the greatest numeric build present in valid archive links.
- Derive `recommended` and `optional` from their labels in the index HTML.
- Labeled channels are independent from `latest`; for example, the newest artifact can be newer than the recommended artifact.
- A missing optional label is valid and must be stored as `null`. Missing `latest` or `recommended` is an error and must not modify tracked state.

## Tracked state and Dockerfile

- Store the resolved source URL and channel objects in `data/fxserver-versions.json`.
- Keep the default `FXSERVER_ARTIFACT_URL` build argument in `Dockerfile` pinned to the tracked `latest.url`.
- Only rewrite state and the Dockerfile when the resolved channel data changes.
- Download with curl failure flags so HTTP errors fail the image build.
- Run FXServer as the unprivileged `cfx` user with UID/GID 1000.
- Expose `30120/tcp`, `30120/udp`, and `40120/tcp`.
- Support FiveM by default and RedM through the runtime arguments `+set gamename rdr3`.

## Automation workflow

1. Run on an hourly schedule at minute 28, on manual dispatch, and when automation-related files are pushed.
2. Fetch and parse the artifact index with the repository's Node script.
3. Compare the resolved channels with `data/fxserver-versions.json`.
4. If changed, update the state file and Dockerfile, commit only those two files, and push to the triggering/default branch.
5. If `latest` changed and its numeric Git tag does not exist, create and push that immutable tag. Never move an existing version tag.
6. Publish images in the same workflow because pushes made with `GITHUB_TOKEN` do not trigger another workflow.
7. Publish to `ghcr.io/<owner>/<repository>` using `GITHUB_TOKEN`:
   - tracked latest artifact: `<version>` and `latest`
   - tracked recommended artifact: `<version>` and `recommended`
   - tracked optional artifact, when present: `optional`
8. On scheduled artifact checks, publish only channels whose resolved artifact
   changed. A missing optional artifact is not publishable and must not create an
   empty build matrix.
9. On automation-related pushes and forced manual runs, publish every available
   channel so Dockerfile and automation changes reach all mutable tags.
10. Build only `linux/amd64`, matching the downloaded FXServer artifact.
11. Use workflow concurrency to prevent overlapping state updates.

## Parser and test requirements

- Use Node.js built-ins only; do not require runtime npm dependencies for the checker.
- Parse quoted and unquoted `href` attributes and tolerate whitespace or markup inside labels.
- Resolve relative artifact links against the configured index URL.
- Deduplicate repeated links before choosing the greatest numeric build.
- Emit stable GitHub Actions outputs for change status, versions, and URLs.
- Include fixture-based tests covering:
  - separate latest, recommended, and optional builds;
  - a combined `LATEST RECOMMENDED` label with no optional build;
  - malformed or foreign artifact links;
  - failure when required channels are missing.
- Test build-matrix selection, numeric recommended tags, full forced
  publication, and deduplication when channels share an artifact.

## Validation

- Run `node --test` after script changes.
- Run the checker in read-only mode against a fixture and, when network access is available, against the live artifact index.
- Validate workflow YAML structure and inspect the final Git diff.
- Do not build or push a container during local validation unless explicitly requested.

## Change discipline

- Keep automation narrowly focused on FXServer artifact discovery and image publishing.
- Do not commit credentials. GHCR authentication must use the workflow-provided token.
- Preserve user changes and stage only explicit paths in automation.
- Document required GitHub Actions permissions and the container usage examples in `README.md`.
