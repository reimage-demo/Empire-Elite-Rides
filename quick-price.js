import { backendMessage, convexClient, customerSessionId, initAddressAutocomplete, money, warmPricingClient } from './pricing-client.js';

warmPricingClient();

const form = document.querySelector('#quick-price-form');
if (form) {
  const result = document.querySelector('#quick-price-result');
  const status = document.querySelector('#quick-price-status');
  const submit = form.querySelector('button[type="submit"]');
  const pickup = initAddressAutocomplete(form.elements.pickupAddress, document.querySelector('#quick-pickup-suggestions'), { onInvalidate: hideResult });
  const dropoff = initAddressAutocomplete(form.elements.dropoffAddress, document.querySelector('#quick-dropoff-suggestions'), { onInvalidate: hideResult });

  function serviceNow() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).reduce((map, part) => ({ ...map, [part.type]: part.value }), {});
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
  }
  function configureDate() {
    const now = serviceNow();
    form.elements.pickupDate.min = now.date;
    form.elements.pickupDate.value ||= now.date;
    const rounded = Math.ceil((now.hour * 60 + now.minute + 60) / 30) * 30;
    if (rounded < 1440 && form.elements.pickupDate.value === now.date) form.elements.pickupTime.value ||= `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
  }
  function hideResult() { result.hidden = true; }
  configureDate();
  form.addEventListener('change', hideResult);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const pickupValue = pickup.getSelection(), dropoffValue = dropoff.getSelection();
    if (!pickupValue || !dropoffValue) {
      status.textContent = 'Select both addresses from the suggestions before getting a price.';
      (!pickupValue ? form.elements.pickupAddress : form.elements.dropoffAddress).focus();
      return;
    }
    submit.disabled = true; result.hidden = true; status.textContent = 'Preparing your ride estimate…';
    try {
      const client = await convexClient();
      const quote = await client.action('quotes:generateHomepageQuote', { sessionId: customerSessionId(), pickup: pickupValue, dropoff: dropoffValue, pickupDate: form.elements.pickupDate.value, pickupTime: form.elements.pickupTime.value });
      if (quote.status === 'unavailable') {
        status.textContent = 'The selected pickup time is unavailable. Please choose another time.';
        return;
      }
      status.textContent = quote.status === 'confirmation_required' ? 'Availability confirmation required' : '';
      result.querySelector('[data-estimate-price]').textContent = money(quote.estimatedPriceCents);
      result.querySelector('[data-estimate-route]').textContent = `${quote.pickupAddress} → ${quote.dropoffAddress}`;
      result.querySelector('[data-estimate-when]').textContent = `${quote.pickupDate} at ${quote.pickupTime}`;
      result.querySelector('[data-estimate-distance]').textContent = `${quote.passengerMiles.toFixed(1)} passenger miles`;
      result.querySelector('[data-estimate-duration]').textContent = `About ${quote.passengerMinutes} passenger minutes`;
      const adjustments = result.querySelector('[data-estimate-adjustments]');
      adjustments.replaceChildren(...quote.customerBreakdown.map(line => { const item = document.createElement('li'); item.textContent = `${line.label}: ${money(line.amountCents)}`; return item; }));
      adjustments.hidden = !quote.customerBreakdown.length;
      result.querySelector('[data-continue-booking]').href = `booking.html?estimateId=${encodeURIComponent(quote.estimateId)}`;
      result.hidden = false;
    } catch (error) {
      status.textContent = backendMessage(error, 'We could not calculate that trip. Please try again.');
    } finally { submit.disabled = false; }
  });
}
