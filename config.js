/*
 * MMCrypto personal-brand website · member-first configuration.
 *
 * The public homepage and website registration carry only MMCrypto branding.
 * WEEX onboarding is introduced inside the Member Hub after website sign-in.
 *
 * For WEEX, supply its approved exchanges[].registrationUrl
 * and display-only inviteCode. WEEX also accepts partner.referralUrl as a
 * fallback. Bare official home/registration URLs remain generic destinations;
 * they do not establish an invitation relationship. Keep static HTML links
 * synchronized with confirmed configuration and never reuse another creator's
 * code. Designated links, campaign terms and VIP destinations are still pending.
 *
 * membership.mode and exchangeVerification.mode are independent previews.
 * The exchange walkthrough covers registration, exchange email + UID, and a
 * result. Its email may differ from the website member email. Preview fixtures:
 * exchange.demo@example.com with 10000001 matched, 10000002 invitation_mismatch,
 * 10000003 not_found, or 10000004 unavailable. No real verification is performed.
 *
 * A future adapter is window.MM_EXCHANGE_PROVIDER.verifyReferral({exchangeId,
 * email, uid}), returning {status: 'matched' | 'invitation_mismatch' |
 * 'not_found' | 'unavailable'}. The trusted server owns the expected invitation
 * rule; a browser-supplied code or valid UID format is never proof. Do not place
 * secrets here. Changing modes alone does not create production authentication.
 */
window.MM_CONFIG = {
  links: {
    youtube: 'https://www.youtube.com/@mmcryptotube',
    youtubeLatest: 'https://www.youtube.com/@MMCryptoTube/videos',
    x: 'https://x.com/mmcrypto',
    instagram: 'https://www.instagram.com/chrismmcrypto/',
    health: 'https://www.instagram.com/chrismmhealth/',
    telegram: 'https://t.me/MMCrypto',
    weexRegister: 'https://www.weex.com/register',
    weexHome: 'https://www.weex.com/',
    campaign: null,
    vip: null
  },
  // Frontend preview only. No email, identity, or exchange verification service is connected.
  membership: {
    mode: 'preview',
    otpTtlSeconds: 300,
    resendSeconds: 30,
    termsUrl: null,
    privacyUrl: null,
    discordUrl: null
  },
  partner: {
    referralUrl: null,
    tutorialUrl: null,
    rewardTitle: null
  },
  // WEEX is the sole partner destination, shown only after MMCrypto sign-in.
  exchanges: [
    { id: 'weex', name: 'WEEX', relationship: 'partner', homeUrl: 'https://www.weex.com/', registrationUrl: null, inviteCode: null, description: 'An optional next step for MMCrypto members. Register on WEEX, then return to connect your account.' }
  ],
  // Real referral attribution requires a trusted server-side exchange integration.
  exchangeVerification: { mode: 'preview' }
};
