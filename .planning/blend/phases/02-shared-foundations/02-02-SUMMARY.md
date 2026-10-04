# 02-02 Summary: decay range contradiction

## Finding

The formula in `PLAN.md` §4.1 is `2 ** ((atMs - L) / H)`, with a 45-day half-life and a 2026
landmark. The task's `decayFactor(Date.UTC(2200, 0, 1))` test cannot be finite: its exponent is
about 1,412, while JavaScript Float64 overflows around exponent 1,024. That happens roughly 126
years after the landmark, not 126,000 years as §4.1 claims. In the distant past the factor also
eventually underflows to zero, so “very old and very new timestamps stay finite” is not true for an
unbounded timestamp range.

The formula's forward-decay property and indexed ordering both depend on the stored `score` staying
in range. Clamping the exponent would change those semantics, so the implementation should not pick
a workaround without a corrected time horizon or representation decision.

## Status

Blocked before implementation by the contradictory range claim and 2200 test. No source files or
tests were changed. Revise the test and promise to a supported date range, or choose a numerically
stable representation that preserves the tally's additive and ordering requirements.
