# Inko third-party notices

This file identifies third-party material in the Inko source checkout and the
prebuilt npm package. Inko itself is licensed under Apache License 2.0;
third-party material remains under the licenses listed below.

This notice is distributed in multiple layouts. "Viewer root" means:

- `public/` in a source checkout
- the current directory in a built or deployed viewer
- `viewer/` in the npm package

All asset and license paths below are relative to the viewer root. From the
npm package's top-level copy of this notice, prepend `viewer/` to those paths.

## Software bundled in the npm artifact

The release SBOM generator checks this table against non-empty JavaScript in
the generated npm tarball. Versions and registry integrity for locked packages
come from `package-lock.json`; the vendored Acorn version is read from the
locked Paper.js distribution and confirmed in the generated bundle.

<!-- inko-artifact-components:start -->
| Component | Version | License | Viewer-root license path |
| --- | --- | --- | --- |
| `@pdf-lib/standard-fonts` | 1.0.0 | MIT | `third_party_licenses/pdf-lib-standard-fonts-MIT.md` |
| `@pdf-lib/upng` | 1.0.1 | MIT | `third_party_licenses/pdf-lib-upng-MIT.txt` |
| `acorn` | 0.5.0 | MIT | `third_party_licenses/acorn-0.5.0-MIT.txt` |
| `acorn` | 8.18.0 | MIT | `third_party_licenses/acorn-MIT.txt` |
| Liberation Fonts | 2.1.5 | OFL-1.1 | `standard_fonts/LICENSE_LIBERATION` |
| `pako` | 1.0.11 | MIT AND Zlib | `third_party_licenses/pako-MIT-Zlib.txt` |
| `paper` | 0.12.18 | MIT | `third_party_licenses/paper-MIT.txt` |
| `pdf-lib` | 1.17.1 | MIT | `third_party_licenses/pdf-lib-MIT.md` |
| `pdfjs-dist` | 5.4.624 | Apache-2.0 | `third_party_licenses/pdfjs-dist-Apache-2.0.txt` |
| `pretendard` | 1.3.9 | OFL-1.1 | `third_party_licenses/pretendard-OFL-1.1.txt` |
| `svelte` | 5.56.10 | MIT | `third_party_licenses/svelte-MIT.txt` |
| `tslib` | 1.14.1 | 0BSD | `third_party_licenses/tslib-0BSD.txt` |
| `vite` | 7.3.6 | MIT | `third_party_licenses/vite-runtime-MIT.txt` |
<!-- inko-artifact-components:end -->

Paper.js contains its vendored Acorn 0.5.0 parser and also resolves the locked
Acorn runtime during the browser build. Both implementations are therefore
listed separately. Its full distribution also incorporates Straps.js-derived
code; the corresponding copyright and MIT terms are at
`third_party_licenses/straps-MIT.txt`.

The `pako` notice path listed in the table contains both its MIT terms and the
complete zlib-derived notice, including the redistribution conditions and
Inko's bundling/minification change statement.

## Source dependencies not present in the current npm browser bundle

No production dependency is source-only in the current browser artifact. The
release check fails if the evidence and these tables diverge.

<!-- inko-source-only-components:start -->
| Component | Version | License | Viewer-root license path |
| --- | --- | --- | --- |
<!-- inko-source-only-components:end -->

## PDF support assets

- `pdf.worker.mjs` is derived from `pdfjs-dist` 5.4.624. Inko removes only the dangling
  `sourceMappingURL` comment from the distributed copy; the Apache-2.0 header
  remains intact.
- `cmaps/*.bcmap` comes from `pdfjs-dist` 5.4.624. Adobe's redistribution
  notice is at `cmaps/LICENSE`.
- `pdfjs-images/annotation-*.svg` comes from `pdfjs-dist` 5.4.624. The
  Apache-2.0 license copy is at `pdfjs-images/LICENSE.pdfjs-dist`, and the
  byte-level integrity manifest is at `pdfjs-images/manifest.json`.
- `standard_fonts/Foxit*.pfb` comes from `pdfjs-dist` 5.4.624. Its
  redistribution terms are at `standard_fonts/LICENSE_FOXIT`.
- `standard_fonts/LiberationSans-*.ttf` comes from the official Liberation
  Fonts 2.1.5 TTF release and is licensed under SIL Open Font License 1.1.
  The license is at `standard_fonts/LICENSE_LIBERATION`.
- `assets/Pretendard-Regular-*.woff2` comes from the locked Pretendard 1.3.9
  package and ships as a viewer asset. It is loaded only when flattened export
  must render PointText that Helvetica cannot encode; the resulting text is a
  transparent PNG, not an embedded font. Its SIL Open Font License 1.1 copy is at
  `third_party_licenses/pretendard-OFL-1.1.txt`.

Third-party names and marks belong to their respective owners. They are listed
only to identify source and license obligations.
