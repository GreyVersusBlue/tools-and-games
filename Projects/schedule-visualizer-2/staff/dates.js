// Dates for the reader. A published file holds its times in UTC; what is
// shown is always the reader's own day and clock, in the reader's own
// language. `locale` and `zone` are for the tests, which pin both.

function parse(iso) {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms) : null;
}

// "12 September", with the year when it is not this year.
export function dayText(iso, now, locale, zone) {
  const date = parse(iso);
  if (!date) return 'an unknown date';
  const options = { day: 'numeric', month: 'long' };
  if (zone) options.timeZone = zone;
  const year = (value) => new Intl.DateTimeFormat('en', zone ? { year: 'numeric', timeZone: zone } : { year: 'numeric' }).format(value);
  if (!now || year(date) !== year(now)) options.year = 'numeric';
  return new Intl.DateTimeFormat(locale || undefined, options).format(date);
}

// "12 September 2026, 08:00": the publish date and time, local.
export function momentText(iso, locale, zone) {
  const date = parse(iso);
  if (!date) return 'an unknown time';
  const options = { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' };
  if (zone) options.timeZone = zone;
  return new Intl.DateTimeFormat(locale || undefined, options).format(date);
}

// Is this copy past the date its publisher gave it?
export function isStale(data, now) {
  const until = parse(data && data.staleAfter);
  return Boolean(until) && now.getTime() > until.getTime();
}

// Was `seen` (the newest publish time opened on this device) later than this
// copy's own?
export function isOlderThanSeen(data, seen) {
  const own = parse(data && data.publishedAt);
  const other = parse(seen);
  return Boolean(own) && Boolean(other) && other.getTime() > own.getTime();
}
