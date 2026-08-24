# Inko

[![CI](https://github.com/sinabin/inko-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/sinabin/inko-sdk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/inko-pdf-sdk.svg)](https://www.npmjs.com/package/inko-pdf-sdk)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[한국어](README.ko.md) · [Developer documentation](https://nexth.co.kr/inko/docs/overview) · [Live demo](https://nexth.co.kr/pdfv/)

Inko is a free, open-source, self-hosted PDF annotation SDK. It lets a host
application load a PDF, export and restore editable annotation state, display
multiple review states as overlays, and continue editing from a state selected
by the host.

Inko is maintained by [NextH](https://nexth.co.kr/). The project is published
to make the implementation and its limits directly verifiable.

## What Inko provides

- PDF rendering powered by PDF.js
- Pen, highlighter, eraser, text, shape, selection, zoom, and thumbnail tools
- A bookmark panel built from the PDF's embedded outline, shown only when the
  document actually carries one
- Editable state export and restoration through `canvasData`
- Review-state overlays through `loadUserCanvasOverlay()`
- Exactly-one version-history selection when one overlay entry declares `isCurrent: true`
- A browser/iframe SDK exposed through `Inko.mount()`
- Theme, tool, and Korean/English UI configuration

Inko does **not** provide a server-side repository, authentication,
authorization, version numbering, append-only storage, backup, retention,
audit logs, Git diff/merge/branch features, or a collaboration backend. Those
belong to the host application.

## Install

```bash
npm install inko-pdf-sdk
```

Inko is self-hosted. Serve the package's `viewer/` directory from your web
server, and serve `sdk/inko-sdk.js` from a URL your application can load. A
same-origin deployment is the simplest starting point.

```bash
cp -R node_modules/inko-pdf-sdk/viewer public/inko-viewer
cp node_modules/inko-pdf-sdk/sdk/inko-sdk.js public/inko-sdk.js
```

```html
<div id="inko" style="height: 80vh"></div>
<script src="/inko-sdk.js"></script>
<script>
  let savedState = ''

  const viewer = Inko.mount('#inko', {
    src: '/inko-viewer/index.html',
    pdfUrl: '/documents/example.pdf',
    fileName: 'example.pdf',
    initialCanvasData: savedState || undefined,

    onChange(canvasData) {
      // Debounce and persist this value in the host application's storage.
      savedState = canvasData
    },

    onError(error) {
      console.error(error)
    },
  })
</script>
```

For cross-origin iframe deployments, configure `VITE_ALLOWED_ORIGINS` at build
time and apply the required HTTP CSP/CORS headers in the host environment. See
the [integration guide](docs/integration-guide.md) for the API and deployment
details.

## Responsibility boundary

The adopter is responsible for installation, hosting, integration, origin and
CSP policy, authentication, authorization, storage, backups, environment
validation, security updates, upgrades, rollback, and maintenance of any fork.

NextH does not provide individual technical support, an SLA, LTS, a guaranteed
response or remediation time, or compatibility guarantees for a particular
browser, iframe host, PDF collection, infrastructure, or future version. Public
issues and pull requests are reviewed on a best-effort basis and are not a
support channel.

## Develop from source

Requirements: Node.js 22.12 or newer and npm.

```bash
npm ci
npm test
npm run check
npm run build
```

The production build is written to `dist/`. The build includes an OSS-boundary
check that rejects unreviewed sample PDFs, development mocks, source maps, and
drift in reviewed PDF.js/font assets.

The repository root is intentionally marked `private` to block accidental npm
publication of the source workspace. `npm run build:pkg` creates the allowlisted
public package in `release/`; only the verified tarball from that directory is
published.

Browser integration tests require Playwright Chromium:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

## Verify a release

Each GitHub release includes the npm tarball, a CycloneDX SBOM, and
`SHA256SUMS`. Verify the downloaded files before installation:

```bash
sha256sum --check SHA256SUMS
npm audit signatures
```

GitHub build attestations can also be verified with:

```bash
gh attestation verify inko-pdf-sdk-1.0.1.tgz --repo sinabin/inko-sdk
```

## Documentation

- [Integration guide](docs/integration-guide.md)
- [Architecture](docs/architecture.md)
- [Data flow](docs/data-flow.md)
- [Asset provenance](docs/oss/asset-provenance.md)
- [Third-party notices](public/THIRD_PARTY_NOTICES.md)

## Security reports

Do not post suspected vulnerabilities in a public issue. Use GitHub's private
vulnerability reporting for this repository. See [Security policy](SECURITY.md).

## License

Inko is licensed under the [Apache License 2.0](LICENSE). Third-party components
and assets remain under their respective licenses; see
[THIRD_PARTY_NOTICES.md](public/THIRD_PARTY_NOTICES.md).
