import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import logoUrl from './logo.png'

const api = anyApi

const icon = (path) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
const icons = {
  dashboard: icon('M4 4h6v7H4V4Zm10 0h6v11h-6V4ZM4 15h6v5H4v-5Zm10 4h6v1h-6v-1Z'),
  new: icon('M12 5v14M5 12h14'),
  list: icon('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'),
  calendar: icon('M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2Zm3-2v4m8-4v4M3 10h18'),
  pricing: icon('M12 2v20m5-16.5c-1.1-1-2.8-1.5-5-1.5-3 0-5 1.5-5 4s2 3.5 5 4 5 1.5 5 4-2 4-5 4c-2.2 0-4-.5-5-1.5'),
  logout: icon('M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5m5-4 4-3-4-3m4 3H9')
}

const legacyEventLabels = { wedding: 'Wedding', prom: 'Prom', airport: 'Airport pickup', business: 'Business meeting', other: 'Other' }
const eventName = (row) => legacyEventLabels[row.eventType] || row.eventType
const statusLabels = { requested: 'New request', manual_review: 'Manual review', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', refunded: 'Refunded' }
const occasions = ['Airport Transportation', 'Corporate Travel', 'Weddings', 'Special Events', 'Nights Out', 'Personal Chauffeur', 'Family Travel', 'Long-Distance Travel', 'Medical & Professional', 'Funeral Services']
const toDate = (value) => new Date(`${value}T00:00:00`)
const prettyDate = (value) => toDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const prettyTime = (value) => new Date(`2000-01-01T${value}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const timeMinutes = (value) => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes }
const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const minutes = index * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})
const addDays = (value, count) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10) }
const defaultBookingDate = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  const today = `${parts.year}-${parts.month}-${parts.day}`
  return Number(parts.hour) >= 12 ? addDays(today, 1) : today
}
const formatPhone = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

function Login({ onLogin }) {
  const login = useMutation(api.adminAuth.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  async function submit(event) {
    event.preventDefault(); setError(''); setWorking(true)
    try {
      const result = await login({ username, password })
      if (!result.token) throw new Error('Login rejected.')
      onLogin(result.token)
    }
    catch { setError('Incorrect username or password.') }
    finally { setWorking(false) }
  }
  return <main className="auth-shell"><form className="auth-card" onSubmit={submit}>
    <img src={logoUrl} alt="Empire Elite Rides" />
    <p className="eyebrow">Private administration</p><h1>Welcome back</h1><p className="muted">Sign in to manage chauffeur reservations.</p>
    {error && <div className="error-box">{error}</div>}
    <label>Username<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required autoFocus /></label>
    <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
    <button className="primary-btn" disabled={working}>{working ? 'Signing in…' : 'Sign in'}</button>
  </form></main>
}

function Dashboard({ rows, onNavigate }) {
  const today = new Date().toLocaleDateString('en-CA')
  const active = rows.filter(row => row.status !== 'cancelled' && row.status !== 'completed')
  const next = active.filter(row => row.serviceDate >= today).sort((a,b) => `${a.serviceDate}${a.startTime}`.localeCompare(`${b.serviceDate}${b.startTime}`)).slice(0, 5)
  const stats = [
    ['New requests', rows.filter(r => r.status === 'requested').length],
    ['Upcoming rides', active.filter(r => r.serviceDate >= today).length],
    ['This month', active.filter(r => r.serviceDate.startsWith(today.slice(0,7))).length],
    ['Completed', rows.filter(r => r.status === 'completed').length]
  ]
  return <>
    <section className="stats-grid">{stats.map(([label,value]) => <article className="stat-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <section className="panel"><div className="panel-head"><div><p className="eyebrow">At a glance</p><h2>Next chauffeur services</h2></div><button className="secondary-btn" onClick={() => onNavigate('list')}>View all</button></div>
      <div className="upcoming-list">{next.map(row => <article key={row._id}><div className="date-tile"><strong>{toDate(row.serviceDate).toLocaleDateString(undefined,{day:'2-digit'})}</strong><span>{toDate(row.serviceDate).toLocaleDateString(undefined,{month:'short'})}</span></div><div><strong>{row.fullName}</strong><span>{eventName(row)} · {prettyTime(row.startTime)}–{prettyTime(row.endTime)}</span></div><span className={`status ${row.status}`}>{statusLabels[row.status]}</span></article>)}{!next.length && <div className="empty">No upcoming rides yet.</div>}</div>
    </section>
  </>
}

function BookingList({ rows, token }) {
  const updateStatus = useMutation(api.bookings.updateStatus)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const filtered = rows.filter(row => {
    const haystack = `${row.fullName} ${row.email} ${row.phone} ${row.eventType} ${row.pickupAddress} ${row.destination}`.toLowerCase()
    return haystack.includes(search.toLowerCase()) && (status === 'all' || row.status === status)
  })
  return <section className="panel list-panel">
    <div className="panel-head"><div><p className="eyebrow">Reservations</p><h2>All bookings</h2></div><div className="filters"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers or trips…" /><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
    <div className="table-wrap"><table><thead><tr><th>Date & time</th><th>Customer</th><th>Service</th><th>Route</th><th>Contact</th><th>Status</th></tr></thead><tbody>{filtered.map(row => <tr key={row._id}><td><strong>{prettyDate(row.serviceDate)}</strong><span>{prettyTime(row.startTime)}–{prettyTime(row.endTime)}</span></td><td><strong>{row.fullName}</strong><span>{row.email}<br />{row.phone}</span></td><td><strong>{eventName(row)}</strong><span>{row.tripType.replace('both','Pickup & drop-off')}</span></td><td><strong>{row.pickupAddress}</strong><span>to {row.destination}</span>{row.notes && <small>{row.notes}</small>}</td><td><span className="contact-pill">{row.contactMethod}</span></td><td><select className={`status-select ${row.status}`} value={row.status} onChange={e => updateStatus({ sessionToken: token, id: row._id, status: e.target.value })}>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></td></tr>)}</tbody></table>{!filtered.length && <div className="empty">No bookings match these filters.</div>}</div>
  </section>
}

function AdminBookingForm({ rows, token, onCreated }) {
  const createBooking = useMutation(api.bookings.createAdmin)
  const emptyForm = () => ({ fullName: '', email: '', phone: '', contactMethod: 'text', eventType: '', tripType: 'both', serviceDate: defaultBookingDate(), startTime: '09:00', endTime: '10:00', pickupAddress: '', destination: '', notes: '' })
  const [form, setForm] = useState(emptyForm)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState(null)
  const activeForDate = rows.filter(row => row.serviceDate === form.serviceDate && row.status !== 'cancelled')
  const blocked = activeForDate.map(row => ({ start: timeMinutes(row.startTime), until: Math.min(timeMinutes(row.endTime) + 120, 1440) }))
  const startDisabled = value => blocked.some(window => timeMinutes(value) >= window.start && timeMinutes(value) < window.until)
  const endDisabled = value => {
    const start = timeMinutes(form.startTime), end = timeMinutes(value)
    return end <= start || blocked.some(window => start < window.until && end + 120 > window.start)
  }
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const changeStart = value => {
    const start = timeMinutes(value)
    const firstEnd = timeOptions.find(option => {
      const end = timeMinutes(option)
      return end > start && !blocked.some(window => start < window.until && end + 120 > window.start)
    })
    setForm(current => ({ ...current, startTime: value, endTime: firstEnd || current.endTime }))
  }
  const changeDate = value => {
    const dateRows = rows.filter(row => row.serviceDate === value && row.status !== 'cancelled')
    const dateBlocks = dateRows.map(row => ({ start: timeMinutes(row.startTime), until: Math.min(timeMinutes(row.endTime) + 120, 1440) }))
    const start = timeOptions.find(option => !dateBlocks.some(window => timeMinutes(option) >= window.start && timeMinutes(option) < window.until)) || '09:00'
    const startValue = timeMinutes(start)
    const end = timeOptions.find(option => timeMinutes(option) > startValue && !dateBlocks.some(window => startValue < window.until && timeMinutes(option) + 120 > window.start)) || '10:00'
    setForm(current => ({ ...current, serviceDate: value, startTime: start, endTime: end }))
  }
  async function submit(event) {
    event.preventDefault(); setWorking(true); setMessage(null)
    try {
      const result = await createBooking({ sessionToken: token, ...form, email: form.email.trim() || undefined })
      setMessage({ type: 'success', text: `Booking ${result.confirmationCode} was created and confirmed.` })
      setForm(emptyForm())
      onCreated?.()
    } catch (error) {
      const text = error.data?.code === 'TIME_UNAVAILABLE' ? 'That time conflicts with an existing reservation. Choose another available time.' : (error.data?.message || 'The booking could not be created. Review the details and try again.')
      setMessage({ type: 'error', text })
    } finally { setWorking(false) }
  }
  return <section className="panel admin-booking-panel">
    <div className="panel-head"><div><p className="eyebrow">Direct entry</p><h2>Book for a client</h2></div><span className="confirmed-note">Admin bookings are confirmed immediately</span></div>
    <form className="admin-booking-form" onSubmit={submit}>
      <fieldset><legend>Client</legend><div className="admin-form-grid"><label>Full name *<input value={form.fullName} onChange={e => update('fullName', e.target.value)} required /></label><label>Phone *<input value={form.phone} onChange={e => update('phone', formatPhone(e.target.value))} inputMode="numeric" maxLength="12" placeholder="860-326-1089" required /></label><label>Email <input type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="Optional" /></label><label>Preferred contact *<select value={form.contactMethod} onChange={e => update('contactMethod', e.target.value)}><option value="text">Text message</option><option value="call">Phone call</option><option value="email">Email</option></select></label></div></fieldset>
      <fieldset><legend>Service</legend><div className="admin-form-grid"><label>Occasion *<select value={form.eventType} onChange={e => update('eventType', e.target.value)} required><option value="">Choose an occasion</option>{occasions.map(item => <option key={item}>{item}</option>)}</select></label><label>Direction *<select value={form.tripType} onChange={e => update('tripType', e.target.value)}><option value="pickup">Pickup only</option><option value="dropoff">Drop-off only</option><option value="both">Pickup and drop-off</option></select></label><label>Service date *<input type="date" min={defaultBookingDate()} value={form.serviceDate} onChange={e => changeDate(e.target.value)} required /><small>{activeForDate.length ? `${activeForDate.length} active booking${activeForDate.length === 1 ? '' : 's'} on this date; conflicting times are blocked.` : 'No active bookings on this date.'}</small></label><label>Start time *<select value={form.startTime} onChange={e => changeStart(e.target.value)} required>{timeOptions.map(value => <option key={value} value={value} disabled={startDisabled(value)}>{prettyTime(value)}{startDisabled(value) ? ' — unavailable' : ''}</option>)}</select></label><label>End time *<select value={form.endTime} onChange={e => update('endTime', e.target.value)} required>{timeOptions.map(value => <option key={value} value={value} disabled={endDisabled(value)}>{prettyTime(value)}{endDisabled(value) ? ' — unavailable' : ''}</option>)}</select></label><label>Pickup address *<input value={form.pickupAddress} onChange={e => update('pickupAddress', e.target.value)} required /></label><label>Destination *<input value={form.destination} onChange={e => update('destination', e.target.value)} required /></label><label className="admin-notes">Notes<textarea value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Flight, passengers, itinerary or special instructions" /></label></div></fieldset>
      {message && <div className={message.type === 'success' ? 'success-box' : 'error-box'}>{message.text}</div>}
      <button className="primary-btn admin-submit" disabled={working}>{working ? 'Creating booking…' : 'Create confirmed booking'}</button>
    </form>
  </section>
}

const pricingGroups = [
  ['General pricing', [['Base service fee','baseServiceFeeCents'],['Minimum fare','minimumFareCents'],['Passenger per mile','passengerPerMileCents'],['Passenger per minute','passengerPerMinuteCents'],['Included miles','includedMiles','number'],['Included minutes','includedMinutes','number']]],
  ['Positioning', [['Positioning per mile','positioningPerMileCents'],['Positioning per minute','positioningPerMinuteCents'],['Return per mile','returnPerMileCents'],['Return per minute','returnPerMinuteCents'],['Maximum positioning charge','maximumPositioningChargeCents']]],
  ['Availability', [['Cleaning buffer (minutes)','cleaningBufferMinutes','number'],['Preparation buffer (minutes)','preparationBufferMinutes','number'],['Driver break buffer (minutes)','driverBreakBufferMinutes','number'],['Limited availability threshold (minutes)','limitedAvailabilityThresholdMinutes','number'],['Confirmation threshold (minutes)','confirmationRequiredThresholdMinutes','number'],['Limited availability adjustment','limitedAvailabilityAdjustmentCents']]],
  ['Extras', [['Additional stop fee','additionalStopFeeCents'],['Waiting per minute','waitTimePerMinuteCents'],['Airport fee','airportFeeCents'],['Meet-and-greet fee','meetAndGreetFeeCents'],['Hourly rate','hourlyRateCents'],['Event minimum','eventMinimumFareCents'],['Tax (%)','taxPercentageBps','percent'],['Gratuity (%)','gratuityPercentageBps','percent']]],
  ['Internal costs — private', [['Fuel per mile','fuelCostPerMileCents'],['Vehicle wear per mile','vehicleWearPerMileCents'],['Labor per minute','chauffeurLaborPerMinuteCents'],['Cleaning cost','cleaningCostCents'],['Target margin (%)','targetMarginBps','percent']]],
  ['Quote settings', [['Homepage expiration (minutes)','homepageQuoteExpirationMinutes','number'],['Official quote expiration (minutes)','bookingQuoteExpirationMinutes','number'],['Manual-review distance (miles)','manualReviewDistanceMiles','number'],['Maximum route distance (miles)','maximumTotalRouteMiles','number']]]
]

function PricingPanel({ token }) {
  const data = useQuery(api.pricingAdmin.dashboard, { sessionToken: token })
  const saveConfig = useMutation(api.pricingAdmin.saveConfig)
  const addHoliday = useMutation(api.pricingAdmin.addHoliday), toggleHoliday = useMutation(api.pricingAdmin.toggleHoliday)
  const addEvent = useMutation(api.pricingAdmin.addEvent), toggleEvent = useMutation(api.pricingAdmin.toggleEvent)
  const addBlackout = useMutation(api.pricingAdmin.addBlackout), toggleBlackout = useMutation(api.pricingAdmin.toggleBlackout)
  const [draft, setDraft] = useState(null), [reason, setReason] = useState(''), [message, setMessage] = useState(null), [working, setWorking] = useState(false)
  const [holiday, setHoliday] = useState({name:'',start:'',end:'',flat:'0',percent:'0',manualApproval:false})
  const [specialEvent, setSpecialEvent] = useState({name:'',start:'',end:'',flat:'0',percent:'0',manualApproval:false,displayName:false})
  const [blackout, setBlackout] = useState({start:'',end:'',reason:''})
  const config = draft || data?.config.snapshot
  if (!data || !config) return <section className="panel"><div className="empty">Loading pricing configuration…</div></section>
  const update = (key, raw, type) => setDraft(current => ({ ...(current || data.config.snapshot), [key]: type === 'percent' ? Math.round(Number(raw) * 100) : type === 'number' ? Number(raw) : Math.round(Number(raw) * 100) }))
  const display = (key, type) => type === 'percent' ? config[key] / 100 : type === 'number' ? config[key] : config[key] / 100
  const updateRules = (key, raw) => { try { const value = JSON.parse(raw); if (Array.isArray(value)) setDraft(current => ({ ...(current || data.config.snapshot), [key]: value })) } catch {} }
  async function save(event) { event.preventDefault(); setWorking(true); setMessage(null); try { const result = await saveConfig({sessionToken:token,snapshot:config,reason}); setMessage({type:'success',text:`Pricing version ${result.version} is now active.`}); setDraft(null); setReason('') } catch(error){setMessage({type:'error',text:error.data?.message||'Pricing could not be saved.'})} finally{setWorking(false)} }
  const cents = value => Math.round(Number(value || 0) * 100), at = value => new Date(value).getTime()
  async function createHoliday(event){event.preventDefault();try{await addHoliday({sessionToken:token,name:holiday.name,startAt:at(holiday.start),endAt:at(holiday.end),flatCents:cents(holiday.flat),percentageBps:Math.round(Number(holiday.percent)*100),manualApproval:holiday.manualApproval});setHoliday({name:'',start:'',end:'',flat:'0',percent:'0',manualApproval:false})}catch(error){setMessage({type:'error',text:error.data?.message||'Holiday could not be added.'})}}
  async function createEvent(event){event.preventDefault();try{await addEvent({sessionToken:token,name:specialEvent.name,startAt:at(specialEvent.start),endAt:at(specialEvent.end),flatCents:cents(specialEvent.flat),percentageBps:Math.round(Number(specialEvent.percent)*100),manualApproval:specialEvent.manualApproval,displayName:specialEvent.displayName});setSpecialEvent({name:'',start:'',end:'',flat:'0',percent:'0',manualApproval:false,displayName:false})}catch(error){setMessage({type:'error',text:error.data?.message||'Event could not be added.'})}}
  async function createBlackout(event){event.preventDefault();try{await addBlackout({sessionToken:token,startAt:at(blackout.start),endAt:at(blackout.end),reason:blackout.reason});setBlackout({start:'',end:'',reason:''})}catch(error){setMessage({type:'error',text:error.data?.message||'Blackout could not be added.'})}}
  return <div className="pricing-layout">
    {config.ownerReviewRequired&&<div className="owner-review">Owner review required: all starting rates are editable placeholders and are not approved business pricing until the first saved version.</div>}
    {message&&<div className={message.type==='success'?'success-box':'error-box'}>{message.text}</div>}
    <form className="panel pricing-config" onSubmit={save}><div className="panel-head"><div><p className="eyebrow">Version {data.config.version}</p><h2>Pricing configuration</h2></div><button className="primary-btn" disabled={working}>{working?'Saving…':'Save new version'}</button></div>
      <div className="pricing-groups">{pricingGroups.map(([title,fields])=><fieldset key={title}><legend>{title}</legend><div className="admin-form-grid">{fields.map(([label,key,type])=><label key={key}>{label}<input type="number" min="0" step={type==='number'?'1':'0.01'} value={display(key,type)} onChange={event=>update(key,event.target.value,type)} /></label>)}</div></fieldset>)}</div>
      <fieldset><legend>Time adjustments</legend><p className="muted">Advanced JSON fields preserve configurable days, windows, percentages, flat adjustments, and manual-approval flags.</p><div className="rule-json-grid"><label>Rush-hour windows<textarea defaultValue={JSON.stringify(config.rushHourRules,null,2)} onBlur={e=>updateRules('rushHourRules',e.target.value)} /></label><label>Short-notice thresholds<textarea defaultValue={JSON.stringify(config.shortNoticeRules,null,2)} onBlur={e=>updateRules('shortNoticeRules',e.target.value)} /></label><label>After-hours windows<textarea defaultValue={JSON.stringify(config.afterHoursRules,null,2)} onBlur={e=>updateRules('afterHoursRules',e.target.value)} /></label></div></fieldset>
      <label>Reason for this version *<input value={reason} onChange={e=>setReason(e.target.value)} required placeholder="Example: Owner-approved 2026 rates" /></label>
    </form>
    <section className="panel rules-panel"><div className="panel-head"><div><p className="eyebrow">Scheduled rules</p><h2>Holidays and events</h2></div></div>
      <form className="compact-admin-form" onSubmit={createHoliday}><h3>Add holiday</h3><input placeholder="Holiday name" value={holiday.name} onChange={e=>setHoliday({...holiday,name:e.target.value})} required/><input type="datetime-local" value={holiday.start} onChange={e=>setHoliday({...holiday,start:e.target.value})} required/><input type="datetime-local" value={holiday.end} onChange={e=>setHoliday({...holiday,end:e.target.value})} required/><input type="number" step="0.01" placeholder="Flat dollars" value={holiday.flat} onChange={e=>setHoliday({...holiday,flat:e.target.value})}/><input type="number" step="0.01" placeholder="Percent" value={holiday.percent} onChange={e=>setHoliday({...holiday,percent:e.target.value})}/><label className="inline-check"><input type="checkbox" checked={holiday.manualApproval} onChange={e=>setHoliday({...holiday,manualApproval:e.target.checked})}/>Manual approval</label><button className="secondary-btn">Add holiday</button></form>
      <div className="rule-list">{data.holidays.map(row=><article key={row._id}><div><strong>{row.name}</strong><span>{new Date(row.startAt).toLocaleString()} – {new Date(row.endAt).toLocaleString()}</span></div><button onClick={()=>toggleHoliday({sessionToken:token,id:row._id,active:!row.active})}>{row.active?'Disable':'Enable'}</button></article>)}</div>
      <form className="compact-admin-form" onSubmit={createEvent}><h3>Add special event</h3><input placeholder="Internal event name" value={specialEvent.name} onChange={e=>setSpecialEvent({...specialEvent,name:e.target.value})} required/><input type="datetime-local" value={specialEvent.start} onChange={e=>setSpecialEvent({...specialEvent,start:e.target.value})} required/><input type="datetime-local" value={specialEvent.end} onChange={e=>setSpecialEvent({...specialEvent,end:e.target.value})} required/><input type="number" step="0.01" placeholder="Flat dollars" value={specialEvent.flat} onChange={e=>setSpecialEvent({...specialEvent,flat:e.target.value})}/><input type="number" step="0.01" placeholder="Percent" value={specialEvent.percent} onChange={e=>setSpecialEvent({...specialEvent,percent:e.target.value})}/><label className="inline-check"><input type="checkbox" checked={specialEvent.manualApproval} onChange={e=>setSpecialEvent({...specialEvent,manualApproval:e.target.checked})}/>Manual approval</label><button className="secondary-btn">Add event</button></form>
      <div className="rule-list">{data.events.map(row=><article key={row._id}><div><strong>{row.name}</strong><span>{new Date(row.startAt).toLocaleString()} – {new Date(row.endAt).toLocaleString()}</span></div><button onClick={()=>toggleEvent({sessionToken:token,id:row._id,active:!row.active})}>{row.active?'Disable':'Enable'}</button></article>)}</div>
    </section>
    <section className="panel rules-panel"><div className="panel-head"><div><p className="eyebrow">Availability</p><h2>Maintenance and blackouts</h2></div></div><form className="compact-admin-form" onSubmit={createBlackout}><input type="datetime-local" value={blackout.start} onChange={e=>setBlackout({...blackout,start:e.target.value})} required/><input type="datetime-local" value={blackout.end} onChange={e=>setBlackout({...blackout,end:e.target.value})} required/><input placeholder="Private internal reason" value={blackout.reason} onChange={e=>setBlackout({...blackout,reason:e.target.value})} required/><button className="secondary-btn">Block time</button></form><div className="rule-list">{data.blocks.map(row=><article key={row._id}><div><strong>{row.reason}</strong><span>{new Date(row.startAt).toLocaleString()} – {new Date(row.endAt).toLocaleString()}</span></div><button onClick={()=>toggleBlackout({sessionToken:token,id:row._id,active:!row.active})}>{row.active?'Release':'Enable'}</button></article>)}</div></section>
    <section className="panel audit-panel"><div className="panel-head"><div><p className="eyebrow">Security history</p><h2>Recent audit log</h2></div></div><div className="rule-list">{data.audit.map(row=><article key={row._id}><div><strong>{row.action.replaceAll('_',' ')}</strong><span>{row.userId} · {new Date(row.timestamp).toLocaleString()}{row.reason?` · ${row.reason}`:''}</span></div></article>)}</div></section>
  </div>
}

function Calendar({ rows }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const year = cursor.getFullYear(), month = cursor.getMonth()
  const startPad = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(startPad).fill(null), ...Array.from({length: days},(_,i)=>i+1)]
  while (cells.length % 7) cells.push(null)
  const byDate = rows.filter(r => r.status !== 'cancelled').reduce((map,row) => { (map[row.serviceDate] ||= []).push(row); return map }, {})
  const keyFor = day => `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  return <section className="panel calendar-panel"><div className="panel-head"><div><p className="eyebrow">Schedule</p><h2>{cursor.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h2></div><div className="calendar-actions"><button onClick={() => setCursor(new Date(year,month-1,1))}>←</button><button onClick={() => {const d=new Date();setCursor(new Date(d.getFullYear(),d.getMonth(),1))}}>Today</button><button onClick={() => setCursor(new Date(year,month+1,1))}>→</button></div></div>
    <div className="calendar-grid">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => <div className="weekday" key={day}>{day}</div>)}{cells.map((day,index) => { const dayRows = day ? (byDate[keyFor(day)] || []) : []; return <div className={`calendar-cell ${!day?'blank':''} ${dayRows.length?'has-bookings':''}`} key={index}>{day && <><span className="day-number">{day}</span>{dayRows.sort((a,b)=>a.startTime.localeCompare(b.startTime)).map(row => <article className={`calendar-booking ${row.status}`} key={row._id}><strong>{prettyTime(row.startTime)} {row.fullName}</strong><span>{eventName(row)}</span></article>)}</>}</div>})}</div>
  </section>
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('empire-admin-token') || '')
  const [view, setView] = useState('dashboard')
  const logout = useMutation(api.adminAuth.logout)
  const touchSession = useMutation(api.adminAuth.touchSession)
  const rows = useQuery(api.bookings.adminList, token ? { sessionToken: token } : 'skip')
  const clearToken = useCallback(() => {
    sessionStorage.removeItem('empire-admin-token')
    setToken('')
  }, [])
  const saveToken = useCallback(next => {
    sessionStorage.setItem('empire-admin-token', next)
    setToken(next)
  }, [])
  const signOut = useCallback(async () => {
    try { await logout({ token }) }
    finally { clearToken() }
  }, [clearToken, logout, token])

  useEffect(() => {
    if (!token) return
    const inactivityMs = 30 * 60 * 1000
    const serverRefreshMs = 60 * 1000
    let lastServerRefresh = Date.now()
    let inactivityTimer
    const expire = () => { void signOut() }
    const resetTimer = () => {
      clearTimeout(inactivityTimer)
      inactivityTimer = setTimeout(expire, inactivityMs)
    }
    const recordActivity = () => {
      resetTimer()
      const now = Date.now()
      if (now - lastServerRefresh < serverRefreshMs) return
      lastServerRefresh = now
      void touchSession({ token }).catch(clearToken)
    }
    resetTimer()
    for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
      window.addEventListener(eventName, recordActivity, { passive: true })
    }
    return () => {
      clearTimeout(inactivityTimer)
      for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
        window.removeEventListener(eventName, recordActivity)
      }
    }
  }, [clearToken, signOut, token, touchSession])
  if (!token) return <Login onLogin={saveToken} />
  if (rows === undefined) return <div className="loading">Loading reservations…</div>
  const titles = { dashboard: 'Dashboard', new: 'New Booking', list: 'Bookings', calendar: 'Calendar', pricing: 'Pricing & Availability' }
  return <div className="app-shell"><aside className="sidebar"><div className="brand-block"><img src={logoUrl} alt="Empire Elite Rides" /></div><nav>{[['dashboard','Overview'],['new','New Booking'],['list','Bookings'],['calendar','Calendar'],['pricing','Pricing']].map(([key,label]) => <button className={view===key?'active':''} onClick={() => setView(key)} key={key}>{icons[key]}<span>{label}</span></button>)}</nav><div className="sidebar-bottom"><span>Administrator</span><button onClick={signOut}>{icons.logout}<span>Sign out</span></button></div></aside>
    <main className="main-panel"><header className="page-header"><div><p>Empire Elite Rides</p><h1>{titles[view]}</h1></div><div className="vehicle-chip"><span></span>2017 Ford Expedition Limited</div></header>{view==='dashboard'&&<Dashboard rows={rows} onNavigate={setView}/>} {view==='new'&&<AdminBookingForm rows={rows} token={token} onCreated={() => setView('calendar')}/>} {view==='list'&&<BookingList rows={rows} token={token}/>} {view==='calendar'&&<Calendar rows={rows}/>} {view==='pricing'&&<PricingPanel token={token}/>}</main></div>
}
