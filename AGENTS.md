# FXServer image automation

## Objective

Maintain a self-contained Docker image repository for the Linux FXServer artifact used by FiveM and RedM. The repository must discover Cfx.re's latest and recommended artifact changes, record both selected versions, update the pinned Docker build, create immutable version tags, and publish channel images without relying on a second repository.

## Source of truth

- Read channel data from `https://docs.fivem.net/docs/server-download/?platform=legacy&os=linux`.
- Read the `latest` and `recommended` versions from the embedded Next.js
  `legacy.latest.linux` and `legacy.recommended.linux` channel data used by the
  page's Update Branch selector.
- Accept only archive URLs whose final path is
  `<numeric-build>-<40-hex-commit>/fx.tar.xz` under
  `https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/`.
- Require each displayed `build <number>` subtitle to match the build number in
  its validated archive URL.
- Derive `latest` from the greatest numeric build in the latest channel and
  derive `recommended` independently from the recommended channel.
- Missing or inconsistent `latest` or `recommended` data is an error and must
  not modify tracked state.

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
2. Fetch and parse the Server Download page with the repository's Node script.
3. Compare the resolved channels with `data/fxserver-versions.json`.
4. If changed, update the state file and Dockerfile, commit only those two files, and push to the triggering/default branch.
5. If `latest` changed and its numeric Git tag does not exist, create and push that immutable tag. Never move an existing version tag.
6. Publish images in the same workflow because pushes made with `GITHUB_TOKEN` do not trigger another workflow.
7. Publish to `ghcr.io/<owner>/<repository>` using `GITHUB_TOKEN`:
   - tracked latest artifact: `<version>` and `latest`
   - tracked recommended artifact: `<version>` and `recommended`
8. On scheduled artifact checks, publish only channels whose resolved artifact
   changed. No unchanged artifact should be rebuilt or pushed.
9. On automation-related pushes and forced manual runs, publish every available
   channel so Dockerfile and automation changes reach all mutable tags.
10. Build only `linux/amd64`, matching the downloaded FXServer artifact.
11. Use workflow concurrency to prevent overlapping state updates.

## Parser and test requirements

- Use Node.js built-ins only; do not require runtime npm dependencies for the checker.
- Parse the current `__NEXT_DATA__` legacy Linux channel data.
- Deduplicate repeated links before choosing the greatest numeric build.
- Emit stable GitHub Actions outputs for change status, versions, and URLs.
- Include fixture-based tests covering:
  - separate latest and recommended builds;
  - malformed or foreign artifact links;
  - a displayed build number that does not match its archive URL;
  - failure when required channels are missing.
- Test build-matrix selection, numeric recommended tags, full forced
  publication, and deduplication when channels share an artifact.

## Validation

- Run `node --test` after script changes.
- Run the checker in read-only mode against a fixture and, when network access is available, against the live Server Download page.
- Validate workflow YAML structure and inspect the final Git diff.
- Do not build or push a container during local validation unless explicitly requested.

## Change discipline

- Keep automation narrowly focused on FXServer artifact discovery and image publishing.
- Do not commit credentials. GHCR authentication must use the workflow-provided token.
- Preserve user changes and stage only explicit paths in automation.
- Document required GitHub Actions permissions and the container usage examples in `README.md`.
