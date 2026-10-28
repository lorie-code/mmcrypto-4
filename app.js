(() => {
  'use strict';

  const ready = (callback) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  };

  ready(() => {
    const body = document.body;

    // Keeping destinations in config.js makes future campaign updates small.
    document.querySelectorAll('a[data-link]').forEach((link) => {
      const destination = window.MM_CONFIG?.links?.[link.dataset.link];
      if (typeof destination !== 'string' || !destination.trim()) return;
      try {
        const url = new URL(destination);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
        link.href = url.href;
        if (link.target === '_blank') link.rel = 'noopener noreferrer';
      } catch {
        // A missing or invalid destination leaves the useful HTML fallback intact.
      }
    });

    const menuToggle = document.getElementById('menu-toggle');
    const navigation = document.getElementById('site-nav');
    const closeMenu = () => {
      body.classList.remove('nav-open');
      menuToggle?.setAttribute('aria-expanded', 'false');
      menuToggle?.setAttribute('aria-label', 'Open navigation');
    };

    if (menuToggle && navigation) {
      menuToggle.addEventListener('click', () => {
        const open = !body.classList.contains('nav-open');
        body.classList.toggle('nav-open', open);
        menuToggle.setAttribute('aria-expanded', String(open));
        menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      });
      document.addEventListener('click', (event) => {
        if (!body.classList.contains('nav-open')) return;
        const target = event.target;
        if (target.closest('a') || (!navigation.contains(target) && !menuToggle.contains(target))) {
          closeMenu();
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && body.classList.contains('nav-open')) {
          closeMenu();
          menuToggle.focus({ preventScroll: true });
        }
      });
      const desktop = window.matchMedia('(min-width: 900px)');
      const onDesktop = () => {
        if (desktop.matches) closeMenu();
      };
      if (desktop.addEventListener) desktop.addEventListener('change', onDesktop);
      else desktop.addListener(onDesktop);
      onDesktop();
    }

    const setupTabs = (buttonSelector, panelSelector) => {
      const tabs = [...document.querySelectorAll(buttonSelector)];
      const panels = [...document.querySelectorAll(panelSelector)];
      if (!tabs.length || !panels.length) return;

      const activate = (tab, moveFocus = false) => {
        const panelId = tab.getAttribute('aria-controls');
        if (!panels.some((panel) => panel.id === panelId)) return;
        tabs.forEach((item) => {
          const selected = item === tab;
          item.setAttribute('aria-selected', String(selected));
          item.tabIndex = selected ? 0 : -1;
          item.classList.toggle('is-active', selected);
        });
        panels.forEach((panel) => {
          const selected = panel.id === panelId;
          panel.hidden = !selected;
          panel.classList.toggle('is-active', selected);
        });
        if (moveFocus) tab.focus({ preventScroll: true });
      };

      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activate(tab));
        tab.addEventListener('keydown', (event) => {
          let next = index;
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else return;
          event.preventDefault();
          activate(tabs[next], true);
        });
      });
      activate(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0]);
    };

    const setupJourney = () => {
      const story = document.querySelector('#story.story-journey');
      const windowEl = story?.querySelector('#journey-window');
      if (!story || !windowEl) return;
      const chapters = [...story.querySelectorAll('[data-journey-chapter]')];
      const tabs = [...story.querySelectorAll('[data-journey-link]')];
      const current = story.querySelector('#journey-current');
      const progress = story.querySelector('#journey-progress');
      const previous = story.querySelector('#journey-prev');
      const next = story.querySelector('#journey-next');
      if (!chapters.length || tabs.length !== chapters.length) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      let active = 0;
      let target = null;
      let lastWidth = 0;
      let frame = null;
      let settleTimer = null;
      const clamp = (index) => Math.max(0, Math.min(chapters.length - 1, index));
      const animate = () => !reduced.matches && !body.classList.contains('motion-paused');

      const render = (index) => {
        active = clamp(index);
        chapters.forEach((chapter, i) => {
          const selected = i === active;
          // Inactive slides retain their snap positions but leave the focus order.
          if (!selected && chapter.contains(document.activeElement)) windowEl.focus({ preventScroll: true });
          chapter.classList.toggle('is-active', selected);
          chapter.inert = !selected;
          chapter.setAttribute('aria-hidden', String(!selected));
          tabs[i].setAttribute('aria-selected', String(selected));
          tabs[i].tabIndex = selected ? 0 : -1;
        });
        current.textContent = String(active + 1).padStart(2, '0');
        progress.style.transform = `scaleX(${(active + 1) / chapters.length})`;
        previous.setAttribute('aria-disabled', String(active === 0));
        next.setAttribute('aria-disabled', String(active === chapters.length - 1));
      };
      const sync = () => {
        frame = null;
        const width = windowEl.clientWidth;
        if (!width) return;
        const index = clamp(Math.round(windowEl.scrollLeft / width));
        if (target !== null && Math.abs(windowEl.scrollLeft - target * width) > 2) return;
        target = null;
        if (index !== active) render(index);
      };
      const finish = () => {
        clearTimeout(settleTimer);
        target = null;
        sync();
      };
      const show = (index, smooth = true) => {
        const destination = clamp(index);
        const width = windowEl.clientWidth;
        const adjacent = Math.abs(destination - active) === 1;
        render(destination);
        if (!width) return;
        target = destination;
        windowEl.scrollTo({ left: destination * width, behavior: smooth && adjacent && animate() ? 'smooth' : 'auto' });
        clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, 200);
      };
      const realign = () => {
        const width = windowEl.clientWidth;
        if (!width) { lastWidth = 0; return; }
        if (width !== lastWidth) {
          lastWidth = width;
          show(active, false);
        }
      };
      const fromHash = () => {
        const index = chapters.findIndex((chapter) => `#${chapter.id}` === location.hash);
        if (index !== -1) show(index, false);
      };

      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => show(index));
        tab.addEventListener('keydown', (event) => {
          let destination = index;
          if (event.key === 'ArrowRight') destination = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') destination = (index - 1 + tabs.length) % tabs.length;
          else if (event.key === 'Home') destination = 0;
          else if (event.key === 'End') destination = tabs.length - 1;
          else return;
          event.preventDefault();
          tabs[destination].focus({ preventScroll: true });
          show(destination);
        });
      });
      previous.addEventListener('click', () => { if (active > 0) show(active - 1); });
      next.addEventListener('click', () => { if (active < chapters.length - 1) show(active + 1); });
      windowEl.addEventListener('keydown', (event) => {
        if (event.target.closest('a,button,input,select,textarea')) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          show(active + (event.key === 'ArrowRight' ? 1 : -1));
        }
      });
      // Native horizontal touch / trackpad scrolling; vertical page scrolling is untouched.
      windowEl.addEventListener('pointerdown', () => { target = null; }, { passive: true });
      windowEl.addEventListener('wheel', () => { target = null; }, { passive: true });
      windowEl.addEventListener('scroll', () => {
        if (frame === null) frame = requestAnimationFrame(sync);
        clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, 160);
      }, { passive: true });
      windowEl.addEventListener('scrollend', finish);
      window.addEventListener('hashchange', fromHash);
      window.addEventListener('pageshow', () => { realign(); fromHash(); });
      window.addEventListener('resize', realign, { passive: true });
      if ('ResizeObserver' in window) new ResizeObserver(realign).observe(windowEl);
      // Pause an in-flight scroll immediately if motion is disabled.
      const onMotionChange = () => { if (!animate()) show(active, false); };
      new MutationObserver(onMotionChange).observe(body, { attributes: true, attributeFilter: ['class'] });
      reduced.addEventListener?.('change', onMotionChange);
      render(0);
      realign();
      fromHash();
    };

    setupJourney();
    setupTabs('[data-weex-tab]', '.weex-panel');

    const videoDialog = document.getElementById('video-dialog');
    const videoFrame = document.getElementById('video-frame');
    const videoTitle = document.getElementById('video-title');
    const videoExternal = document.getElementById('video-external');
    let videoTrigger = null;

    if (videoDialog && videoFrame && typeof videoDialog.showModal === 'function') {
      const videoLinks = [...document.querySelectorAll('a[data-video]')];
      videoFrame.innerHTML = `
        <img class="mm-player-poster" alt="" hidden>
        <div class="mm-player-mount"></div>
        <div class="mm-player-overlay">
          <span class="mm-player-spinner" aria-hidden="true"></span>
          <strong class="mm-player-message">Connecting to YouTube…</strong>
          <p class="mm-player-help">The original video is always available below.</p>
          <div class="mm-player-recovery" hidden>
            <a class="button button-orange mm-player-external" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a>
            <button type="button" class="mm-player-retry">Try again</button>
          </div>
        </div>`;
      const mount = videoFrame.querySelector('.mm-player-mount');
      const poster = videoFrame.querySelector('.mm-player-poster');
      const message = videoFrame.querySelector('.mm-player-message');
      const help = videoFrame.querySelector('.mm-player-help');
      const recovery = videoFrame.querySelector('.mm-player-recovery');
      const recoveryExternal = videoFrame.querySelector('.mm-player-external');
      const retryButton = videoFrame.querySelector('.mm-player-retry');
      const closeButton = videoDialog.querySelector('[data-close-video]');
      const status = videoDialog.querySelector('.video-modal-bottom p');
      status?.setAttribute('role', 'status');
      status?.setAttribute('aria-live', 'polite');
      let player = null;
      let requestToken = 0;
      let loadTimer = 0;
      let apiPromise = null;
      let cancelAPILoad = null;

      const setStatus = (text) => { if (status) status.textContent = text; };
      const isCurrent = (token) => token === requestToken && videoDialog.open;

      // No YouTube script or embed is requested until a visitor clicks a video.
      const loadAPI = () => {
        if (window.YT?.Player) return Promise.resolve(window.YT);
        if (apiPromise) return apiPromise;
        const loading = new Promise((resolve, reject) => {
          const previousReady = window.onYouTubeIframeAPIReady;
          const script = document.createElement('script');
          let settled = false;
          let apiTimer = 0;
          const finish = (error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(apiTimer);
            script.removeEventListener('error', onError);
            if (window.onYouTubeIframeAPIReady === onAPIReady) {
              if (previousReady) window.onYouTubeIframeAPIReady = previousReady;
              else delete window.onYouTubeIframeAPIReady;
            }
            if (cancelAPILoad === cancel) cancelAPILoad = null;
            if (error) {
              script.remove();
              reject(error);
            } else resolve(window.YT);
          };
          const onError = () => finish(new Error('api-unavailable'));
          const onAPIReady = () => {
            if (typeof previousReady === 'function') {
              try { previousReady(); } catch { /* Other widgets remain independent. */ }
            }
            if (window.YT?.Player) finish();
            else finish(new Error('api-unavailable'));
          };
          const cancel = () => finish(new Error('api-cancelled'));
          cancelAPILoad = cancel;
          window.onYouTubeIframeAPIReady = onAPIReady;
          script.src = 'https://www.youtube.com/iframe_api';
          script.async = true;
          script.referrerPolicy = 'strict-origin-when-cross-origin';
          script.addEventListener('error', onError, { once: true });
          apiTimer = window.setTimeout(() => finish(new Error('api-timeout')), 14000);
          document.head.append(script);
        });
        const pending = loading.then((YT) => {
          if (apiPromise === pending) apiPromise = null;
          return YT;
        }, (error) => {
          if (apiPromise === pending) apiPromise = null;
          throw error;
        });
        apiPromise = pending;
        return pending;
      };

      const clearPlayer = () => {
        window.clearTimeout(loadTimer);
        loadTimer = 0;
        if (cancelAPILoad) {
          const cancel = cancelAPILoad;
          cancelAPILoad = null;
          apiPromise = null;
          cancel();
        }
        try { player?.destroy(); } catch { /* Removal still stops an unavailable frame. */ }
        player = null;
        mount.replaceChildren();
      };

      const unavailable = (token, code = 'load-timeout') => {
        if (!isCurrent(token)) return;
        ++requestToken;
        clearPlayer();
        videoFrame.dataset.state = 'unavailable';
        videoFrame.dataset.errorCode = String(code);
        videoFrame.setAttribute('aria-busy', 'false');
        message.textContent = 'This video couldn’t play here.';
        help.textContent = 'Open the original on YouTube, or try the player again.';
        recovery.hidden = false;
        setStatus('The in-page player is unavailable. You can still watch on YouTube.');
      };

      const startVideo = (link) => {
        const videoId = link.dataset.video;
        if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || '')) return false;
        const title = link.dataset.videoTitle || 'Watch MMCrypto';
        const watchURL = `https://www.youtube.com/watch?v=${videoId}`;
        try {
          if (!videoDialog.open) videoDialog.showModal();
        } catch {
          return false;
        }
        const token = ++requestToken;
        clearPlayer();
        videoTrigger = link;
        body.classList.add('video-open');
        if (videoTitle) videoTitle.textContent = title;
        if (videoExternal) videoExternal.href = watchURL;
        recoveryExternal.href = watchURL;
        const thumbnail = link.querySelector('img') || link.closest('article')?.querySelector('img') ||
          videoLinks.find((item) => item.dataset.video === videoId && item.querySelector('img'))?.querySelector('img');
        if (thumbnail) poster.src = thumbnail.currentSrc || thumbnail.src;
        else poster.removeAttribute('src');
        poster.hidden = !thumbnail;
        videoFrame.dataset.state = 'loading';
        delete videoFrame.dataset.errorCode;
        videoFrame.setAttribute('aria-busy', 'true');
        message.textContent = 'Connecting to YouTube…';
        help.textContent = 'The original video is always available below.';
        recovery.hidden = true;
        setStatus('Loading the video player…');
        closeButton?.focus({ preventScroll: true });

        const iframe = document.createElement('iframe');
        iframe.id = `mm-youtube-${token}`;
        iframe.title = title;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        const embedURL = new URL(`https://www.youtube.com/embed/${videoId}`);
        embedURL.searchParams.set('autoplay', '1');
        embedURL.searchParams.set('rel', '0');
        embedURL.searchParams.set('playsinline', '1');
        embedURL.searchParams.set('enablejsapi', '1');
        if (/^https?:$/.test(location.protocol)) {
          embedURL.searchParams.set('origin', location.origin);
          embedURL.searchParams.set('widget_referrer', location.href);
        }
        iframe.src = embedURL.href;
        iframe.addEventListener('error', () => unavailable(token, 'embed-unavailable'), { once: true });
        mount.append(iframe);
        loadTimer = window.setTimeout(() => unavailable(token), 14000);

        loadAPI().then((YT) => {
          if (!isCurrent(token)) return;
          try {
            player = new YT.Player(iframe, {
              events: {
                onReady(event) {
                  if (!isCurrent(token)) return;
                  window.clearTimeout(loadTimer);
                  videoFrame.dataset.state = 'ready';
                  videoFrame.setAttribute('aria-busy', 'false');
                  setStatus('Player ready. Press play if the video doesn’t start.');
                  try { event.target.playVideo(); } catch { /* Native controls remain available. */ }
                },
                onStateChange(event) {
                  if (!isCurrent(token)) return;
                  if (event.data === YT.PlayerState.PLAYING) {
                    window.clearTimeout(loadTimer);
                    videoFrame.dataset.state = 'playing';
                    videoFrame.setAttribute('aria-busy', 'false');
                    setStatus('Now playing · MMCrypto');
                  } else if (event.data === YT.PlayerState.PAUSED) {
                    setStatus('Paused. Resume in the player.');
                  } else if (event.data === YT.PlayerState.BUFFERING) {
                    setStatus('Buffering the video…');
                  } else if (event.data === YT.PlayerState.ENDED) {
                    setStatus('Video finished. Explore another conversation.');
                  }
                },
                onAutoplayBlocked() {
                  if (!isCurrent(token)) return;
                  window.clearTimeout(loadTimer);
                  videoFrame.dataset.state = 'ready';
                  videoFrame.setAttribute('aria-busy', 'false');
                  setStatus('Press play in the player to start the video.');
                },
                onError(event) { unavailable(token, event.data); }
              }
            });
          } catch {
            unavailable(token, 'player-unavailable');
          }
        }).catch((error) => unavailable(token, error.message));
        return true;
      };

      const closeVideo = () => {
        if (videoDialog.open) videoDialog.close();
      };
      videoDialog.querySelectorAll('[data-close-video]').forEach((button) => {
        button.addEventListener('click', closeVideo);
      });
      videoDialog.addEventListener('click', (event) => {
        if (event.target !== videoDialog) return;
        const bounds = videoDialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) closeVideo();
      });
      videoDialog.addEventListener('close', () => {
        ++requestToken;
        clearPlayer();
        videoFrame.dataset.state = 'idle';
        videoFrame.setAttribute('aria-busy', 'false');
        poster.removeAttribute('src');
        poster.hidden = true;
        body.classList.remove('video-open');
        if (videoTrigger?.isConnected) videoTrigger.focus({ preventScroll: true });
        videoTrigger = null;
      });
      videoExternal?.addEventListener('click', closeVideo);
      recoveryExternal.addEventListener('click', closeVideo);
      retryButton.addEventListener('click', () => {
        if (videoTrigger) startVideo(videoTrigger);
      });
      videoLinks.forEach((link) => {
        // File previews retain a normal, usable YouTube link without an embed.
        if (location.protocol === 'file:') return;
        link.setAttribute('aria-haspopup', 'dialog');
        link.setAttribute('aria-controls', videoDialog.id);
        link.addEventListener('click', (event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (startVideo(link)) event.preventDefault();
        });
      });
    }

    const motionToggle = document.getElementById('motion-toggle');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionStorageKey = 'mmcrypto-motion';
    const reveals = [...document.querySelectorAll('.reveal')];
    let motionPreference = null;
    let revealObserver = null;

    try {
      const stored = localStorage.getItem(motionStorageKey);
      if (stored === 'paused' || stored === 'running') motionPreference = stored;
    } catch {
      // Private browsing and file previews can disallow local storage.
    }

    const motionIsPaused = () => reducedMotion.matches || motionPreference === 'paused';

    const updateMotion = () => {
      const paused = motionIsPaused();
      const label = reducedMotion.matches ? 'Reduced motion enabled' : paused ? 'Resume motion' : 'Pause motion';
      body.classList.toggle('motion-paused', paused);
      motionToggle?.setAttribute('aria-pressed', String(paused));
      motionToggle?.setAttribute('aria-label', label);
      if (motionToggle) motionToggle.disabled = reducedMotion.matches;
      const motionLabel = motionToggle?.querySelector('[data-motion-label]');
      if (motionLabel) motionLabel.textContent = label;
      const motionIcon = motionToggle?.querySelector('[aria-hidden="true"]');
      if (motionIcon) motionIcon.textContent = paused ? '▶' : 'Ⅱ';

      if (paused || !('IntersectionObserver' in window)) {
        revealObserver?.disconnect();
        body.classList.remove('motion-ready');
        reveals.forEach((element) => element.classList.add('is-visible'));
        return;
      }

      if (!revealObserver) {
        revealObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
          });
        }, { threshold: 0.06, rootMargin: '0px 0px -20px 0px' });
      }

      reveals.forEach((element) => {
        const bounds = element.getBoundingClientRect();
        if (bounds.top < window.innerHeight && bounds.bottom > 0) {
          element.classList.add('is-visible');
        }
        if (!element.classList.contains('is-visible')) revealObserver.observe(element);
      });
      body.classList.add('motion-ready');
    };

    motionToggle?.addEventListener('click', () => {
      // Device-level reduced motion is always respected; otherwise save the
      // visitor's pause preference across page visits.
      motionPreference = motionIsPaused() ? 'running' : 'paused';
      try { localStorage.setItem(motionStorageKey, motionPreference); } catch { /* Optional preference. */ }
      updateMotion();
    });
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', updateMotion);
    else reducedMotion.addListener(updateMotion);
    updateMotion();

    const hero = document.getElementById('home');
    if (hero && 'IntersectionObserver' in window) {
      const heroObserver = new IntersectionObserver(([entry]) => {
        body.classList.toggle('past-hero', !entry.isIntersecting && entry.boundingClientRect.top < 0);
      }, { threshold: 0 });
      heroObserver.observe(hero);
    }

    const progress = document.getElementById('reading-progress');
    let scrollFrame = null;
    const updateScroll = () => {
      scrollFrame = null;
      if (progress) {
        const available = document.documentElement.scrollHeight - window.innerHeight;
        const fraction = available > 0 ? Math.max(0, Math.min(1, window.scrollY / available)) : 0;
        progress.style.transform = `scaleX(${fraction})`;
      }
      if (hero && !('IntersectionObserver' in window)) {
        body.classList.toggle('past-hero', hero.getBoundingClientRect().bottom <= 0);
      }
    };
    const scheduleScroll = () => {
      if (scrollFrame === null) scrollFrame = requestAnimationFrame(updateScroll);
    };
    window.addEventListener('scroll', scheduleScroll, { passive: true });
    window.addEventListener('resize', scheduleScroll, { passive: true });
    window.addEventListener('load', scheduleScroll, { once: true });
    if ('ResizeObserver' in window) new ResizeObserver(scheduleScroll).observe(body);
    updateScroll();
  });
})();
