# 02-03 Summary: share-code validator mismatch

## Finding

The current generator is `newCode()` in `apps/api/src/user/actions.ts`: it emits 8 characters from
`abcdefghjkmnpqrstuvwxyz23456789` using modulo 31. The plan correctly identifies the modulo bias.
However, its Task 2 says `isShareCode` already uses `CODE_ALPHABET`; the current validator instead
uses `CODE_SHAPE = /^[a-z0-9]{6,12}$/`, which accepts characters the generator never emits.

Keeping that broader validator preserves current behavior. Restricting it to the alphabet matches
the plan wording, and old `newCode()`-generated values are already within that alphabet, but it is a
validator behavior change not covered by the plan's tests. No implementation or tests were changed
while this is unresolved.

## Status

Blocked before implementation by the validator mismatch. Clarify whether to preserve `CODE_SHAPE` or
change `isShareCode` to accept only the generated alphabet; then proceed with rejection sampling and
the existing 8-character share-code length.
