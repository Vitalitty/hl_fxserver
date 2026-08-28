FROM alpine:3.24 AS download

ARG FXSERVER_ARTIFACT_URL=https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/35574-5c8481b36c2dc65ee7c8e9f5d9bf283f03e2f36e/fx.tar.xz

RUN apk add --no-cache ca-certificates curl tar xz
SHELL ["/bin/ash", "-eo", "pipefail", "-c"]
RUN set -eux; \
    mkdir -p /srv; \
    curl --fail --location --silent --show-error "${FXSERVER_ARTIFACT_URL}" \
      | tar -xJ -C /srv

FROM scratch

COPY --from=download /srv/alpine/ /

RUN apk add --no-cache ca-certificates openssl
RUN addgroup -g 1000 -S cfx \
    && adduser -u 1000 -S cfx -G cfx \
    && mkdir -p /txData \
    && chown cfx:cfx /txData

USER cfx
WORKDIR /opt/cfx-server

EXPOSE 30120/tcp 30120/udp 40120/tcp

ENTRYPOINT ["/opt/cfx-server/ld-musl-x86_64.so.1", "--library-path", "/usr/lib/v8/:/usr/lib/", "--", "FXServer", "+set", "citizen_dir", "/opt/cfx-server/citizen/"]
