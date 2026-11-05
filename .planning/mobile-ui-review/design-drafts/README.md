# V6 design sources

Run from this folder with Python 3:

```powershell
python v5_build.py ../design-gallery
$env:PYTHONIOENCODING='utf-8'
python v5_audit.py
```

The build uses the standard library. `v5_kit.py` owns the shared base styles;
`v5_round6.py` applies the approved core compositions; `v6_finish.py` completes
the remaining shared/layout refinements. `v6_icons.py` maps semantic icon names
to the shipped Ionicons font and fails for missing mappings. The source font
and glyph table are in `assets/`, copied from the mobile app's installed
`@expo/vector-icons` package; retain their upstream license.

Build output is `project/V5-*.dc.html` plus `design-gallery/V5-*.html` and
`design-gallery/index.html`. Filenames keep the V5 prefix to preserve canvas
references; their content is V6. The build does not overwrite `project/canvas.json`.
Do not publish an old canvas index over the owner's edits. The owner waived canvas
publishing for this session.

Optional self-contained HTML review (Pillow and fontTools are required):

```powershell
python v6_review.py V5-Responsive --limit=3 > review.html
python v6_review.py V5-NowPlaying --offset=8 --limit=1 > review.html
```

This helper reads the generated gallery, embeds smaller cover copies and a font
subset, and changes only board furniture for phone-scale review. It does not
alter source artwork. The audit checks source patterns and inline sizes; it is
not computed-layout, screen-reader, app-runtime or physical-device evidence.

App runtime tokens live in `apps/mobile/src/constants/allegraTheme.ts`; the
component contract is `apps/mobile/DESIGN.md`. Keep design-token changes aligned
with those files. See `../IMPLEMENTATION-STATUS.md` for prepared versus shipped scope.
