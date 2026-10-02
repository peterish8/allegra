# Credits and upstream terms

Allegra's code is offered under the root [GNU GPL version 3](./LICENSE). Existing third-party
notices and terms continue to apply; this file does not relicense their work or the media fetched
by the app. Corresponding source must accompany distributed builds or be made available as required
by the relevant licence.

| Project | Use in Allegra | Upstream terms |
|---|---|---|
| [Metrolist](https://github.com/MetrolistGroup/Metrolist) | Music-player and Listen Together protocol references | [GPL-3.0](https://github.com/MetrolistGroup/Metrolist/blob/main/LICENSE) |
| [Echo Music](https://github.com/brahmkshatriya/echo) | Player motion, recommendations and provider implementation references | [Unabandon Public License](./licenses/echo-UPL.md), incorporating GPLv3 and a public-source requirement |
| [Mel-Band RoFormer / Music Source Separation Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) | On-device karaoke model architecture and tooling | [MIT](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/LICENSE); model weights have their own provenance and terms |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | Browser inference | [MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |
| [LRCLIB](https://github.com/tranxuanthang/lrclib) | Community lyrics lookup | [MIT server code](https://github.com/tranxuanthang/lrclib/blob/main/LICENSE); lyrics remain the rights holders' work |
| [BetterLyrics](https://github.com/better-lyrics/better-lyrics) and other community lyrics services | Timed lyrics sources and provider references | Retain source notices; API availability does not license supplied lyrics |
| React, React Native, Expo, Next.js, Motion, Lucide | App framework, animation and icons | Respective package licences and copyright notices in dependencies |
| Convex, Convex Auth, Convex Presence, Sentry | Account persistence, sync and diagnostics | Respective SDK licences; hosted services have separate terms |

Echo's current upstream licence is **not plain MIT or plain GPL**. Its full notice is preserved in
`licenses/echo-UPL.md`. Review adapted files and source-availability obligations before distributing
an APK; the root GPL identifier alone is not a certification of compatibility with custom terms.

The web and phone also access music catalogues, artwork services, Lyrica, KuGou, QQ Music,
Musixmatch and translation providers where configured. Those recordings, lyrics and images are
not covered by Allegra's code licence. See the provider modules for individual attribution.

SF Pro and third-party font assets are not relicensed by the root GPL. Their review/removal was
outside the selected task list. Preserve their owners' terms and obtain a distribution review.
Allegra is unaffiliated with the providers and credited projects.
