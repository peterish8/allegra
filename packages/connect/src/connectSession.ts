import type { SongSnapshot } from '../../shared/songRef.ts';
import type {
  Clock,
  ConnectCommand,
  ConnectPlayerState,
  ConnectSession,
  ConnectSessionOptions,
  ConnectSnapshot,
  ConnectView,
  PendingCommandView,
  PlayerSnapshot,
  PlayerStatePatch,
  RemoteCommand,
  TransferResult
} from './types.ts';

const HEARTBEAT_MS = 60_000;
const COMMAND_TIMEOUT_MS = 4_000;
const LISTEN_RETRY_MS = 5_000;
const ACK_RETRY_MS = 1_000;
const POSITION_REPORT_MS = 30_000;
const MAX_SEEN_COMMANDS = 500;

interface ProcessedCommand {
  readonly ok: boolean;
  readonly error?: string;
  acknowledged: boolean;
}

interface LocalPending {
  readonly targetDeviceId: string;
  readonly command: RemoteCommand;
  readonly startedAt: number;
  readonly kind: 'control' | 'transfer';
  commandId?: string;
  timeout?: unknown;
}

interface OptimisticState {
  readonly snapshot: PlayerSnapshot;
  readonly positionAt: number;
}

/**
 * Playback-agnostic Connect orchestration. Platform adapters own audio; this
 * module owns device claims, command delivery, state reporting and recovery.
 */
export function createConnectSession({ transport, player, device, clock }: ConnectSessionOptions): ConnectSession {
  let disposed = false;
  let visible = false;
  let registering = false;
  let watchStop: (() => void) | undefined;
  let heartbeatTimer: unknown;
  let listenRetryTimer: unknown;
  let ackRetryTimer: unknown;
  let playerStop: (() => void) | undefined;
  let snapshot: ConnectSnapshot = { serverNow: clock.now(), devices: [], commands: [] };
  let local = player.getSnapshot();
  let clockOffset = 0;
  let suppressPlayerEvents = 0;
  let restoringLastSession = false;
  let didRestore = false;
  let autoplayBlocked = false;
  let lastError: string | undefined;
  let optimistic: OptimisticState | undefined;
  let pending: LocalPending | undefined;
  let lastReportedKey = '';
  let lastReportedAt = 0;
  const subscribers = new Set<(view: ConnectView) => void>();
  const processedCommands = new Map<string, ProcessedCommand>();
  const processingCommands = new Set<string>();
  const acknowledgingCommands = new Set<string>();
  const transferWaiters = new Map<string, (result: TransferResult) => void>();

  const toServerNow = () => clock.now() + clockOffset;
  const state = () => snapshot.state;
  const activeId = () => state()?.activeDeviceId;
  const isActive = () => activeId() === device.deviceId;

  function notify(): void {
    if (disposed) return;
    const value = view();
    for (const listener of [...subscribers]) listener(value);
  }

  function displayedSnapshot(): PlayerSnapshot {
    return optimistic?.snapshot ?? state() ?? local;
  }

  function displayedAnchor(): number {
    return optimistic?.positionAt ?? state()?.positionAt ?? toServerNow();
  }

  function livePosition(): number {
    const current = displayedSnapshot();
    const elapsed = current.isPlaying ? Math.max(0, (toServerNow() - displayedAnchor()) / 1000) : 0;
    return Math.max(0, current.positionSec + elapsed);
  }

  function view(): ConnectView {
    const current = displayedSnapshot();
    const activeDeviceId = activeId();
    const activeDevice = snapshot.devices.find((entry) => entry.deviceId === activeDeviceId);
    const pendingView: PendingCommandView | undefined = pending
      ? {
          ...(pending.commandId ? { commandId: pending.commandId } : {}),
          targetDeviceId: pending.targetDeviceId,
          command: pending.command,
          startedAt: pending.startedAt
        }
      : undefined;
    return {
      devices: snapshot.devices,
      ...(activeDevice ? { activeDevice } : {}),
      ...(activeDeviceId ? { activeDeviceId } : {}),
      isThisDeviceActive: isActive(),
      ...(current.song ? { song: current.song } : {}),
      queue: current.queue,
      isPlaying: current.isPlaying,
      livePosition: livePosition(),
      volume: current.volume,
      shuffle: current.shuffle,
      repeat: current.repeat,
      ...(pendingView ? { pendingCommand: pendingView } : {}),
      autoplayBlocked,
      ...(lastError ? { lastError } : {})
    };
  }

  function updateClock(serverNow: number): void {
    clockOffset = serverNow - clock.now();
  }

  function shouldListen(): boolean {
    return visible || local.isPlaying || isActive();
  }

  function reconcileListening(): void {
    if (disposed) return;
    if (shouldListen()) void startListening();
    else stopListening();
  }

  function scheduleListenRetry(): void {
    if (disposed || listenRetryTimer !== undefined || !shouldListen()) return;
    listenRetryTimer = clock.setTimeout(() => {
      listenRetryTimer = undefined;
      void startListening();
    }, LISTEN_RETRY_MS);
  }

  async function startListening(): Promise<void> {
    if (disposed || watchStop || registering) return;
    registering = true;
    try {
      const result = await transport.register(device);
      updateClock(result.serverNow);
      if (disposed || !shouldListen()) return;
      watchStop = transport.watch(device.deviceId, onTransportSnapshot);
      heartbeatTimer = clock.setInterval(() => {
        void transport.heartbeat(device.deviceId).then((reply) => updateClock(reply.serverNow)).catch(() => {
          lastError = 'Connect is offline';
          notify();
        });
      }, HEARTBEAT_MS);
      if (listenRetryTimer !== undefined) clock.clearTimeout(listenRetryTimer);
      listenRetryTimer = undefined;
    } catch (error) {
      lastError = errorMessage(error, 'Connect is offline');
      notify();
      scheduleListenRetry();
    } finally {
      registering = false;
    }
  }

  function stopListening(): void {
    watchStop?.();
    watchStop = undefined;
    if (heartbeatTimer !== undefined) clock.clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    if (listenRetryTimer !== undefined) clock.clearTimeout(listenRetryTimer);
    listenRetryTimer = undefined;
    // A registration is durable. The transport watch and heartbeat are the cost-bearing parts.
  }

  function onTransportSnapshot(next: ConnectSnapshot): void {
    if (disposed) return;
    const wasActive = isActive();
    snapshot = next;
    updateClock(next.serverNow);
    lastError = undefined;

    if (!didRestore) {
      didRestore = true;
      const hasTakeover = next.commands.some((command) => command.status === 'pending' && command.targetDeviceId === device.deviceId && command.command.kind === 'take_over');
      const stored = next.state;
      if (!hasTakeover && stored?.song && !local.song) {
        restoringLastSession = true;
        void player.load(stored.song, stored.queue, { positionSec: positionAt(stored, toServerNow()), play: false })
          .then(() => {
            local = player.getSnapshot();
            notify();
          })
          .catch(() => undefined)
          .finally(() => {
            restoringLastSession = false;
          });
      }
    }

    if (wasActive && !isActive() && local.isPlaying) {
      void runPlayerAction(() => player.pause());
    }
    reconcilePending(next.commands);
    processInbox(next.commands);
    notify();
    reconcileListening();
  }

  function reconcilePending(commands: readonly ConnectCommand[]): void {
    if (!pending?.commandId) return;
    const command = commands.find((entry) => entry.id === pending?.commandId);
    if (!command || command.status === 'pending') return;
    finishPending(command.status === 'done'
      ? { ok: true }
      : transferFailure(command.error ?? 'Command failed'));
  }

  function processInbox(commands: readonly ConnectCommand[]): void {
    for (const command of commands) {
      if (command.targetDeviceId !== device.deviceId || command.status !== 'pending') continue;
      if (processingCommands.has(command.id)) continue;
      const processed = processedCommands.get(command.id);
      if (processed) {
        if (!processed.acknowledged) void acknowledge(command.id, processed);
        continue;
      }
      processingCommands.add(command.id);
      void applyIncoming(command).finally(() => processingCommands.delete(command.id));
    }
  }

  async function applyIncoming(envelope: ConnectCommand): Promise<void> {
    let ok = true;
    let error: string | undefined;
    try {
      const result = await applyCommand(envelope.command);
      if (result === 'not_found') {
        ok = false;
        error = 'not_found';
      } else if (result === 'needs_gesture') {
        ok = false;
        error = 'needs_gesture';
      }
    } catch (cause) {
      ok = false;
      error = errorMessage(cause, 'command_failed');
    }
    const processed: ProcessedCommand = { ok, ...(error ? { error } : {}), acknowledged: false };
    processedCommands.set(envelope.id, processed);
    if (processedCommands.size > MAX_SEEN_COMMANDS) {
      const first = processedCommands.values().next().value;
      if (first) {
        const firstId = processedCommands.keys().next().value as string | undefined;
        if (firstId) processedCommands.delete(firstId);
      }
    }
    if (ok && isActive()) await reportLocal(true);
    await acknowledge(envelope.id, processed);
  }

  async function acknowledge(commandId: string, processed: ProcessedCommand): Promise<void> {
    if (processed.acknowledged || acknowledgingCommands.has(commandId)) return;
    acknowledgingCommands.add(commandId);
    try {
      const result = await transport.ack(device.deviceId, commandId, {
        ok: processed.ok,
        ...(processed.error ? { error: processed.error } : {})
      });
      if (result.accepted !== false) {
        processed.acknowledged = true;
        lastError = undefined;
        const hasUnacknowledgedPending = snapshot.commands.some((command) =>
          command.targetDeviceId === device.deviceId &&
          command.status === 'pending' &&
          !processedCommands.get(command.id)?.acknowledged
        );
        if (!hasUnacknowledgedPending && ackRetryTimer !== undefined) {
          clock.clearTimeout(ackRetryTimer);
          ackRetryTimer = undefined;
        }
      } else {
        lastError = 'Could not acknowledge command';
        scheduleAckRetry();
      }
    } catch (cause) {
      lastError = errorMessage(cause, 'Could not acknowledge command');
      scheduleAckRetry();
    } finally {
      acknowledgingCommands.delete(commandId);
      notify();
    }
  }

  function scheduleAckRetry(): void {
    if (disposed || ackRetryTimer !== undefined) return;
    ackRetryTimer = clock.setTimeout(() => {
      ackRetryTimer = undefined;
      processInbox(snapshot.commands);
    }, ACK_RETRY_MS);
  }

  async function applyCommand(command: RemoteCommand): Promise<'ok' | 'not_found' | 'needs_gesture'> {
    switch (command.kind) {
      case 'take_over': {
        const song = command.state.song;
        if (!song) return 'not_found';
        const result = await loadSnapshot(song, command.state, positionAt(command.state, toServerNow()));
        if (result === 'not_found') return 'not_found';
        autoplayBlocked = result === 'needs_gesture';
        local = player.getSnapshot();
        if (result === 'needs_gesture') throw new Error('needs_gesture');
        try {
          const claim = await transport.claim(device.deviceId, local);
          if (claim.accepted === false) throw new Error('Could not claim playback');
          updateClock(claim.serverNow);
        } catch (error) {
          if (player.getSnapshot().isPlaying) await runPlayerAction(() => player.pause()).catch(() => undefined);
          throw error;
        }
        lastReportedKey = reportKey(local);
        lastReportedAt = clock.now();
        return 'ok';
      }
      case 'play_song': {
        const result = await runPlayerAction(() => player.load(command.song, command.queue ?? [], { positionSec: 0, play: true }));
        if (result === 'not_found') return 'not_found';
        autoplayBlocked = result === 'needs_gesture';
        if (result === 'needs_gesture') return 'needs_gesture';
        local = player.getSnapshot();
        if (local.isPlaying && !isActive()) {
          const claim = await transport.claim(device.deviceId, local);
          updateClock(claim.serverNow);
        }
        return 'ok';
      }
      case 'queue_add':
        if (player.addToQueue) await runPlayerAction(() => player.addToQueue?.(command.song) ?? Promise.resolve());
        else if (local.song) {
          const result = await runPlayerAction(() => player.load(local.song as SongSnapshot, [...local.queue, command.song], { positionSec: livePosition(), play: local.isPlaying }));
          if (result === 'not_found') return 'not_found';
          autoplayBlocked = result === 'needs_gesture';
          if (result === 'needs_gesture') return 'needs_gesture';
        } else return 'not_found';
        local = player.getSnapshot();
        return 'ok';
      default:
        return executeBasicCommand(command);
    }
  }

  async function executeBasicCommand(command: Exclude<RemoteCommand, { kind: 'take_over' | 'play_song' | 'queue_add' }>): Promise<'ok' | 'not_found' | 'needs_gesture'> {
    switch (command.kind) {
      case 'play': {
        const result = await runPlayerAction(() => player.play());
        autoplayBlocked = result === 'needs_gesture';
        if (result === 'needs_gesture') return 'needs_gesture';
        break;
      }
      case 'pause':
        await runPlayerAction(() => player.pause());
        autoplayBlocked = false;
        break;
      case 'seek':
        await runPlayerAction(() => player.seek(command.sec));
        break;
      case 'volume':
        await runPlayerAction(() => player.setVolume(command.v));
        break;
      case 'shuffle':
        if (player.setShuffle) await runPlayerAction(() => player.setShuffle?.(command.on) ?? Promise.resolve());
        break;
      case 'repeat':
        if (player.setRepeat) await runPlayerAction(() => player.setRepeat?.(command.mode) ?? Promise.resolve());
        break;
      case 'next':
        if (player.next) await runPlayerAction(() => player.next?.() ?? Promise.resolve());
        else if (local.queue[0]) {
          const [next, ...queue] = local.queue;
          const result = await runPlayerAction(() => player.load(next as SongSnapshot, queue, { positionSec: 0, play: local.isPlaying }));
          if (result === 'not_found') return 'not_found';
          autoplayBlocked = result === 'needs_gesture';
          if (result === 'needs_gesture') return 'needs_gesture';
        }
        break;
      case 'prev':
        if (player.previous) await runPlayerAction(() => player.previous?.() ?? Promise.resolve());
        else await runPlayerAction(() => player.seek(local.positionSec > 3 ? 0 : local.positionSec));
        break;
    }
    local = player.getSnapshot();
    if (local.isPlaying && !isActive()) {
      const claim = await transport.claim(device.deviceId, local);
      updateClock(claim.serverNow);
    }
    return 'ok';
  }

  async function runPlayerAction<T>(action: () => Promise<T>): Promise<T> {
    suppressPlayerEvents++;
    try {
      return await action();
    } finally {
      suppressPlayerEvents--;
      local = player.getSnapshot();
    }
  }

  async function loadSnapshot(song: SongSnapshot, source: PlayerSnapshot, positionSec: number): Promise<'ok' | 'not_found' | 'needs_gesture'> {
    let loaded = false;
    try {
      // Start playback in the initiating action before awaiting settings writes;
      // browsers can lose user activation across an awaited settings update.
      const result = await runPlayerAction(() => player.load(song, source.queue, {
        positionSec,
        play: source.isPlaying
      }));
      if (result === 'not_found') return result;
      loaded = true;
      await runPlayerAction(() => player.setVolume(source.volume));
      if (player.setShuffle) await runPlayerAction(() => player.setShuffle?.(source.shuffle) ?? Promise.resolve());
      if (player.setRepeat) await runPlayerAction(() => player.setRepeat?.(source.repeat) ?? Promise.resolve());
      local = player.getSnapshot();
      return result;
    } catch (error) {
      if (loaded && player.getSnapshot().isPlaying) await runPlayerAction(() => player.pause()).catch(() => undefined);
      throw error;
    }
  }

  async function reportLocal(force: boolean): Promise<void> {
    if (!isActive() || !snapshot.state || disposed) return;
    local = player.getSnapshot();
    const key = reportKey(local);
    const dueForDrift = clock.now() - lastReportedAt >= POSITION_REPORT_MS;
    if (!force && key === lastReportedKey && !dueForDrift) return;
    const patch: PlayerStatePatch = { ...local };
    try {
      const result = await transport.report(device.deviceId, patch, snapshot.state.rev);
      updateClock(result.serverNow);
      if (result.accepted === false) return;
      lastReportedKey = key;
      lastReportedAt = clock.now();
    } catch (error) {
      lastError = errorMessage(error, 'Could not sync playback');
    }
  }

  async function claimLocal(): Promise<void> {
    if (disposed || !local.isPlaying) return;
    try {
      const result = await transport.claim(device.deviceId, player.getSnapshot());
      updateClock(result.serverNow);
      local = player.getSnapshot();
      lastReportedKey = reportKey(local);
      lastReportedAt = clock.now();
      autoplayBlocked = false;
      lastError = undefined;
      notify();
    } catch (error) {
      lastError = errorMessage(error, 'Could not claim playback');
      notify();
    }
  }

  function onPlayerChange(next: PlayerSnapshot): void {
    local = next;
    if (suppressPlayerEvents > 0 || restoringLastSession || disposed) return;
    if (next.isPlaying && !isActive()) {
      reconcileListening();
      void startListening().then(() => claimLocal());
    } else if (isActive()) {
      void reportLocal(false);
    }
    notify();
    reconcileListening();
  }

  function control(command: RemoteCommand): void {
    if (disposed) return;
    const active = activeId();
    if (!active || active === device.deviceId) {
      if (command.kind === 'take_over') return;
      void applyCommand(command).then((result) => {
        if (result === 'not_found') throw new Error('not_found');
        if (result === 'needs_gesture') throw new Error('needs_gesture');
        if (isActive()) return reportLocal(true);
        if (local.isPlaying) return claimLocal();
        return undefined;
      }).catch((error) => {
        lastError = errorMessage(error, 'Playback command failed');
        notify();
      });
      return;
    }
    void sendRemote(active, command);
  }

  async function sendRemote(targetDeviceId: string, command: RemoteCommand): Promise<void> {
    if (pending) return;
    optimistic = { snapshot: optimisticSnapshot(command), positionAt: toServerNow() };
    pending = { targetDeviceId, command, startedAt: clock.now(), kind: 'control' };
    lastError = undefined;
    notify();
    try {
      const result = await transport.send(device.deviceId, targetDeviceId, command);
      if (disposed) return;
      updateClock(result.serverNow);
      if (!pending) return;
      pending.commandId = result.commandId;
      pending.timeout = clock.setTimeout(() => onPendingTimeout(result.commandId), COMMAND_TIMEOUT_MS);
      reconcilePending(snapshot.commands);
      notify();
    } catch (error) {
      if (disposed) return;
      clearPending();
      optimistic = undefined;
      lastError = isOffline(error) ? 'Connect is offline' : errorMessage(error, 'Connect is offline');
      notify();
    }
  }

  async function transferTo(targetDeviceId: string): Promise<TransferResult> {
    if (disposed) return { ok: false, reason: 'offline' };
    if (targetDeviceId === device.deviceId) return transferToLocalDevice();
    if (pending) return { ok: false, reason: 'failed', error: 'A command is already in progress' };
    optimistic = undefined;
    const target = snapshot.devices.find((entry) => entry.deviceId === targetDeviceId);
    const command: RemoteCommand = state()
      ? { kind: 'take_over', state: state() as ConnectPlayerState }
      : { kind: 'pause' };
    if (!target?.canPlay || !target.isOnline) return { ok: false, reason: 'failed', error: 'That device is unavailable' };
    pending = { targetDeviceId, command, startedAt: clock.now(), kind: 'transfer' };
    lastError = undefined;
    notify();
    return new Promise<TransferResult>((resolve) => {
      let settled = false;
      transferWaiters.set('__pending_transfer__', (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      });
      void transport.transfer(device.deviceId, targetDeviceId).then((result) => {
        if (disposed) return;
        updateClock(result.serverNow);
        if (!pending) {
          settleTransferFromCommand(result.commandId, resolve);
          return;
        }
        pending.commandId = result.commandId;
        pending.timeout = clock.setTimeout(() => onPendingTimeout(result.commandId), COMMAND_TIMEOUT_MS);
        transferWaiters.delete('__pending_transfer__');
        transferWaiters.set(result.commandId, (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        });
        reconcilePending(snapshot.commands);
        notify();
      }).catch((error) => {
        if (disposed) return;
        clearPending();
        const failure: TransferResult = { ok: false, reason: isOffline(error) ? 'offline' : 'failed', error: errorMessage(error, 'Transfer failed') };
        lastError = failure.error;
        transferWaiters.delete('__pending_transfer__');
        if (!settled) {
          settled = true;
          resolve(failure);
        }
        notify();
      });
    });
  }

  async function transferToLocalDevice(): Promise<TransferResult> {
    if (isActive()) return { ok: true };
    if (pending) return { ok: false, reason: 'failed', error: 'A command is already in progress' };
    if (!device.canPlay) return { ok: false, reason: 'failed', error: 'This device cannot play audio' };
    const current = state();
    if (!current?.song) return { ok: false, reason: 'not_found', error: 'There is no song to transfer' };

    const command: RemoteCommand = { kind: 'take_over', state: current };
    pending = { targetDeviceId: device.deviceId, command, startedAt: clock.now(), kind: 'transfer' };
    optimistic = undefined;
    lastError = undefined;
    notify();
    try {
      const result = await loadSnapshot(current.song, current, positionAt(current, toServerNow()));
      if (disposed) {
        if (player.getSnapshot().isPlaying) await runPlayerAction(() => player.pause()).catch(() => undefined);
        return { ok: false, reason: 'offline' };
      }
      if (result === 'not_found') {
        lastError = 'This song is unavailable on this device';
        return { ok: false, reason: 'not_found', error: 'not_found' };
      }
      if (result === 'needs_gesture') {
        autoplayBlocked = true;
        lastError = 'Playback needs a tap on this device';
        return { ok: false, reason: 'failed', error: 'needs_gesture' };
      }

      const claim = await transport.claim(device.deviceId, player.getSnapshot());
      if (disposed) return { ok: false, reason: 'offline' };
      if (claim.accepted === false) throw new Error('Could not claim playback');
      updateClock(claim.serverNow);
      local = player.getSnapshot();
      lastReportedKey = reportKey(local);
      lastReportedAt = clock.now();
      autoplayBlocked = false;
      lastError = undefined;
      return { ok: true };
    } catch (error) {
      if (player.getSnapshot().isPlaying) await runPlayerAction(() => player.pause()).catch(() => undefined);
      if (!disposed) lastError = isOffline(error) ? 'Connect is offline' : errorMessage(error, 'Could not transfer playback');
      return { ok: false, reason: isOffline(error) ? 'offline' : 'failed', error: errorMessage(error, 'Could not transfer playback') };
    } finally {
      clearPending();
      notify();
    }
  }

  function settleTransferFromCommand(commandId: string, resolve: (result: TransferResult) => void): void {
    const command = snapshot.commands.find((entry) => entry.id === commandId);
    if (!command || command.status === 'pending') return;
    resolve(command.status === 'done' ? { ok: true } : transferFailure(command.error ?? 'Transfer failed'));
  }

  function onPendingTimeout(commandId: string): void {
    if (!pending || pending.commandId !== commandId) return;
    const target = snapshot.devices.find((entry) => entry.deviceId === pending?.targetDeviceId);
    const message = `Couldn't reach ${target?.name ?? 'device'}`;
    const waiter = transferWaiters.get(commandId) ?? transferWaiters.get('__pending_transfer__');
    clearPending();
    optimistic = undefined;
    lastError = message;
    waiter?.({ ok: false, reason: 'timeout', error: message });
    transferWaiters.delete(commandId);
    transferWaiters.delete('__pending_transfer__');
    notify();
  }

  function finishPending(result: TransferResult): void {
    const commandId = pending?.commandId;
    const waiter = commandId ? transferWaiters.get(commandId) : transferWaiters.get('__pending_transfer__');
    const wasTransfer = pending?.kind === 'transfer';
    clearPending();
    optimistic = undefined;
    if ('error' in result) lastError = result.error ?? 'Command failed';
    if (wasTransfer) waiter?.(result);
    if (commandId) transferWaiters.delete(commandId);
    transferWaiters.delete('__pending_transfer__');
    notify();
  }

  function clearPending(): void {
    if (pending?.timeout !== undefined) clock.clearTimeout(pending.timeout);
    pending = undefined;
  }

  function optimisticSnapshot(command: RemoteCommand): PlayerSnapshot {
    const current = displayedSnapshot();
    switch (command.kind) {
      case 'play': return { ...current, isPlaying: true };
      case 'pause': return { ...current, isPlaying: false };
      case 'seek': return { ...current, positionSec: Math.max(0, command.sec) };
      case 'volume': return { ...current, volume: Math.max(0, Math.min(1, command.v)) };
      case 'shuffle': return { ...current, shuffle: command.on };
      case 'repeat': return { ...current, repeat: command.mode };
      case 'play_song': return { song: command.song, queue: command.queue ?? [], isPlaying: true, positionSec: 0, volume: current.volume, shuffle: current.shuffle, repeat: current.repeat };
      case 'queue_add': return { ...current, queue: [...current.queue, command.song] };
      case 'take_over': return command.state;
      case 'next': {
        const [song, ...queue] = current.queue;
        return song ? { ...current, song, queue, positionSec: 0, isPlaying: true } : current;
      }
      case 'prev': return { ...current, positionSec: 0 };
    }
  }

  playerStop = player.onChange(onPlayerChange);

  return {
    view,
    subscribe(listener) {
      subscribers.add(listener);
      listener(view());
      return () => subscribers.delete(listener);
    },
    control,
    transferTo,
    setVisible(value) {
      if (disposed || visible === value) return;
      visible = value;
      reconcileListening();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopListening();
      playerStop?.();
      playerStop = undefined;
      if (pending?.timeout !== undefined) clock.clearTimeout(pending.timeout);
      pending = undefined;
      optimistic = undefined;
      if (ackRetryTimer !== undefined) clock.clearTimeout(ackRetryTimer);
      ackRetryTimer = undefined;
      for (const resolve of transferWaiters.values()) resolve({ ok: false, reason: 'offline' });
      transferWaiters.clear();
      subscribers.clear();
    }
  };

  function positionAt(current: Pick<ConnectPlayerState, 'positionSec' | 'positionAt' | 'isPlaying'>, serverNow: number): number {
    return current.positionSec + (current.isPlaying ? Math.max(0, (serverNow - current.positionAt) / 1000) : 0);
  }

  function reportKey(value: PlayerSnapshot): string {
    return JSON.stringify({
      song: value.song?.ref ?? null,
      queue: value.queue.map((song) => song.ref),
      isPlaying: value.isPlaying,
      volume: value.volume,
      shuffle: value.shuffle,
      repeat: value.repeat
    });
  }

  function transferFailure(error: string): TransferResult {
    if (error === 'not_found') return { ok: false, reason: 'not_found', error };
    return { ok: false, reason: 'failed', error };
  }

  function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  function isOffline(error: unknown): boolean {
    return error instanceof Error && /offline|network/i.test(error.message);
  }
}
