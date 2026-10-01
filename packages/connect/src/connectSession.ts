import type { SongSnapshot } from '../../shared/songRef.ts';
import { connectError, errorCode, errorData, isUncertainFailure } from './errors.ts';
import { createIntentQueue, type QueuedIntent } from './intentQueue.ts';
import { applyConfirmedPatch, confirmedFromSnapshot, confirmedFromState, expectedPosition, planPatch, type ConfirmedState } from './playbackDiff.ts';
import { applyQueueEdit, isQueueEdit } from './queueEdit.ts';
import { createServerClock } from './serverClock.ts';
import { CONNECT_PROTOCOL_VERSION, QUEUE_EDIT_PROTOCOL_VERSION } from './types.ts';
import type {
  CommandOutcomeInput, ConnectDevice, ConnectFailureCode, ConnectSession, ConnectSessionOptions, ConnectTransport,
  ConnectTraceEvent, ConnectTraceOperation, ConnectView, InboxCommand, PlayerSnapshot,
  PlayerStatePatch, RemoteCommand, SessionDevice, TransferResult
} from './types.ts';

const HEARTBEAT_MS = 60_000;
/** Registration retries back off from 1 s to this, so a server that keeps refusing is not polled every second. */
const LISTEN_RETRY_MAX_MS = 30_000;
/**
 * How long the target has to pick a command up. Once it has (the outcome shows `began`), the
 * sender waits for the command's own server deadline instead: a transfer or a song load needs a
 * catalog lookup, buffering and, for a transfer, the old owner's pause, which often takes longer.
 */
const INPUT_FEEDBACK_MS = 4_000;
/** Past the server deadline, how long to wait for the failure the deadline job writes. */
const DEADLINE_GRACE_MS = 2_000;
/** How long a transfer's destination waits for the playing device to pause and release. */
const RELEASE_WAIT_MS = 15_000;
const REPORT_DRIFT_MS = 5_000;
const QUEUE_CAPACITY = 32;
const EMPTY_PLAYER: PlayerSnapshot = { queue: [], isPlaying: false, positionSec: 0, volume: 1, shuffle: false, repeat: 'off' };

interface Intent extends QueuedIntent {
  readonly requestId: string;
  readonly transfer: boolean;
  readonly startedAt: number;
  /** When it was transmitted. The pick-up window runs from here: an input can wait its turn for longer. */
  sentAt?: number;
  readonly startedMono?: number;
  feedbackTimedOut?: boolean;
  /** Local time the server's deadline for this command passes, from the send receipt. */
  deadlineAt?: number;
  readonly resolveTransfer?: (result: TransferResult) => void;
  command: RemoteCommand;
}

interface PendingCompletion {
  readonly item: InboxCommand;
  readonly reservationToken: string;
  outcome: CommandOutcomeInput;
  patch?: PlayerStatePatch;
  rev?: number;
}

function clamp(position: number, duration: number): number {
  const safe = Number.isFinite(position) ? Math.max(0, position) : 0;
  return duration > 0 ? Math.min(duration, safe) : safe;
}

/**
 * Display text for a failed call. Only coded errors carry listener copy; anything else (a network
 * failure, or a server error such as Convex's "[CONVEX M(connect:register)] … Server Error") gets
 * the caller's fallback, never its raw message.
 */
function failureText(error: unknown, fallback: string): string {
  const data = errorData(error);
  return typeof data?.message === 'string' ? data.message : fallback;
}

function failureResult(error: unknown): TransferResult {
  const code = errorCode(error);
  const reason = code === 'offline' ? 'offline' : code === 'command_expired' ? 'timeout' : 'failed';
  return { ok: false, reason, ...(code ? { code } : {}), error: failureText(error, 'Playback could not be transferred.') };
}

export function createConnectSession({ transport, player, device: initialDevice, clock, trace }: ConnectSessionOptions): ConnectSession {
  /** Replaced only by `rename`: the id never changes. */
  let device: SessionDevice = initialDevice;
  let disposed = false;
  let visible = false;
  let listening = false;
  let registering = false;
  let watchStop: (() => void) | undefined;
  let heartbeatTimer: unknown;
  let listenRetryTimer: unknown;
  let listenRetryCount = 0;
  /** When the server last confirmed this device online (register or heartbeat). */
  let lastBeatAt = 0;
  let local = player.getSnapshot();
  let previousLocal = local;
  let snapshot: Parameters<Parameters<typeof transport.watch>[1]>[0] | undefined;
  let didRestore = false;
  let restoring = false;
  let lastError: string | undefined;
  let lastErrorCode: ConnectView['lastErrorCode'];
  let autoplayBlocked = false;
  let optimistic: { readonly intent: Intent; readonly expiresAt: number } | undefined;
  let pending: Intent | undefined;
  let pendingCommandId: string | undefined;
  let feedbackTimer: unknown;
  let retryTimer: unknown;
  let retryCount = 0;
  let requestSequence = 0;
  let claimInFlight = false;
  let reportInFlight = false;
  let reportQueued = false;
  let reportQueuedSeek = false;
  let lastPositionReportAt = 0;
  let lastPosition: number | undefined;
  let confirmed: ConfirmedState | undefined;
  let serverRev: number | undefined;
  let inboxWorker = false;
  let inboxRetryCount = 0;
  let handoffInFlight = false;
  let handoffCommandId: string | undefined;
  const processed = new Set<string>();
  const processing = new Set<string>();
  const completions = new Map<string, PendingCompletion>();
  const subscribers = new Set<(view: ConnectView) => void>();
  const snapshotWaiters = new Set<() => void>();
  const timers = new Set<unknown>();
  const timerOperations = new Map<unknown, ConnectTraceOperation>();
  const queue = createIntentQueue<Intent>(QUEUE_CAPACITY);
  const sampledClock = createServerClock(clock, () => {
    emit({ event: 'mutation.conflict', operation: 'register', outcome: 'rejected', count: 1 });
    if (!disposed) void registerAndListen();
  });

  function emit(event: ConnectTraceEvent): void {
    try { trace?.record(event); } catch { /* Diagnostics must not change playback. */ }
  }

  function requestId(): string {
    requestSequence++;
    const random = Math.floor(Math.random() * 0x1fffffffffffff).toString(36);
    return `${device.deviceId.slice(-18)}-${clock.now().toString(36)}-${requestSequence.toString(36)}-${random}`.slice(-64);
  }

  function schedule(callback: () => void, delayMs: number, operation: ConnectTraceOperation = 'listen_retry'): unknown {
    emit({ event: 'timer.scheduled', operation, count: 1, delayMs: Math.max(0, delayMs) });
    const handle = clock.setTimeout(() => {
      timers.delete(handle);
      timerOperations.delete(handle);
      emit({ event: 'timer.fired', operation, count: 1 });
      callback();
    }, Math.max(0, delayMs));
    timers.add(handle);
    timerOperations.set(handle, operation);
    return handle;
  }

  function clearTimer(handle: unknown): void {
    if (handle === undefined) return;
    clock.clearTimeout(handle);
    timers.delete(handle);
    const operation = timerOperations.get(handle);
    timerOperations.delete(handle);
    if (operation) emit({ event: 'timer.cleared', operation, count: 1 });
  }

  function sample<T extends { readonly serverNow: number }>(operation: ConnectTraceOperation, run: () => Promise<T>): Promise<T> {
    const finish = sampledClock.begin();
    const started = clock.monotonicNow?.();
    emit({ event: 'mutation.started', operation, count: 1 });
    return run().then((result) => {
      finish(result.serverNow);
      const ended = clock.monotonicNow?.();
      emit({ event: 'mutation.completed', operation, outcome: 'ok', count: 1,
        ...(started !== undefined && ended !== undefined && ended >= started ? { durationMs: ended - started } : {}) });
      return result;
    }, (error: unknown) => {
      emit({ event: errorCode(error) === 'stale_revision' || errorCode(error) === 'stale_ownership' ? 'mutation.conflict' : 'mutation.failed',
        operation, outcome: errorCode(error) === 'offline' ? 'offline' : 'failed', count: 1 });
      throw error;
    });
  }

  function activeId(): string | undefined { return snapshot?.state?.activeDeviceId; }
  function isActive(): boolean { return activeId() === device.deviceId; }
  function stateEpoch(): number { return snapshot?.state?.ownershipEpoch ?? 0; }
  function activeDevice(): ConnectDevice | undefined { return snapshot?.devices.find((row) => row.deviceId === activeId()); }
  function activeOnline(): boolean { return isActive() || activeDevice()?.isOnline === true; }
  function localPosition(): number {
    const live = player.getSnapshot();
    return clamp(live.positionSec, live.song?.duration ?? 0);
  }

  function remotePosition(): number {
    const state = snapshot?.state;
    if (!state) return 0;
    const now = sampledClock.now();
    return clamp(state.positionSec + (state.isPlaying ? Math.max(0, now - state.positionAt) / 1000 : 0), state.song?.duration ?? 0);
  }

  function livePosition(): number {
    if (isActive()) return localPosition();
    // Where you last scrubbed to, until the playing device says where it really is. That covers
    // the seek being sent and any behind it, so the scrubber does not snap back while they wait.
    const scrubbed = lastSeekInput();
    if (scrubbed) return clamp(scrubbed.sec, snapshot?.state?.song?.duration ?? 0);
    return remotePosition();
  }

  /** The newest seek this device has sent or is about to, while it is still outstanding. */
  function lastSeekInput(): Extract<RemoteCommand, { kind: 'seek' }> | undefined {
    const waiting = [...(pending ? [pending] : []), ...queue.items()];
    for (let index = waiting.length - 1; index >= 0; index--) {
      const command = waiting[index]?.command;
      if (command?.kind === 'seek') return command;
    }
    return undefined;
  }

  function view(): ConnectView {
    const state = snapshot?.state;
    const shown = optimistic && clock.now() < optimistic.expiresAt ? optimistic.intent.command : undefined;
    let song = state?.song;
    let queueItems = state?.queue ?? EMPTY_PLAYER.queue;
    let isPlaying = state?.isPlaying ?? false;
    let volume = state?.volume ?? EMPTY_PLAYER.volume;
    let shuffle = state?.shuffle ?? false;
    let repeat = state?.repeat ?? 'off';
    if (shown) {
      if (shown.kind === 'play') isPlaying = true;
      else if (shown.kind === 'pause') isPlaying = false;
      else if (shown.kind === 'play_song') { song = shown.song; queueItems = shown.queue ?? []; isPlaying = true; }
      else if (shown.kind === 'seek') { /* livePosition owns the optimistic position. */ }
      else if (shown.kind === 'volume') volume = shown.v;
      else if (shown.kind === 'shuffle') shuffle = shown.on;
      else if (shown.kind === 'repeat') repeat = shown.mode;
      else if (isQueueEdit(shown)) queueItems = applyQueueEdit(queueItems, shown) ?? queueItems;
    }
    const selectedDevice = activeDevice();
    return {
      devices: snapshot?.devices ?? [],
      ...(selectedDevice ? { activeDevice: selectedDevice } : {}),
      ...(state?.activeDeviceId ? { activeDeviceId: state.activeDeviceId } : {}),
      isThisDeviceActive: isActive(),
      activeDeviceOnline: activeOnline(),
      ownershipEpoch: stateEpoch(),
      ...(song ? { song } : {}),
      queue: queueItems,
      queueEditable: isActive() || (activeOnline() && (selectedDevice?.protocolVersion ?? 1) >= QUEUE_EDIT_PROTOCOL_VERSION),
      isPlaying,
      livePosition: livePosition(),
      volume,
      shuffle,
      repeat,
      ...(pending ? { pendingCommand: { ...(pendingCommandId ? { commandId: pendingCommandId } : {}), targetDeviceId: pending.targetDeviceId, command: pending.command, startedAt: pending.startedAt } } : {}),
      queuedCommands: queue.size,
      autoplayBlocked,
      ...(lastError ? { lastError } : {}),
      ...(lastErrorCode ? { lastErrorCode } : {})
    };
  }

  // A subscriber that throws must not stop what called notify: that is often a command about to be sent.
  function notify(): void {
    if (disposed) return;
    for (const listener of [...subscribers]) {
      try { listener(view()); } catch { /* a screen's bug is not a playback failure */ }
    }
  }
  function wakeSnapshotWaiters(): void { for (const wake of [...snapshotWaiters]) wake(); snapshotWaiters.clear(); }

  function shouldListen(): boolean { return !disposed && (visible || local.isPlaying || isActive()); }

  async function registerAndListen(): Promise<void> {
    if (registering || listening || !shouldListen()) return;
    registering = true;
    try {
      await sample('register', () => transport.register({ ...device, protocolVersion: CONNECT_PROTOCOL_VERSION }));
      if (disposed || !shouldListen()) {
        // Registering put the device on the others' lists, and it left while that was in flight.
        void transport.disconnect(device.deviceId).catch(() => undefined);
        return;
      }
      lastBeatAt = clock.now();
      listening = true;
      watchStop = transport.watch(device.deviceId, onSnapshot);
      heartbeatTimer = clock.setInterval(() => { void beat(); }, HEARTBEAT_MS);
      if (listenRetryTimer !== undefined) clearTimer(listenRetryTimer);
      listenRetryTimer = undefined;
      listenRetryCount = 0;
      emit({ event: 'adapter.ready', operation: 'watch', outcome: 'ok', count: 1 });
    } catch (error) {
      if (errorCode(error) === 'unauthenticated') showReconnecting();
      else setError(error, 'Connect is unavailable right now. Trying again shortly.');
      if (listenRetryTimer === undefined && shouldListen()) {
        const delay = Math.min(LISTEN_RETRY_MAX_MS, 1_000 * 2 ** listenRetryCount);
        listenRetryCount++;
        listenRetryTimer = schedule(() => { listenRetryTimer = undefined; void registerAndListen(); }, delay, 'listen_retry');
      }
    } finally { registering = false; }
  }

  /** Keeps this device online in Presence. */
  async function beat(): Promise<void> {
    try {
      await sample('heartbeat', () => transport.heartbeat(device.deviceId));
      lastBeatAt = clock.now();
    } catch (error) {
      const code = errorCode(error);
      // Refused as signed out (a tab or app waking before its sign-in is restored) or as
      // unknown (the sweep removed a long-idle device): register again now, with backoff,
      // rather than wait a minute and drop out of the other devices' lists. A real sign-out
      // disposes this session.
      if ((code === 'unauthenticated' || code === 'device_not_registered') && !disposed) {
        showReconnecting();
        void stopListening();
        void registerAndListen();
        return;
      }
      setError(error, 'Connect is offline.');
    }
  }

  function showReconnecting(): void {
    lastError = 'Reconnecting to Allegra…';
    lastErrorCode = 'offline';
    notify();
  }

  /**
   * `announce` tells the server this device has left, so the others stop offering it now rather
   * than when its heartbeats run out. Best effort: an unsent goodbye only means the old wait.
   */
  function stopListening(announce = false): Promise<void> {
    const wasListening = listening;
    watchStop?.(); watchStop = undefined;
    if (heartbeatTimer !== undefined) clock.clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    listening = false;
    if (!announce || !wasListening) return Promise.resolve();
    emit({ event: 'mutation.started', operation: 'disconnect', count: 1 });
    return transport.disconnect(device.deviceId).catch(() => undefined);
  }

  function setError(error: unknown, fallback: string): void {
    lastErrorCode = errorCode(error) ?? (errorCode(error) === 'offline' ? 'offline' : undefined);
    lastError = failureText(error, fallback);
    notify();
  }

  function onSnapshot(next: Parameters<Parameters<typeof transport.watch>[1]>[0]): void {
    if (disposed) return;
    emit({ event: 'query.delivered', operation: 'watch', count: 1 });
    const wasActive = isActive();
    snapshot = next;
    if (next.state) {
      confirmed = confirmedFromState(next.state);
      if (serverRev === undefined || next.state.rev > serverRev) serverRev = next.state.rev;
    }
    else if (!confirmed) confirmed = undefined;
    lastError = undefined;
    lastErrorCode = undefined;
    observeOutcome();
    wakeSnapshotWaiters();

    if (!didRestore) {
      didRestore = true;
      const restored = next.state;
      if (restored?.song && !local.song) {
        restoring = true;
        const position = clamp(restored.positionSec + (restored.isPlaying ? Math.max(0, sampledClock.now() - restored.positionAt) / 1000 : 0), restored.song.duration);
        void player.load(restored.song, restored.queue, { positionSec: position, play: false }).then(() => {
          local = player.getSnapshot(); previousLocal = local; notify();
        }).catch(() => undefined).finally(() => { restoring = false; });
      }
    }

    if (wasActive && !isActive() && local.isPlaying) void pauseAfterOwnershipLoss();
    if (next.state?.handoff && next.state.activeDeviceId === device.deviceId && next.state.handoff.toDeviceId !== device.deviceId) {
      void answerHandoff(next.state.handoff.commandId, stateEpoch());
    }
    notify();
    void drainInbox();
    reconcileListening();
    pump();
  }

  async function pauseAfterOwnershipLoss(): Promise<void> {
    handoffInFlight = true;
    try { await player.pause(); }
    catch { /* ownership already moved; never claim it back on a position tick */ }
    finally { handoffInFlight = false; local = player.getSnapshot(); notify(); }
  }

  async function answerHandoff(commandId: string, epoch: number): Promise<void> {
    if (handoffInFlight || !snapshot?.state || snapshot.state.handoff?.commandId !== commandId || !isActive()) return;
    handoffInFlight = true;
    const resume = local.isPlaying;
    try {
      if (resume) await player.pause();
      const exact = player.getSnapshot();
      await sample('release', () => transport.release({
        deviceId: device.deviceId, commandId, expectedOwnershipEpoch: epoch,
        positionSec: clamp(exact.positionSec, exact.song?.duration ?? 0), resume
      }));
      local = player.getSnapshot();
    } catch (error) {
      // If the destination timed out after this pause, keep the former owner audible.
      if (resume) {
        const result = await player.play().catch(() => 'needs_gesture' as const);
        if (result !== 'ok') setError(error, 'The other device could not confirm the transfer.');
      }
    } finally { handoffInFlight = false; notify(); }
  }

  function reconcileListening(): void {
    if (shouldListen()) void registerAndListen();
    else void stopListening(true);
  }

  function makeIntent(command: RemoteCommand, targetDeviceId: string, transfer = false, resolveTransfer?: (result: TransferResult) => void): Intent {
    const startedAt = clock.now();
    return {
      command, targetDeviceId, epoch: stateEpoch(), barrier: transfer || (command.kind !== 'seek' && command.kind !== 'volume'),
      requestId: requestId(), transfer, startedAt,
      ...(clock.monotonicNow ? { startedMono: clock.monotonicNow() } : {}),
      ...(resolveTransfer ? { resolveTransfer } : {})
    };
  }

  function offer(intent: Intent): void {
    const result = queue.offer(intent);
    if (result.status === 'overflow') {
      const error = connectError('rate_limited'); setError(error, 'Connect command queue is full.');
      intent.resolveTransfer?.({ ok: false, reason: 'failed', code: 'rate_limited', error: 'Connect command queue is full.' });
      return;
    }
    notify(); pump();
  }

  function finishFeedback(intent: Intent, outcome?: CommandOutcomeInput): void {
    if (intent !== pending) return;
    clearTimer(feedbackTimer); feedbackTimer = undefined;
    const ended = clock.monotonicNow?.();
    const durationMs = intent.startedMono !== undefined && ended !== undefined && ended >= intent.startedMono
      ? ended - intent.startedMono
      : undefined;
    if (!outcome) {
      const progress = pendingCommandId ? snapshot?.outcomes.find((row) => row.id === pendingCommandId) : undefined;
      const now = clock.now();
      if (progress?.began && intent.deadlineAt !== undefined && now < intent.deadlineAt + DEADLINE_GRACE_MS) {
        // Reached and running: keep the spinner (and any optimistic view) until it finishes or its deadline passes.
        if (optimistic?.intent === intent) optimistic = { intent, expiresAt: intent.deadlineAt };
        feedbackTimer = schedule(() => { feedbackTimer = undefined; finishFeedback(intent); },
          intent.deadlineAt + DEADLINE_GRACE_MS - now, 'command_timeout');
        notify();
        return;
      }
      intent.feedbackTimedOut = true;
      const waitingFor = intent.transfer
        ? snapshot?.devices.find((row) => row.deviceId === intent.targetDeviceId)?.name
        : activeDevice()?.name;
      // Two different failures: the server never acknowledged the send (this device's connection),
      // or it did and the other device never picked the command up.
      const sent = pendingCommandId !== undefined;
      lastError = sent
        ? `Couldn't reach ${waitingFor ?? 'the other device'}.`
        : `Couldn't send that to ${waitingFor ?? 'the other device'}. Check this device's connection.`;
      lastErrorCode = 'offline';
      if (optimistic?.intent === intent) optimistic = undefined;
      intent.resolveTransfer?.({ ok: false, reason: sent ? 'timeout' : 'offline', code: 'offline', error: lastError });
      emit({ event: 'input.timed_out', operation: intent.transfer ? 'transfer' : 'control', outcome: 'timeout', count: 1, ...(durationMs !== undefined ? { durationMs } : {}) });
    } else if (outcome.ok === false) {
      lastError = outcome.error ?? 'The device could not complete that action.';
      lastErrorCode = outcome.code;
      if (optimistic?.intent === intent) optimistic = undefined;
      intent.resolveTransfer?.({ ok: false, reason: outcome.code === 'not_found' ? 'not_found' : 'failed', code: outcome.code, error: lastError });
      emit({ event: 'input.failed', operation: intent.transfer ? 'transfer' : 'control', outcome: outcome.code, count: 1, ...(durationMs !== undefined ? { durationMs } : {}) });
    } else {
      optimistic = undefined; lastError = undefined; lastErrorCode = undefined;
      intent.resolveTransfer?.({ ok: true });
      emit({ event: 'input.confirmed', operation: intent.transfer ? 'transfer' : 'control', outcome: 'ok', count: 1, ...(durationMs !== undefined ? { durationMs } : {}) });
    }
    notify();
  }

  function pump(): void {
    if (disposed || pending || !snapshot || queue.size === 0) return;
    const intent = queue.shift();
    if (!intent) return;
    const target = snapshot.devices.find((row) => row.deviceId === intent.targetDeviceId);
    if (!target?.isOnline || !target.canPlay || (!intent.transfer && intent.targetDeviceId !== activeId())) {
      const error = !target?.isOnline ? connectError('offline') : !target.canPlay ? connectError('target_cannot_play') : connectError('target_not_active');
      setError(error, 'That device is unavailable.');
      intent.resolveTransfer?.(failureResult(error));
      pump(); return;
    }
    // An older app drops a command it does not know, which would read as an unreachable device.
    const needsNewer = isQueueEdit(intent.command) && intent.command.kind !== 'queue_add'
      ? target.protocolVersion < QUEUE_EDIT_PROTOCOL_VERSION
      : target.protocolVersion < 2;
    if (needsNewer) {
      const error = connectError('update_required'); setError(error, 'Update the other device to use Connect.');
      intent.resolveTransfer?.(failureResult(error)); pump(); return;
    }
    if (intent.epoch !== stateEpoch()) {
      const error = connectError('stale_ownership'); setError(error, 'Playback moved to another device.');
      intent.resolveTransfer?.(failureResult(error)); pump(); return;
    }
    pending = intent;
    pendingCommandId = undefined;
    retryCount = 0;
    intent.sentAt = clock.now();
    optimistic = intent.transfer ? undefined : { intent, expiresAt: intent.sentAt + INPUT_FEEDBACK_MS };
    emit({ event: 'input.started', operation: intent.transfer ? 'transfer' : 'control', requestId: intent.requestId, kind: intent.command.kind, count: 1 });
    feedbackTimer = schedule(() => { feedbackTimer = undefined; finishFeedback(intent); }, INPUT_FEEDBACK_MS, 'command_timeout');
    notify();
    transmit(intent);
  }

  async function transmit(intent: Intent): Promise<void> {
    if (disposed || pending !== intent || pendingCommandId) return;
    try {
      const receipt = await sample(intent.transfer ? 'transfer' : 'send', () => intent.transfer
        ? transport.transfer({ fromDeviceId: device.deviceId, toDeviceId: intent.targetDeviceId, requestId: intent.requestId, expectedOwnershipEpoch: intent.epoch })
        : transport.send({ fromDeviceId: device.deviceId, targetDeviceId: intent.targetDeviceId, requestId: intent.requestId, expectedOwnershipEpoch: intent.epoch, command: intent.command }));
      pendingCommandId = receipt.commandId;
      intent.deadlineAt = clock.now() + Math.max(0, receipt.executeBefore - receipt.serverNow);
      retryCount = 0;
      notify();
      observeOutcome();
    } catch (error) {
      const code = errorCode(error);
      if (code === 'stale_ownership') {
        queue.removeWhere((queued) => queued.epoch === intent.epoch);
        pending = undefined; pendingCommandId = undefined; optimistic = undefined; clearTimer(feedbackTimer); feedbackTimer = undefined;
        setError(error, 'Playback moved to another device.'); intent.resolveTransfer?.(failureResult(error)); pump(); return;
      }
      if (isUncertainFailure(error) && clock.now() - (intent.sentAt ?? intent.startedAt) < 60_000) {
        retryCount++;
        const delay = Math.min(4_000, 250 * (2 ** Math.min(retryCount, 4)));
        retryTimer = schedule(() => { retryTimer = undefined; void transmit(intent); }, delay, 'send_retry');
        return;
      }
      pending = undefined; pendingCommandId = undefined; optimistic = undefined;
      clearTimer(feedbackTimer); feedbackTimer = undefined;
      setError(error, 'Could not send the Connect command.'); intent.resolveTransfer?.(failureResult(error));
      pump();
    }
  }

  function observeOutcome(): void {
    if (!pending || !pendingCommandId || !snapshot) return;
    const result = snapshot.outcomes.find((row) => row.id === pendingCommandId);
    if (!result || result.status === 'pending') return;
    const intent = pending;
    finishFeedback(intent, result.status === 'done' ? { ok: true } : {
      ok: false, code: result.errorCode ?? 'command_failed', ...(result.error ? { error: result.error } : {})
    });
    pending = undefined; pendingCommandId = undefined;
    clearTimer(retryTimer); retryTimer = undefined;
    pump();
  }

  async function playLocally(command: Extract<RemoteCommand, { kind: 'play' | 'play_song' }>): Promise<void> {
    try {
      if (command.kind === 'play_song') {
        const queueItems = command.queue ?? [];
        const result = await player.load(command.song, queueItems, { positionSec: command.positionSec ?? 0, play: true });
        if (result === 'not_found') throw connectError('invalid_command', { message: 'This song is not available on this device.' });
        if (result === 'needs_gesture') {
          autoplayBlocked = true;
          throw Object.assign(new Error('Tap play to start audio.'), { data: { code: 'needs_gesture', message: 'Tap play to start audio.' } });
        }
      } else {
        const result = await player.play();
        if (result === 'needs_gesture') {
          autoplayBlocked = true;
          throw Object.assign(new Error('Tap play to start audio.'), { data: { code: 'needs_gesture', message: 'Tap play to start audio.' } });
        }
      }
      autoplayBlocked = false;
      local = player.getSnapshot(); notify();
    } catch (error) { setError(error, 'Could not start playback here.'); }
  }

  function control(command: RemoteCommand): void {
    if (disposed) return;
    if (command.kind === 'take_over') return;
    const remote = activeId() !== undefined && activeId() !== device.deviceId;
    if (remote && !activeOnline()) {
      if (command.kind === 'play' || command.kind === 'play_song') { void playLocally(command); return; }
      setError(connectError('offline'), 'The active device is offline.'); return;
    }
    if (remote) {
      if (!activeId()) return;
      offer(makeIntent(command, activeId() as string));
      return;
    }
    void applyLocalControl(command);
  }

  async function applyLocalControl(command: Exclude<RemoteCommand, { kind: 'take_over' }>): Promise<void> {
    try {
      switch (command.kind) {
        case 'play':
          if (await player.play() !== 'ok') { autoplayBlocked = true; throw new Error('Tap play to start audio.'); }
          autoplayBlocked = false;
          break;
        case 'pause': await player.pause(); break;
        case 'seek': await player.seek(command.sec); break;
        case 'volume': await player.setVolume(command.v); break;
        case 'shuffle': if (player.setShuffle) await player.setShuffle(command.on); break;
        case 'repeat': if (player.setRepeat) await player.setRepeat(command.mode); break;
        case 'next': if (player.next) await player.next(); break;
        case 'prev': if (player.previous) await player.previous(); break;
        case 'play_song': {
          const result = await player.load(command.song, command.queue ?? [], { positionSec: command.positionSec ?? 0, play: true });
          if (result !== 'ok') throw new Error(result === 'not_found' ? 'Song not found.' : 'Tap play to start audio.'); break;
        }
        // An edit naming a song that has already left the queue changes nothing.
        case 'queue_add': case 'queue_remove': case 'queue_move': case 'queue_clear':
          await executePlayerCommand(command); break;
      }
      local = player.getSnapshot();
      notify();
    } catch (error) { setError(error, 'Could not control playback.'); }
  }

  function onPlayerChange(next: PlayerSnapshot): void {
    const previous = previousLocal;
    previousLocal = next;
    local = next;
    if (disposed || restoring) return;
    const started = next.isPlaying && !previous.isPlaying;
    if (started) autoplayBlocked = false;
    if (started && !isActive() && !claimInFlight && next.song) void claimLocal();
    if (isActive() && !handoffInFlight) void reportLocal(next.positionSec !== previous.positionSec);
    notify();
    reconcileListening();
  }

  async function claimLocal(): Promise<void> {
    if (claimInFlight || disposed || !local.isPlaying || !local.song) return;
    claimInFlight = true;
    const expectedEpoch = stateEpoch();
    try {
      const result = await sample('claim', () => transport.claim(device.deviceId, player.getSnapshot(), expectedEpoch));
      confirmed = confirmedFromSnapshot(player.getSnapshot(), result.serverNow);
      lastPositionReportAt = clock.now();
      lastError = undefined; lastErrorCode = undefined;
      notify();
    } catch (error) {
      setError(error, 'Could not claim playback.');
      if (errorCode(error) === 'stale_ownership' && activeId() !== device.deviceId && player.getSnapshot().isPlaying) {
        await player.pause().catch(() => undefined); local = player.getSnapshot(); previousLocal = local;
      }
    } finally { claimInFlight = false; }
  }

  async function reportLocal(seek: boolean): Promise<void> {
    if (reportInFlight) { reportQueued = true; reportQueuedSeek ||= seek; return; }
    const state = snapshot?.state;
    if (!state || !isActive() || !local.song || handoffInFlight || disposed) return;
    const now = sampledClock.now();
    const current = player.getSnapshot();
    const position = clamp(current.positionSec, current.song?.duration ?? 0);
    const allowDrift = clock.now() - lastPositionReportAt >= REPORT_DRIFT_MS;
    const plan = planPatch(current, position, confirmed ?? confirmedFromState(state), now, { seek, allowDrift });
    if (!plan.patch) return;
    reportInFlight = true;
    const rev = serverRev ?? snapshot?.state?.rev ?? state.rev;
    const epoch = stateEpoch();
    const before = confirmed ?? confirmedFromState(state);
    try {
      const result = await sample('report', () => transport.report(device.deviceId, plan.patch as PlayerStatePatch, { rev, ownershipEpoch: epoch }));
      serverRev = Math.max(serverRev ?? 0, result.rev);
      confirmed = applyConfirmedPatch(before, plan.patch, result.serverNow);
      if (plan.patch.positionSec !== undefined) lastPositionReportAt = clock.now();
      lastError = undefined; lastErrorCode = undefined;
    } catch (error) {
      if (errorCode(error) === 'stale_ownership') {
        if (player.getSnapshot().isPlaying) await player.pause().catch(() => undefined);
        local = player.getSnapshot(); previousLocal = local;
      } else if (errorCode(error) === 'stale_revision') {
        const currentRev = errorData(error)?.currentRev;
        if (typeof currentRev === 'number' && Number.isFinite(currentRev)) serverRev = Math.max(serverRev ?? 0, currentRev);
        reportQueued = true;
      } else setError(error, 'Could not sync playback.');
    } finally {
      reportInFlight = false;
      if (reportQueued && isActive()) {
        const trailingSeek = reportQueuedSeek; reportQueued = false; reportQueuedSeek = false;
        void reportLocal(trailingSeek);
      }
      notify();
    }
  }

  async function drainInbox(): Promise<void> {
    if (inboxWorker || disposed || !snapshot) return;
    inboxWorker = true;
    try {
      while (!disposed && snapshot) {
        const next = snapshot.inbox.find((row) => !processed.has(row.id) && !processing.has(row.id));
        if (!next) break;
        processing.add(next.id);
        emit({ event: 'receiver.delivered', operation: 'receiver', commandId: next.id,
          ...(next.requestId ? { requestId: next.requestId } : {}), kind: next.command.kind, count: 1 });
        let retry = false;
        try {
          const completion = completions.get(next.id);
          if (completion) await deliverCompletion(completion);
          else await executeInbox(next);
          processed.add(next.id);
          inboxRetryCount = 0;
        } catch (error) {
          setError(error, 'Could not run the Connect command.');
          inboxRetryCount++;
          retry = true;
        } finally { processing.delete(next.id); }
        if (retry) {
          const delay = Math.min(4_000, 250 * (2 ** Math.min(inboxRetryCount, 4)));
          schedule(() => { void drainInbox(); }, delay, 'inbox_retry');
          break;
        }
      }
    } finally { inboxWorker = false; }
  }

  async function executeInbox(item: InboxCommand): Promise<void> {
    let begin: Awaited<ReturnType<ConnectTransport['begin']>>;
    try {
      begin = await sample('begin', () => transport.begin(device.deviceId, item.id));
    } catch (error) {
      const code = errorCode(error);
      const failure: ConnectFailureCode | undefined = code === 'command_expired' ? 'expired'
        : code === 'stale_ownership' ? 'superseded'
          : code === 'target_cannot_play' ? 'cannot_play' : undefined;
      if (!failure) throw error;
      await complete(item, '', { ok: false, code: failure, error: failureText(error, 'Command cannot run.') });
      return;
    }
    const deadline = item.executeBefore ?? begin.executeBefore;
    if (sampledClock.now() >= deadline) {
      await complete(item, begin.reservationToken, { ok: false, code: 'expired' }); return;
    }
    if (!device.canPlay) { await complete(item, begin.reservationToken, { ok: false, code: 'cannot_play' }); return; }
    if (item.expectedOwnershipEpoch !== undefined && item.expectedOwnershipEpoch !== stateEpoch()) {
      await complete(item, begin.reservationToken, { ok: false, code: 'superseded' }); return;
    }
    if (item.command.kind === 'take_over') {
      try { await executeTakeover(item, begin.reservationToken, deadline); }
      catch (error) {
        const code: ConnectFailureCode = errorData(error)?.code === 'not_found' ? 'not_found' : 'command_failed';
        await complete(item, begin.reservationToken, { ok: false, code, error: failureText(error, 'Transfer could not complete.') });
      }
      return;
    }
    const before = player.getSnapshot();
    try {
      const result = await executePlayerCommand(item.command);
      if (result !== 'ok') {
        if (result === 'needs_gesture') autoplayBlocked = true;
        const gone = result === 'not_found' && (item.command.kind === 'queue_remove' || item.command.kind === 'queue_move');
        await complete(item, begin.reservationToken, { ok: false, code: result, ...(gone ? { error: 'That song is no longer in the queue.' } : {}) });
        notify();
        return;
      }
      if (sampledClock.now() >= deadline) { await complete(item, begin.reservationToken, { ok: false, code: 'expired' }); return; }
      const after = player.getSnapshot();
      const patch = statePatchFrom(before, after);
      await complete(item, begin.reservationToken, { ok: true }, patch);
    } catch (error) {
      const code: ConnectFailureCode = errorData(error)?.code === 'needs_gesture' ? 'needs_gesture' : errorData(error)?.code === 'not_found' ? 'not_found' : 'command_failed';
      await complete(item, begin.reservationToken, { ok: false, code, error: failureText(error, 'Command failed.') });
    }
  }

  async function executePlayerCommand(command: Exclude<RemoteCommand, { kind: 'take_over' }>): Promise<'ok' | 'not_found' | 'needs_gesture' | 'command_failed'> {
    switch (command.kind) {
      case 'play': return player.play();
      case 'pause': await player.pause(); return 'ok';
      case 'seek': await player.seek(command.sec); return 'ok';
      case 'volume': await player.setVolume(command.v); return 'ok';
      case 'shuffle': if (player.setShuffle) { await player.setShuffle(command.on); return 'ok'; } return 'command_failed';
      case 'repeat': if (player.setRepeat) { await player.setRepeat(command.mode); return 'ok'; } return 'command_failed';
      case 'next': {
        if (player.next) { await player.next(); return 'ok'; }
        const current = player.getSnapshot();
        const nextSong = current.queue[0];
        if (!nextSong) return 'not_found';
        return player.load(nextSong, current.queue.slice(1), { positionSec: 0, play: current.isPlaying });
      }
      case 'prev': if (player.previous) { await player.previous(); return 'ok'; } return 'command_failed';
      case 'play_song': return player.load(command.song, command.queue ?? [], { positionSec: command.positionSec ?? 0, play: true });
      case 'queue_add':
        if (!command.next && !command.more?.length && player.addToQueue) { await player.addToQueue(command.song); return 'ok'; }
        return replaceQueue(applyQueueEdit(player.getSnapshot().queue, command));
      case 'queue_remove': case 'queue_move': case 'queue_clear':
        return replaceQueue(applyQueueEdit(player.getSnapshot().queue, command));
    }
  }

  /** `next` is the queue after an edit, or undefined when the song it named has gone. */
  async function replaceQueue(next: readonly SongSnapshot[] | undefined): Promise<'ok' | 'not_found' | 'needs_gesture'> {
    if (!next) return 'not_found';
    if (player.setQueue) { await player.setQueue(next); return 'ok'; }
    // A player that cannot swap its queue in place reloads the current song around it.
    const current = player.getSnapshot();
    if (!current.song) return 'not_found';
    return player.load(current.song, next, { positionSec: current.positionSec, play: current.isPlaying });
  }

  async function executeTakeover(item: InboxCommand, token: string, deadline: number): Promise<void> {
    const command = item.command;
    if (command.kind !== 'take_over') {
      await complete(item, token, { ok: false, code: 'not_found' }); return;
    }
    const state = command.state;
    const song = state.song;
    if (!song) { await complete(item, token, { ok: false, code: 'not_found' }); return; }
    const estimate = clamp(state.positionSec + (state.isPlaying ? Math.max(0, sampledClock.now() - state.positionAt) / 1000 : 0), song.duration);
    const loaded = await player.load(song, state.queue, { positionSec: estimate, play: false });
    if (loaded !== 'ok') { await complete(item, token, { ok: false, code: loaded }); return; }
    const prepared = await sample('prepare', () => transport.prepare(device.deviceId, item.id, token));
    if (prepared.status === 'awaiting_release') {
      // A listening owner pauses and releases within a few seconds. One that has not by now is not
      // listening, and the listener should hear that, not wait out the whole load deadline.
      const released = await waitForRelease(item.id, Math.min(deadline, sampledClock.now() + RELEASE_WAIT_MS));
      if (!released) { await complete(item, token, { ok: false, code: 'owner_unreachable' }); return; }
      await activateTransfer(item, token, released.positionSec, released.resume);
      return;
    }
    await activateTransfer(item, token, prepared.positionSec, prepared.resume);
  }

  async function activateTransfer(item: InboxCommand, token: string, positionSec: number, resume: boolean): Promise<void> {
    await player.seek(positionSec);
    if (resume) {
      const played = await player.play();
      if (played === 'needs_gesture') {
        autoplayBlocked = true;
        await complete(item, token, { ok: false, code: 'needs_gesture' }); return;
      }
    }
    autoplayBlocked = false;
    const current = player.getSnapshot();
    const state = snapshot?.state;
    await complete(item, token, { ok: true }, statePatchFrom(state ?? EMPTY_PLAYER, { ...current, positionSec, isPlaying: resume }), state?.rev);
  }

  async function waitForRelease(commandId: string, deadline: number): Promise<NonNullable<InboxCommand['release']> | undefined> {
    for (;;) {
      const command = snapshot?.inbox.find((row) => row.id === commandId);
      if (command?.release) return command.release;
      const remaining = deadline - sampledClock.now();
      if (remaining <= 0 || disposed) return undefined;
      await new Promise<void>((resolve) => {
        let done = false;
        const wake = (): void => { if (done) return; done = true; clearTimer(timer); snapshotWaiters.delete(wake); resolve(); };
        const timer = schedule(wake, remaining, 'handoff_deadline');
        snapshotWaiters.add(wake);
      });
    }
  }

  async function complete(item: InboxCommand, reservationToken: string, outcome: CommandOutcomeInput, patch?: PlayerStatePatch, knownRev?: number): Promise<void> {
    const pending = completions.get(item.id) ?? {
      item,
      reservationToken,
      outcome,
      ...(patch ? { patch } : {}),
      ...(knownRev !== undefined ? { rev: knownRev } : snapshot?.state ? { rev: snapshot.state.rev } : {})
    };
    completions.set(item.id, pending);
    await deliverCompletion(pending);
  }

  async function waitBeforeRetry(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      let finished = false;
      let timer: unknown;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        clearTimer(timer);
        snapshotWaiters.delete(finish);
        resolve();
      };
      snapshotWaiters.add(finish);
      timer = schedule(finish, delayMs, 'write_retry');
      if (disposed) finish();
    });
  }

  async function deliverCompletion(pending: PendingCompletion): Promise<void> {
    let attempt = 0;
    while (!disposed) {
      try {
        const result = await sample('complete', () => transport.complete({
          deviceId: device.deviceId, commandId: pending.item.id, reservationToken: pending.reservationToken,
          outcome: pending.outcome,
          ...(pending.patch ? { patch: pending.patch } : {}),
          ...(pending.patch && pending.rev !== undefined ? { rev: pending.rev } : {})
        }));
        if (result.status === 'completed') {
          emit({
            event: pending.outcome.ok ? 'receiver.completed' : 'receiver.failed',
            operation: 'receiver', commandId: pending.item.id,
            ...(pending.item.requestId ? { requestId: pending.item.requestId } : {}),
            kind: pending.item.command.kind,
            outcome: pending.outcome.ok === true ? 'ok' : pending.outcome.code, count: 1
          });
          if (completions.get(pending.item.id) === pending) completions.delete(pending.item.id);
          return;
        }
        pending.rev = result.currentRev;
        attempt = 0;
      } catch (error) {
        const code = errorCode(error);
        if (pending.outcome.ok === true && (code === 'device_not_active' || code === 'stale_ownership')) {
          pending.outcome = { ok: false, code: 'superseded', error: 'Playback ownership changed before the command was confirmed.' };
          delete pending.patch;
          delete pending.rev;
          attempt = 0;
        } else if (!isUncertainFailure(error)) {
          throw error;
        }
      }
      await waitBeforeRetry(Math.min(4_000, 250 * (2 ** Math.min(attempt++, 4))));
    }
  }

  function statePatchFrom(before: PlayerSnapshot, after: PlayerSnapshot): PlayerStatePatch {
    const songChanged = before.song?.ref !== after.song?.ref;
    const queueChanged = before.queue.length !== after.queue.length || before.queue.some((item, index) => item.ref !== after.queue[index]?.ref);
    const duration = after.song?.duration ?? 0;
    const position = clamp(after.positionSec, duration);
    const isPlayingChanged = before.isPlaying !== after.isPlaying;
    return {
      ...(songChanged ? { song: after.song ?? null } : {}),
      ...(queueChanged ? { queue: after.queue } : {}),
      ...(isPlayingChanged || before.positionSec !== position ? { isPlaying: after.isPlaying, positionSec: position } : {}),
      ...(before.volume !== after.volume ? { volume: after.volume } : {}),
      ...(before.shuffle !== after.shuffle ? { shuffle: after.shuffle } : {}),
      ...(before.repeat !== after.repeat ? { repeat: after.repeat } : {})
    };
  }

  function transferTo(targetDeviceId: string): Promise<TransferResult> {
    if (disposed || !snapshot) return Promise.resolve({ ok: false, reason: 'offline' });
    const target = snapshot.devices.find((row) => row.deviceId === targetDeviceId);
    if (!target?.isOnline) return Promise.resolve({ ok: false, reason: 'offline', code: 'offline', error: 'That device is offline.' });
    if (!target.canPlay) return Promise.resolve({ ok: false, reason: 'failed', code: 'target_cannot_play', error: 'That device cannot play right now.' });
    if (target.protocolVersion < 2) return Promise.resolve({ ok: false, reason: 'failed', code: 'update_required', error: 'Update the other device to use Connect.' });
    return new Promise((resolve) => offer(makeIntent({ kind: 'pause' }, targetDeviceId, true, resolve)));
  }


  const playerStop = player.onChange(onPlayerChange);

  return {
    view,
    livePosition,
    control,
    transferTo,
    subscribe(listener) { subscribers.add(listener); listener(view()); return () => subscribers.delete(listener); },
    rename(name) {
      const next = name.trim().slice(0, 80);
      if (disposed || !next || next === device.name) return;
      device = { ...device, name: next };
      // Registering again is how a name reaches the server; a device not listening sends it when it next does.
      if (listening) void sample('register', () => transport.register({ ...device, protocolVersion: CONNECT_PROTOCOL_VERSION }))
        .catch((error: unknown) => setError(error, 'Could not rename this device.'));
    },
    setVisible(value) {
      visible = value;
      reconcileListening();
      // Back in front after a while (a throttled tab, a suspended phone app): say so now, not at
      // the next interval, so the other devices list this one again straight away.
      if (value && listening && clock.now() - lastBeatAt >= HEARTBEAT_MS / 2) void beat();
    },
    dispose() { void end(); },
    leave() { return end(); }
  };

  function end(): Promise<void> {
    if (disposed) return Promise.resolve();
    disposed = true;
    const goodbye = stopListening(true);
    playerStop();
    for (const handle of [...timers]) clearTimer(handle);
    subscribers.clear();
    for (const wake of [...snapshotWaiters]) wake();
    queue.removeWhere(() => true);
    if (pending) {
      emit({ event: 'input.failed', operation: pending.transfer ? 'transfer' : 'control', outcome: 'disposed', requestId: pending.requestId, count: 1 });
      pending.resolveTransfer?.({ ok: false, reason: 'offline', code: 'offline', error: 'Connect session ended.' });
    }
    pending = undefined; pendingCommandId = undefined; optimistic = undefined;
    player.dispose?.();
    return goodbye;
  }
}
