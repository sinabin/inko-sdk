# Contributing to Inko

Thank you for considering a contribution. Inko is a free, self-service open
source project. Issues and pull requests are public collaboration channels, not
individual technical-support channels. Review, response, acceptance, and release
timing remain at the maintainers' discretion; no response time is promised.

## Before contributing

- Search existing issues and pull requests before opening a new one.
- Keep each change narrowly scoped and explain the user-visible reason for it.
- Add or update tests and documentation when behavior changes.
- Use synthetic, non-confidential fixtures. Do not submit customer documents,
  production data, credentials, secrets, access tokens, private URLs, or
  unnecessary personal information.
- Do not submit code, fonts, PDFs, images, or other material unless you have the
  right to contribute it under the applicable open source license. Identify the
  source, version, license, and required notices for every new third-party item.

## Architecture and state ownership

Read [the architecture guide](docs/architecture.md) before changing viewer
state or lifecycle code. A state value or disposable resource should have one
owner; other layers receive getters, commands, callbacks, or narrow ports.

| State or resource | Owner | Contribution rule |
| --- | --- | --- |
| PDF document, load generation, native `annotationStorage` | `pdfLoader` | Do not duplicate document identity or native-form state in components. |
| Zoom, fit-width, pointer/keyboard listeners | `viewerInteractionController` | Attach and detach listeners through the controller lifecycle. |
| Review entries, current editable version, history-panel mode | `viewerReviewController` | Keep host version metadata separate from editable page state. |
| Host transport and message-driven document load | `viewerBridgeController` | Validate at the bridge boundary and suppress stale async completions. |
| Visibility, render queue/FSM/cache, PDF.js render tasks | `scrollMode` | Cancel owned tasks and reject completions from an old lifecycle generation. |
| Canonical page-keyed Paper JSON for the current document | `documentCanvasStore` | Update through store operations; do not assemble competing component-local maps. |
| Live page managers and Paper scopes | `PageCanvasRegistry` | Snapshot before detach and dispose exactly once. |
| TextLayer, AnnotationLayer, StructTree DOM | `PdfPageDomLayers` | Build from the matching page, logical viewport, and annotation canvas map. |
| Persistent storage, identity, authorization, versions, backups | Host application | Do not move host responsibilities into the SDK. |

Any async operation that can outlive its document, page, component, or DOM node
must capture a generation or identity token and re-check it before mutating
state, cache, DOM, or invoking an external callback. Add a test in which
cancellation is requested but the underlying promise still resolves late.

## Public and internal APIs

An `export` keyword in the source tree does not by itself make an API public.
The root workspace is private; only the curated `release/` package is published.

| Surface | Status | Required treatment |
| --- | --- | --- |
| `sdk/inko-sdk.js`, `sdk/inko-sdk.d.ts`, `window.Inko` | Public | Preserve documented runtime and type behavior or make an explicit semver decision. |
| `Inko.mount()`, `ViewerOptions`, `ViewerInstance`, callbacks | Public | Update JS, declarations, README/integration docs, and consumer tests together. |
| `canvasData`, review-entry semantics, SDK↔viewer message schema | Compatibility-sensitive | Keep runtime validation and both sides of the bridge synchronized; test round trips. |
| `viewer/index.html` self-hosted entry | Public deployment entry | Keep the entry loadable; hashed asset names are implementation details. |
| `src/components/**`, `src/lib/**`, controllers, ports, Svelte props | Internal | Refactor freely only with behavior and lifecycle regression coverage. |
| `src/lib/index.ts` exports | Internal source convenience | Do not document them as package imports unless they are deliberately added to the release package. |

Public API additions should be small and justified by a host integration need.
They require runtime implementation, matching declarations, documentation,
installed-package verification, and a compatibility review. Internal types
must not leak into the public declaration file accidentally.

## Change-to-test matrix

Run the narrowest relevant tests while iterating, then run the complete required
checks before submitting. The rows below are minimum coverage, not substitutes
for tests specific to a regression.

| Changed area | Minimum focused verification |
| --- | --- |
| Browser SDK, public declarations, bridge or message payloads | `pdfvSdk.lifecycle`, `postMessageBridge`, and `viewerBridgeController` unit tests; `sdk-roundtrip` and `cross-origin-bridge` E2E; `npm run build:pkg`; `npm run test:release-install` |
| `canvasData`, document store, page manager/registry, history | Relevant store/registry/coordinator unit tests; `page-revisit` and `sdk-roundtrip` E2E |
| Page/component lifecycle, timers, listeners, async generations | A destroy/document-replace race test plus the nearest component/controller unit suite |
| PDF.js render, TextLayer, AnnotationLayer, links, forms, search | Matching PDF adapter unit tests; `text-search-copy`, `native-annotations-forms`, or `bookmarks` E2E as applicable |
| Scroll, visibility, render cache, zoom or high-DPI behavior | Scroll/cache/interaction unit tests; `zoom-interactions` E2E; `npm run test:perf` for performance-sensitive changes |
| Toolbar, panels, keyboard, accessibility, locale or theme | Component/policy/accessibility unit tests; `accessibility`, `apply-config`, and relevant visual checks |
| Dependencies, bundled assets, sample fixtures or release scripts | `npm run test:oss-boundary`; `npm run build`; `npm run build:pkg`; release-package and installed-tarball verification |

The full pre-submission baseline is:

```bash
npm run check
npm run test:coverage
npm run build
npm run test:e2e
```

Also run `npm run test:perf` when render, virtualization, cache, zoom, worker, or
asset-loading behavior changes. Use `npm run test:visual` and the review
checklist for intentional UI changes; do not accept a new screenshot merely
because it differs.

## License and Developer Certificate of Origin

Inko is licensed under the Apache License 2.0. By intentionally submitting a
contribution for inclusion in Inko, you submit it under the Apache License 2.0 as
described in Section 5 of that license.

Every commit must also be certified under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/) by
including a `Signed-off-by` line:

```text
Signed-off-by: Your Name <your-public-email@example.com>
```

The usual command is:

```bash
git commit --signoff
```

The sign-off certifies that you created the contribution or otherwise have the
right to submit it. Do not sign on behalf of another person unless you are
authorized to do so. If you contribute for an employer or another organization,
confirm that you have authority to submit the contribution.

## Public-record and privacy notice

The repository, issues, pull requests, reviews, commits, and DCO sign-offs are
public. The contribution record—including the name and email address you choose
to place in Git metadata or the sign-off—may be retained indefinitely and
redistributed with the project.

Use only the minimum public attribution information needed for your contribution.
A public Git hosting no-reply address may be used when it accurately identifies
the contributing account. Do not add telephone numbers, home addresses,
government identifiers, customer identities, or other unrelated personal data.
Before attaching logs, screenshots, PDFs, or recordings, replace real data with
a minimal synthetic reproduction and remove metadata. If confidential data or a
secret is exposed accidentally, do not repeat it in a public issue; follow
`SECURITY.md` immediately.

## AI-assisted contributions

If generative AI materially assisted the change, state in the pull request:

- the tool used;
- what a human reviewed and tested; and
- how you checked that third-party code, confidential material, or incompatible
  license terms were not introduced.

The contributor remains responsible for the accuracy, security, provenance, and
licensing of the contribution.

## Submission checklist

- [ ] The change is narrowly scoped and documented.
- [ ] Relevant automated checks pass.
- [ ] Every commit contains a valid `Signed-off-by` line.
- [ ] No customer data, secrets, or unnecessary personal information is present.
- [ ] New third-party material has complete provenance and license notices.
- [ ] AI assistance, if material, is disclosed and human-reviewed.

Maintainers may close or decline any issue or contribution, including changes
that expand maintenance, security, compatibility, or support obligations beyond
the project's published scope.
