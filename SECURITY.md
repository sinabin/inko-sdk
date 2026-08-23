# Security policy

## Support boundary

Inko is provided under the Apache License 2.0 on an **AS IS** basis. NextH does
not provide an SLA, LTS branch, individual technical support, guaranteed
compatibility, or a guaranteed acknowledgement or remediation time. Maintainers
may investigate, publish an advisory, or release a change at their discretion.

Inko is self-hosted. Users are responsible for installation, host integration,
environment and document validation, deployment, access control, protection of
PDF and annotation data, monitoring published releases and advisories, and
deciding when and how to patch, upgrade, or maintain a fork.

Only code and artifacts published through the official Inko repository and
release channels are within this policy. Third-party dependencies remain subject
to their upstream security processes, although an issue that affects Inko may
also be reported here.

## Reporting a vulnerability

Do not disclose an unpatched vulnerability in a public issue, discussion, pull
request, or social-media post.

1. Use GitHub's **Private vulnerability reporting** feature in the official Inko
   repository.
2. If that feature is unavailable, email `siwoolee@nexth.co.kr` with the subject
   `[Inko Security]` and do not include sensitive details in any other public
   channel.

Include only what is necessary to reproduce and assess the issue:

- affected Inko version, commit, and environment;
- impact and required preconditions;
- minimal reproduction steps or proof of concept; and
- any suggested mitigation.

Use synthetic files and redacted logs. Do not send customer PDFs, production
credentials, access tokens, private keys, or unrelated personal information. If
the vulnerability itself involves exposed personal or confidential data,
describe the data category and impact without attaching the underlying records;
wait for a private follow-up before transferring any sample.

Submitting a report does not create a support, confidentiality, payment, or
remediation agreement. There is no bug-bounty program unless NextH announces one
separately in writing. NextH asks reporters to allow a reasonable opportunity
for private assessment before public disclosure, but does not promise a specific
timeline.

## Public advisories

Users should monitor the official repository's Security Advisories and release
notes. A release or advisory describes only the scope tested or investigated for
that item and is not a warranty that the software is free of vulnerabilities.
