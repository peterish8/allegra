// Injected into every Allegra page. The site already tells the operating system what is playing
// through the Media Session API (apps/web/src/hooks/useMediaSession.ts); this script listens in
// on those same calls and keeps the handlers, so the desktop shell can show the song (taskbar,
// mini player, notch) and press the same buttons Windows' media keys press. The site needs no
// desktop-specific code, and every command still goes through the player's one funnel.
(() => {
  if (window.top !== window || !window.MediaSession) return;
  const post = (msg) => window.ipc.postMessage(JSON.stringify(msg));
  const proto = MediaSession.prototype;
  const handlers = {};
  const now = { title: "", artist: "", album: "", cover: null, playing: false, duration: 0, position: 0 };
  const pendingCatalog = [];
  let catalogHandler = null;

  const catalogRequest = (value) => {
    const cleanRef = (ref) => typeof ref === "string" && /^(saavn|gaana):[A-Za-z0-9._~-]{1,256}$/.test(ref);
    if (!value || !cleanRef(value.id)) return null;
    const queue = value.queue === undefined ? [value.id] : value.queue;
    if (!Array.isArray(queue) || queue.length > 50 || !queue.every(cleanRef)) return null;
    const ordered = [...new Set(queue)];
    if (!ordered.includes(value.id)) ordered.unshift(value.id);
    return { id: value.id, queue: ordered };
  };

  // Song and play state go out at once; position updates (many per second) at most once a second.
  let sentAt = 0;
  let timer = 0;
  const send = (urgent) => {
    const wait = 1000 - (Date.now() - sentAt);
    if (!urgent && wait > 0) {
      timer ||= setTimeout(() => { timer = 0; send(true); }, wait);
      return;
    }
    clearTimeout(timer);
    timer = 0;
    sentAt = Date.now();
    post({ cmd: "now", ...now });
  };

  const setHandler = proto.setActionHandler;
  proto.setActionHandler = function (action, handler) {
    handlers[action] = handler;
    return setHandler.call(this, action, handler);
  };

  const afterSet = (prop, then) => {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, { ...d, set(v) { d.set.call(this, v); then(v); } });
  };
  afterSet("metadata", (m) => {
    now.title = m?.title || "";
    now.artist = m?.artist || "";
    now.album = m?.album || "";
    const art = m?.artwork || [];
    now.cover = art.length ? art[art.length - 1].src : null;
    send(true);
  });
  afterSet("playbackState", (s) => {
    const playing = s === "playing";
    if (playing !== now.playing) { now.playing = playing; send(true); }
  });

  const setPosition = proto.setPositionState;
  proto.setPositionState = function (s) {
    setPosition.call(this, s);
    now.duration = s?.duration || 0;
    now.position = s?.position || 0;
    send(false);
  };

  // Called by the shell.
  window.__allegra = {
    cmd(action, seekTime) {
      const h = handlers[action];
      if (h) h({ action, seekTime });
    },
    toggle() { this.cmd(now.playing ? "pause" : "play"); },
    playCatalog(value) {
      const request = catalogRequest(value);
      if (!request) return;
      if (catalogHandler) catalogHandler(request);
      else pendingCatalog.push(request);
    },
    onCatalogPlay(handler) {
      catalogHandler = handler;
      for (const request of pendingCatalog.splice(0)) handler(request);
      return () => { if (catalogHandler === handler) catalogHandler = null; };
    },
    // Same-document navigation, so the music keeps playing (Next.js follows history.pushState).
    go(path) {
      if (location.pathname + location.search !== path) history.pushState(null, "", path);
    },
  };

  // Playlists the listener opens feed the taskbar's "Recent" list. The site doesn't set
  // document.title, so the name comes from the page heading once it has rendered.
  const visited = () => {
    const path = location.pathname;
    if (!/^\/(playlist|shared)\/./.test(path) && path !== "/liked") return;
    setTimeout(() => {
      if (location.pathname !== path) return;
      const h = document.querySelector("main h1") || document.querySelector("h1");
      post({ cmd: "visit", path, title: (h?.textContent || "").trim() });
    }, 1500);
  };
  for (const k of ["pushState", "replaceState"]) {
    const f = history[k];
    history[k] = function (...a) { const r = f.apply(this, a); visited(); return r; };
  }
  addEventListener("popstate", visited);
  addEventListener("DOMContentLoaded", visited);

  // Karaoke models are hundreds of MB in origin storage; ask Chromium never to evict them.
  navigator.storage?.persist?.().then((granted) => post({ cmd: "persist", granted }), () => {});
  post({ cmd: "ready" });
})();
