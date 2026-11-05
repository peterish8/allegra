# V6 scripted audit

Static source audit, not device or screen-reader evidence. Targets below inspect inline sizes; CSS/layout and artwork contrast still need visual review.

- Boards: 21; phone frames: 121
- Design/runtime palette parity: pass
- Font weights used: ['400', '600', '700'] → pass (only 400/600/700 ship in the app)
- Letter spacing other than the room code: 0 → pass
- Uppercase transforms: 0 → pass
- Emoji in UI text: 0 → pass
- Interactive elements without a name: 0 → pass
- Interactive elements drawn under 48 wide / 40 tall: 0 → pass
- linear-gradient uses (generated covers, artist photo fade only): 47

## Contrast (WCAG 2.2 1.4.3 for text, 1.4.11 for UI parts)
| Text | Base #0B0D10 | Raised #17191E | Control #22252C | Toast #2A2D34 |
|---|---|---|---|---|
| Text 1 #F4F4F5 | 17.7 | 16.0 | 14.0 | 12.5 |
| Text 2 #A3A5AE | 7.9 | 7.2 | 6.2 | 5.6 |
| Text 3 #8A8D96 | 5.9 | 5.3 | 4.6 | 4.2 |
| Danger #FF6B61 | 7.0 | 6.3 | 5.5 | 4.9 |
| Base text on white button | 17.7 | | | |
| Danger on danger-tint button (≈#3A1E1F) | 5.4 | | | |
| Selected-tab underline / switch on vs base (UI part) | 17.7 | | | |
| Off-switch outline #8A8D96 vs control (UI part, 3:1 needed) | 4.6 | | | |
| Off-switch thumb #8A8D96 vs control | 4.6 | | | |
| Progress track #2A2D34 vs raised (decorative; the fill carries meaning) | 1.3 | | | |
| Lyrics non-sung line, 26 bold = large text, 3:1 needed (42% white ≈#6E7074) vs base | 3.9 | | | |
