(() => {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');
  toggle?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  const cookieBanner = document.querySelector('[data-cookie-banner]');
  const cookieKey = 'empireEliteCookieConsent';
  const openCookieBanner = () => {
    if (!cookieBanner) return;
    cookieBanner.hidden = false;
    requestAnimationFrame(() => cookieBanner.classList.add('visible'));
  };
  const closeCookieBanner = () => {
    if (!cookieBanner) return;
    cookieBanner.classList.remove('visible');
    window.setTimeout(() => { cookieBanner.hidden = true; }, 220);
  };

  if (cookieBanner && !localStorage.getItem(cookieKey)) window.setTimeout(openCookieBanner, 450);
  document.querySelectorAll('[data-cookie-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      localStorage.setItem(cookieKey, button.dataset.cookieChoice);
      closeCookieBanner();
    });
  });
  document.querySelectorAll('[data-cookie-settings]').forEach((button) => {
    button.addEventListener('click', openCookieBanner);
  });

  if ('serviceWorker' in navigator && ['https:', 'http:'].includes(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  const installOverlay = document.querySelector('[data-install-app]');
  if (installOverlay) {
    const installButton = installOverlay.querySelector('[data-install-confirm]');
    const installHelp = installOverlay.querySelector('[data-install-help]');
    const installWalkthrough = installOverlay.querySelector('[data-install-walkthrough]');
    const installTrigger = document.querySelector('[data-open-install]');
    let deferredInstallPrompt = null;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isIosChrome = isIos && /CriOS/.test(navigator.userAgent);
    const dismissInstall = () => {
      installOverlay.hidden = true;
      installOverlay.classList.remove('is-manual');
    };
    const requestInstall = async () => {
      if (!deferredInstallPrompt) return false;
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (choice.outcome === 'accepted') dismissInstall();
      return true;
    };
    const showManualInstructions = () => {
      installHelp.textContent = isIosChrome
        ? 'Chrome on iPhone or iPad: follow these three quick steps.'
        : isIos
          ? 'Safari on iPhone or iPad: follow these three quick steps.'
          : 'Your browser does not offer one-tap installation here. Open its menu and choose Add to Home screen or Install app.';
      installHelp.hidden = false;
      if (installWalkthrough) installWalkthrough.hidden = !isIos;
      installOverlay.classList.toggle('is-manual', isIos);
      installButton.textContent = isIos ? 'Done' : 'Got it';
      installOverlay.hidden = false;
      installOverlay.querySelector('.install-app-close')?.focus();
    };
    if (standalone && installTrigger) installTrigger.hidden = true;
    installTrigger?.addEventListener('click', async () => {
      if (await requestInstall()) return;
      showManualInstructions();
    });
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
    });
    window.addEventListener('appinstalled', () => dismissInstall());
    installButton?.addEventListener('click', async () => { if (!await requestInstall()) dismissInstall(); });
    installOverlay.querySelectorAll('[data-install-dismiss]').forEach(button => button.addEventListener('click', () => dismissInstall()));
  }

  const faqItems = document.querySelectorAll('.faq-list details');
  faqItems.forEach((item) => {
    item.addEventListener('toggle', () => {
      if (!item.open) return;
      faqItems.forEach((other) => {
        if (other !== item) other.open = false;
      });
    });
  });

  async function loadPublicPromotion() {
    try {
      if (!window.EMPIRE_ELITE_CONFIG?.convexUrl) {
        await new Promise((resolve, reject) => {
          const config = document.createElement('script');
          config.src = 'config.js'; config.onload = resolve; config.onerror = reject;
          document.head.append(config);
        });
      }
      const { convexClient } = await import('./pricing-client.js');
      const promotion = await (await convexClient()).query('promotions:currentWebsitePromotion', {});
      if (!promotion) return;
      window.EMPIRE_ACTIVE_PROMOTION = promotion;
      window.dispatchEvent(new CustomEvent('empire:promotion', { detail: promotion }));

      if (document.querySelector('.booking-main')) {
        const banner = document.createElement('aside');
        banner.className = 'promotion-banner'; banner.setAttribute('aria-label', 'Current promotion');
        const copy = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = promotion.headline;
        const message = document.createElement('span'); message.textContent = `${promotion.message} Offer ends ${new Date(promotion.endAt).toLocaleString()}.`;
        const badge = document.createElement('b'); badge.textContent = `${promotion.percentageBps / 100}% OFF`;
        copy.append(title, message); banner.append(badge, copy);
        document.querySelector('.booking-main').before(banner);
      }

      const seenKey = `empireElitePromotionSeen:${promotion.id}`;
      if (localStorage.getItem(seenKey)) return;
      localStorage.setItem(seenKey, '1');
      const overlay = document.createElement('div'); overlay.className = 'promotion-popup-overlay';
      const dialog = document.createElement('section'); dialog.className = 'promotion-popup'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'promotion-popup-title');
      const close = document.createElement('button'); close.className = 'promotion-popup-close'; close.type = 'button'; close.setAttribute('aria-label', 'Close promotion'); close.textContent = '×';
      const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'Limited-time offer';
      const heading = document.createElement('h2'); heading.id = 'promotion-popup-title'; heading.textContent = promotion.headline;
      const body = document.createElement('p'); body.textContent = promotion.message;
      const link = document.createElement('a'); link.className = 'gold-button'; link.href = 'booking.html'; link.textContent = 'Book with this offer →';
      dialog.append(close, eyebrow, heading, body, link); overlay.append(dialog); document.body.append(overlay);
      const dismiss = () => { overlay.remove(); document.removeEventListener('keydown', escape); };
      const escape = event => { if (event.key === 'Escape') dismiss(); };
      close.addEventListener('click', dismiss); overlay.addEventListener('click', event => { if (event.target === overlay) dismiss(); }); document.addEventListener('keydown', escape); close.focus();
    } catch { /* Promotions never prevent the website from loading. */ }
  }

  void loadPublicPromotion();

})();
