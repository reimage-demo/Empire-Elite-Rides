import { backendMessage, convexClient, customerSessionId, initAddressAutocomplete, initCurrentLocation, initTimePicker, money, warmPricingClient } from './pricing-client.js';

warmPricingClient();

const form = document.querySelector('#booking-form');

if (form) {
  const quoteMessage = document.querySelector('#quote-message');
  const formMessage = document.querySelector('#form-message');
  const quoteResult = document.querySelector('#booking-quote-result');
  const quotePlaceholder = document.querySelector('#booking-quote-placeholder');
  const quoteButton = document.querySelector('#calculate-booking-price');
  const reserveButton = document.querySelector('#reserve-button');
  const paymentReturn = document.querySelector('#payment-return');
  const promotionStatus = document.querySelector('#promotion-code-status');
  const applyPromotionButton = document.querySelector('#apply-promotion-code');
  const stopContainer = document.querySelector('#additional-stops');
  const stopControllers = [];
  const bookingDateRange = form.querySelector('[data-booking-date-range]');
  const bookingPickupDateDisplay = document.querySelector('#booking-date-display');
  const bookingDropoffDateDisplay = document.querySelector('#booking-dropoff-date-display');
  const bookingAddDropoffDate = bookingDateRange.querySelector('[data-add-dropoff-date]');
  const bookingRemoveDropoffDate = bookingDateRange.querySelector('[data-remove-dropoff-date]');
  const bookingDropoffDateField = bookingDateRange.querySelector('[data-dropoff-date-field]');
  const bookingReturnTimeField = bookingDateRange.querySelector('[data-return-time-field]');
  const bookingPickupTimePicker = initTimePicker(form.elements.pickupTime, { onChange: invalidateQuote });
  const bookingReturnTimePicker = initTimePicker(form.elements.returnTime, { onChange: invalidateQuote });
  const bookingCalendar = document.querySelector('#booking-range-calendar');
  const bookingCalendarMonths = bookingCalendar.querySelector('[data-calendar-months]');
  const bookingCalendarPeriod = bookingCalendar.querySelector('[data-calendar-period]');
  const bookingCalendarInstruction = bookingCalendar.querySelector('[data-calendar-instruction]');
  const bookingPreviousMonth = bookingCalendar.querySelector('[data-calendar-previous]');
  const bookingNextMonth = bookingCalendar.querySelector('[data-calendar-next]');
  const bookingApplyDates = bookingCalendar.querySelector('[data-calendar-apply]');
  const bookingCancelDates = bookingCalendar.querySelector('[data-calendar-cancel]');
  const bookingSteps = [...form.querySelectorAll('[data-booking-step]')];
  const bookingProgress = form.querySelector('.booking-progress');
  const bookingProgressSegments = [...bookingProgress.querySelectorAll('span')];
  const bookingStepCount = form.querySelector('[data-step-count]');
  const bookingStepName = form.querySelector('[data-step-name]');
  const estimateTransferNote = form.querySelector('[data-estimate-transfer-note]');
  const bookingStepNames = ['Route', 'Vehicle', 'Schedule', 'Optional details', 'Contact', 'Review & pay'];
  const vehicleCapacity = {
    'ford-expedition-2017': { passengers: 7, luggage: 6 },
    'lincoln-nautilus-hybrid-2025': { passengers: 4, luggage: 4 }
  };
  const bookingMonthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
  const bookingDateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const bookingLongDateFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const bookingWeekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  let bookingCommittedStart = '';
  let bookingCommittedEnd = '';
  let bookingDraftStart = '';
  let bookingDraftEnd = '';
  let bookingDropoffEnabled = false;
  let bookingVisibleMonth;
  let bookingSelectionMode = 'start';
  let bookingCalendarTrigger = bookingPickupDateDisplay;
  let currentBookingStep = 0;
  let currentQuote = null;
  let estimateId = null;
  let expirationTimer = null;
  let availabilityRequest = 0;
  const pendingCheckoutKey = 'eer-pending-checkout';

  const pickup = initAddressAutocomplete(form.elements.pickupAddress, document.querySelector('#booking-pickup-suggestions'), { onInvalidate: invalidateQuote, onSelect: invalidateQuote });
  const dropoff = initAddressAutocomplete(form.elements.dropoffAddress, document.querySelector('#booking-dropoff-suggestions'), { onInvalidate: invalidateQuote });
  const returnPickup = initAddressAutocomplete(form.elements.returnPickupAddress, document.querySelector('#return-pickup-suggestions'), { onInvalidate: invalidateQuote });
  const returnDropoff = initAddressAutocomplete(form.elements.returnDropoffAddress, document.querySelector('#return-dropoff-suggestions'), { onInvalidate: invalidateQuote });
  initCurrentLocation(form.querySelector('[data-use-current-location]'), pickup, form.querySelector('[data-location-status]'));

  function newYorkToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function defaultTime() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).reduce((map, part) => ({ ...map, [part.type]: part.value }), {});
    const minutes = Math.ceil((Number(parts.hour) * 60 + Number(parts.minute) + 60) / 15) * 15;
    return minutes < 1440 ? `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` : '09:00';
  }
  function bookingDateFromIso(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }
  function bookingIsoFromDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function bookingMonthStart(date) { return new Date(date.getFullYear(), date.getMonth(), 1, 12); }
  function addBookingMonths(date, amount) { return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12); }
  function syncBookingDateInputs(notify = false) {
    form.elements.pickupDate.value = bookingCommittedStart;
    form.elements.returnDate.value = bookingDropoffEnabled ? bookingCommittedEnd : '';
    bookingPickupDateDisplay.value = bookingCommittedStart ? bookingDateFormatter.format(bookingDateFromIso(bookingCommittedStart)) : '';
    bookingDropoffDateDisplay.value = bookingDropoffEnabled && bookingCommittedEnd ? bookingDateFormatter.format(bookingDateFromIso(bookingCommittedEnd)) : '';
    if (notify) invalidateQuote();
    void refreshBookingPickupAvailability();
  }
  async function refreshBookingPickupAvailability() {
    const serviceDate = bookingCommittedStart;
    const vehicleKey = form.elements.vehicleKey.value;
    const request = ++availabilityRequest;
    if (!serviceDate || !vehicleKey) { bookingPickupTimePicker.setUnavailable([]); return; }
    try {
      const client = await convexClient();
      const availability = await client.query('bookings:availabilityForDate', { serviceDate, vehicleKey });
      if (request !== availabilityRequest || serviceDate !== bookingCommittedStart || vehicleKey !== form.elements.vehicleKey.value) return;
      const selectionRemoved = bookingPickupTimePicker.setUnavailable(availability.unavailableTimes);
      const scheduleMessage = bookingSteps[2].querySelector('[data-step-message]');
      if (availability.dayFull) setStepMessage(bookingSteps[2], "That vehicle is fully booked for this date. Please choose another vehicle, date, or time.");
      else if (selectionRemoved) setStepMessage(bookingSteps[2], 'Your previously selected pickup time is no longer available for that vehicle. Please choose another time.');
      else if (/fully booked|no longer available/i.test(scheduleMessage?.textContent || '')) setStepMessage(bookingSteps[2]);
    } catch {
      if (request === availabilityRequest) bookingPickupTimePicker.setUnavailable([]);
    }
  }
  function syncBookingDropoffUi() {
    bookingAddDropoffDate.hidden = bookingDropoffEnabled;
    bookingAddDropoffDate.setAttribute('aria-expanded', String(bookingDropoffEnabled));
    bookingDropoffDateField.hidden = !bookingDropoffEnabled;
    bookingReturnTimeField.hidden = !bookingDropoffEnabled;
    form.elements.returnTime.required = bookingDropoffEnabled;
    if (!bookingDropoffEnabled) bookingReturnTimePicker.setValue('');
  }
  function renderBookingMonth(monthDate, minimumDate) {
    const section = document.createElement('section'); section.className = 'range-calendar-month';
    const heading = document.createElement('h3'); heading.textContent = bookingMonthFormatter.format(monthDate);
    const weekdays = document.createElement('div'); weekdays.className = 'range-calendar-weekdays';
    weekdays.replaceChildren(...bookingWeekdays.map(name => { const label = document.createElement('span'); label.textContent = name; return label; }));
    const days = document.createElement('div'); days.className = 'range-calendar-days';
    for (let blank = 0; blank < monthDate.getDay(); blank += 1) { const space = document.createElement('span'); space.className = 'range-calendar-blank'; days.append(space); }
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day, 12), iso = bookingIsoFromDate(date);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'range-calendar-day'; button.textContent = String(day);
      button.setAttribute('aria-label', bookingLongDateFormatter.format(date));
      button.disabled = iso < minimumDate || (bookingDropoffEnabled && bookingSelectionMode === 'end' && bookingDraftStart && iso < bookingDraftStart);
      if (iso === minimumDate) button.classList.add('today');
      if (bookingDraftStart && bookingDraftEnd && iso > bookingDraftStart && iso < bookingDraftEnd) button.classList.add('in-range');
      if (iso === bookingDraftStart) { button.classList.add('range-start'); button.setAttribute('aria-selected', 'true'); }
      if (iso === bookingDraftEnd) { button.classList.add('range-end'); button.setAttribute('aria-selected', 'true'); }
      button.addEventListener('click', () => selectBookingDate(iso));
      days.append(button);
    }
    section.append(heading, weekdays, days); return section;
  }
  function renderBookingCalendar() {
    const minimumDate = newYorkToday(), secondMonth = addBookingMonths(bookingVisibleMonth, 1);
    bookingCalendarMonths.replaceChildren(renderBookingMonth(bookingVisibleMonth, minimumDate), renderBookingMonth(secondMonth, minimumDate));
    bookingCalendarPeriod.textContent = `${bookingMonthFormatter.format(bookingVisibleMonth)} – ${bookingMonthFormatter.format(secondMonth)}`;
    bookingPreviousMonth.disabled = bookingVisibleMonth <= bookingMonthStart(bookingDateFromIso(minimumDate));
    const complete = Boolean(bookingDraftStart && (!bookingDropoffEnabled || bookingDraftEnd));
    bookingCalendarInstruction.textContent = !bookingDraftStart ? 'Choose your pickup date.' : bookingDropoffEnabled && !bookingDraftEnd ? 'Choose your return date.' : `Date${bookingDropoffEnabled ? 's' : ''} selected. Press ✓ Apply to confirm.`;
    bookingApplyDates.disabled = !complete;
    bookingApplyDates.innerHTML = `<span aria-hidden="true">✓</span> Apply date${bookingDropoffEnabled ? 's' : ''}`;
  }
  function closeBookingCalendar(restoreFocus = false) {
    if (bookingCalendar.hidden) return;
    bookingCalendar.hidden = true;
    bookingPickupDateDisplay.setAttribute('aria-expanded', 'false');
    bookingDropoffDateDisplay.setAttribute('aria-expanded', 'false');
    if (restoreFocus) bookingCalendarTrigger.focus();
  }
  function openBookingCalendar(mode, trigger) {
    bookingSelectionMode = mode; bookingCalendarTrigger = trigger;
    bookingDraftStart = bookingCommittedStart; bookingDraftEnd = bookingDropoffEnabled ? bookingCommittedEnd : '';
    const anchor = mode === 'end' && bookingDraftEnd ? bookingDraftEnd : bookingDraftStart || newYorkToday();
    bookingVisibleMonth = bookingMonthStart(bookingDateFromIso(anchor));
    renderBookingCalendar(); bookingCalendar.hidden = false;
    bookingPickupDateDisplay.setAttribute('aria-expanded', String(trigger === bookingPickupDateDisplay));
    bookingDropoffDateDisplay.setAttribute('aria-expanded', String(trigger === bookingDropoffDateDisplay));
  }
  function selectBookingDate(iso) {
    if (bookingSelectionMode === 'start') {
      bookingDraftStart = iso; bookingDraftEnd = '';
      if (bookingDropoffEnabled) bookingSelectionMode = 'end';
      renderBookingCalendar(); return;
    }
    if (!bookingDraftStart || iso < bookingDraftStart) { bookingDraftStart = iso; bookingDraftEnd = ''; bookingSelectionMode = 'end'; renderBookingCalendar(); return; }
    bookingDraftEnd = iso; renderBookingCalendar();
  }
  function applyBookingDates() {
    if (!bookingDraftStart || (bookingDropoffEnabled && !bookingDraftEnd)) return;
    bookingCommittedStart = bookingDraftStart; bookingCommittedEnd = bookingDropoffEnabled ? bookingDraftEnd : '';
    syncBookingDateInputs(true); closeBookingCalendar();
  }
  function setBookingDates(pickupDate, dropoffDate = '', notify = false) {
    bookingCommittedStart = pickupDate || newYorkToday(); bookingCommittedEnd = dropoffDate;
    bookingDropoffEnabled = Boolean(dropoffDate); bookingVisibleMonth = bookingMonthStart(bookingDateFromIso(bookingCommittedStart));
    syncBookingDropoffUi(); syncBookingDateInputs(notify);
  }
  function setBookingDropoffEnabled(enabled, notify = false) {
    bookingDropoffEnabled = enabled;
    if (!enabled) bookingCommittedEnd = '';
    syncBookingDropoffUi(); syncBookingDateInputs(notify);
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
  function setStepMessage(step, message = '') {
    step.querySelector('[data-step-message]')?.replaceChildren(message);
  }
  function firstInvalidControl(step) {
    return [...step.querySelectorAll('input, select, textarea')].find(control => control.type !== 'hidden' && !control.disabled && !control.checkValidity());
  }
  function validateBookingStep(index) {
    const step = bookingSteps[index];
    setStepMessage(step);
    if (index === 2 && (!bookingCommittedStart || (bookingDropoffEnabled && !bookingCommittedEnd))) {
      setStepMessage(step, bookingDropoffEnabled ? 'Choose and apply the return date before continuing.' : 'Choose and apply the pickup date before continuing.');
      openBookingCalendar(bookingDropoffEnabled && bookingCommittedStart ? 'end' : 'start', bookingDropoffEnabled && bookingCommittedStart ? bookingDropoffDateDisplay : bookingPickupDateDisplay);
      return false;
    }
    if (index === 2 && (!bookingPickupTimePicker.getValue() || (bookingDropoffEnabled && !bookingReturnTimePicker.getValue()))) {
      const missingPickupTime = !bookingPickupTimePicker.getValue();
      setStepMessage(step, missingPickupTime ? 'Choose a pickup time before continuing.' : 'Choose a return time before continuing.');
      (missingPickupTime ? bookingPickupTimePicker : bookingReturnTimePicker).focus();
      return false;
    }
    const invalidControl = firstInvalidControl(step);
    if (invalidControl) {
      setStepMessage(step, 'Complete the required information before continuing.');
      invalidControl.reportValidity();
      return false;
    }
    if (index === 0) {
      const pickupValue = pickup.getSelection();
      const dropoffValue = dropoff.getSelection();
      if (!pickupValue || !dropoffValue) {
        setStepMessage(step, 'Select both addresses from the suggestions before continuing.');
        (!pickupValue ? form.elements.pickupAddress : form.elements.dropoffAddress).focus();
        return false;
      }
      const incompleteStop = stopControllers.find(controller => !controller.getSelection());
      if (incompleteStop) {
        setStepMessage(step, 'Select every added stop from the suggestions or remove it.');
        return false;
      }
    }
    if (index === 2) {
      if (form.elements.tripType.value === 'round_trip') {
        const returnPickupValue = returnPickup.getSelection();
        const returnDropoffValue = returnDropoff.getSelection();
        if (!returnPickupValue || !returnDropoffValue) {
          setStepMessage(step, 'Select both return-trip addresses from the suggestions before continuing.');
          (!returnPickupValue ? form.elements.returnPickupAddress : form.elements.returnDropoffAddress).focus();
          return false;
        }
      }
    }
    if (index === 4 && form.elements.phone.value.replace(/\D/g, '').length !== 10) {
      setStepMessage(step, 'Enter a complete 10-digit phone number before continuing.');
      form.elements.phone.focus();
      return false;
    }
    return true;
  }
  function showBookingStep(index, { focus = true, autoPrice = true } = {}) {
    currentBookingStep = Math.max(0, Math.min(index, bookingSteps.length - 1));
    bookingSteps.forEach((step, stepIndex) => { step.hidden = stepIndex !== currentBookingStep; });
    bookingProgressSegments.forEach((segment, stepIndex) => {
      segment.classList.toggle('active', stepIndex === currentBookingStep);
      segment.classList.toggle('complete', stepIndex < currentBookingStep);
    });
    bookingStepCount.textContent = `Step ${currentBookingStep + 1} of ${bookingSteps.length}`;
    bookingStepName.textContent = bookingStepNames[currentBookingStep];
    bookingProgress.setAttribute('aria-valuenow', String(currentBookingStep + 1));
    if (focus) {
      form.querySelector('.booking-flow-header').scrollIntoView({ block: 'start' });
      bookingSteps[currentBookingStep].querySelector('h2')?.focus({ preventScroll: true });
    }
    if (autoPrice && currentBookingStep === bookingSteps.length - 1 && !currentQuote) void calculateQuote();
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
    if (airportEnabled && (!form.elements.airline.value || !form.elements.flightNumber.value.trim())) throw new Error('Choose the airline and enter the flight number.');
    return {
      sessionId: customerSessionId(), estimateId: estimateId || undefined,
      vehicleKey: form.elements.vehicleKey.value,
      pickup: pickupValue, dropoff: dropoffValue, pickupDate: form.elements.pickupDate.value, pickupTime: form.elements.pickupTime.value,
      tripType: form.elements.tripType.value, passengerCount: Number(form.elements.passengerCount.value), luggageCount: Number(form.elements.luggageCount.value),
      stops: selectedStops(), requestedWaitMinutes: Number(form.elements.requestedWaitMinutes.value), roundTripDetails,
      airportOptions: airportEnabled ? { enabled: true, direction: form.elements.airportService.value, airline: form.elements.airline.value, flightNumber: form.elements.flightNumber.value.trim().toUpperCase() } : undefined,
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
    quoteResult.querySelector('[data-booking-vehicle]').textContent = quote.vehicle ? `Reserved vehicle: ${quote.vehicle.name}` : '';
    const promotionLine = quoteResult.querySelector('[data-booking-promotion]');
    if (quote.promotion && quote.discountCents > 0) {
      promotionLine.textContent = `${quote.promotion.name}: you save ${money(quote.discountCents)}.`;
      promotionLine.hidden = false;
      promotionStatus.className = 'promotion-code-status success';
      promotionStatus.textContent = quote.promotion.kind === 'code' ? `Code ${quote.promotion.code} applied.` : `${quote.promotion.name} applied automatically.`;
    } else {
      promotionLine.hidden = true;
      promotionStatus.className = 'promotion-code-status';
      promotionStatus.textContent = form.elements.promotionCode.value.trim() ? 'The entered code was not applied.' : '';
    }
    const breakdown = quoteResult.querySelector('[data-booking-breakdown]');
    breakdown.replaceChildren(...quote.customerBreakdown.map(line => {
      const row = document.createElement('div'), name = document.createElement('dt'), value = document.createElement('dd');
      name.textContent = line.label; value.textContent = money(line.amountCents); row.append(name, value); return row;
    }));
    quoteMessage.textContent = quote.status === 'rejected'
      ? quote.availabilityReason === 'day_full'
        ? "We're fully booked for this date. Please choose another date."
        : 'That pickup window is fully booked. Please choose a different time.'
      : quote.status === 'manual_review_required' ? 'This price requires staff confirmation. You can submit the request now.' : 'Your trip details and price are ready.';
    reserveButton.textContent = quote.status === 'manual_review_required' ? 'Submit for Confirmation →' : `Pay ${money(quote.finalPriceCents)} Securely →`;
    reserveButton.disabled = quote.status === 'rejected';
    const expiration = quoteResult.querySelector('[data-quote-expiration]');
    const tick = () => {
      const remaining = quote.expiresAt - Date.now();
      if (remaining <= 0) { expiration.textContent = 'This quote has expired. Recalculate to continue.'; reserveButton.disabled = true; currentQuote = null; window.clearInterval(expirationTimer); }
      else expiration.textContent = `Quote expires in ${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`;
    };
    tick(); expirationTimer = window.setInterval(tick, 1000);
  }

  async function calculateQuote() {
    quoteButton.disabled = true; applyPromotionButton.disabled = true; reserveButton.disabled = true; quoteMessage.textContent = 'Preparing your ride price…'; formMessage.textContent = '';
    try {
      const client = await convexClient();
      renderQuote(await client.action('quotes:generateBookingQuote', quoteArgs()));
    } catch (error) {
      const message = backendMessage(error, 'We could not calculate this reservation. Review the details and try again.');
      quoteMessage.textContent = message;
      if (form.elements.promotionCode.value.trim()) { promotionStatus.className = 'promotion-code-status error'; promotionStatus.textContent = message; }
    } finally { quoteButton.disabled = false; applyPromotionButton.disabled = false; }
  }

  function validCheckoutUrl(value) {
    try { return new URL(value).origin === 'https://checkout.stripe.com'; }
    catch { return false; }
  }

  function showPaymentReturn(kind, title, message, checkoutUrl) {
    paymentReturn.className = `payment-return ${kind}`;
    paymentReturn.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = title;
    const copy = document.createElement('p'); copy.textContent = message;
    paymentReturn.append(heading, copy);
    if (checkoutUrl && validCheckoutUrl(checkoutUrl)) {
      const link = document.createElement('a'); link.href = checkoutUrl; link.textContent = 'Return to secure checkout';
      paymentReturn.append(link);
    }
    paymentReturn.hidden = false;
  }

  async function handlePaymentReturn() {
    const params = new URLSearchParams(location.search);
    const state = params.get('payment');
    if (state === 'cancelled') {
      let pending = null;
      try { pending = JSON.parse(sessionStorage.getItem(pendingCheckoutKey) || 'null'); } catch { /* ignore invalid browser state */ }
      showPaymentReturn('cancelled', 'Payment was canceled', 'No completed payment was recorded. You may return to the secure Stripe checkout while this reservation hold remains open.', pending?.checkoutUrl);
      return;
    }
    if (state !== 'success') return;
    const checkoutSessionId = params.get('checkout_session_id');
    if (!checkoutSessionId) return showPaymentReturn('cancelled', 'Payment status unavailable', 'Please contact us with your Stripe receipt so we can verify the reservation.');
    showPaymentReturn('success', 'Confirming your payment…', 'Stripe returned you safely. We are waiting for the verified payment notification.');
    try {
      const client = await convexClient();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const status = await client.query('paymentRecords:checkoutStatus', { checkoutSessionId, sessionId: customerSessionId() });
        if (status?.paymentStatus === 'paid') {
          sessionStorage.removeItem(pendingCheckoutKey);
          showPaymentReturn('success', 'Payment received', `Reservation ${status.confirmationCode} is paid in full for ${money(status.amountCents)}. Our team has received it and will follow up with your service details.`);
          return;
        }
        await new Promise(resolve => window.setTimeout(resolve, 1250));
      }
      showPaymentReturn('success', 'Payment is processing', 'Your return from Stripe was received, but only the verified Stripe notification can mark the booking paid. Refresh this page shortly or contact us if this message remains.');
    } catch {
      showPaymentReturn('success', 'Payment verification pending', 'We could not display the verified status yet. Keep your Stripe receipt and contact us if you need immediate confirmation.');
    }
  }

  async function loadEstimate() {
    const searchParams = new URLSearchParams(location.search);
    const id = searchParams.get('estimateId');
    if (!id) return;
    quoteMessage.textContent = 'Loading your homepage estimate…';
    try {
      const client = await convexClient();
      const estimate = await client.query('quotes:getHomepageEstimate', { estimateId: id, sessionId: customerSessionId() });
      if (!estimate || estimate.expired) { quoteMessage.textContent = 'That homepage estimate expired. Confirm the trip details and calculate a new price.'; return; }
      estimateId = estimate.estimateId;
      pickup.setSelection(estimate.pickup); dropoff.setSelection(estimate.dropoff);
      setBookingDates(estimate.pickupDate, estimate.dropoffDate || '');
      if (estimate.dropoffDate) {
        form.elements.tripType.value = 'round_trip';
        setRoundTripMode(true, { syncDatePicker: false, notify: false });
        returnPickup.setSelection(estimate.dropoff);
        returnDropoff.setSelection(estimate.pickup);
      }
      bookingPickupTimePicker.setValue(estimate.pickupTime);
      const returnTime = searchParams.get('returnTime') || '';
      if (estimate.dropoffDate) bookingReturnTimePicker.setValue(returnTime);
      estimateTransferNote.hidden = false;
      showBookingStep(1, { focus: false, autoPrice: false });
      quoteMessage.textContent = 'Trip details were transferred securely. Choose your vehicle to continue.';
    } catch {
      quoteMessage.textContent = 'The homepage estimate could not be loaded. Enter the trip details below.';
      showBookingStep(0, { focus: false, autoPrice: false });
    }
  }

  function setRoundTripMode(roundTrip, { syncDatePicker = true, notify = true } = {}) {
    document.querySelector('#return-fields').hidden = !roundTrip;
    for (const input of document.querySelectorAll('#return-fields input')) input.required = roundTrip;
    form.elements.returnTime.required = roundTrip;
    if (syncDatePicker) setBookingDropoffEnabled(roundTrip);
    if (notify) invalidateQuote();
  }
  function syncAirportDetails() {
    const enabled = form.elements.airportService.value !== 'none';
    form.querySelectorAll('[data-airport-detail]').forEach(field => { field.hidden = !enabled; });
    form.elements.airline.required = enabled;
    form.elements.flightNumber.required = enabled;
    if (!enabled) {
      form.elements.airline.value = '';
      form.elements.flightNumber.value = '';
    }
  }
  function syncVehicleCapacity() {
    const limits = vehicleCapacity[form.elements.vehicleKey.value];
    if (!limits) return;
    form.elements.passengerCount.max = String(limits.passengers);
    form.elements.luggageCount.max = String(limits.luggage);
    form.elements.passengerCount.value = String(Math.min(Number(form.elements.passengerCount.value), limits.passengers));
    form.elements.luggageCount.value = String(Math.min(Number(form.elements.luggageCount.value), limits.luggage));
  }

  setBookingDates(newYorkToday()); bookingPickupTimePicker.setValue(defaultTime()); syncAirportDetails(); syncVehicleCapacity();
  bookingAddDropoffDate.addEventListener('click', () => {
    form.elements.tripType.value = 'round_trip';
    setRoundTripMode(true, { syncDatePicker: false, notify: false });
    setBookingDropoffEnabled(true, true);
    openBookingCalendar('end', bookingDropoffDateDisplay);
  });
  bookingRemoveDropoffDate.addEventListener('click', () => {
    form.elements.tripType.value = 'one_way';
    setBookingDropoffEnabled(false, true);
    setRoundTripMode(false, { syncDatePicker: false, notify: false });
    closeBookingCalendar(); bookingAddDropoffDate.focus();
  });
  bookingPickupDateDisplay.addEventListener('click', () => openBookingCalendar('start', bookingPickupDateDisplay));
  bookingDropoffDateDisplay.addEventListener('click', () => openBookingCalendar('end', bookingDropoffDateDisplay));
  bookingPickupDateDisplay.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openBookingCalendar('start', bookingPickupDateDisplay); } });
  bookingDropoffDateDisplay.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openBookingCalendar('end', bookingDropoffDateDisplay); } });
  bookingPreviousMonth.addEventListener('click', () => { bookingVisibleMonth = addBookingMonths(bookingVisibleMonth, -1); renderBookingCalendar(); });
  bookingNextMonth.addEventListener('click', () => { bookingVisibleMonth = addBookingMonths(bookingVisibleMonth, 1); renderBookingCalendar(); });
  bookingCalendar.querySelector('.range-calendar-close').addEventListener('click', () => closeBookingCalendar(true));
  bookingCancelDates.addEventListener('click', () => closeBookingCalendar(true));
  bookingApplyDates.addEventListener('click', applyBookingDates);
  document.addEventListener('pointerdown', event => { if (!bookingCalendar.hidden && !event.target.closest('[data-booking-date-range]')) closeBookingCalendar(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeBookingCalendar(true); });
  form.elements.phone.addEventListener('input', () => { form.elements.phone.value = formatPhone(form.elements.phone.value); });
  form.elements.promotionCode.addEventListener('input', () => { form.elements.promotionCode.value = form.elements.promotionCode.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); });
  form.elements.tripType.addEventListener('change', () => {
    const roundTrip = form.elements.tripType.value === 'round_trip';
    setRoundTripMode(roundTrip);
    document.querySelector('#hourly-field').hidden = form.elements.tripType.value !== 'hourly';
  });
  form.elements.airportService.addEventListener('change', () => { syncAirportDetails(); invalidateQuote(); });
  [...form.querySelectorAll('[name="vehicleKey"]')].forEach(control => control.addEventListener('change', () => {
    syncVehicleCapacity();
    void refreshBookingPickupAvailability();
    invalidateQuote();
  }));
  form.addEventListener('click', event => {
    if (event.target.closest('[data-step-back]')) {
      showBookingStep(currentBookingStep - 1);
      return;
    }
    if (event.target.closest('[data-step-skip]')) {
      showBookingStep(currentBookingStep + 1);
      return;
    }
    if (event.target.closest('[data-step-next]') && validateBookingStep(currentBookingStep)) showBookingStep(currentBookingStep + 1);
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

  quoteButton.addEventListener('click', calculateQuote);
  applyPromotionButton.addEventListener('click', calculateQuote);

  form.addEventListener('submit', async event => {
    event.preventDefault(); formMessage.className = 'form-message'; formMessage.textContent = '';
    if (!currentQuote || currentQuote.expiresAt <= Date.now()) return showError(formMessage, 'Calculate a current official quote before continuing.');
    const details = customer();
    if (details.phone.replace(/\D/g, '').length !== 10) return showError(formMessage, 'Enter a complete 10-digit phone number.');
    reserveButton.disabled = true; reserveButton.textContent = currentQuote.status === 'manual_review_required' ? 'Submitting request…' : 'Opening secure checkout…';
    try {
      const client = await convexClient();
      if (currentQuote.status === 'manual_review_required') {
        const response = await client.mutation('reservations:submit', { quoteId: currentQuote.quoteId, sessionId: customerSessionId(), customer: details });
        formMessage.className = 'form-message success';
        formMessage.textContent = `Request ${response.confirmationCode} was submitted for staff confirmation. No payment was taken.`;
        currentQuote = null;
      } else {
        const response = await client.action('payments:createCheckout', {
          quoteId: currentQuote.quoteId,
          sessionId: customerSessionId(),
          returnOrigin: location.origin,
          customer: details
        });
        if (!validCheckoutUrl(response.checkoutUrl)) throw new Error('Stripe returned an invalid checkout address.');
        sessionStorage.setItem(pendingCheckoutKey, JSON.stringify({
          checkoutUrl: response.checkoutUrl,
          checkoutSessionId: response.checkoutSessionId,
          confirmationCode: response.confirmationCode,
          testMode: response.testMode
        }));
        location.assign(response.checkoutUrl);
      }
    } catch (error) {
      showError(formMessage, backendMessage(error, 'Secure payment could not be opened. Your card was not charged; please try again.'));
      reserveButton.disabled = false;
      reserveButton.textContent = currentQuote?.status === 'manual_review_required' ? 'Submit for Confirmation →' : currentQuote ? `Pay ${money(currentQuote.finalPriceCents)} Securely →` : 'Recalculate to Continue →';
    }
  });
  const returningFromPayment = new URLSearchParams(location.search).has('payment');
  showBookingStep(returningFromPayment ? bookingSteps.length - 1 : 0, { focus: false, autoPrice: false });
  void handlePaymentReturn();
  loadEstimate();
}
