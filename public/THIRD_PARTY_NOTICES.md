# Inko third-party notices

This file identifies third-party material included in Inko. Inko itself is
licensed under Apache License 2.0; third-party material remains under the
licenses listed below.

| Component | Version | License | Included license copy |
| --- | --- | --- | --- |
| PDF.js (`pdfjs-dist`) | 5.4.624 | Apache-2.0 | `viewer/third_party_licenses/pdfjs-dist-Apache-2.0.txt` |
| Paper.js (`paper`) | 0.12.18 | MIT | `viewer/third_party_licenses/paper-MIT.txt` |
| pdf-lib | 1.17.1 | MIT | `viewer/third_party_licenses/pdf-lib-MIT.md` |
| `@pdf-lib/standard-fonts` | 1.0.0 | MIT | `viewer/third_party_licenses/pdf-lib-standard-fonts-MIT.md` |
| `@pdf-lib/upng` | 1.0.1 | MIT | `viewer/third_party_licenses/pdf-lib-upng-MIT.txt` |
| pako | 1.0.11 | MIT AND Zlib | `viewer/third_party_licenses/pako-MIT-Zlib.txt` |
| tslib | 1.14.1 | 0BSD | `viewer/third_party_licenses/tslib-0BSD.txt` |
| Svelte | 5.56.10 | MIT | `viewer/third_party_licenses/svelte-MIT.txt` |

## PDF support assets

- `pdf.worker.mjs` is derived from `pdfjs-dist` 5.4.624. Inko removes only the
  dangling `sourceMappingURL` comment from the distributed copy; the Apache-2.0
  header remains intact.
- `viewer/cmaps/*.bcmap` comes from `pdfjs-dist` 5.4.624. Adobe's redistribution notice
  is included at `viewer/cmaps/LICENSE`.
- `viewer/standard_fonts/Foxit*.pfb` comes from `pdfjs-dist` 5.4.624. Its redistribution
  terms are included at `viewer/standard_fonts/LICENSE_FOXIT`.
- `viewer/standard_fonts/LiberationSans-*.ttf` comes from the official Liberation Fonts
  2.1.5 TTF release and is licensed under SIL Open Font License 1.1. The license
  is included at `viewer/standard_fonts/LICENSE_LIBERATION`.

Third-party names and marks belong to their respective owners. They are listed
only to identify source and license obligations.
