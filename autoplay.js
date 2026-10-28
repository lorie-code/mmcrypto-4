/* Inline, muted YouTube previews for the video library. Full controls remain in the click-to-open dialog. */
(() => {
  'use strict';

  const ready = (callback) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  };

  ready(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const videoLinks = [...document.querySelectorAll('.video-library-grid .research-thumb[data-video]')];
    if (!videoLinks.length || reduced.matches) return;

    // Share one IFrame API request with the click-to-play dialog when it is used later.
    const loadAPI = () => {
      if (window.YT?.Player) return Promise.resolve(window.YT);
      if (window.__mmYouTubeAPI) return window.__mmYouTubeAPI;
      const pending = new Promise((resolve, reject) => {
        const previous = window.onYouTubeIframeAPIReady;
        const script = document.createElement('script');
        let timer = 0;
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          script.removeEventListener('error', fail);
          if (window.onYouTubeIframeAPIReady === onReady) {
            if (previous) window.onYouTubeIframeAPIReady = previous;
            else delete window.onYouTubeIframeAPIReady;
          }
          if (error) reject(error);
          else resolve(window.YT);
        };
        const fail = () => finish(new Error('youtube-api-unavailable'));
        const onReady = () => {
          try { previous?.(); } catch { /* The other player owns its own recovery UI. */ }
          window.YT?.Player ? finish() : fail();
        };
        window.onYouTubeIframeAPIReady = onReady;
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.referrerPolicy = 'strict-origin-when-cross-origin';
        script.addEventListener('error', fail, { once: true });
        timer = window.setTimeout(fail, 14000);
        document.head.append(script);
      });
      window.__mmYouTubeAPI = pending.catch((error) => {
        window.__mmYouTubeAPI = null;
        throw error;
      });
      return window.__mmYouTubeAPI;
    };

    const players = new Map();
    const motionIsPaused = () => reduced.matches || document.body.classList.contains('motion-paused') || document.hidden;
    const pause = (entry) => {
      try { entry?.player?.pauseVideo(); } catch { /* The iframe may have just been removed. */ }
      if (entry?.link) entry.link.dataset.inlinePlaying = 'false';
    };
    const play = (entry) => {
      if (!entry?.player || motionIsPaused()) return;
      try { entry.player.mute(); entry.player.playVideo(); } catch { /* Native iframe remains a usable poster fallback. */ }
    };
    const remove = (entry) => {
      if (!entry) return;
      pause(entry);
      try { entry.player?.destroy(); } catch { /* Destruction is best effort on pagehide. */ }
      entry.frame?.remove();
      delete entry.link.dataset.inlinePlaying;
      players.delete(entry.link);
    };
    const create = (link) => {
      if (players.has(link) || motionIsPaused()) return;
      const videoId = link.dataset.video;
      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || '')) return;
      const frame = document.createElement('iframe');
      frame.className = 'mm-inline-player';
      frame.title = `${link.dataset.videoTitle || 'MMCrypto video'} · muted preview`;
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.loading = 'lazy';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      const source = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
      source.searchParams.set('autoplay', '1');
      source.searchParams.set('mute', '1');
      source.searchParams.set('controls', '0');
      source.searchParams.set('loop', '1');
      source.searchParams.set('playlist', videoId);
      source.searchParams.set('playsinline', '1');
      source.searchParams.set('rel', '0');
      source.searchParams.set('modestbranding', '1');
      source.searchParams.set('iv_load_policy', '3');
      source.searchParams.set('disablekb', '1');
      source.searchParams.set('fs', '0');
      source.searchParams.set('enablejsapi', '1');
      if (/^https?:$/.test(location.protocol)) source.searchParams.set('origin', location.origin);
      frame.src = source.href;
      const entry = { link, frame, player: null, visible: false, playing: false, fallbackTimer: 0 };
      players.set(link, entry);
      link.append(frame);
      // Keep the poster visible unless YouTube confirms that muted playback started.
      entry.fallbackTimer = window.setTimeout(() => {
        if (!entry.playing) frame.classList.remove('is-ready');
      }, 9000);
      loadAPI().then((YT) => {
        if (!players.has(link)) return;
        try {
          entry.player = new YT.Player(frame, {
            events: {
              onReady(event) {
                if (entry.visible && !motionIsPaused()) {
                  try { event.target.mute(); event.target.playVideo(); } catch { /* Keep the poster fallback. */ }
                }
              },
              onStateChange(event) {
                if (event.data === YT.PlayerState.PLAYING) {
                  entry.playing = true;
                  window.clearTimeout(entry.fallbackTimer);
                  frame.classList.add('is-ready');
                  link.dataset.inlinePlaying = 'true';
                } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
                  entry.playing = false;
                  link.dataset.inlinePlaying = 'false';
                }
              },
              onError() {
                // Bot checks, region limits and unavailable embeds leave the original card thumbnail.
                frame.classList.remove('is-ready');
              }
            }
          });
        } catch {
          frame.classList.remove('is-ready');
        }
      }).catch(() => frame.classList.remove('is-ready'));
    };
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      entries.forEach((item) => {
        const link = item.target;
        if (item.isIntersecting && item.intersectionRatio >= .2) {
          let entry = players.get(link);
          if (!entry) { create(link); entry = players.get(link); }
          if (entry) { entry.visible = true; play(entry); }
        } else {
          const entry = players.get(link);
          if (entry) { entry.visible = false; pause(entry); }
        }
      });
    }, { rootMargin: '160px 0px', threshold: [.2, .5] }) : null;

    videoLinks.forEach((link) => {
      link.dataset.inlinePreview = 'true';
      if (observer) observer.observe(link);
      else create(link);
    });

    const syncMotion = () => {
      if (motionIsPaused()) players.forEach(pause);
      else players.forEach((entry) => { if (entry.visible) play(entry); });
    };
    reduced.addEventListener?.('change', syncMotion);
    document.addEventListener('visibilitychange', syncMotion);
    new MutationObserver(syncMotion).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('pagehide', () => players.forEach(remove), { once: true });
  });
})();
