import { backendMessage, convexClient, customerSessionId, initAddressAutocomplete, money, warmPricingClient } from './pricing-client.js';

warmPricingClient();

const form = document.querySelector('#booking-form');
const OCCASIONS = ['Airport Transportation', 'Corporate Travel', 'Weddings', 'Special Events', 'Nights Out', 'Personal Chauffeur', 'Family Travel', 'Long-Distance Travel', 'Medical & Professional', 'Funeral Services'];

if (form) {
  const quoteMessage = document.querySelector('#quote-message');
  const formMessage = document.querySelector('#form-message');
  const quoteResult = document.querySelector('#booking-quote-result');
  const quotePlaceholder = document.querySelector('#booking-quote-placeholder');
  const quoteButton = document.querySelector('#calculate-booking-price');
  const reserveButton = document.querySelector('#reserve-button');
  const stopContainer = document.querySelector('#additional-stops');
  const stopControllers = [];
  let currentQuote = null;
  let estimateId = null;
  let expirationTimer = null;

  const pickup = initAddressAutocomplete(form.elements.pickupAddress, document.querySelector('#booking-pickup-suggestions'), { onInvalidate: invalidateQuote });
  const dropoff = initAddressAutocomplete(form.elements.dropoffAddress, document.querySelector('#booking-dropoff-suggestions'), { onInvalidate: invalidateQuote });
  const returnPickup = initAddressAutocomplete(form.elements.returnPickupAddress, document.querySelector('#return-pickup-suggestions'), { onInvalidate: invalidateQuote });
  const returnDropoff = initAddressAutocomplete(form.elements.returnDropoffAddress, document.querySelector('#return-dropoff-suggestions'), { onInvalidate: invalidateQuote });

  function newYorkToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function defaultTime() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).reduce((map, part) => ({ ...map, [part.type]: part.value }), {});
    const minutes = Math.ceil((Number(parts.hour) * 60 + Number(parts.minute) + 60) / 30) * 30;
    return minutes < 1440 ? `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` : '09:00';
  }
  function formatPhone(value) {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  function invalidateQuote() {
    if (!currentQuote && quoteResult.hidden && reserveButton.disabled) return;
    currentQuote = null;
    window.clearInterval(expirationTimer);
    quoteResult.hidden = true;
    quotePlaceholder.hidden = false;
    quotePlaceholder.querySelector('p').textContent = 'Trip details changed. Calculate an updated official price.';
    reserveButton.disabled = true;
    quoteMessage.textContent = '';
  }
  function showError(target, text) { target.className = 'form-message error'; target.textContent = text; }
  function customer() {
    return { fullName: form.elements.fullName.value.trim(), email: form.elements.email.value.trim(), phone: form.elements.phone.value, contactMethod: form.elements.contactMethod.value, eventType: form.elements.eventType.value, notes: form.elements.notes.value.trim() };
  }
  function selectedStops() { return stopControllers.map(controller => controller.getSelection()).filter(Boolean); }
  function quoteArgs() {
    const pickupValue = pickup.getSelection(), dropoffValue = dropoff.getSelection();
    if (!pickupValue || !dropoffValue) throw new Error('Select the pickup and drop-off addresses from the suggestions.');
    if (stopControllers.some(controller => !controller.getSelection())) throw new Error('Select every additional stop from the suggestions or remove the incomplete stop.');
    const isRoundTrip = form.elements.tripType.value === 'round_trip';
    let roundTripDetails;
    if (isRoundTrip) {
      const returnPickupValue = returnPickup.getSelection(), returnDropoffValue = returnDropoff.getSelection();
      if (!returnPickupValue || !returnDropoffValue || !form.elements.returnDate.value || !form.elements.returnTime.value) throw new Error('Complete and validate all return-trip details.');
      roundTripDetails = { pickup: returnPickupValue, dropoff: returnDropoffValue, date: form.elements.returnDate.value, time: form.elements.returnTime.value };
    }
    const airportEnabled = form.elements.airportService.value !== 'none';
    return {
      sessionId: customerSessionId(), estimateId: estimateId || undefined,
      pickup: pickupValue, dropoff: dropoffValue, pickupDate: form.elements.pickupDate.value, pickupTime: form.elements.pickupTime.value,
      tripType: form.elements.tripType.value, passengerCount: Number(form.elements.passengerCount.value), luggageCount: Number(form.elements.luggageCount.value),
      stops: selectedStops(), requestedWaitMinutes: Number(form.elements.requestedWaitMinutes.value), roundTripDetails,
      airportOptions: airportEnabled ? { enabled: true, direction: form.elements.airportService.value, flightNumber: form.elements.flightNumber.value.trim(), meetAndGreet: form.elements.meetAndGreet.checked, parkingEstimateCents: form.elements.airportService.value === 'pickup' ? 2000 : 0 } : undefined,
      hourlyDetails: form.elements.tripType.value === 'hourly' ? { hours: Number(form.elements.hourlyHours.value) } : undefined,
      eventOptions: ['Weddings', 'Special Events'].includes(form.elements.eventType.value) ? { enabled: true, eventType: form.elements.eventType.value } : undefined,
      promotionCode: form.elements.promotionCode.value.trim() || undefined
    };
  }

  function renderQuote(quote) {
    currentQuote = quote;
    quotePlaceholder.hidden = true; quoteResult.hidden = false;
    quoteResult.querySelector('[data-booking-total]').textContent = money(quote.finalPriceCents);
    const label = quoteResult.querySelector('[data-booking-quote-label]');
    label.textContent = quote.status === 'manual_review_required' ? 'Availability confirmation required' : 'Your confirmed quote';
    const breakdown = quoteResult.querySelector('[data-booking-breakdown]');
    breakdown.replaceChildren(...quote.customerBreakdown.map(line => {
      const row = document.createElement('div'), name = document.createElement('dt'), value = document.createElement('dd');
      name.textContent = line.label; value.textContent = money(line.amountCents); row.append(name, value); return row;
    }));
    quoteMessage.textContent = quote.status === 'rejected' ? 'The selected time is unavailable. Choose another pickup time.' : quote.status === 'manual_review_required' ? 'This price requires staff confirmation. You can submit the request now.' : 'Your trip details and price are ready.';
    reserveButton.textContent = quote.status === 'manual_review_required' ? 'Submit for Confirmation →' : 'Request Reservation →';
    reserveButton.disabled = quote.status === 'rejected';
    const expiration = quoteResult.querySelector('[data-quote-expiration]');
    const tick = () => {
      const remaining = quote.expiresAt - Date.now();
      if (remaining <= 0) { expiration.textContent = 'This quote has expired. Recalculate to continue.'; reserveButton.disabled = true; currentQuote = null; window.clearInterval(expirationTimer); }
      else expiration.textContent = `Quote expires in ${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`;
    };
    tick(); expirationTimer = window.setInterval(tick, 1000);
  }

  async function loadEstimate() {
    const id = new URLSearchParams(location.search).get('estimateId');
    if (!id) return;
    quoteMessage.textContent = 'Loading your homepage estimate…';
    try {
      const client = await convexClient();
      const estimate = await client.query('quotes:getHomepageEstimate', { estimateId: id, sessionId: customerSessionId() });
      if (!estimate || estimate.expired) { quoteMessage.textContent = 'That homepage estimate expired. Confirm the trip details and calculate a new price.'; return; }
      estimateId = estimate.estimateId;
      pickup.setSelection(estimate.pickup); dropoff.setSelection(estimate.dropoff);
      form.elements.pickupDate.value = estimate.pickupDate; form.elements.pickupTime.value = estimate.pickupTime;
      quoteMessage.textContent = 'Trip details were transferred securely. Add any options and calculate your official price.';
    } catch { quoteMessage.textContent = 'The homepage estimate could not be loaded. Enter the trip details below.'; }
  }

  form.elements.eventType.innerHTML = `<option value="">Choose an occasion</option>${OCCASIONS.map(value => `<option value="${value}">${value}</option>`).join('')}`;
  form.elements.pickupDate.min = newYorkToday(); form.elements.pickupDate.value = newYorkToday(); form.elements.pickupTime.value = defaultTime();
  form.elements.returnDate.min = newYorkToday();
  form.elements.phone.addEventListener('input', () => { form.elements.phone.value = formatPhone(form.elements.phone.value); });
  form.elements.tripType.addEventListener('change', () => {
    const roundTrip = form.elements.tripType.value === 'round_trip';
    document.querySelector('#return-fields').hidden = !roundTrip;
    document.querySelector('#hourly-field').hidden = form.elements.tripType.value !== 'hourly';
    for (const input of document.querySelectorAll('#return-fields input')) input.required = roundTrip;
    invalidateQuote();
  });
  form.addEventListener('input', event => { if (!['fullName', 'email', 'phone', 'contactMethod', 'notes', 'consent'].includes(event.target.name)) invalidateQuote(); });
  form.addEventListener('change', event => { if (!['fullName', 'email', 'phone', 'contactMethod', 'notes', 'consent'].includes(event.target.name)) invalidateQuote(); });
  document.querySelector('#add-stop').addEventListener('click', () => {
    if (stopControllers.length >= 6) return;
    const index = stopControllers.length, wrapper = document.createElement('div');
    wrapper.className = 'dynamic-stop address-field';
    wrapper.innerHTML = `<label for="stop-${index}">Additional stop ${index + 1}</label><div class="dynamic-stop-row"><input id="stop-${index}" placeholder="Start typing a full address" required><button type="button" aria-label="Remove stop ${index + 1}">Remove</button></div><div id="stop-${index}-suggestions" class="address-suggestions" role="listbox" hidden></div>`;
    stopContainer.append(wrapper);
    const controller = initAddressAutocomplete(wrapper.querySelector('input'), wrapper.querySelector('.address-suggestions'), { onInvalidate: invalidateQuote });
    stopControllers.push(controller);
    wrapper.querySelector('button').addEventListener('click', () => { const position = stopControllers.indexOf(controller); stopControllers.splice(position, 1); wrapper.remove(); invalidateQuote(); });
    invalidateQuote(); wrapper.querySelector('input').focus();
  });

  quoteButton.addEventListener('click', async () => {
    quoteButton.disabled = true; reserveButton.disabled = true; quoteMessage.textContent = 'Preparing your ride price…'; formMessage.textContent = '';
    try { const client = await convexClient(); renderQuote(await client.action('quotes:generateBookingQuote', quoteArgs())); }
    catch (error) { quoteMessage.textContent = backendMessage(error, 'We could not calculate this reservation. Review the details and try again.'); }
    finally { quoteButton.disabled = false; }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault(); formMessage.className = 'form-message'; formMessage.textContent = '';
    if (!currentQuote || currentQuote.expiresAt <= Date.now()) return showError(formMessage, 'Calculate a current official quote before continuing.');
    const details = customer();
    if (details.phone.replace(/\D/g, '').length !== 10) return showError(formMessage, 'Enter a complete 10-digit phone number.');
    reserveButton.disabled = true; reserveButton.textContent = 'Submitting request…';
    try {
      const client = await convexClient();
      const response = await client.mutation('reservations:submit', { quoteId: currentQuote.quoteId, sessionId: customerSessionId(), customer: details });
      formMessage.className = 'form-message success';
      formMessage.textContent = response.status === 'manual_review' ? `Request ${response.confirmationCode} was submitted for staff confirmation.` : `Request ${response.confirmationCode} was received with your quoted price. We’ll contact you to confirm.`;
      currentQuote = null;
    } catch (error) { showError(formMessage, backendMessage(error, 'The reservation could not be prepared. Recalculate and try again.')); reserveButton.disabled = false; }
  });
  loadEstimate();
}
