# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem.

Email support@trytiamat.com with "Security" in the subject. If this repository is public, GitHub's private
vulnerability reporting (the Security tab, then "Report a vulnerability") also works once it is turned on.

Include:

- what you found, and where (the file, screen or endpoint),
- the steps to reproduce it,
- the version you tested,
- what an attacker could do with it.

We reply within 7 days. We aim to publish a fix within 90 days of your report, and we will tell you when it is out.
If you want credit, we will name you in the release notes. There is no bug bounty yet.

## Supported versions

The latest release on the main line is supported. Older releases are not, so a fix ships in a new release, not in an
old one.

## Scope

In scope: the code in this repository and the `phonux` package published from it on npm.

Out of scope: problems that exist only in upstream projects, and in third-party services. Report those to their owners,
and tell us too if they reach this code.
