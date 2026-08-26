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

function timeLabel(value) {
  const [hourValue, minute] = value.split(':').map(Number);
  const period = hourValue >= 12 ? 'PM' : 'AM';
  const hour = hourValue % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${period}`;
}

export function initTimePicker(select, { onChange } = {}) {
  const groups = [
    { name: 'Early morning', start: 0, end: 5 },
    { name: 'Morning', start: 5, end: 12 },
    { name: 'Afternoon', start: 12, end: 17 },
    { name: 'Evening', start: 17, end: 24 }
  ];
  let unavailable = new Set();
  function renderOptions(value = select.value) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a time';
    placeholder.disabled = true;
    const groupElements = [];
    for (const group of groups) {
      const optionGroup = document.createElement('optgroup');
      optionGroup.label = group.name;
      for (let hour = group.start; hour < group.end; hour += 1) {
        for (const minute of [0, 15, 30, 45]) {
          const optionValue = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          if (unavailable.has(optionValue)) continue;
          const option = document.createElement('option');
          option.value = optionValue;
          option.textContent = timeLabel(optionValue);
          optionGroup.append(option);
        }
      }
      if (optionGroup.children.length) groupElements.push(optionGroup);
    }
    select.replaceChildren(placeholder, ...groupElements);
    select.value = value && !unavailable.has(value) ? value : '';
  }
  renderOptions('');
  function setValue(value, notify = false) {
    select.value = value || '';
    if (notify) {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  function setUnavailable(values) {
    const previous = select.value;
    unavailable = new Set(values || []);
    renderOptions(previous);
    return Boolean(previous && !select.value);
  }
  select.addEventListener('change', () => onChange?.(select.value));
  return { getValue: () => select.value, setValue, setUnavailable, focus: () => select.focus() };
}

export function readableDate(date, time) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' }).format(new Date(`${date}T${time}:00`));
}

export function backendMessage(error, fallback) {
  const message = error?.data?.message || error?.message;
  if (!message || message.includes('[CONVEX') || message.includes('Server Error')) return fallback;
  return message;
}

export function initCurrentLocation(button, addressController, status, { onResolved } = {}) {
  const label = button.querySelector('[data-location-label]');
  const addressInput = button.closest('.address-field')?.querySelector('input') || button.closest('.quick-price-card, .booking-card')?.querySelector('[name="pickupAddress"]');
  if (!navigator.geolocation) {
    button.disabled = true;
    button.title = 'Location is not available in this browser';
    return;
  }
  function position() {
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60000
    }));
  }
  function locationError(error) {
    if (error?.code === 1) return 'Location access was denied. Allow location access or enter the pickup address manually.';
    if (error?.code === 2) return 'Your current location is unavailable. Check your device settings or enter the address manually.';
    if (error?.code === 3) return 'Finding your location took too long. Try again or enter the address manually.';
    return 'We could not identify your current address. Please enter it manually.';
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('locating');
    label.textContent = 'Locating…';
    status.hidden = false;
    status.className = 'location-status';
    status.textContent = 'Finding your current pickup location…';
    try {
      const current = await position();
      const client = await convexClient();
      const place = await client.action('quotes:locateAddress', {
        sessionId: customerSessionId(),
        latitude: current.coords.latitude,
        longitude: current.coords.longitude
      });
      addressController.setSelection(place);
      status.className = 'location-status success';
      status.textContent = 'Pickup address filled from your location. Please check that it is the correct entrance.';
      onResolved?.(place);
    } catch (error) {
      status.className = 'location-status error';
      status.textContent = [1, 2, 3].includes(error?.code) ? locationError(error) : backendMessage(error, locationError(error));
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.classList.remove('locating');
      label.textContent = 'Use my location';
    }
  });
  addressInput?.addEventListener('input', () => { status.hidden = true; });
}

export function initAddressAutocomplete(input, list, { onInvalidate, onSelect } = {}) {
  let selected = null;
  let requestNumber = 0;
  let newestRenderedRequest = 0;
  let blurTimer;
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

  function cancelPendingRequests() {
    requestNumber += 1;
    newestRenderedRequest = requestNumber;
  }

  function setSelection(next) {
    window.clearTimeout(blurTimer);
    cancelPendingRequests();
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
  input.addEventListener('focus', () => window.clearTimeout(blurTimer));
  input.addEventListener('focus', warmPricingClient, { once: true });
  input.addEventListener('blur', () => {
    cancelPendingRequests();
    blurTimer = window.setTimeout(clearList, 150);
  });
  input.addEventListener('keydown', event => {
    const options = [...list.querySelectorAll('button')];
    if (event.key === 'ArrowDown' && options.length) { event.preventDefault(); options[0].focus(); }
    if (event.key === 'Escape') clearList();
  });

  return { getSelection: () => selected, setSelection, invalidate: () => setSelection(null) };
}
