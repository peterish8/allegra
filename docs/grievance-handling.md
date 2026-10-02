# Grievance handling

The named grievance officer in `packages/shared/legal.ts` owns this process. Fill the operator's
name, address and monitored email before publishing policy pages. Check the queue routinely;
the code records reports but sends no email or automated acknowledgement. A reporter who supplies
no contact receives only the on-screen receipt. Do not claim an email was sent.

On the intended Convex deployment, list open reports (up to 100, oldest first):

```bash
npx convex run reports:open
```

Record receipt time, share code, reason, details, contact, evidence, officer and each action in a
restricted incident record. Never put contact details or harmful material in GitHub issues. Review
urgency immediately; do not wait for the general deadline when a shorter category applies.

| Complaint category | Clock from receipt |
|---|---|
| General acknowledgement | 24 hours |
| General grievance resolution | 7 days |
| Applicable Rule 3(1)(b) content-removal grievances | 36 hours |
| Intimate imagery / impersonation under Rule 3(2)(b) | 2 hours |
| Applicable court / authorised government order under Rule 3(1)(d) | 3 hours |
| Complete copyright complaint within Copyright Rule 75's scope | 36 hours; conditional 21-day restraint |

The handoff's 15-day general and 36-hour order deadlines are outdated. These clocks reflect the
[consolidated IT Rules amended in February 2026](https://www.meity.gov.in/static/uploads/2026/02/550681ab908f8afb135b0ad42816a1c9.pdf).
[Copyright Rule 75](https://www.copyright.gov.in/Copyright_Rules_2013/chapter_xiv.html) has a narrower
transient/incidental-storage scope; counsel must determine applicability. Do not promise automatic
restoration after 21 days without reviewing any court order and other grounds.

For a substantiated complaint, disable the link and, if necessary, remove its uploaded cover:

```bash
npx convex run reports:takeDown '{"code":"abcd2345","removeCover":true}'
```

This removes public access and closes reports for that code. It does not remove upstream songs.
Verify the shared URL returns not found. Explain the decision privately to the reporter and owner
where possible. Preserve evidence only as legally required, securely. Dismiss unfounded reports
after documenting the reason:

```bash
npx convex run reports:dismiss '{"code":"abcd2345"}'
```

These are internal functions: use the dashboard/CLI with operator credentials, never browser APIs.
Takedown is an operator decision. Account export/delete requests are available in Settings → Manage
account; other data-rights requests go to the officer. Have counsel review the process before launch.
