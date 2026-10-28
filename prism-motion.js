/* Decorative movement only. Core content and membership behavior stay independent. */
(() => {
  'use strict';
  const init = () => {
    const hero = document.getElementById('home');
    if (!hero) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const ambient = document.createElement('div');
    ambient.className = 'prism-ambient';
    ambient.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i += 1) ambient.appendChild(document.createElement('span'));
    hero.prepend(ambient);
    let heroVisible = true;
    const paused = () => reduced.matches || document.body.classList.contains('motion-paused') || document.hidden;
    const sync = () => {
      ambient.classList.toggle('is-still', paused() || !heroVisible);
      ambient.dataset.animationState = paused() || !heroVisible ? 'still' : 'running';
      hero.dataset.prismMotion = paused() || !heroVisible ? 'still' : 'running';
      if (paused() || !fine.matches) {
        hero.style.removeProperty('--prism-shift-x');
        hero.style.removeProperty('--prism-shift-y');
      }
    };
    new MutationObserver(sync).observe(document.body, {attributes:true, attributeFilter:['class']});
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    fine.addEventListener('change', sync);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => { heroVisible = entry.isIntersecting; sync(); }, {threshold:0}).observe(hero);
    }
    hero.addEventListener('pointermove', (event) => {
      if (paused() || !fine.matches || !heroVisible) return;
      const bounds = hero.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - .5;
      const y = (event.clientY - bounds.top) / bounds.height - .5;
      hero.style.setProperty('--prism-shift-x', `${(x * 10).toFixed(2)}px`);
      hero.style.setProperty('--prism-shift-y', `${(y * 6).toFixed(2)}px`);
    }, {passive:true});
    hero.addEventListener('pointerleave', () => {
      hero.style.removeProperty('--prism-shift-x');
      hero.style.removeProperty('--prism-shift-y');
    });
    document.querySelectorAll('.library-card, .social-card, .health-card').forEach((card) => {
      card.classList.add('prism-shine');
      card.addEventListener('pointermove', (event) => {
        if (paused() || !fine.matches) return;
        const bounds = card.getBoundingClientRect();
        card.style.setProperty('--prism-x', `${event.clientX - bounds.left}px`);
        card.style.setProperty('--prism-y', `${event.clientY - bounds.top}px`);
      }, {passive:true});
    });
    if ('IntersectionObserver' in window) {
      const entrance = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('prism-is-visible');
          entrance.unobserve(entry.target);
        });
      }, {threshold:.06, rootMargin:'0px 0px -12px 0px'});
      document.querySelectorAll('.library-card, .social-card, .health-grid, .journey-carousel').forEach((card,index) => {
        card.classList.add('prism-enter');
        card.style.setProperty('--prism-reveal-delay', `${(index % 3) * 75}ms`);
        entrance.observe(card);
      });
      document.body.classList.add('prism-reveals-ready');
    }
    const nav = [...document.querySelectorAll('#site-nav a[href^="#"]')].filter((link) => link.hash !== '#member-hub');
    const sections = nav.map((link) => document.getElementById(link.hash.slice(1))).filter(Boolean);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        if (document.body.classList.contains('member-view')) return;
        const active = entries.filter((entry) => entry.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!active) return;
        nav.forEach((link) => {
          if (link.hash === `#${active.target.id}`) link.setAttribute('aria-current','location');
          else link.removeAttribute('aria-current');
        });
      }, {rootMargin:'-15% 0px -55% 0px', threshold:0}).observe(hero);
      const sectionObserver = new IntersectionObserver((entries) => {
        if (document.body.classList.contains('member-view')) return;
        const active = entries.find((entry) => entry.isIntersecting);
        if (!active) return;
        nav.forEach((link) => {
          if (link.hash === `#${active.target.id}`) link.setAttribute('aria-current','location');
          else link.removeAttribute('aria-current');
        });
      }, {rootMargin:'-15% 0px -55% 0px', threshold:0});
      sections.filter((section) => section !== hero).forEach((section) => sectionObserver.observe(section));
    }
    sync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
