(() => {
  'use strict';

  const ready = (callback) => document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', callback, { once: true }) : callback();

  ready(() => {
    const byId = (id) => document.getElementById(id);
    const hub = byId('member-hub');
    const publicContent = byId('public-content');
    const authDialog = byId('auth-dialog');
    const infoDialog = byId('member-info-dialog');
    const linkDialog = byId('link-dialog');
    if (!hub || !publicContent || !authDialog || !infoDialog || !linkDialog) return;

    const STORAGE_KEY = 'mmcrypto.members.preview.v1';
    const SAMPLE_EMAIL = 'exchange.demo@example.com';
    const SAMPLE_UID = '10000001';
    const DEMO_RESULTS = Object.freeze({ '10000001': 'matched', '10000002': 'invitation_mismatch', '10000003': 'not_found', '10000004': 'unavailable' });
    const MAX_ATTEMPTS = 5;
    const dialogs = [authDialog, infoDialog, linkDialog];
    const returnFocus = new WeakMap();
    const closeQueue = new WeakMap();
    const emailInput = byId('auth-email');
    const codeInput = byId('auth-code');
    const consentInput = byId('auth-consent');
    const errorNode = byId('auth-error');
    let mode = 'signin';
    let challenge = null;
    let timer = null;
    let pendingCompletion = null;
    let infoReturn = null;
    let infoAction = null;
    let storageAvailable = true;
    let lastPublicHash = location.hash && location.hash !== '#member-hub' ? location.hash : '#home';
    let routeAuth = false;
    let linkExchangeId = 'weex';
    let linkStep = 'registration';
    let registrationConfirmed = false;
    let verificationRequest = 0;
    let verificationBusy = false;
    let state = { version: 1, accounts: [], currentEmail: null, association: null };

    const previewMode = () => window.MM_CONFIG?.membership?.mode === 'preview';
    const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
    const validEmail = (value) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    const signedIn = () => previewMode() && Boolean(state.currentEmail && state.accounts.includes(state.currentEmail));
    const safeUrl = (value, fallback = null) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : fallback;
      } catch { return fallback; }
    };
    const exchangePreviewMode = () => window.MM_CONFIG?.exchangeVerification?.mode === undefined
      || window.MM_CONFIG.exchangeVerification.mode === 'preview';
    const exchangeProvider = () => window.MM_EXCHANGE_PROVIDER;
    const defaultExchanges = [
      { id: 'weex', name: 'WEEX', relationship: 'partner', homeUrl: 'https://www.weex.com/', description: 'An optional next step for MMCrypto members. Register on WEEX, then return to connect your account.' },
    ];
    const configuredExchanges = Array.isArray(window.MM_CONFIG?.exchanges) ? window.MM_CONFIG.exchanges : [];
    const exchanges = defaultExchanges.map((fallback) => {
      const configured = configuredExchanges.find((item) => item?.id === fallback.id) || {};
      const homeUrl = safeUrl(configured.homeUrl, fallback.homeUrl);
      const genericUrl = safeUrl(window.MM_CONFIG?.links?.weexRegister, homeUrl);
      const candidate = safeUrl(configured.registrationUrl) || safeUrl(window.MM_CONFIG?.partner?.referralUrl);
      // Bare official home/registration pages remain generic, even in a referral setting.
      const candidateUrl = candidate ? new URL(candidate) : null;
      const candidatePath = candidateUrl?.pathname.replace(/\/+$/, '').replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i, '');
      const genericCandidate = candidateUrl && candidateUrl.origin === new URL(homeUrl).origin
        && !candidateUrl.search && !candidateUrl.hash && ['', '/register', '/signup', '/sign-up'].includes(candidatePath);
      const registrationUrl = genericCandidate ? null : candidate;
      return {
        id: fallback.id,
        name: typeof configured.name === 'string' && configured.name.trim() ? configured.name.trim().slice(0, 60) : fallback.name,
        relationship: 'partner',
        description: typeof configured.description === 'string' ? configured.description.slice(0, 300) : fallback.description,
        homeUrl, genericUrl, registrationUrl,
        inviteCode: typeof configured.inviteCode === 'string' && configured.inviteCode.trim() ? configured.inviteCode.trim().slice(0, 100) : null,
      };
    });
    const findExchange = (id) => exchanges.find((exchange) => exchange.id === id) || exchanges[0];
    const configuredSeconds = (key, fallback) => {
      const value = Number(window.MM_CONFIG?.membership?.[key]);
      return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 3600) : fallback;
    };

    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (saved?.version === 1 && Array.isArray(saved.accounts)) {
        state.accounts = [...new Set(saved.accounts.filter((email) => typeof email === 'string')
          .map(normalizeEmail).filter(validEmail))].slice(-100);
        const savedEmail = normalizeEmail(saved.currentEmail);
        if (state.accounts.includes(savedEmail)) state.currentEmail = savedEmail;
        const association = saved.association;
        if (state.currentEmail && exchangePreviewMode() && association?.mode === 'preview'
          && association.memberEmail === state.currentEmail && association.email === SAMPLE_EMAIL
          && association.uid === SAMPLE_UID && exchanges.some((exchange) => exchange.id === association.exchangeId)) {
          state.association = { memberEmail: state.currentEmail, exchangeId: association.exchangeId, email: SAMPLE_EMAIL, uid: SAMPLE_UID, mode: 'preview' };
        }
      }
    } catch { storageAvailable = false; }

    const save = () => {
      // Real provider results are not restored as verified claims from editable browser storage.
      const storedState = { ...state, association: state.association?.mode === 'preview' ? state.association : null };
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(storedState)); }
      catch { storageAvailable = false; }
      if (!storageAvailable) {
        byId('auth-storage-note').textContent = 'Tab storage is unavailable. This demo will last only until this page reloads; nothing is sent to a server.';
        byId('hub-preview-note').textContent = 'Interactive preview. Tab storage is unavailable, so membership lasts only until the page reloads. No real membership account is created and no email is sent.';
      }
    };

    const resetMenu = () => {
      document.body.classList.remove('nav-open');
      const toggle = byId('menu-toggle');
      toggle?.setAttribute('aria-expanded', 'false');
      toggle?.setAttribute('aria-label', 'Open navigation');
    };
    const updateModalState = () => {
      document.body.classList.toggle('member-dialog-open', dialogs.some((dialog) => dialog.open));
    };
    const isVisible = (element) => Boolean(element?.isConnected && !element.closest('[hidden]')
      && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
    const focusVisible = (element) => {
      const destination = isVisible(element) ? element
        : [byId('menu-toggle'), document.querySelector('.brand')].find(isVisible);
      destination?.focus({ preventScroll: true });
    };
    const closeDialog = (dialog, reason = 'user', after = null) => {
      if (!dialog.open) { after?.(); return; }
      if (dialog === linkDialog) invalidateVerification();
      const queue = closeQueue.get(dialog) || [];
      queue.push({ reason, after });
      closeQueue.set(dialog, queue);
      dialog.close();
      updateModalState();
    };
    const showDialog = (dialog, focusTarget = null, opener = null) => {
      let origin = opener || document.activeElement;
      if (origin?.closest('#site-nav') && document.body.classList.contains('nav-open') && isVisible(byId('menu-toggle'))) {
        origin = byId('menu-toggle');
      }
      resetMenu();
      if (!dialog.open) {
        returnFocus.set(dialog, origin);
        document.querySelectorAll('dialog[open]').forEach((other) => {
          if (other === dialog) return;
          if (dialogs.includes(other)) closeDialog(other, 'transition');
          else other.close();
        });
        dialog.showModal();
      }
      updateModalState();
      requestAnimationFrame(() => {
        if (dialog.open) focusVisible(focusTarget || dialog.querySelector('button, input, a[href]'));
      });
    };
    const clearChallenge = () => {
      challenge = null;
      if (timer) clearInterval(timer);
      timer = null;
      codeInput.value = '';
      codeInput.disabled = true;
      emailInput.disabled = false;
      consentInput.disabled = false;
    };
    const displayPublic = () => {
      document.body.classList.remove('member-view');
      publicContent.hidden = false;
      hub.hidden = true;
      document.querySelector('.skip-link')?.setAttribute('href', '#main');
    };
    const cancelHubRoute = () => {
      if (!signedIn() && location.hash === '#member-hub') {
        history.replaceState(null, '', lastPublicHash);
        displayPublic();
      }
      routeAuth = false;
    };

    dialogs.forEach((dialog) => {
      dialog.addEventListener('close', () => {
        if (dialog === linkDialog) invalidateVerification();
        const closing = closeQueue.get(dialog)?.shift() || { reason: 'user', after: null };
        updateModalState();
        if (dialog === authDialog && closing.reason === 'user') {
          pendingCompletion = null;
          infoReturn = null;
          clearChallenge();
          cancelHubRoute();
        }
        if (dialog === infoDialog && closing.reason === 'user' && infoReturn) {
          const destination = infoReturn;
          infoReturn = null;
          showDialog(authDialog, destination.focus, destination.opener);
          return;
        }
        closing.after?.();
        if (closing.reason === 'user' && !document.querySelector('dialog[open]')) {
          focusVisible(returnFocus.get(dialog));
        }
      });
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
          closeDialog(dialog);
        }
      });
    });

    const authError = (message, field = null) => {
      errorNode.textContent = message;
      if (field) { field.setAttribute('aria-invalid', 'true'); focusVisible(field); }
    };
    const clearAuthErrors = () => {
      errorNode.textContent = '';
      [emailInput, codeInput, consentInput].forEach((field) => field.removeAttribute('aria-invalid'));
    };
    const renderAuth = () => {
      const codeStep = Boolean(challenge);
      byId('auth-title').textContent = codeStep ? 'Enter demo code' : mode === 'signup' ? 'Sign Up' : 'Log In';
      byId('auth-email-step').hidden = codeStep;
      byId('auth-code-step').hidden = !codeStep;
      byId('auth-legal').hidden = mode !== 'signup';
      consentInput.required = mode === 'signup';
      emailInput.disabled = codeStep;
      consentInput.disabled = codeStep;
      codeInput.disabled = !codeStep;
      byId('auth-switch').hidden = codeStep;
      document.querySelectorAll('[data-auth-switch]').forEach((row) => {
        row.hidden = row.dataset.authSwitch === mode;
      });
      authDialog.querySelector('[data-member-close]').setAttribute('aria-label', mode === 'signup' ? 'Close registration' : 'Close login');
      byId('auth-submit').textContent = codeStep ? (mode === 'signup' ? 'Create demo account' : 'Log In · demo') : 'Continue with email';
      byId('auth-submit').disabled = !previewMode();
      if (!previewMode()) authError('Member services are not connected. Preview login is disabled outside preview mode.');
    };
    const openAuth = (nextMode = 'signin', preserveCompletion = false) => {
      if (signedIn()) { openHub(); return; }
      if (!preserveCompletion) pendingCompletion = null;
      infoReturn = null;
      clearChallenge();
      mode = nextMode === 'signup' ? 'signup' : 'signin';
      clearAuthErrors();
      renderAuth();
      showDialog(authDialog, emailInput);
    };
    const updateCodeClock = () => {
      if (!challenge) return;
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((challenge.expiresAt - now) / 1000));
      const cooldown = Math.max(0, Math.ceil((challenge.resendAt - now) / 1000));
      byId('auth-code-expiry').textContent = remaining ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'This demo code has expired. Generate a new code to continue.';
      byId('auth-resend').disabled = cooldown > 0;
      byId('auth-resend').textContent = cooldown ? `New code in ${cooldown}s` : 'Generate a new demo code';
      byId('auth-submit').disabled = !previewMode() || remaining === 0 || challenge.attempts >= MAX_ATTEMPTS;
    };
    const generateCode = (email) => {
      let value;
      try {
        const bytes = new Uint32Array(1);
        crypto.getRandomValues(bytes);
        value = bytes[0] % 1000000;
      } catch { value = Math.floor(Math.random() * 1000000); }
      challenge = {
        email, code: String(value).padStart(6, '0'), attempts: 0,
        expiresAt: Date.now() + configuredSeconds('otpTtlSeconds', 300) * 1000,
        resendAt: Date.now() + configuredSeconds('resendSeconds', 30) * 1000,
      };
      codeInput.value = '';
      byId('auth-code-email').textContent = email;
      byId('auth-demo-code').textContent = challenge.code;
      clearAuthErrors();
      renderAuth();
      updateCodeClock();
      if (timer) clearInterval(timer);
      timer = setInterval(updateCodeClock, 1000);
      focusVisible(codeInput);
    };
    const notifyMemberChange = () => document.dispatchEvent(new CustomEvent('mmcrypto:member-change', { detail: { signedIn: signedIn() } }));
    const renderMembership = () => {
      const active = signedIn();
      document.querySelectorAll('[data-signed-in]').forEach((node) => { node.hidden = !active; });
      document.querySelectorAll('[data-signed-out]').forEach((node) => { node.hidden = active; });
      if (byId('member-hub-link')) byId('member-hub-link').hidden = !active;
      byId('hub-email').textContent = active ? state.currentEmail : '';
      const association = active && state.association?.memberEmail === state.currentEmail ? state.association : null;
      byId('hub-association-badge').textContent = association ? (association.mode === 'preview' ? 'DEMO LINKED' : 'LINKED') : 'NOT LINKED';
      byId('hub-association-badge').closest('.hub-association').dataset.linked = String(Boolean(association));
      byId('hub-link-summary').textContent = association
        ? association.mode === 'preview'
          ? `${findExchange(association.exchangeId).name} · Demo linked with sample UID ${association.uid}. No real exchange account or invitation was verified; no rewards or VIP eligibility were granted.`
          : `${findExchange(association.exchangeId).name} · The verification service reported a matching referral for UID ${association.uid}. Rewards and VIP eligibility depend on separate published terms.`
        : 'Your MMCrypto member preview is ready to explore. When you are ready, set up WEEX and return here with your WEEX email and UID.';
      const storageNote = storageAvailable ? 'Membership stays in this browser tab.' : 'Tab storage is unavailable; membership lasts only until this page reloads.';
      byId('hub-preview-note').textContent = exchangePreviewMode()
        ? `Interactive preview. ${storageNote} No real account is created, no email is sent, and no exchange account or referral is verified.`
        : `Membership preview. ${storageNote} No real membership account is created or email sent. Exchange verification requires a configured server provider and designated referral link.`;
      renderExchangeCards();
    };
    const route = () => {
      // Retired public exchange links return to the MMCrypto homepage.
      if (location.hash === '#collaborations') history.replaceState(null, '', '#home');
      resetMenu();
      renderMembership();
      if (location.hash === '#member-hub') {
        if (signedIn()) {
          routeAuth = false;
          publicContent.hidden = true;
          hub.hidden = false;
          document.body.classList.add('member-view');
          document.querySelector('.skip-link')?.setAttribute('href', '#member-hub');
          requestAnimationFrame(() => { window.scrollTo(0, 0); focusVisible(byId('hub-title')); });
        } else {
          displayPublic();
          routeAuth = true;
          if (!authDialog.open && !infoDialog.open) openAuth('signin');
        }
      } else {
        lastPublicHash = location.hash || '#home';
        displayPublic();
        if (routeAuth) {
          pendingCompletion = null;
          infoReturn = null;
          clearChallenge();
          dialogs.forEach((dialog) => closeDialog(dialog, 'route'));
        }
        routeAuth = false;
        let target = null;
        try { target = byId(decodeURIComponent(lastPublicHash.slice(1))); } catch { /* Ignore malformed fragments. */ }
        if (target && location.hash) {
          // Chapter deep links select a panel in the story carousel. Scroll only
          // its fixed window into the page, never the offscreen horizontal panel.
          const destination = target.matches('[data-journey-chapter]') ? byId('journey-window') || target : target;
          requestAnimationFrame(() => destination.scrollIntoView({ block: 'start' }));
        }
      }
    };
    const openHub = () => {
      resetMenu();
      if (location.hash !== '#member-hub') location.hash = 'member-hub';
      else route();
    };
    const requireSignIn = (callback) => {
      if (typeof callback !== 'function') return;
      if (signedIn()) { callback(); return; }
      pendingCompletion = callback;
      openAuth('signin', true);
    };
    const signOut = () => {
      invalidateVerification();
      state.currentEmail = null;
      state.association = null;
      pendingCompletion = null;
      infoReturn = null;
      clearChallenge();
      dialogs.forEach((dialog) => closeDialog(dialog, 'signout'));
      save();
      renderMembership();
      notifyMemberChange();
      if (location.hash === '#member-hub') location.hash = 'home';
      else route();
    };

    byId('auth-form').addEventListener('submit', (event) => {
      event.preventDefault();
      clearAuthErrors();
      if (!previewMode()) { authError('Member services are not connected. No account can be created or logged in here.'); return; }
      if (!challenge) {
        const email = normalizeEmail(emailInput.value);
        if (!validEmail(email) || !emailInput.validity.valid) { authError('Enter a valid email address, such as you@example.com.', emailInput); return; }
        emailInput.value = email;
        if (mode === 'signup' && !consentInput.checked) { authError('Acknowledge the Terms preview and Privacy preview to try free membership.', consentInput); return; }
        const existing = state.accounts.includes(email);
        if (mode === 'signup' && existing) { authError('A preview account already exists for this email in this tab. Choose Log In to continue.', emailInput); return; }
        if (mode === 'signin' && !existing) { authError('No preview account exists for this email in this tab. Choose Sign Up to create a demo membership.', emailInput); return; }
        generateCode(email);
        return;
      }
      if (Date.now() >= challenge.expiresAt) { authError('This demo code has expired. Generate a new code to continue.', codeInput); updateCodeClock(); return; }
      if (challenge.attempts >= MAX_ATTEMPTS) { authError('Five incorrect attempts. Generate a new demo code after the cooldown to try again.'); return; }
      const entered = codeInput.value.trim();
      if (!/^\d{6}$/.test(entered)) { authError('Enter the six digits shown in the demo code box.', codeInput); return; }
      if (entered !== challenge.code) {
        challenge.attempts += 1;
        const attemptsLeft = MAX_ATTEMPTS - challenge.attempts;
        authError(attemptsLeft ? `That code does not match. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.` : 'Five incorrect attempts. Generate a new demo code after the cooldown to try again.', codeInput);
        updateCodeClock();
        return;
      }
      const email = challenge.email;
      if (!state.accounts.includes(email)) state.accounts = [...state.accounts, email].slice(-100);
      state.currentEmail = email;
      state.association = null;
      save();
      clearChallenge();
      renderMembership();
      notifyMemberChange();
      const callback = pendingCompletion;
      pendingCompletion = null;
      infoReturn = null;
      routeAuth = false;
      closeDialog(authDialog, 'success', () => { if (callback) callback(); else openHub(); });
    });

    byId('auth-resend').addEventListener('click', () => {
      if (previewMode() && challenge && Date.now() >= challenge.resendAt) generateCode(challenge.email);
    });
    byId('auth-change-email').addEventListener('click', () => {
      clearChallenge(); clearAuthErrors(); renderAuth(); focusVisible(emailInput);
    });
    [emailInput, codeInput, consentInput].forEach((field) => {
      field.addEventListener('input', () => field.removeAttribute('aria-invalid'));
    });

    const guides = {
      membership: { title: 'Your membership, explained.', paragraphs: [
        'Free membership opens this Member Hub and the member learning note in Content. In this frontend preview, logging in is a demonstration using a visible code.',
        'Demo accounts are stored in this browser tab only. Signing out clears the active session and demo account link; the email remains available for a later preview login in the same tab. Closing the tab ends the demo storage.',
      ], action: 'Explore the articles', run: () => { location.hash = 'articles'; } },
      partner: { title: 'Your next step with WEEX.', paragraphs: [
        'Your MMCrypto website membership comes first. From this Member Hub, you can optionally register with partner exchange WEEX and return to connect your account.',
        'A designated MMCrypto referral URL is needed to establish the intended invitation relationship. The link is still pending; the general official WEEX registration page does not establish that relationship.',
        'Review WEEX terms, regional availability and risks before registering. Registration and a demo association do not guarantee rewards or VIP access.',
      ], action: 'Set up WEEX', run: () => openLink('weex') },
      link: { title: 'Connect the right account.', paragraphs: [
        'After registering with WEEX through the designated referral link, return here and enter your WEEX account email and UID. Your WEEX email may differ from your MMCrypto website email.',
        `In demo mode, use ${SAMPLE_EMAIL} with UID 10000001 for a matched preview, 10000002 for invitation mismatch, 10000003 for not found, or 10000004 for unavailable. Other combinations return demo not found.`,
        'Demo checks stay on this page. A real referral check requires a server integration that verifies the expected invitation relationship; the browser cannot verify it. No preview result earns referral credit, rewards or VIP access.',
      ], action: 'Explore the association flow', run: () => openLink('weex') },
      tutorial: { title: 'From registration to association.', steps: [
        'Create your MMCrypto website membership, then open the WEEX setup in your Member Hub.',
        'Open the designated MMCrypto referral link for WEEX once supplied. Register on WEEX, then return and manually confirm that step. A general official link does not establish the referral.',
        'Enter your WEEX account email and UID. The WEEX email does not need to match your MMCrypto website email.',
        'Request a referral check. A live service must verify the intended invitation relationship; a UID’s format alone is not proof.',
      ], paragraphs: ['The current frontend preview uses displayed sample inputs and simulates the WEEX registration step. The designated referral link, expected invitation details and live verification are pending.'], action: 'Explore the association flow', run: () => openLink('weex') },
      community: { title: 'Continue the conversation.', paragraphs: [
        'The official profiles in Social Media are available without membership. Telegram links to the German-speaking MMCrypto community; YouTube, X and Instagram offer more public updates.',
        'Discord login and a Discord invite have not been configured. The email preview is the available way to explore this Member Hub.',
      ], action: 'Explore social channels', run: () => { location.hash = 'connect'; }, external: 'telegram', externalLabel: 'Open Telegram community ↗' },
      campaigns: { title: 'Campaign details are pending.', paragraphs: [
        'No MMCrypto-specific campaign, reward amount, referral eligibility, participation dates or claim rules have been confirmed for this preview.',
        'A demo membership or demo account association does not enroll you in a campaign. WEEX offers are governed by its own published rules.',
      ], external: 'weexHome', externalLabel: 'Explore the official WEEX site ↗' },
      vip: { title: 'VIP details are pending.', paragraphs: [
        'MMCrypto-specific VIP benefits and eligibility have not been announced. This preview does not grant VIP access or check trading volume, balances or status.',
        'Consult the platform’s published information for current services and availability. Creating an account does not guarantee VIP eligibility.',
      ], external: 'weexHome', externalLabel: 'Visit the official WEEX site ↗' },
      discord: { title: 'Discord isn’t connected yet.', paragraphs: [
        'Discord OAuth and a community invite have not been configured for this frontend preview. This page cannot authenticate a Discord account or grant access to a server.',
        'You can continue with the clearly labelled email demo to explore membership. No messages or emails will be sent.',
      ], action: 'Continue with email preview', run: () => openAuth(mode) },
      terms: { title: 'Terms preview.', kicker: 'MMCRYPTO / DOCUMENT PREVIEW', paragraphs: [
        'Published membership terms have not been supplied. This explanatory screen is a frontend preview, not a binding service agreement.',
        'The demo illustrates MMCrypto email login, a Member Hub and optional member onboarding. It does not create a real account, activate services or grant benefits.',
        'Acknowledging this preview enables the demonstration only. Official service terms must be provided before live membership is available.',
      ] },
      privacy: { title: 'Privacy preview.', kicker: 'MMCRYPTO / DOCUMENT PREVIEW', paragraphs: [
        'A published privacy policy has not been supplied. This screen explains how the membership demo behaves; it is not a complete privacy policy for a live service.',
        'The membership demo stores sample member emails, the active demo email and optional sample onboarding progress in sessionStorage for this tab. If storage is unavailable, that state remains only in page memory. Demo mode does not send these form inputs to a server. Any future live integrations must be covered by a published privacy policy before activation.',
        'Signing out removes the active session and association while retaining demo email entries for same-tab login. Closing the tab ends the demo storage. External platform links and video playback are separate services with their own privacy practices.',
      ] },
    };

    function showGuide(key) {
      const guide = guides[key];
      if (!guide) return;
      const memberOnlyGuide = ['partner', 'link', 'tutorial', 'campaigns', 'vip'].includes(key);
      if (memberOnlyGuide && !signedIn()) { requireSignIn(() => { openHub(); showGuide(key); }); return; }
      const fromAuth = authDialog.open;
      infoReturn = fromAuth ? { focus: document.activeElement, opener: returnFocus.get(authDialog) } : null;
      byId('member-info-title').textContent = guide.title;
      byId('member-info-kicker').textContent = guide.kicker || 'MMCRYPTO / GET STARTED';
      const copy = byId('member-info-copy');
      copy.replaceChildren();
      if (guide.steps) {
        const list = document.createElement('ol');
        list.className = 'guide-steps';
        guide.steps.forEach((text) => { const item = document.createElement('li'); item.textContent = text; list.append(item); });
        copy.append(list);
      }
      (guide.paragraphs || []).forEach((text) => { const paragraph = document.createElement('p'); paragraph.textContent = text; copy.append(paragraph); });
      const actionButton = byId('member-info-action');
      actionButton.textContent = fromAuth ? 'Back to membership' : guide.action || 'Got it';
      infoAction = fromAuth ? null : guide.run || null;
      const external = byId('member-info-external');
      let destination = guide.external ? safeUrl(window.MM_CONFIG?.links?.[guide.external]) : null;
      if (key === 'terms' || key === 'privacy') destination = safeUrl(window.MM_CONFIG?.membership?.[`${key}Url`]);
      if (key === 'tutorial') destination = safeUrl(window.MM_CONFIG?.partner?.tutorialUrl);
      external.hidden = !destination;
      if (destination) {
        external.href = destination;
        external.textContent = guide.externalLabel || (key === 'tutorial' ? 'Open partner tutorial ↗' : 'Open published document ↗');
      } else external.removeAttribute('href');
      showDialog(infoDialog, byId('member-info-action'));
    }

    byId('member-info-action').addEventListener('click', () => {
      if (infoReturn) { closeDialog(infoDialog); return; }
      const callback = infoAction;
      infoAction = null;
      closeDialog(infoDialog, callback ? 'action' : 'user', callback);
    });

    function renderExchangeCards() {
      exchanges.forEach((exchange) => {
        const card = document.querySelector(`[data-exchange-card="${exchange.id}"]`);
        if (card) {
          card.querySelector('[data-exchange-label]').textContent = 'PARTNER EXCHANGE';
          card.querySelector('.exchange-name').textContent = exchange.name;
          card.querySelector('[data-exchange-description]').textContent = exchange.description;
          card.querySelector('[data-exchange-invite]').textContent = exchange.registrationUrl
            ? 'Designated referral link available' : 'Designated referral link pending';
          card.querySelector('[data-exchange-status]').textContent = exchangePreviewMode()
            ? 'Demo only. No live referral verification is connected.'
            : 'A configured server provider must verify the invitation relationship.';
          card.querySelector('[data-exchange-open]').textContent = exchangePreviewMode()
            ? 'Set up WEEX · demo' : 'Set up WEEX account';
        }
        document.querySelectorAll(`[data-exchange-home="${exchange.id}"]`).forEach((link) => {
          link.href = exchange.homeUrl;
          link.textContent = `Official ${exchange.name} site ↗`;
        });
      });
    }

    function setLinkBusy(busy) {
      verificationBusy = busy;
      byId('link-form').setAttribute('aria-busy', String(busy));
      ['link-email', 'link-uid', 'link-submit'].forEach((id) => { byId(id).disabled = busy; });
      linkDialog.querySelectorAll('[data-link-fixture]').forEach((button) => { button.disabled = busy; });
      byId('link-submit').textContent = busy ? 'Checking referral…' : exchangePreviewMode() ? 'Verify referral · demo' : 'Verify referral';
    }

    function invalidateVerification() {
      verificationRequest += 1;
      setLinkBusy(false);
    }

    function setLinkProgress(current) {
      ['registration', 'details', 'result'].forEach((step) => {
        const item = byId(`link-progress-${step}`);
        if (step === current) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
    }

    function setLinkStep(step) {
      linkStep = step;
      byId('link-registration-step').hidden = step !== 'registration';
      byId('link-details-step').hidden = step !== 'details';
      byId('link-success-step').hidden = step !== 'success';
      byId('link-preview-note').hidden = step === 'success';
      setLinkProgress(step === 'success' ? 'result' : step);
      linkDialog.querySelectorAll('.link-progress li').forEach((item) => item.classList.toggle('is-complete', step === 'success'));
      const titleId = step === 'success' ? 'link-success-title' : step === 'registration' ? 'link-registration-title' : 'link-details-title';
      requestAnimationFrame(() => {
        if (linkDialog.open && linkStep === step) focusVisible(byId(titleId));
      });
    }

    function showLinkSuccess(association) {
      const demo = association.mode === 'preview';
      const name = findExchange(association.exchangeId).name;
      byId('link-title').textContent = demo ? 'Demo setup complete.' : 'Setup complete.';
      byId('link-success-kicker').textContent = demo ? 'DEMO RESULT' : 'ACCOUNT CONNECTED';
      byId('link-success-title').textContent = demo ? `${name} linked · demo` : `${name} linked successfully`;
      byId('link-success-message').textContent = demo
        ? 'The sample account is linked in this demo. No real WEEX account or invitation was verified; no rewards or VIP access were granted.'
        : 'Your account is linked. The verification service confirmed the expected invitation relationship. Rewards and VIP access depend on separate published terms.';
      byId('link-success-email').textContent = association.email;
      byId('link-success-uid').textContent = association.uid;
      setLinkStep('success');
      linkDialog.scrollTop = 0;
    }

    byId('link-success-done').addEventListener('click', () => {
      closeDialog(linkDialog, 'action', () => {
        openHub();
        requestAnimationFrame(() => {
          const summary = byId('hub-link-summary');
          if (!hub.hidden) { summary.scrollIntoView({ block: 'center' }); focusVisible(summary); }
        });
      });
    });

    function clearLinkResult() {
      byId('link-result').textContent = '';
      byId('link-result').removeAttribute('data-state');
      ['link-email', 'link-uid'].forEach((id) => byId(id).removeAttribute('aria-invalid'));
    }

    function openLink(exchangeId = 'weex') {
      const exchange = findExchange(exchangeId);
      if (!signedIn()) { requireSignIn(() => { openHub(); openLink(exchange.id); }); return; }
      invalidateVerification();
      linkExchangeId = exchange.id;
      registrationConfirmed = false;
      const demo = exchangePreviewMode();
      const referralUrl = exchange.registrationUrl;
      const destination = referralUrl || exchange.genericUrl;
      byId('link-kicker').textContent = `MMCRYPTO / WEEX SETUP${demo ? ' · DEMO' : ''}`;
      byId('link-title').textContent = demo ? `Explore ${exchange.name} association.` : `Connect your ${exchange.name} account.`;
      byId('link-preview-note').textContent = demo
        ? `Demo only. This walkthrough does not contact ${exchange.name} or verify a real account or invitation. Use the sample inputs shown in the next step.`
        : 'Exchange verification requires a configured server provider. The service must verify the expected invitation relationship; this page cannot determine it from an email and UID alone.';
      byId('link-registration-title').textContent = `Register, then return here.`;
      byId('link-referral-label').textContent = referralUrl ? `Designated ${exchange.name} referral link` : 'General official link · designated referral pending';
      byId('link-referral-note').textContent = referralUrl
        ? `Use this designated link to register on ${exchange.name}, then return to this site. The exchange handles registration and applies its own eligibility and regional terms.`
        : `A designated MMCrypto referral link for ${exchange.name} has not been supplied. The link below is a general official destination; it does not establish the intended invitation relationship.`;
      byId('link-partner-url').value = destination;
      byId('link-copy-status').textContent = '';
      byId('link-open-exchange').href = destination;
      byId('link-open-exchange').textContent = referralUrl ? `Open ${exchange.name} referral registration ↗` : `Open ${exchange.name} official page ↗`;
      byId('link-expected-invite').textContent = exchange.inviteCode ? exchange.inviteCode : 'Pending — not supplied';
      byId('link-registration-help').textContent = demo
        ? 'In a live flow, register through the designated referral URL, then return here. No real registration is needed to explore this demo.'
        : 'After registering through the designated referral URL, return here to enter your exchange details. Verification is unavailable until the required referral configuration and server provider are connected.';
      byId('link-confirm-label').textContent = demo
        ? 'For this demo, simulate having completed registration and returned to this site.'
        : 'I have completed registration through the designated referral link and returned to this site.';
      byId('link-registration-confirm').checked = false;
      byId('link-registration-confirm').removeAttribute('aria-invalid');
      byId('link-registration-error').textContent = '';
      byId('link-fixtures').hidden = !demo;
      byId('link-sample-email').textContent = SAMPLE_EMAIL;
      byId('link-email').value = '';
      byId('link-email').placeholder = demo ? SAMPLE_EMAIL : 'your.exchange@example.com';
      byId('link-uid').value = '';
      byId('link-uid').placeholder = demo ? SAMPLE_UID : 'Your exchange UID';
      byId('link-uid-label').textContent = `${exchange.name} UID${demo ? ' · demo' : ''}`;
      byId('link-eligibility-note').textContent = demo
        ? 'A successful demo does not verify a real referral, create referral credit, or grant rewards or VIP eligibility.'
        : 'A referral match does not itself create rewards or VIP eligibility. Those depend on separate published exchange terms.';
      clearLinkResult();
      setLinkStep('registration');
      showDialog(linkDialog, byId('link-registration-title'));
    }

    byId('link-continue').addEventListener('click', () => {
      const checkbox = byId('link-registration-confirm');
      if (!checkbox.checked) {
        byId('link-registration-error').textContent = exchangePreviewMode()
          ? 'Confirm the simulated registration step to continue with the demo.'
          : 'Confirm that you completed registration through the designated referral link before continuing.';
        checkbox.setAttribute('aria-invalid', 'true');
        focusVisible(checkbox);
        return;
      }
      byId('link-registration-error').textContent = '';
      checkbox.removeAttribute('aria-invalid');
      registrationConfirmed = true;
      setLinkStep('details');
    });
    byId('link-registration-confirm').addEventListener('change', () => {
      byId('link-registration-error').textContent = '';
      byId('link-registration-confirm').removeAttribute('aria-invalid');
    });
    byId('link-back').addEventListener('click', () => {
      invalidateVerification();
      registrationConfirmed = false;
      clearLinkResult();
      setLinkStep('registration');
    });
    linkDialog.querySelectorAll('[data-link-fixture]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!exchangePreviewMode() || verificationBusy || linkStep !== 'details') return;
        const uid = button.dataset.linkFixture;
        if (!Object.hasOwn(DEMO_RESULTS, uid)) return;
        clearLinkResult();
        setLinkProgress('details');
        byId('link-email').value = SAMPLE_EMAIL;
        byId('link-uid').value = uid;
        byId('link-result').textContent = 'Sample details filled. Select “Verify referral · demo” to see this outcome.';
        focusVisible(byId('link-submit'));
      });
    });
    ['link-email', 'link-uid'].forEach((id) => {
      byId(id).addEventListener('input', () => {
        invalidateVerification();
        clearLinkResult();
        setLinkProgress('details');
      });
    });

    byId('link-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (verificationBusy) return;
      const emailField = byId('link-email');
      const uidField = byId('link-uid');
      const result = byId('link-result');
      clearLinkResult();
      const fail = (message, field = null) => {
        result.textContent = message;
        result.dataset.state = 'error';
        if (field) { field.setAttribute('aria-invalid', 'true'); focusVisible(field); }
      };
      if (!signedIn()) { fail('Your preview session has ended. Log in before trying an association.'); return; }
      if (!linkDialog.open || linkStep !== 'details' || !registrationConfirmed) {
        fail('Complete the registration step before requesting a referral check.'); return;
      }
      const email = normalizeEmail(emailField.value);
      const uid = uidField.value.trim();
      if (!validEmail(email) || !emailField.validity.valid) { fail('Enter a valid exchange account email address. It may differ from your website email.', emailField); return; }
      if (!/^\d{1,20}$/.test(uid)) { fail('Enter the numeric UID shown in your exchange account, up to 20 digits.', uidField); return; }
      const exchange = findExchange(linkExchangeId);
      const memberEmail = state.currentEmail;
      const demo = exchangePreviewMode();
      const request = ++verificationRequest;
      const provider = exchangeProvider();
      emailField.value = email;
      uidField.value = uid;
      state.association = null;
      save();
      renderMembership();
      setLinkBusy(true);
      setLinkProgress('result');
      result.dataset.state = 'loading';
      result.textContent = demo ? 'Checking the sample invitation relationship…' : 'Requesting an invitation check from the verification service…';
      let timeoutId;
      let outcome = 'unavailable';
      let unavailableReason = '';
      try {
        if (demo) {
          await new Promise((resolve) => setTimeout(resolve, 650));
          outcome = email === SAMPLE_EMAIL && Object.hasOwn(DEMO_RESULTS, uid) ? DEMO_RESULTS[uid] : 'not_found';
        } else if (exchange.relationship !== 'partner' || !exchange.registrationUrl) {
          unavailableReason = 'A confirmed collaboration and designated referral link are required. This exchange configuration is still pending.';
        } else if (typeof provider?.verifyReferral !== 'function') {
          unavailableReason = 'No verification provider is connected. Your exchange details were not sent anywhere.';
        } else {
          // Provider contract: {status: 'matched' | 'invitation_mismatch' | 'not_found' | 'unavailable'}.
          // The server owns the expected invitation rule; never trust a code supplied by this browser.
          const response = await Promise.race([
            Promise.resolve().then(() => provider.verifyReferral({ exchangeId: exchange.id, email, uid })),
            new Promise((resolve) => { timeoutId = setTimeout(() => resolve({ status: 'unavailable' }), 15000); }),
          ]);
          if (['matched', 'invitation_mismatch', 'not_found', 'unavailable'].includes(response?.status)) outcome = response.status;
        }
      } catch { outcome = 'unavailable'; }
      finally { if (timeoutId) clearTimeout(timeoutId); }
      if (request !== verificationRequest || !linkDialog.open || !signedIn()
        || memberEmail !== state.currentEmail || exchange.id !== linkExchangeId || demo !== exchangePreviewMode()) return;
      setLinkBusy(false);
      result.dataset.state = outcome;
      const messages = demo ? {
        matched: `Demo linked. The sample ${exchange.name} account shows a simulated invitation match. No real account or referral was verified, and no rewards or VIP eligibility were granted.`,
        invitation_mismatch: 'Demo invitation mismatch. This sample account is found, but its simulated invitation relationship does not match. A real integration must check the expected invitation on the server.',
        not_found: `Demo account not found. Use ${SAMPLE_EMAIL} with a displayed sample UID to explore the outcomes. No real exchange lookup was performed.`,
        unavailable: 'Demo service unavailable. This sample shows how an interrupted verification service would appear. No association was saved; you can choose another sample and retry.',
      } : {
        matched: `${exchange.name} referral matched. The verification service reported that this account has the expected invitation relationship. Rewards and VIP eligibility are subject to separate published terms.`,
        invitation_mismatch: 'Invitation mismatch. The verification service found the account but did not confirm the expected referral relationship. Review the registration link and exchange details before retrying.',
        not_found: 'Account not found. The verification service could not match these exchange details. Check the email registered with the exchange and the UID, then retry.',
        unavailable: `Verification unavailable. ${unavailableReason || 'The service did not return a valid result. Please try again later.'} No association was saved.`,
      };
      result.textContent = messages[outcome];
      if (outcome === 'matched') {
        state.association = { memberEmail, exchangeId: exchange.id, email, uid, mode: demo ? 'preview' : 'verified' };
        save();
        renderMembership();
        notifyMemberChange();
        showLinkSuccess(state.association);
        return;
      }
      focusVisible(result);
    });

    byId('link-copy-link').addEventListener('click', async () => {
      const input = byId('link-partner-url');
      const status = byId('link-copy-status');
      const destination = input.value;
      const exchangeId = linkExchangeId;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(destination);
        if (linkDialog.open && exchangeId === linkExchangeId && destination === input.value) status.textContent = 'Link copied. Registration takes place on the exchange’s own website.';
      } catch {
        if (!linkDialog.open || exchangeId !== linkExchangeId || destination !== input.value) return;
        input.focus();
        input.select();
        status.textContent = 'Automatic copying is unavailable. The link is selected; use your device’s Copy command.';
      }
    });

    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const closeButton = target.closest('[data-member-close]');
      if (closeButton) { closeDialog(closeButton.closest('dialog')); return; }
      const authMode = target.closest('[data-auth-mode]');
      if (authMode) {
        clearChallenge(); clearAuthErrors(); mode = authMode.dataset.authMode === 'signup' ? 'signup' : 'signin';
        renderAuth(); focusVisible(emailInput); return;
      }
      const authButton = target.closest('[data-auth]');
      if (authButton) { event.preventDefault(); openAuth(authButton.dataset.auth); return; }
      const signoutButton = target.closest('[data-member-signout]');
      if (signoutButton) { event.preventDefault(); signOut(); return; }
      const guideButton = target.closest('[data-guide], [data-member-legal]');
      if (guideButton) { event.preventDefault(); showGuide(guideButton.dataset.guide || guideButton.dataset.memberLegal); return; }
      const exchangeButton = target.closest('[data-exchange-open]');
      if (exchangeButton) { event.preventDefault(); openLink(exchangeButton.dataset.exchangeOpen); return; }
      if (target.closest('[data-member-link]')) { event.preventDefault(); openLink('weex'); return; }
      const hubLink = target.closest('a[href="#member-hub"]');
      if (hubLink) { event.preventDefault(); openHub(); }
    });
    window.addEventListener('hashchange', route);
    window.MM_MEMBERS = { isSignedIn: signedIn, openAuth, requireSignIn, openHub, signOut, showGuide };
    save();
    renderMembership();
    route();
  });
})();
