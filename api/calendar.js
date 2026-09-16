'use strict';

var NOTE = 'Dates are correct at the time of publication but may be subject to change. Check Sport80 for up-to-date information.';

function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldLine(line) {
  var output = '';
  var width = 0;

  for (var character of String(line)) {
    var bytes = Buffer.byteLength(character, 'utf8');
    if (width + bytes > 75) {
      output += '\r\n ';
      width = 1;
    }
    output += character;
    width += bytes;
  }

  return output;
}

function calendarDate(value) {
  return String(value || '').replace(/-/g, '');
}

function nextCalendarDate(value) {
  var parts = String(value || '').split('-').map(Number);
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1));
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function calendarTimestamp(value) {
  var date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) date = new Date();
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function relationName(value) {
  if (Array.isArray(value)) value = value[0];
  return value && value.name ? String(value.name) : '';
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    response.status(405).send('Method not allowed');
    return;
  }

  var supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  var supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    response.status(500).send('The calendar feed is not configured.');
    return;
  }

  try {
    var endpoint = new URL('/rest/v1/events', supabaseUrl);
    endpoint.searchParams.set('select', 'id,start_date,end_date,title,updated_at,clubs(name),series(name)');
    endpoint.searchParams.set('status', 'eq.approved');
    endpoint.searchParams.set('order', 'start_date.asc,title.asc');

    var result = await fetch(endpoint, {
      headers: {
        apikey: supabaseKey,
        Accept: 'application/json'
      }
    });

    if (!result.ok) {
      throw new Error('Supabase returned HTTP ' + result.status);
    }

    var events = await result.json();
    var now = calendarTimestamp();
    var protocol = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    var host = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
    var appUrl = host ? protocol + '://' + host + '/' : '';
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Peak District Trials Group//Trials Dates//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Peak District Trials Group Dates',
      'X-WR-CALDESC:' + escapeText(NOTE),
      'X-PUBLISHED-TTL:PT1H',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H'
    ];

    events.forEach(function (event) {
      var club = relationName(event.clubs);
      var series = relationName(event.series);
      var description = 'Club: ' + (club || 'Not specified') +
        '\nSeries: ' + (series || 'Other') +
        '\n' + NOTE;

      lines.push(
        'BEGIN:VEVENT',
        'UID:' + escapeText(event.id) + '@peak-district-trials-group-dates',
        'DTSTAMP:' + now,
        'LAST-MODIFIED:' + calendarTimestamp(event.updated_at),
        'DTSTART;VALUE=DATE:' + calendarDate(event.start_date),
        'DTEND;VALUE=DATE:' + nextCalendarDate(event.end_date),
        'SUMMARY:' + escapeText(event.title + (series ? ' — ' + series : '')),
        'DESCRIPTION:' + escapeText(description),
        'STATUS:CONFIRMED',
        'TRANSP:TRANSPARENT'
      );
      if (appUrl) lines.push('URL:' + appUrl);
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    var body = lines.map(foldLine).join('\r\n') + '\r\n';

    response.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    response.setHeader('Content-Disposition', 'inline; filename="peak-district-trials-group-dates.ics"');
    response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600');
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.method === 'HEAD') {
      response.status(200).end();
      return;
    }
    response.status(200).send(body);
  } catch (error) {
    console.error('[calendar-feed] failed', error && error.message ? error.message : error);
    response.setHeader('Cache-Control', 'no-store');
    response.status(502).send('The live calendar feed is temporarily unavailable.');
  }
};
