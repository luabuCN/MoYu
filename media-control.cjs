'use strict';

// Executed separately in each frame, including cross-origin player frames.
// Remote pages receive no Node.js or IPC access.
function controlFrameMedia(paused, revision) {
  const key = '__moyuMediaPauseState';
  let state = window[key];
  if (!state) {
    if (!paused) return;
    state = window[key] = {revision: -1, paused: false, playing: new Set(), roots: new Map()};
    state.pause = media => {
      if (state.paused && media instanceof HTMLMediaElement && !media.paused && !media.ended) {
        state.playing.add(media);
        HTMLMediaElement.prototype.pause.call(media);
      }
    };
    state.onPlay = event => state.pause(event.target);
    state.scan = root => {
      if (root instanceof HTMLMediaElement) state.pause(root);
      root.querySelectorAll?.('audio,video').forEach(state.pause);
      for (const element of [root, ...(root.querySelectorAll?.('*') || [])]) {
        if (element.shadowRoot) state.watch(element.shadowRoot);
      }
    };
    state.watch = root => {
      if (state.roots.has(root)) return;
      const observer = new MutationObserver(records => {
        if (state.paused) for (const record of records) for (const node of record.addedNodes) state.scan(node);
      });
      state.roots.set(root, observer);
      root.addEventListener('play', state.onPlay, true);
      observer.observe(root, {childList: true, subtree: true});
      state.scan(root);
    };
  }
  // Rapid hide/restore operations can finish out of order across renderer processes.
  if (revision < state.revision) return;
  state.revision = revision;
  state.paused = paused;
  if (paused) {
    state.watch(document);
    state.scan(document);
  } else {
    for (const [root, observer] of state.roots) {
      observer.disconnect();
      root.removeEventListener('play', state.onPlay, true);
    }
    state.roots.clear();
    const playing = [...state.playing];
    state.playing.clear();
    for (const media of playing) {
      if (media.isConnected && media.paused && !media.ended) {
        try { HTMLMediaElement.prototype.play.call(media).catch(() => {}); } catch {}
      }
    }
  }
}

class MediaController {
  constructor(contents, shouldPause) {
    this.contents = contents;
    this.shouldPause = shouldPause;
    this.paused = false;
    this.previousMute = null;
    this.revision = 0;
    this.disposed = false;
    this.onMediaChange = () => { void this.sync(); };
    this.events = ['dom-ready', 'did-frame-finish-load', 'media-started-playing'];
    for (const event of this.events) contents.on(event, this.onMediaChange);
    contents.once('destroyed', () => this.dispose());
  }

  async sync() {
    const contents = this.contents;
    if (this.disposed || contents.isDestroyed()) return;
    const paused = this.shouldPause();
    const revision = ++this.revision;
    if (paused) {
      if (!this.paused) this.previousMute = contents.isAudioMuted();
      // Native muting covers every frame and Web Audio even if page JS stalls,
      // a player refuses to pause, or a hidden page starts another stream.
      contents.setAudioMuted(true);
    } else if (this.paused && this.previousMute !== null) {
      contents.setAudioMuted(this.previousMute);
      this.previousMute = null;
    }
    this.paused = paused;
    let frames;
    try { frames = contents.mainFrame.framesInSubtree; } catch { return; }
    const script = `(${controlFrameMedia.toString()})(${paused}, ${revision})`;
    await Promise.allSettled(frames.map(async frame => {
      try {
        if (!frame.isDestroyed() && !frame.detached) await frame.executeJavaScript(script, !paused);
      } catch { /* A frame can navigate or disappear while the command is in flight. */ }
    }));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const event of this.events) this.contents.removeListener(event, this.onMediaChange);
  }
}

module.exports = {MediaController};
