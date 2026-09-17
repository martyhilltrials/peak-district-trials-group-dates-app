'use strict';

var ADMIN_EMAIL = 'martyhilltrials@gmail.com';

function sendJson(response, status, value) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.status(status).json(value);
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
  });
}

async function callRpc(supabaseUrl, supabaseKey, accessToken, functionName) {
  var endpoint = new URL('/rest/v1/rpc/' + functionName, supabaseUrl);
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: '{}'
  });
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, {error:'Method not allowed'});
    return;
  }

  var resendKey = process.env.RESEND_API_KEY;
  var supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  var supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;
  var authorization = String(request.headers.authorization || '');
  var accessToken = authorization.indexOf('Bearer ') === 0 ? authorization.slice(7).trim() : '';

  if (!resendKey) {
    sendJson(response, 503, {error:'Email notification is not configured.'});
    return;
  }
  if (!supabaseUrl || !supabaseKey) {
    sendJson(response, 500, {error:'Supabase configuration is missing.'});
    return;
  }
  if (!accessToken) {
    sendJson(response, 401, {error:'A verified sign-in is required.'});
    return;
  }

  try {
    var pendingResult = await callRpc(
      supabaseUrl,
      supabaseKey,
      accessToken,
      'pending_calendar_access_notification'
    );

    if (pendingResult.status === 401 || pendingResult.status === 403) {
      sendJson(response, 401, {error:'The sign-in session could not be verified.'});
      return;
    }
    if (!pendingResult.ok) {
      throw new Error('Access request lookup returned HTTP ' + pendingResult.status);
    }

    var pendingRows = await pendingResult.json();
    var pending = Array.isArray(pendingRows) ? pendingRows[0] : pendingRows;
    if (!pending || !pending.request_user_id) {
      sendJson(response, 200, {sent:false, reason:'already-notified-or-approved'});
      return;
    }

    var personName = String(pending.request_name || '').trim() || 'Name not provided';
    var personEmail = String(pending.request_email || '').trim().toLowerCase();
    var protocol = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    var host = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
    var reviewUrl = host ? protocol + '://' + host + '/' : 'https://peak-district-trials-group-dates-ap.vercel.app/';
    var fromAddress = process.env.RESEND_FROM_EMAIL || 'Peak District Trials Dates <onboarding@resend.dev>';
    var subject = 'New calendar access request — ' + personName;
    var text = [
      'A new club representative has requested access to the Peak District Trials Group Dates app.',
      '',
      'Name: ' + personName,
      'Email: ' + personEmail,
      '',
      'Open the app, sign in and choose Setup to assign their club and approve access:',
      reviewUrl
    ].join('\n');
    var html = '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#172536">' +
      '<h2 style="color:#102b46">New calendar access request</h2>' +
      '<p>A new club representative has requested access to the Peak District Trials Group Dates app.</p>' +
      '<p><strong>Name:</strong> ' + escapeHtml(personName) + '<br><strong>Email:</strong> ' + escapeHtml(personEmail) + '</p>' +
      '<p><a href="' + escapeHtml(reviewUrl) + '" style="display:inline-block;background:#3333cc;color:#fff;text-decoration:none;padding:10px 15px;border-radius:7px">Open calendar setup</a></p>' +
      '<p style="font-size:12px;color:#637487">Sign in as administrator, open Setup, assign the correct club and approve the representative.</p>' +
      '</div>';

    var emailResult = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + resendKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'pdtg-access-request-' + pending.request_user_id
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [ADMIN_EMAIL],
        reply_to: personEmail,
        subject: subject,
        text: text,
        html: html
      })
    });

    if (!emailResult.ok) {
      var emailError = await emailResult.text();
      throw new Error('Resend returned HTTP ' + emailResult.status + ': ' + emailError.slice(0, 180));
    }

    var markResult = await callRpc(
      supabaseUrl,
      supabaseKey,
      accessToken,
      'mark_calendar_access_notification_sent'
    );
    if (!markResult.ok) {
      console.error('[access-request] email sent but notification marker failed with HTTP ' + markResult.status);
    }

    sendJson(response, 200, {sent:true});
  } catch (error) {
    console.error('[access-request] failed', error && error.message ? error.message : error);
    sendJson(response, 502, {error:'The access request was saved, but its email notification could not be sent.'});
  }
};
