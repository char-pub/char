# Local development and integration tests use the same source-built MinIO image.
# The upstream binary image/archive endpoints are no longer anonymously available.
FROM golang:1.24.13-bookworm AS build
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
# RELEASE.2025-09-07T16-13-09Z and RELEASE.2025-08-13T08-35-41Z, respectively.
RUN go install github.com/minio/minio@07c3a429bfed433e49018cb0f78a52145d4bedeb
RUN go install github.com/minio/mc@7394ce0dd2a80935aded936b09fa12cbb3cb8096
RUN mkdir /licenses && \
    cp /go/pkg/mod/github.com/minio/minio@*-07c3a429bfed/LICENSE /licenses/minio-LICENSE && \
    cp /go/pkg/mod/github.com/minio/mc@*-7394ce0dd2a8/LICENSE /licenses/mc-LICENSE

FROM alpine:3.22
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /go/bin/minio /go/bin/mc /usr/local/bin/
COPY --from=build /licenses /licenses
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
