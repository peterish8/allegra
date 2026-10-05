# Synthetic Spotify export fixtures

These files are synthetic parser fixtures, not a capture of an owner's Spotify account export.
No real listener export was found in the repository. The owner approved synthetic fixtures so the
parser can be tested; the exact shape of a real Spotify download still needs confirmation.

The filenames and wrapper keys below follow the current import plan. Values are public song titles
or clearly synthetic placeholders. Playlist names are synthetic. No account name, email, country,
private playlist name, follower count, or personal listening history is present.

## YourLibrary.json

Top-level value: object. Its tracks property is an array.

| Location | Key | JSON type | Meaning in this synthetic fixture |
|---|---|---|---|
| root | tracks | array | Saved item entries |
| track entry | trackName | string | Track title |
| track entry | artistName | string | Artist credit |
| track entry | albumName | string | Album title |
| track entry | duration_ms | integer | Duration in milliseconds |
| non-track entry | episode | object | Podcast episode; skipped |
| non-track entry | localTrack | object | Local file; skipped |

This file has six entries: four tracks, one podcast episode, and one local file. It has no date
fields.

## Playlist1.json

Top-level value: object. Its playlists property is an array.

| Location | Key | JSON type | Meaning in this synthetic fixture |
|---|---|---|---|
| root | playlists | array | Playlist records |
| playlist | name | string | Synthetic playlist name |
| playlist | lastModifiedDate | string | Synthetic date, YYYY-MM-DD |
| playlist | items | array | Playlist item records |
| item | track | object or null | Track details when the item is a track |
| item | episode | object or null | Podcast episode marker |
| item | localTrack | object or null | Local file marker |
| item | addedDate | string | Synthetic date, YYYY-MM-DD |
| track | trackName | string | Track title |
| track | artistName | string | Artist credit |
| track | albumName | string | Album title |
| track | duration_ms | integer | Duration in milliseconds |

The file has two playlists with three tracks each. Dates, nesting, keys, and placeholder values are
synthetic and have not been verified against an owner export.

## exportify.csv

The synthetic CSV uses UTF-8 and CRLF line endings, with this header:

Track Name,Artist Name(s),Album Name,Duration (ms),Added At

There are six rows, including one multi-artist value separated by a semicolon. Duration values are
milliseconds. Added At values are synthetic ISO dates. The CSV has no podcast/local-file type
field, so those two illustrative rows are ordinary CSV rows to the generic parser.

## spotify-export.zip

Synthetic ZIP entries:

- Spotify Account Data/YourLibrary.json
- Spotify Account Data/Playlist1.json
- MyData/ReadMe.pdf (1,024-byte placeholder, not a real document)

The archive's folder names and contents are test data. They do not establish the layout of Spotify's
current account download.
