# 04-01 Summary: synthetic Spotify export fixtures

## Changes

- Added synthetic YourLibrary.json and Playlist1.json fixtures, a six-row exportify.csv, and a ZIP
  containing the JSON files plus a 1,024-byte placeholder PDF.
- Added a fixture README with key tables, value types, date fields, the chosen synthetic folder
  layout, and an explicit statement that this is not an owner export.
- No checked-in Spotify export fixture was present. Synthetic data was used with owner approval.

## Verification

- Listed the archive contents with tar -tf; it contains both JSON files and MyData/ReadMe.pdf.
- Reviewed fixture values for personal account fields; playlist names and non-song data are synthetic.

## Unresolved

The plan's real-export structure capture remains unverified. The README records the parser fixture
schema, not evidence of Spotify's current account download. Confirm it against an owner export before
claiming real-format compatibility.

No commit was made.
