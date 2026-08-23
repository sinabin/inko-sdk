# Inko OSS asset provenance register

Status: internal pre-release evidence. This register does not grant an Inko
project license and is not a public-release approval.

## Source-owned synthetic PDF

- File: `public/samples/inko-demo.pdf`
- Generator: `scripts/generate-oss-sample-pdf.py`
- SHA-256: `2C30C70BF5F8A4DDE4706E9BC877A5F781DEBF899C4DB24446007216D15953AC`
- Properties checked: 12 A4 pages, NextH author metadata, 8,076 extracted text
  characters, Helvetica/Helvetica-Bold Base14 references only, no embedded images
- Content boundary: synthetic NextH copy only; no customer, government, partner,
  personal, or third-party document content

## Liberation Sans

- Upstream: `liberationfonts/liberation-fonts` official 2.1.5 TTF release
- Archive: `liberation-fonts-ttf-2.1.5.tar.gz`
- Source URL: `https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz`
- Archive SHA-256: `7191C669BF38899F73A2094ED00F7B800553364F90E2637010A69C0E268F25D0`
- License: SIL Open Font License 1.1, copied to
  `public/standard_fonts/LICENSE_LIBERATION`

| File | SHA-256 |
| --- | --- |
| `LiberationSans-Regular.ttf` | `76D04C18EA243F426B7DE1F3AD208E927008F961DC5945E5AAD352D0DFDE8EE8` |
| `LiberationSans-Bold.ttf` | `788ABEE4C806D660E8AEE46689DD8540CD4BB98DA03DCC9D171CE3EFD99A9173` |
| `LiberationSans-Italic.ttf` | `E5BAE5C4CDE31F22142753855F4F8FB86DA6FF39955ED3C0A11248B0D16948B0` |
| `LiberationSans-BoldItalic.ttf` | `698DA70FC191CC5F33AD4D6D3FE830FE4624B898EA2E3169955928B7C491F1EE` |

The previous 1.07.4 binaries were removed because their embedded license metadata
did not match the copied OFL notice.

## PDF.js worker, Foxit fonts, and Adobe CMaps

- Version source: installed, locked `pdfjs-dist` 5.4.624 package
- Worker license: Apache-2.0; full copy in
  `public/third_party_licenses/pdfjs-dist-Apache-2.0.txt`
- Worker distribution change: dangling `sourceMappingURL` comment removed; license
  header retained
- Foxit font files and `LICENSE_FOXIT`: copied from the locked package and checked
  byte-for-byte by `scripts/check-oss-boundary.mjs`
- Adobe CMaps and `cmaps/LICENSE`: copied from the locked package and checked
  byte-for-byte by `scripts/check-oss-boundary.mjs`

## Verification rule

`npm run build` fails if the synthetic fixture is missing, an old rights-unknown
PDF returns, the approved Liberation 2.1.5 hashes change, PDF.js support assets
diverge from the locked dependency, a source map is emitted, or development mock
code appears in the production bundle.
