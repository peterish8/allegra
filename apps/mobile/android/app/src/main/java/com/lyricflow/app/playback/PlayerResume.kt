package com.lyricflow.app.playback

import androidx.media3.common.Player

/**
 * Play, the way every button of ours means it: the app's `MainPlayer.play()` and the island both use this.
 * Call on the player's thread (the main thread).
 */
fun resumePlayback(player: Player) {
    // After a stream error the player sits idle; play() alone would do nothing, so re-prepare at the same position.
    if (player.playbackState == Player.STATE_IDLE && player.mediaItemCount > 0) player.prepare()
    // Suppressed by another app's audio focus: playWhenReady is already true, so play() would be a no-op.
    // Toggle it so ExoPlayer asks for focus again and actually resumes.
    if (player.playWhenReady && player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE) {
        player.pause()
    }
    player.play()
}

/** What the transport shows: playing only while the player wants to and nothing holds it back (the app shows the same). */
fun showsPlaying(player: Player): Boolean =
    player.playWhenReady &&
        player.playbackState != Player.STATE_IDLE &&
        player.playbackState != Player.STATE_ENDED &&
        player.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE
