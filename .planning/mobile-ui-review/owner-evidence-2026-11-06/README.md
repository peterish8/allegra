# Owner screenshots, 2026-11-06

These are actual owner-provided problem reports, not design targets. Both were visually inspected.
APK SHA, font scale, device model and navigation sequence are not supplied; reproduce and record them.
PNG evidence is ignored by the repository's existing `.planning/**/*.png` rule. Preserve the local files;
if handing off to another machine, transfer them explicitly. Do not pretend their absence is a passing check.

| Local image | Original absolute path | SHA-256 |
| --- | --- | --- |
| `stream-overlap.png` | `C:/Users/nithy/.t3/userdata/attachments/066d1c9a-cdf0-4e2a-8839-21b783228379-3f1c2397-6df0-4ba4-ba5a-7bcf1c2ba29c.png` | `b1ae8708d9a3d25f227a57ad01c5464ed90d5eb3cf62b5666e25dcef42ec6b0a` |
| `player-up-next-overlap.png` | `C:/Users/nithy/.t3/userdata/attachments/066d1c9a-cdf0-4e2a-8839-21b783228379-b41eda7e-c8a2-4268-9c05-3ed0ffc60dc6.png` | `7acc892481647c87a7d3294c51080e25d6252bf7c33dfafee2c808610c4ec8d2` |

Stream: mood chips and Jump back in heading overlap; there is excessive blank space before Quick picks;
shortcut titles are tightly truncated. Player: Up next filter chips overlap the first queue row; the player title
is visibly split/clipped across its lane near the action buttons. These are observations. Root causes are unconfirmed.

See `../PLAN-V6-VERIFICATION.md` correction IDs UI-01 through UI-10 and the current handoff.
