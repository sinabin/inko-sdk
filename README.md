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
- Native PDF text selection/copy plus Unicode literal search across virtualized pages
- PDF.js native annotations, safe internal/external links, and AcroForm display/input
- `exportPdf()` for an `ArrayBuffer` containing current AcroForm values
- `exportFlattenedPdf()` for a standalone PDF with AcroForms plus supported Inko
  drawing types burned into page content; omissions and failures are reported per item
- Pen, highlighter, eraser, text, shape, selection, zoom, and thumbnail tools
- A bookmark panel built from the PDF's embedded outline, shown only when the
  document actually carries one
- Editable state export and restoration through `canvasData`
- Review-state overlays through `loadUserCanvasOverlay()`
- Exactly-one version-history selection when one overlay entry declares `isCurrent: true`
- A browser/iframe SDK exposed through `Inko.mount()`
- Theme, tool, and Korean/English UI configuration

The viewer uses PDF.js's public `TextLayerBuilder` and `AnnotationLayerBuilder`
with one document-level `annotationStorage`, keeps high-DPI canvas rendering and
DOM layers on the same logical viewport, and virtualizes offscreen pages. These
are the same classes of rendering, text, form-state, and lifecycle concerns
expected from a production PDF integration, while remaining inspectable OSS.

Inko does **not** provide a server-side repository, authentication,
authorization, version numbering, append-only storage, backup, retention,
audit logs, Git diff/merge/branch features, or a collaboration backend. Those
belong to the host application.

## Why Inko instead of PDF.js's built-in annotation editor?

Inko is built **on** PDF.js and uses its public `TextLayerBuilder` and
`AnnotationLayerBuilder`. PDF.js also ships its own `AnnotationEditorLayer`
(ink, highlight, free text, stamp). If that covers your case, use it — it is
already in your bundle and Inko is not trying to replace it.

The two solve different storage problems.

| | PDF.js `AnnotationEditorLayer` | Inko |
| --- | --- | --- |
| Where edits live | Inside the PDF, as native annotations | In a separate `canvasData` string your app stores |
| Original PDF bytes | Rewritten on `saveDocument()` | Left untouched |
| Number of simultaneous states | One — the document's own annotation set | Many, overlaid and toggled independently |
| Comparing two reviewers' markup | Open two files | `loadUserCanvasOverlay()` in one view |
| Resuming from a chosen past state | Not modeled | `isCurrent` selection, then continue editing |
| Interop with Acrobat/Chrome viewer | Native, immediate | Only after `exportFlattenedPdf()` |

The distinction that matters: **PDF.js's editor makes the PDF the system of
record. Inko keeps your database the system of record and leaves the PDF as an
immutable input.** If five reviewers each mark up the same contract, PDF.js
gives you five PDFs. Inko gives you one PDF and five `canvasData` rows you can
overlay, diff visually, and resume from.

Inko does not force the choice. It also renders PDF.js native annotations and
AcroForm fields, and `exportPdf()` returns `saveDocument()` bytes with current
form values.

**Choose PDF.js's editor when** annotations should travel with the file, one
annotation set per document is enough, and Acrobat interoperability is the
priority.

**Choose Inko when** review state belongs in your own storage next to
permissions and versioning, several reviewers' markup must be visible at once,
and editing must resume from a state your application selects.

### When Inko is the wrong choice

Be aware of these limits before adopting:

- **Digital signatures, certification, and redaction are not implemented.** Use
  a commercial SDK if these are requirements.
- **Inko drawings are not PDF-standard annotations** until you call
  `exportFlattenedPdf()`, which burns them into page content and is not
  reversible.
- **There is no backend.** Storage, authentication, authorization, version
  numbering, retention, and audit logging are yours to build.
- **There is no support contract.** No SLA, no LTS, no guaranteed response time.
  Issues and pull requests are handled on a best-effort basis.

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

  // Separate binary path: native AcroForm values are written into PDF bytes.
  const pdfBytes = await viewer.exportPdf()

  // Delivery copy: AcroForms + every current Inko drawing, no canvasData embedded.
  const { pdfBytes: deliveryPdf, report } = await viewer.exportFlattenedPdf()
  if (report.hasFailures) throw new Error('Some annotations could not be flattened')
</script>
```

`canvasData`, `exportPdf()`, and `exportFlattenedPdf()` are deliberately separate contracts.
`canvasData` preserves Inko's editable Paper.js drawing/review state;
`exportPdf()` returns PDF.js `saveDocument()` bytes with native AcroForm state.
It does not merge Inko drawings. `exportFlattenedPdf()` starts from those saved
AcroForm bytes and writes pen, highlighter, text, rectangle, circle, and line
objects into every affected PDF page. The result is portable but no longer an
editable Inko state, so hosts that need resume-editing must still persist
`canvasData`. Inspect `report.hasFailures`; a content rewrite also cannot preserve
an existing CMS/PAdES cryptographic signature. Helvetica-compatible PointText
stays PDF text. Other Unicode PointText is rendered with the bundled OFL
Pretendard font into a high-resolution transparent image and reported as
`TEXT_RASTERIZED`; that fallback text is visual content rather than selectable
PDF text. Pretendard is loaded only when this fallback is needed.

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

The release workflow creates two separate GitHub attestations for the same
tarball: SLSA build provenance and a CycloneDX SBOM attestation. Verify their
signatures and repository identity with:

```bash
gh attestation verify inko-pdf-sdk-1.2.0.tgz --repo sinabin/inko-sdk
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
