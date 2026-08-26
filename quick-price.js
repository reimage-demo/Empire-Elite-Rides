import { backendMessage, convexClient, customerSessionId, initAddressAutocomplete, initCurrentLocation, initTimePicker, money, warmPricingClient } from './pricing-client.js';

warmPricingClient();

const form = document.querySelector('#quick-price-form');
if (form) {
  const result = document.querySelector('#quick-price-result');
  const status = document.querySelector('#quick-price-status');
  const submit = form.querySelector('button[type="submit"]');
  const pickup = initAddressAutocomplete(form.elements.pickupAddress, document.querySelector('#quick-pickup-suggestions'), { onInvalidate: hideResult, onSelect: hideResult });
  const dropoff = initAddressAutocomplete(form.elements.dropoffAddress, document.querySelector('#quick-dropoff-suggestions'), { onInvalidate: hideResult });
  const quickPriceCard = form.closest('.quick-price-card');
  initCurrentLocation(quickPriceCard.querySelector('[data-use-current-location]'), pickup, quickPriceCard.querySelector('[data-location-status]'));
  const pickupDateDisplay = document.querySelector('#quick-date-display');
  const dropoffDateDisplay = document.querySelector('#quick-dropoff-date-display');
  const addDropoffDateButton = form.querySelector('[data-add-dropoff-date]');
  const removeDropoffDateButton = form.querySelector('[data-remove-dropoff-date]');
  const dropoffDateField = form.querySelector('[data-dropoff-date-field]');
  const returnTimeField = form.querySelector('[data-return-time-field]');
  const pickupTimePicker = initTimePicker(form.elements.pickupTime, { onChange: hideResult });
  const returnTimePicker = initTimePicker(form.elements.returnTime, { onChange: hideResult });
  const calendar = document.querySelector('#quick-range-calendar');
  const calendarMonths = calendar.querySelector('[data-calendar-months]');
  const calendarPeriod = calendar.querySelector('[data-calendar-period]');
  const calendarInstruction = document.querySelector('#quick-range-calendar-instruction');
  const previousMonthButton = calendar.querySelector('[data-calendar-previous]');
  const nextMonthButton = calendar.querySelector('[data-calendar-next]');
  const applyCalendarButton = calendar.querySelector('[data-calendar-apply]');
  const cancelCalendarButton = calendar.querySelector('[data-calendar-cancel]');
  const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
  const displayDateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const longDateFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const weekdayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  let committedStart = '';
  let committedEnd = '';
  let draftStart = '';
  let draftEnd = '';
  let dropoffEnabled = false;
  let visibleMonth;
  let selectionMode = 'start';
  let calendarTrigger = pickupDateDisplay;
  let availabilityRequest = 0;

  function serviceNow() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).reduce((map, part) => ({ ...map, [part.type]: part.value }), {});
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
  }
  function dateFromIso(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }
  function isoFromDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function monthStart(date) { return new Date(date.getFullYear(), date.getMonth(), 1, 12); }
  function addMonths(date, amount) { return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12); }
  function syncDateInputs(notify = false) {
    form.elements.pickupDate.value = committedStart;
    form.elements.dropoffDate.value = dropoffEnabled ? committedEnd : '';
    pickupDateDisplay.value = committedStart ? displayDateFormatter.format(dateFromIso(committedStart)) : '';
    dropoffDateDisplay.value = dropoffEnabled && committedEnd ? displayDateFormatter.format(dateFromIso(committedEnd)) : '';
    if (notify) hideResult();
    void refreshPickupAvailability();
  }
  async function refreshPickupAvailability() {
    const serviceDate = committedStart;
    const request = ++availabilityRequest;
    if (!serviceDate) { pickupTimePicker.setUnavailable([]); return; }
    try {
      const client = await convexClient();
      const availability = await client.query('bookings:availabilityForDate', { serviceDate });
      if (request !== availabilityRequest || serviceDate !== committedStart) return;
      const selectionRemoved = pickupTimePicker.setUnavailable(availability.unavailableTimes);
      if (availability.dayFull) status.textContent = "We're fully booked for this date. Please choose another date.";
      else if (selectionRemoved) status.textContent = 'Your previously selected pickup time is no longer available. Please choose another time.';
      else if (/fully booked|no longer available/i.test(status.textContent)) status.textContent = '';
    } catch {
      if (request === availabilityRequest) pickupTimePicker.setUnavailable([]);
    }
  }
  function syncDropoffUi() {
    addDropoffDateButton.hidden = dropoffEnabled;
    addDropoffDateButton.setAttribute('aria-expanded', String(dropoffEnabled));
    dropoffDateField.hidden = !dropoffEnabled;
    returnTimeField.hidden = !dropoffEnabled;
    form.elements.returnTime.required = dropoffEnabled;
    if (!dropoffEnabled) returnTimePicker.setValue('');
  }
  function renderMonth(monthDate, minimumDate) {
    const section = document.createElement('section'); section.className = 'range-calendar-month';
    const heading = document.createElement('h3'); heading.textContent = monthFormatter.format(monthDate);
    const weekdays = document.createElement('div'); weekdays.className = 'range-calendar-weekdays';
    weekdays.replaceChildren(...weekdayNames.map(name => { const label = document.createElement('span'); label.textContent = name; return label; }));
    const days = document.createElement('div'); days.className = 'range-calendar-days';
    for (let blank = 0; blank < monthDate.getDay(); blank += 1) { const space = document.createElement('span'); space.className = 'range-calendar-blank'; days.append(space); }
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day, 12);
      const iso = isoFromDate(date);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'range-calendar-day'; button.textContent = String(day);
      button.setAttribute('aria-label', longDateFormatter.format(date));
      button.disabled = iso < minimumDate || (dropoffEnabled && selectionMode === 'end' && draftStart && iso < draftStart);
      if (iso === minimumDate) button.classList.add('today');
      if (draftStart && draftEnd && iso > draftStart && iso < draftEnd) button.classList.add('in-range');
      if (iso === draftStart) { button.classList.add('range-start'); button.setAttribute('aria-selected', 'true'); }
      if (iso === draftEnd) { button.classList.add('range-end'); button.setAttribute('aria-selected', 'true'); }
      button.addEventListener('click', () => selectDate(iso));
      days.append(button);
    }
    section.append(heading, weekdays, days);
    return section;
  }
  function renderCalendar() {
    const minimumDate = serviceNow().date;
    const secondMonth = addMonths(visibleMonth, 1);
    calendarMonths.replaceChildren(renderMonth(visibleMonth, minimumDate), renderMonth(secondMonth, minimumDate));
    calendarPeriod.textContent = `${monthFormatter.format(visibleMonth)} – ${monthFormatter.format(secondMonth)}`;
    previousMonthButton.disabled = visibleMonth <= monthStart(dateFromIso(minimumDate));
    const selectionComplete = Boolean(draftStart && (!dropoffEnabled || draftEnd));
    calendarInstruction.textContent = !draftStart ? 'Choose your pickup date.' : dropoffEnabled && !draftEnd ? 'Choose your return date.' : `Date${dropoffEnabled ? 's' : ''} selected. Press ✓ Apply to confirm.`;
    applyCalendarButton.disabled = !selectionComplete;
    applyCalendarButton.innerHTML = `<span aria-hidden="true">✓</span> Apply date${dropoffEnabled ? 's' : ''}`;
  }
  function closeCalendar(restoreFocus = false) {
    if (calendar.hidden) return;
    calendar.hidden = true;
    pickupDateDisplay.setAttribute('aria-expanded', 'false');
    dropoffDateDisplay.setAttribute('aria-expanded', 'false');
    if (restoreFocus) calendarTrigger.focus();
  }
  function openCalendar(mode, trigger) {
    selectionMode = mode;
    calendarTrigger = trigger;
    draftStart = committedStart;
    draftEnd = dropoffEnabled ? committedEnd : '';
    const anchor = mode === 'end' && draftEnd ? draftEnd : draftStart || serviceNow().date;
    visibleMonth = monthStart(dateFromIso(anchor));
    renderCalendar();
    calendar.hidden = false;
    pickupDateDisplay.setAttribute('aria-expanded', String(trigger === pickupDateDisplay));
    dropoffDateDisplay.setAttribute('aria-expanded', String(trigger === dropoffDateDisplay));
  }
  function selectDate(iso) {
    if (selectionMode === 'start') {
      draftStart = iso;
      draftEnd = '';
      if (dropoffEnabled) selectionMode = 'end';
      renderCalendar();
      return;
    }
    if (!draftStart || iso < draftStart) {
      draftStart = iso;
      draftEnd = '';
      selectionMode = 'end';
      renderCalendar();
      return;
    }
    draftEnd = iso;
    renderCalendar();
  }
  function applyCalendar() {
    if (!draftStart || (dropoffEnabled && !draftEnd)) return;
    committedStart = draftStart;
    committedEnd = dropoffEnabled ? draftEnd : '';
    syncDateInputs(true);
    closeCalendar();
  }
  function configureDate() {
    const now = serviceNow();
    committedStart = now.date;
    committedEnd = '';
    visibleMonth = monthStart(dateFromIso(now.date));
    syncDropoffUi();
    syncDateInputs();
    const rounded = Math.ceil((now.hour * 60 + now.minute + 60) / 15) * 15;
    if (rounded < 1440 && committedStart === now.date && !pickupTimePicker.getValue()) pickupTimePicker.setValue(`${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`);
  }
  function hideResult() { result.hidden = true; }
  configureDate();
  addDropoffDateButton.addEventListener('click', () => {
    dropoffEnabled = true;
    committedEnd = '';
    syncDropoffUi();
    syncDateInputs(true);
    openCalendar('end', dropoffDateDisplay);
  });
  removeDropoffDateButton.addEventListener('click', () => {
    dropoffEnabled = false;
    committedEnd = '';
    syncDropoffUi();
    syncDateInputs(true);
    closeCalendar();
    addDropoffDateButton.focus();
  });
  pickupDateDisplay.addEventListener('click', () => openCalendar('start', pickupDateDisplay));
  dropoffDateDisplay.addEventListener('click', () => openCalendar('end', dropoffDateDisplay));
  pickupDateDisplay.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openCalendar('start', pickupDateDisplay); } });
  dropoffDateDisplay.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openCalendar('end', dropoffDateDisplay); } });
  previousMonthButton.addEventListener('click', () => { visibleMonth = addMonths(visibleMonth, -1); renderCalendar(); });
  nextMonthButton.addEventListener('click', () => { visibleMonth = addMonths(visibleMonth, 1); renderCalendar(); });
  calendar.querySelector('.range-calendar-close').addEventListener('click', () => closeCalendar(true));
  cancelCalendarButton.addEventListener('click', () => closeCalendar(true));
  applyCalendarButton.addEventListener('click', applyCalendar);
  document.addEventListener('pointerdown', event => { if (!calendar.hidden && !event.target.closest('[data-date-range]')) closeCalendar(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCalendar(true); });
  form.addEventListener('change', hideResult);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const pickupValue = pickup.getSelection(), dropoffValue = dropoff.getSelection();
    if (!pickupValue || !dropoffValue) {
      status.textContent = 'Select both addresses from the suggestions before getting a price.';
      (!pickupValue ? form.elements.pickupAddress : form.elements.dropoffAddress).focus();
      return;
    }
    if (!pickupTimePicker.getValue() || (dropoffEnabled && !returnTimePicker.getValue())) {
      status.textContent = !pickupTimePicker.getValue() ? 'Choose a pickup time before getting a price.' : 'Choose a return time before getting a price.';
      (!pickupTimePicker.getValue() ? pickupTimePicker : returnTimePicker).focus();
      return;
    }
    if (!committedStart || (dropoffEnabled && !committedEnd)) {
      status.textContent = dropoffEnabled ? 'Choose and apply a return date before getting a price.' : 'Choose and apply a pickup date before getting a price.';
      openCalendar(dropoffEnabled && committedStart ? 'end' : 'start', dropoffEnabled && committedStart ? dropoffDateDisplay : pickupDateDisplay);
      return;
    }
    submit.disabled = true; result.hidden = true; status.textContent = 'Preparing your ride estimate…';
    try {
      const client = await convexClient();
      const quoteArgs = { sessionId: customerSessionId(), pickup: pickupValue, dropoff: dropoffValue, pickupDate: committedStart, pickupTime: form.elements.pickupTime.value };
      if (dropoffEnabled && committedEnd) quoteArgs.dropoffDate = committedEnd;
      const quote = await client.action('quotes:generateHomepageQuote', quoteArgs);
      if (quote.status === 'unavailable') {
        status.textContent = quote.availabilityReason === 'day_full'
          ? "We're fully booked for this date. Please choose another date."
          : 'That pickup window is fully booked. Please choose a different time.';
        return;
      }
      status.textContent = quote.status === 'confirmation_required' ? 'Availability confirmation required' : '';
      result.querySelector('[data-estimate-price]').textContent = money(quote.estimatedPriceCents);
      result.querySelector('[data-estimate-route]').textContent = `${quote.pickupAddress} → ${quote.dropoffAddress}`;
      const pickupSummary = `${displayDateFormatter.format(dateFromIso(quote.pickupDate))} at ${quote.pickupTime}`;
      result.querySelector('[data-estimate-when]').textContent = quote.dropoffDate ? `${pickupSummary} · Return ${displayDateFormatter.format(dateFromIso(quote.dropoffDate))} at ${form.elements.returnTime.value}` : pickupSummary;
      result.querySelector('[data-estimate-distance]').textContent = `${quote.passengerMiles.toFixed(1)} passenger miles`;
      result.querySelector('[data-estimate-duration]').textContent = `About ${quote.passengerMinutes} passenger minutes`;
      const adjustments = result.querySelector('[data-estimate-adjustments]');
      adjustments.replaceChildren(...quote.customerBreakdown.map(line => { const item = document.createElement('li'); item.textContent = `${line.label}: ${money(line.amountCents)}`; return item; }));
      adjustments.hidden = !quote.customerBreakdown.length;
      const returnTimeQuery = quote.dropoffDate ? `&returnTime=${encodeURIComponent(form.elements.returnTime.value)}` : '';
      result.querySelector('[data-continue-booking]').href = `booking.html?estimateId=${encodeURIComponent(quote.estimateId)}${returnTimeQuery}`;
      result.hidden = false;
    } catch (error) {
      status.textContent = backendMessage(error, 'We could not calculate that trip. Please try again.');
    } finally { submit.disabled = false; }
  });
}
