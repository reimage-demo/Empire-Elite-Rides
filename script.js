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

  const faqItems = document.querySelectorAll('.faq-list details');
  faqItems.forEach((item) => {
    item.addEventListener('toggle', () => {
      if (!item.open) return;
      faqItems.forEach((other) => {
        if (other !== item) other.open = false;
      });
    });
  });

})();
