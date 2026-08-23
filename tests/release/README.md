# Installed package release probe

This probe verifies the archive from a consumer's perspective instead of loading
the source tree or Vite development server.

It performs the following checks:

1. creates a new temporary npm project;
2. installs the supplied `.tgz` with the normal npm lifecycle behavior;
3. serves only the temporary project and its installed package over HTTP;
4. mounts the packaged iframe/postMessage SDK and production viewer at the same origin;
5. loads the packaged synthetic PDF;
6. draws a pen stroke, saves it, clears it, reloads it, and saves again;
7. rejects browser errors, failed requests, or a production bridge mock.

Run against the default root archive:

```powershell
node tests/release/verify-installed-tarball.mjs
```

Run against an explicit archive:

```powershell
node tests/release/verify-installed-tarball.mjs C:\path\to\inko-pdf-sdk-1.0.0.tgz
```

For a public release candidate, also enforce public Apache metadata and a
package-root project license:

```powershell
node tests/release/verify-installed-tarball.mjs C:\path\to\inko-pdf-sdk-1.0.0.tgz --expect-public
```

The `--expect-public` gate requires the exact package name `inko-pdf-sdk`,
Apache-2.0 package metadata, a package-root project `LICENSE`, and the absence
of legacy Android bridge globals in the iframe viewer. `private: true` and a
non-Apache license value do not prevent installing a local tarball, but they
must not pass this public-release gate; `private: true` also prevents npm
registry publication.
