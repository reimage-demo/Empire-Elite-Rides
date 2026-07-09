const form = document.querySelector('#booking-form');
const message = document.querySelector('#form-message');
const dateInput = form?.elements.serviceDate;
const phoneInput = form?.elements.phone;
const startSelect = form?.elements.startTime;
const endSelect = form?.elements.endTime;
const eventTypeSelect = form?.elements.eventType;
const availabilityStatus = document.querySelector('[data-availability-status]');
const SERVICE_TIME_ZONE = 'America/New_York';
const OCCASIONS = ['Airport Transportation', 'Corporate Travel', 'Weddings', 'Special Events', 'Nights Out', 'Personal Chauffeur', 'Family Travel', 'Long-Distance Travel', 'Medical & Professional', 'Funeral Services'];
let blockedWindows = [];
let convexClientPromise;

function serviceNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SERVICE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function readableTime(value) {
  const [hour, minute] = value.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function timeMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

async function getConvexClient() {
  if (!convexClientPromise) {
    convexClientPromise = import('https://esm.sh/convex@1.31.5/browser').then(({ ConvexHttpClient }) => new ConvexHttpClient(window.EMPIRE_ELITE_CONFIG.convexUrl));
  }
  return convexClientPromise;
}

function populateTimes() {
  const options = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    options.push(`<option value="${value}">${readableTime(value)}</option>`);
  }
  startSelect.innerHTML = options.join('');
  endSelect.innerHTML = options.join('');
  startSelect.value = '09:00';
  endSelect.value = '10:00';
}

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function configureServiceDate() {
  const now = serviceNow();
  const earliestDate = now.hour >= 12 ? addDays(now.date, 1) : now.date;
  dateInput.min = earliestDate;
  dateInput.value = earliestDate;
}

function updateEndTimes() {
  const start = timeMinutes(startSelect.value);
  let firstAvailable;
  Array.from(endSelect.options).forEach((option) => {
    const end = timeMinutes(option.value);
    const conflicts = blockedWindows.some((block) => start < timeMinutes(block.unavailableUntil) && end + 120 > timeMinutes(block.unavailableFrom));
    option.disabled = end <= start || conflicts;
    if (!option.disabled && !firstAvailable) firstAvailable = option;
  });
  if (endSelect.selectedOptions[0]?.disabled && firstAvailable) endSelect.value = firstAvailable.value;
}

function updateStartTimes() {
  const now = serviceNow();
  const isToday = dateInput.value === now.date;
  const currentMinutes = now.hour * 60 + now.minute;
  let firstAvailable;
  Array.from(startSelect.options).forEach((option) => {
    const start = timeMinutes(option.value);
    const withinBlockedWindow = blockedWindows.some((block) => start >= timeMinutes(block.unavailableFrom) && start < timeMinutes(block.unavailableUntil));
    option.disabled = withinBlockedWindow || (isToday && start <= currentMinutes);
    if (!option.disabled && !firstAvailable) firstAvailable = option;
  });
  if (startSelect.selectedOptions[0]?.disabled && firstAvailable) startSelect.value = firstAvailable.value;
  updateEndTimes();
}

async function loadAvailability() {
  if (!window.EMPIRE_ELITE_CONFIG?.convexUrl || !dateInput.value) return;
  availabilityStatus.textContent = 'Checking available times…';
  try {
    const client = await getConvexClient();
    blockedWindows = await client.query('bookings:availabilityForDate', { serviceDate: dateInput.value });
    updateStartTimes();
    availabilityStatus.textContent = 'Available times are shown; unavailable times are disabled.';
  } catch {
    blockedWindows = [];
    updateStartTimes();
    availabilityStatus.textContent = 'Times will be confirmed when your request is submitted.';
  }
}

if (form) {
  configureServiceDate();
  populateTimes();
  eventTypeSelect.innerHTML = `<option value="">Choose an occasion</option>${OCCASIONS.map(occasion => `<option value="${occasion}">${occasion}</option>`).join('')}`;

  phoneInput.addEventListener('input', () => { phoneInput.value = formatPhone(phoneInput.value); });
  dateInput.addEventListener('change', loadAvailability);
  startSelect.addEventListener('change', updateEndTimes);
  loadAvailability();
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form).entries());
  const current = serviceNow();

  if (values.serviceDate === current.date && current.hour >= 12) {
    configureServiceDate();
    message.className = 'form-message error';
    message.textContent = 'Please review the updated service date.';
    dateInput.focus();
    return;
  }
  if (values.endTime <= values.startTime) {
    message.className = 'form-message error';
    message.textContent = 'End time must be later than start time.';
    endSelect.focus();
    return;
  }
  if (values.phone.replace(/\D/g, '').length !== 10) {
    message.className = 'form-message error';
    message.textContent = 'Please enter a complete 10-digit phone number.';
    phoneInput.focus();
    return;
  }

  const convexUrl = window.EMPIRE_ELITE_CONFIG?.convexUrl;
  if (!convexUrl) {
    message.className = 'form-message error';
    message.textContent = 'Online booking is being connected. Please call 860-326-1089 for this reservation.';
    return;
  }

  submit.disabled = true;
  submit.firstChild.textContent = 'Sending request ';
  message.textContent = '';
  try {
    const client = await getConvexClient();
    const result = await client.mutation('bookings:create', {
      fullName: values.fullName.trim(), email: values.email.trim(), phone: values.phone,
      contactMethod: values.contactMethod, eventType: values.eventType, tripType: values.tripType,
      serviceDate: values.serviceDate, startTime: values.startTime, endTime: values.endTime,
      pickupAddress: values.pickupAddress.trim(), destination: values.destination.trim(), notes: values.notes.trim()
    });
    form.reset();
    configureServiceDate();
    startSelect.value = '09:00';
    endSelect.value = '10:00';
    await loadAvailability();
    message.className = 'form-message success';
    message.textContent = `Thank you. Your request ${result.confirmationCode} has been received. We’ll contact you shortly to confirm.`;
  } catch (error) {
    message.className = 'form-message error';
    if (error.data?.code === 'TIME_UNAVAILABLE') {
      message.textContent = 'That time is no longer available. Please choose another available time.';
      await loadAvailability();
    } else if (error.data?.code === 'SAME_DAY_CUTOFF') {
      configureServiceDate();
      message.textContent = 'Please review the updated service date.';
    } else {
      message.textContent = error.data?.message || 'We could not send your request. Please review your details and try again.';
    }
  } finally {
    submit.disabled = false;
    submit.firstChild.textContent = 'Request Reservation ';
  }
});
