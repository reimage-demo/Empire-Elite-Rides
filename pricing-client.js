let clientPromise;
const addressCache = new Map();
const ADDRESS_CACHE_TTL_MS = 5 * 60 * 1000;

export function customerSessionId() {
  const key = 'eer-customer-session';
  let value = sessionStorage.getItem(key);
  if (!value) {
    value = `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
    sessionStorage.setItem(key, value);
  }
  return value;
}

export async function convexClient() {
  if (!clientPromise) {
    if (!window.EMPIRE_ELITE_CONFIG?.convexUrl) throw new Error('Pricing service is not configured.');
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = window.EMPIRE_ELITE_CONFIG.convexUrl;
    preconnect.crossOrigin = 'anonymous';
    document.head.append(preconnect);
    clientPromise = import('https://esm.sh/convex@1.31.5/browser')
      .then(({ ConvexClient }) => new ConvexClient(window.EMPIRE_ELITE_CONFIG.convexUrl))
      .catch(error => {
        clientPromise = undefined;
        throw error;
      });
  }
  return clientPromise;
}

// Start the CDN connection while the customer is reading the form instead of
// making their first address search pay the module download cost.
export function warmPricingClient() {
  convexClient().catch(() => {});
}

export function money(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100);
}

export function readableDate(date, time) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' }).format(new Date(`${date}T${time}:00`));
}

export function backendMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

export function initAddressAutocomplete(input, list, { onInvalidate, onSelect } = {}) {
  let selected = null;
  let requestNumber = 0;
  let newestRenderedRequest = 0;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');

  function cachedResults(query) {
    const cached = addressCache.get(query.toLowerCase());
    if (!cached || Date.now() - cached.createdAt > ADDRESS_CACHE_TTL_MS) return null;
    return cached.results;
  }

  function renderResults(results, renderedRequest = requestNumber) {
    clearList();
    const fragment = document.createDocumentFragment();
    for (const result of results) {
      const option = document.createElement('button');
      option.type = 'button';
      option.role = 'option';
      option.textContent = result.formattedAddress;
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('click', () => setSelection({ placeId: result.placeId, address: result.formattedAddress }));
      fragment.append(option);
    }
    list.append(fragment);
    list.hidden = !results.length;
    input.setAttribute('aria-expanded', String(Boolean(results.length)));
    newestRenderedRequest = Math.max(newestRenderedRequest, renderedRequest);
  }

  function clearList() {
    list.replaceChildren();
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  function setSelection(next) {
    selected = next;
    input.value = next?.address || '';
    input.dataset.validated = next ? 'true' : 'false';
    clearList();
    if (next) onSelect?.(next);
  }

  input.addEventListener('input', async () => {
    const currentRequest = ++requestNumber;
    if (selected && input.value !== selected.address) {
      selected = null;
      input.dataset.validated = 'false';
      onInvalidate?.();
    }
    const query = input.value.trim();
    if (!query.length) return clearList();
    const cached = cachedResults(query);
    if (cached) return renderResults(cached, currentRequest);
    try {
      const client = await convexClient();
      const results = await client.action('quotes:searchAddresses', { sessionId: customerSessionId(), query });
      addressCache.set(query.toLowerCase(), { results, createdAt: Date.now() });
      if (currentRequest === requestNumber) return renderResults(results, currentRequest);

      // Do not throw away a useful completed prefix merely because the customer
      // kept typing. Show matches for the current text until its newer request
      // arrives, without allowing older responses to replace newer ones.
      const activeQuery = input.value.trim().toLowerCase();
      if (currentRequest > newestRenderedRequest && activeQuery.startsWith(query.toLowerCase())) {
        const matching = results.filter(result => result.formattedAddress.toLowerCase().startsWith(activeQuery));
        if (matching.length) renderResults(matching, currentRequest);
      }
    } catch {
      if (currentRequest === requestNumber) clearList();
    }
  });
  input.addEventListener('focus', warmPricingClient, { once: true });
  input.addEventListener('blur', () => window.setTimeout(clearList, 150));
  input.addEventListener('keydown', event => {
    const options = [...list.querySelectorAll('button')];
    if (event.key === 'ArrowDown' && options.length) { event.preventDefault(); options[0].focus(); }
    if (event.key === 'Escape') clearList();
  });

  return { getSelection: () => selected, setSelection, invalidate: () => setSelection(null) };
}
