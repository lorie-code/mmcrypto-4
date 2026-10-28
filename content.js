(() => {
  'use strict';

  const ready = (callback) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  };

  ready(() => {
    const library = document.getElementById('content-library');
    const dialog = document.getElementById('content-dialog');
    if (!library || !dialog) return;

    const filters = [...library.querySelectorAll('[data-content-filter]')];
    const cards = [...library.querySelectorAll('[data-content-card]')];
    const results = document.getElementById('library-results');
    const empty = document.getElementById('library-empty');
    const feedback = document.getElementById('library-feedback');
    const title = document.getElementById('content-title');
    const lede = document.getElementById('content-lede');
    const access = document.getElementById('content-access');
    const notes = {
      context: {
        title: 'Read a market view with context',
        lede: "A market commentary is one person's interpretation of incomplete information. Reading it carefully means understanding the argument, checking its evidence, and noticing what remains uncertain.",
        member: false,
        element: document.getElementById('content-note-context')
      },
      checklist: {
        title: 'A calm pre-trade checklist',
        lede: 'A checklist creates space between an idea and an action. It cannot remove uncertainty or prevent losses, but it can help reveal missing information, practical constraints, and emotional pressure.',
        member: true,
        element: document.getElementById('content-note-checklist')
      }
    };
    let activeFilter = 'all';
    let activeNote = null;
    let noteTrigger = null;
    let suppressFocusReturn = false;
    let requestVersion = 0;

    const signedIn = () => Boolean(window.MM_MEMBERS?.isSignedIn?.());
    const matches = (card, filter) => filter === 'all' || (card.dataset.contentTags || '').split(/\s+/).includes(filter);
    const say = (message) => {
      if (!feedback) return;
      feedback.textContent = message;
      feedback.hidden = !message;
    };

    const renderLibrary = () => {
      const matching = cards.filter((card) => matches(card, activeFilter));
      const memberCount = matching.filter((card) => matches(card, 'members')).length;
      filters.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.contentFilter === activeFilter)));
      cards.forEach((card) => { card.hidden = !matching.includes(card); });
      if (results) results.textContent = `Showing ${matching.length} ${matching.length === 1 ? 'reading item' : 'reading items'}${!signedIn() && memberCount ? ` · ${memberCount} member ${memberCount === 1 ? 'note requires' : 'notes require'} preview login.` : '.'}`;
      if (empty) empty.hidden = matching.length > 0;
    };

    const applyFilter = (filter) => {
      if (!filters.some((button) => button.dataset.contentFilter === filter)) filter = 'all';
      activeFilter = filter;
      renderLibrary();
      say('');
    };

    filters.forEach((button) => {
      const count = cards.filter((card) => matches(card, button.dataset.contentFilter)).length;
      const counter = button.querySelector('[data-content-count]');
      if (counter) counter.textContent = String(count);
      button.addEventListener('click', () => applyFilter(button.dataset.contentFilter));
    });
    library.querySelector('[data-content-reset]')?.addEventListener('click', () => {
      applyFilter('all');
      filters.find((button) => button.dataset.contentFilter === 'all')?.focus({ preventScroll: true });
    });

    // The configured channel is the source of truth. No cached video title is
    // presented as a current upload, and the feed is opened on YouTube itself.
    document.querySelectorAll('[data-content-channel]').forEach((link) => {
      const destination = window.MM_CONFIG?.links?.youtube;
      if (typeof destination !== 'string') return;
      try {
        const url = new URL(destination);
        if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) return;
        const path = url.pathname.replace(/\/+$/, '').replace(/\/(featured|videos|shorts|streams)$/, '');
        if (!/^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)$/.test(path)) return;
        url.pathname = `${path}/videos`;
        url.search = '';
        url.hash = '';
        link.href = url.href;
      } catch { /* The static official-channel link remains usable. */ }
    });

    const closeMenu = () => {
      document.body.classList.remove('nav-open');
      const toggle = document.getElementById('menu-toggle');
      toggle?.setAttribute('aria-expanded', 'false');
      toggle?.setAttribute('aria-label', 'Open navigation');
    };

    const closeNote = (returnFocus = true) => {
      if (!dialog.open) return;
      suppressFocusReturn = !returnFocus;
      dialog.close();
    };

    const openNote = (key, trigger, version) => {
      const note = notes[key];
      if (!note?.element || version !== requestVersion || (note.member && !signedIn())) return;
      // Auth normally invokes us after closing. This guard also supports a
      // provider that resolves immediately before its own dialog close event.
      const blockingDialog = [...document.querySelectorAll('dialog[open]')].find((item) => item !== dialog);
      if (blockingDialog) {
        blockingDialog.addEventListener('close', () => openNote(key, trigger, version), { once: true });
        return;
      }
      if (typeof dialog.showModal !== 'function') {
        say('This reading view needs a browser with dialog support. Please try a current browser.');
        return;
      }
      closeMenu();
      say('');
      activeNote = key;
      noteTrigger = trigger;
      if (title) title.textContent = note.title;
      if (lede) lede.textContent = note.lede;
      if (access) access.textContent = note.member ? 'WEBSITE EDITORIAL / MEMBER NOTE · PREVIEW' : 'WEBSITE EDITORIAL / PUBLIC NOTE';
      Object.values(notes).forEach((item) => { if (item.element) item.element.hidden = item !== note; });
      dialog.querySelectorAll('[data-content-next]').forEach((button) => { button.hidden = note.member; });
      try {
        if (!dialog.open) dialog.showModal();
        document.body.classList.add('content-dialog-open');
        dialog.scrollTop = 0;
        title?.focus({ preventScroll: true });
      } catch {
        activeNote = null;
        say('The learning note could not open. Close any other dialog and try again.');
      }
    };

    const requestNote = (key, trigger) => {
      const note = notes[key];
      if (!note) return;
      const version = ++requestVersion;
      const returnTarget = dialog.contains(trigger) ? noteTrigger : trigger;
      if (note.member && !signedIn()) {
        if (typeof window.MM_MEMBERS?.requireSignIn !== 'function') {
          say('Member login is currently unavailable. Please reload the preview and try again.');
          return;
        }
        closeNote(false);
        closeMenu();
        window.MM_MEMBERS.requireSignIn(() => openNote(key, returnTarget, version));
        return;
      }
      openNote(key, returnTarget, version);
    };

    document.querySelectorAll('[data-content-open]').forEach((button) => {
      button.addEventListener('click', () => requestNote(button.dataset.contentOpen, button));
    });
    dialog.querySelectorAll('[data-content-close]').forEach((button) => button.addEventListener('click', () => closeNote()));
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeNote();
    });
    dialog.addEventListener('close', () => {
      document.body.classList.remove('content-dialog-open');
      Object.values(notes).forEach((note) => { if (note.element) note.element.hidden = true; });
      activeNote = null;
      const target = noteTrigger;
      noteTrigger = null;
      if (!suppressFocusReturn && !document.querySelector('dialog[open]')) {
        if (target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true });
        else filters.find((button) => button.dataset.contentFilter === activeFilter)?.focus({ preventScroll: true });
      }
      suppressFocusReturn = false;
    });

    const updateMembership = () => {
      const member = signedIn();
      document.querySelectorAll('[data-content-member-action]').forEach((label) => {
        label.textContent = member ? label.dataset.memberLabel : label.dataset.guestLabel;
      });
      if (!member && notes[activeNote]?.member) {
        ++requestVersion;
        closeNote(false);
      }
      // Preserve the selected article category when preview membership changes.
      renderLibrary();
    };
    document.addEventListener('mmcrypto:member-change', updateMembership);
    updateMembership();
  });
})();
