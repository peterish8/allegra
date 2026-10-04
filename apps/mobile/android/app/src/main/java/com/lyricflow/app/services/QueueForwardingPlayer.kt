package com.lyricflow.app.services

import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import com.lyricflow.app.playback.QueueEngine

/**
 * What the media session (notification, lock screen, Bluetooth and headset buttons, Android Auto, Wear) drives.
 * Next and previous go straight to [QueueEngine], which owns the queue, so a skip works with the screen off and
 * JavaScript asleep. Previous follows Echo Music: past 3 s it starts the song over.
 */
class QueueForwardingPlayer(player: Player, private val engine: QueueEngine) : ForwardingPlayer(player) {

    override fun getAvailableCommands(): Player.Commands =
        super.getAvailableCommands()
            .buildUpon()
            .apply { if (engine.canSkip()) addAll(*SKIP_COMMANDS) }
            .build()

    override fun isCommandAvailable(command: Int): Boolean =
        if (command in SKIP_COMMANDS) engine.canSkip() else super.isCommandAvailable(command)

    // The buttons show whenever there is a queue: next wraps to the first song, previous restarts the one playing.
    override fun hasNextMediaItem(): Boolean = engine.canSkip()

    override fun hasPreviousMediaItem(): Boolean = engine.canSkip()

    override fun seekToNext() = engine.skipToNext()

    override fun seekToNextMediaItem() = engine.skipToNext()

    override fun seekToPrevious() = engine.skipToPrevious()

    override fun seekToPreviousMediaItem() = engine.skipToPrevious()

    private companion object {
        val SKIP_COMMANDS = intArrayOf(
            Player.COMMAND_SEEK_TO_NEXT,
            Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_PREVIOUS,
            Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
        )
    }
}
