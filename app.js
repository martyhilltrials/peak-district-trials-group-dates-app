(function () {
  'use strict';

  var DEFAULT_GROUP_LOGO = window.PEAK_DEFAULT_LOGO || 'peak-district-trials-group-logo.png';
  var NOTE = 'Dates are correct at the time of publication but may be subject to change. Check Sport80 for up-to-date information.';
  var KEY = 'peak-district-trials-group-dates-v2-cache';
  var OLD_KEY = 'peak-district-trials-group-dates-v1';
  var REGISTRATION_NAME_KEY = 'peak-district-trials-access-name';
  var names = ['FIM TrialGP','FIM TDN','FIM X - Trial','FIM X - TDN','European Championship','TrialGB','Trial GB Youth','ACU S3 Parts NTC','Normandale Masters','ACU Kickstart','SSDT','ACU Inter Centre','ACU British Sidecar','ACU Trail Bike','National Trials','Others'];
  var colours = ['#1f6fae','#c0394e','#7248a4','#327989','#2f8a60','#df8133','#c24770','#1554a3','#6c7686','#bd673c','#235b89','#7667a9','#56864b','#a15c65','#467d86','#808992'];
  var now = new Date();
  var initialYear = now.getFullYear() + (now.getMonth() >= 8 ? 1 : 0);
  var client = null;
  var remoteReady = false;
  var connectionError = '';
  var user = null;
  var profile = null;
  var clubs = [];
  var adminProfiles = [];
  var realtimeChannel = null;
  var loadingRemote = false;
  var defaultLogoData = '';
  var notificationAttemptedFor = '';

  function $(name) { return document.getElementById(name); }
  function fresh() {
    return {
      year: initialYear,
      acuLogo: '',
      series: names.map(function (name, i) { return {id: 's' + i, name: name, colour: colours[i], logo: ''}; }),
      events: []
    };
  }
  function loadCache() {
    try {
      var raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.series) && Array.isArray(data.events)) {
        data.events = data.events.map(function (event) {
          event.status = event.status || 'approved';
          event.clubId = event.clubId || '';
          return event;
        });
        return data;
      }
    } catch (error) {}
    return fresh();
  }
  var state = loadCache();
  var month = state.year === now.getFullYear() ? now.getMonth() : 0;
  var filter = 'all';
  var editingId = null;
  var pending = null;
  var selectedDay = '';

  function saveCache() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      return false;
    }
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }
  function colour(value) { return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#537894'; }
  function safeLogo(value) { return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value || '') ? value : ''; }
  function headerLogoValue() { return safeLogo(state.acuLogo) || defaultLogoData || DEFAULT_GROUP_LOGO; }
  function logoTag(value, label) { return safeLogo(value) ? '<img class="mini-logo" src="' + value + '" alt="' + esc(label) + '">' : ''; }
  function makeId() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function pad(number) { return String(number).padStart(2, '0'); }
  function iso(year, monthNumber, day) { return year + '-' + pad(monthNumber + 1) + '-' + pad(day); }
  function lastDay(monthNumber) { return new Date(Date.UTC(state.year, monthNumber + 1, 0)).getUTCDate(); }
  function dateLabel(value) { return new Intl.DateTimeFormat('en-GB', {weekday:'short', day:'numeric', month:'short', timeZone:'UTC'}).format(new Date(value + 'T12:00:00Z')); }
  function monthName(monthNumber) { return new Intl.DateTimeFormat('en-GB', {month:'long', timeZone:'UTC'}).format(new Date(Date.UTC(2024, monthNumber, 1))); }
  function range(event) { return event.start === event.end ? dateLabel(event.start) : dateLabel(event.start) + ' – ' + dateLabel(event.end); }
  function sorted(events) { return events.slice().sort(function (a, b) { return a.start.localeCompare(b.start) || a.title.localeCompare(b.title); }); }
  function nextDay(value) {
    var parts = value.split('-').map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1)).toISOString().slice(0, 10);
  }
  function toast(value) {
    $('toast').textContent = value;
    $('toast').style.display = 'block';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { $('toast').style.display = 'none'; }, 3500);
  }
  function messageForError(error, fallback) {
    if (!error) return fallback;
    if (error.code === '23505') return 'That name already exists.';
    if (error.code === '42501') return 'Your account does not have permission to make that change.';
    return fallback + (error.message ? '\n\n' + error.message : '');
  }
  function seriesFor(event) {
    return state.series.find(function (series) { return series.id === event.seriesId; }) ||
      state.series.find(function (series) { return series.id === 's15'; }) ||
      {name:'Others', colour:'#808992', logo:''};
  }
  function clubForId(id) { return clubs.find(function (club) { return club.id === id; }) || null; }
  function profileClubName() {
    var club = profile && clubForId(profile.club_id);
    return club ? club.name : '';
  }
  function isAdmin() { return !!(profile && profile.approved && profile.role === 'admin'); }
  function canAddDates() { return !!(remoteReady && profile && profile.approved && (isAdmin() || profile.club_id)); }
  function canEditEvent(event) { return !!(canAddDates() && (isAdmin() || event.clubId === profile.club_id)); }
  function yearEvents(publishedOnly) {
    return state.events.filter(function (event) {
      return event.start.slice(0, 4) === String(state.year) && (!publishedOnly || event.status === 'approved');
    });
  }
  function visible(events) { return filter === 'all' ? events : events.filter(function (event) { return event.seriesId === filter; }); }
  function monthEntries(monthNumber, all, publishedOnly) {
    var first = iso(state.year, monthNumber, 1);
    var last = iso(state.year, monthNumber, lastDay(monthNumber));
    var source = yearEvents(publishedOnly).filter(function (event) { return event.start <= last && event.end >= first; });
    return sorted(all ? source : visible(source));
  }
  function statusLabel(event) {
    if (event.status === 'approved') return '';
    return '<span class="event-status ' + (event.status === 'rejected' ? 'rejected' : '') + '">' +
      (event.status === 'rejected' ? 'Not approved' : 'Awaiting approval') + '</span>';
  }

  function setConnectionStatus(text, style) {
    $('connectionStatus').textContent = text;
    $('connectionStatus').className = 'status-pill' + (style ? ' ' + style : '');
  }
  function renderHeader() {
    $('yearInput').value = state.year;
    $('mastYear').textContent = state.year;
    var logo = headerLogoValue();
    var image = $('headerLogo');
    image.style.display = 'block';
    $('brandFallback').style.display = 'none';
    image.onerror = function () { image.style.display = 'none'; $('brandFallback').style.display = 'block'; };
    image.src = logo;
    $('appIcon').href = logo;
    $('appleTouchIcon').href = logo;
  }
  function renderAccess() {
    $('newEvent').hidden = !canAddDates();
    $('openSetup').hidden = !isAdmin();
    $('authButton').textContent = user ? 'Account' : 'Club sign in';
    if (connectionError) setConnectionStatus('Offline copy', 'error');
    else if (!remoteReady) setConnectionStatus('Connecting…', '');
    else if (!user) setConnectionStatus('Live calendar', 'live');
    else if (!profile || !profile.approved) setConnectionStatus('Awaiting approval', 'warn');
    else if (isAdmin()) setConnectionStatus('Administrator', 'live');
    else setConnectionStatus(profileClubName() || 'Club editor', 'live');
  }
  function renderFilters() {
    var entries = yearEvents(false).filter(function (event) { return event.status !== 'rejected'; });
    $('seriesList').innerHTML = '<button class="series-filter ' + (filter === 'all' ? 'active' : '') + '" data-filter="all" type="button">All series <span class="count">' + entries.length + '</span></button>' +
      state.series.map(function (series) {
        var count = entries.filter(function (event) { return event.seriesId === series.id; }).length;
        return '<button class="series-filter ' + (filter === series.id ? 'active' : '') + '" data-filter="' + esc(series.id) + '" type="button"><span class="dot" style="background:' + colour(series.colour) + '"></span><span>' + esc(series.name) + '</span><span class="count">' + count + '</span></button>';
      }).join('');
    $('mobileFilter').innerHTML = '<option value="all">All series</option>' + state.series.map(function (series) { return '<option value="' + esc(series.id) + '">' + esc(series.name) + '</option>'; }).join('');
    if (!state.series.some(function (series) { return series.id === filter; })) filter = 'all';
    $('mobileFilter').value = filter;
  }
  function renderMonth() {
    $('monthTitle').textContent = monthName(month) + ' ' + state.year;
    var entries = monthEntries(month, false, false).filter(function (event) { return event.status !== 'rejected'; });
    $('monthCount').textContent = entries.length + ' event' + (entries.length === 1 ? '' : 's') + ' this month';
    $('monthButtons').innerHTML = Array.from({length:12}, function (_, index) {
      var count = monthEntries(index, false, false).filter(function (event) { return event.status !== 'rejected'; }).length;
      return '<button class="month-jump ' + (index === month ? 'current' : '') + '" data-month="' + index + '" type="button">' + monthName(index).slice(0, 3) + '<small>' + (count || '·') + '</small></button>';
    }).join('');
    var firstWeekday = (new Date(Date.UTC(state.year, month, 1)).getUTCDay() + 6) % 7;
    var cells = Array.from({length:firstWeekday}, function () { return '<div class="blank"></div>'; }).join('');
    var today = iso(now.getFullYear(), now.getMonth(), now.getDate());
    for (var day = 1; day <= lastDay(month); day++) {
      var date = iso(state.year, month, day);
      var events = sorted(visible(yearEvents(false).filter(function (event) { return event.status !== 'rejected' && event.start <= date && event.end >= date; })));
      var chips = events.slice(0, 2).map(function (event) {
        var series = seriesFor(event);
        var editable = canEditEvent(event) ? ' data-edit="' + esc(event.id) + '"' : '';
        var pendingMarker = event.status === 'approved' ? '' : ' • pending';
        return '<button class="chip" style="border-color:' + colour(series.colour) + ';background-color:' + colour(series.colour) + '22" title="' + esc(event.title + ' — ' + series.name + pendingMarker) + '"' + editable + ' type="button">' + esc(event.title) + '</button>';
      }).join('');
      cells += '<div class="day-cell ' + (date === today ? 'today' : '') + ' ' + (date === selectedDay ? 'selected' : '') + '"><button class="day-number" type="button" data-day="' + date + '" aria-label="' + esc(dateLabel(date)) + (canAddDates() ? '; add event' : '') + '">' + day + '</button>' + chips + (events.length > 2 ? '<span class="more">+' + (events.length - 2) + ' more</span>' : '') + '</div>';
    }
    $('calendarGrid').innerHTML = cells;
    $('agendaList').innerHTML = entries.length ? entries.map(function (event) {
      var series = seriesFor(event);
      return '<div class="event-row"><div class="date-block">' + esc(range(event)) + '</div>' + logoTag(series.logo, series.name) + '<div class="event-text"><strong>' + esc(event.title) + '</strong><small>' + esc(series.name) + ' · ' + esc(event.club) + '</small>' + statusLabel(event) + '</div>' + (canEditEvent(event) ? '<button class="btn" type="button" data-edit="' + esc(event.id) + '">Edit</button>' : '') + '</div>';
    }).join('') : '<p class="empty">No dates entered for this month.' + (canAddDates() ? ' Click a day to add one.' : '') + '</p>';
  }
  function renderSetup() {
    $('setupRows').innerHTML = state.series.map(function (series) {
      return '<div class="setup-row" data-id="' + esc(series.id) + '"><input type="text" value="' + esc(series.name) + '" maxlength="80" aria-label="Series name"><input type="color" value="' + colour(series.colour) + '" aria-label="Series colour"><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload ' + esc(series.name) + ' logo"><button class="remove-series" type="button" aria-label="Remove ' + esc(series.name) + '" ' + (series.id === 's15' ? 'disabled' : '') + '>×</button></div>';
    }).join('');
    $('adminArea').hidden = !isAdmin();
    if (isAdmin()) renderAdminLists();
  }
  function renderAdminLists() {
    var representatives = adminProfiles.filter(function (entry) { return entry.role !== 'admin'; });
    $('profileAdminList').innerHTML = representatives.length ? representatives.map(function (entry) {
      var person = entry.display_name || 'Name not provided';
      var options = '<option value="">Choose club…</option>' + clubs.map(function (club) { return '<option value="' + esc(club.id) + '" ' + (entry.club_id === club.id ? 'selected' : '') + '>' + esc(club.name) + '</option>'; }).join('');
      return '<div class="admin-row" data-profile="' + esc(entry.user_id) + '"><div class="meta"><strong>' + esc(person) + '</strong><small>' + esc(entry.email) + ' · ' + (entry.approved ? 'Approved club representative' : 'Awaiting approval') + '</small></div><select aria-label="Club for ' + esc(person) + '">' + options + '</select><div class="file-actions"><button class="btn primary save-profile" type="button">' + (entry.approved ? 'Save' : 'Approve') + '</button>' + (entry.approved ? '<button class="btn danger revoke-profile" type="button">Revoke</button>' : '') + '</div></div>';
    }).join('') : '<p class="empty">No club representatives have signed in yet.</p>';
  }
  function renderAuthDialog() {
    $('signedOutPanel').hidden = !!user;
    $('signedInPanel').hidden = !user;
    if (user) {
      $('signedInEmail').textContent = profile && profile.display_name ? profile.display_name + ' · ' + (user.email || '') : (user.email || '');
      $('signedInAccess').textContent = !profile || !profile.approved ? 'Your account is awaiting administrator approval.' : isAdmin() ? 'Administrator access' : 'Approved for ' + (profileClubName() || 'your club');
      if ((!profile || !profile.approved) && user.user_metadata && user.user_metadata.club_name) {
        $('signedInAccess').textContent += ' Club: ' + user.user_metadata.club_name;
      }
    }
  }
  function render() {
    renderHeader();
    renderAccess();
    renderFilters();
    renderMonth();
    renderSetup();
  }

  function editor(event, day) {
    if (!canAddDates()) {
      if (!user) openAuth();
      else alert('Your account must be approved before you can add dates.');
      return;
    }
    editingId = event ? event.id : null;
    $('eventHeading').textContent = event ? 'Edit trial date' : 'Add trial date';
    ['startDate','endDate'].forEach(function (id) { $(id).min = state.year + '-01-01'; $(id).max = state.year + '-12-31'; });
    $('startDate').value = event ? event.start : (day || iso(state.year, month, 1));
    $('endDate').value = event ? event.end : $('startDate').value;
    $('endDate').min = $('startDate').value;
    $('eventSeries').innerHTML = state.series.map(function (series) { return '<option value="' + esc(series.id) + '">' + esc(series.name) + '</option>'; }).join('');
    $('eventSeries').value = event ? event.seriesId : (filter !== 'all' ? filter : state.series[0].id);
    $('eventClub').value = event ? event.club : (isAdmin() ? '' : profileClubName());
    $('eventClub').readOnly = !isAdmin();
    $('eventTitle').value = event ? event.title : '';
    $('deleteEvent').hidden = !event;
    $('eventDialog').showModal();
  }
  function proposed() {
    return {
      id: editingId,
      start: $('startDate').value,
      end: $('endDate').value,
      seriesId: $('eventSeries').value,
      club: $('eventClub').value.trim(),
      title: $('eventTitle').value.trim()
    };
  }
  function conflicts(event) {
    return sorted(state.events.filter(function (other) {
      return other.status !== 'rejected' && other.id !== event.id && event.start <= other.end && other.start <= event.end;
    }));
  }
  function clashDates(firstEvent, secondEvent) {
    var first = firstEvent.start > secondEvent.start ? firstEvent.start : secondEvent.start;
    var last = firstEvent.end < secondEvent.end ? firstEvent.end : secondEvent.end;
    var dates = [];
    for (var date = first; date <= last && dates.length < 32; date = nextDay(date)) dates.push(dateLabel(date));
    return dates.length > 31 ? dateLabel(first) + ' – ' + dateLabel(last) : dates.join(', ');
  }
  async function resolveClub(name) {
    var normalised = name.trim();
    var existing = clubs.find(function (club) { return club.name.toLowerCase() === normalised.toLowerCase(); });
    if (existing) return existing;
    if (!isAdmin()) throw new Error('Your account is not assigned to a club.');
    var result = await client.from('clubs').insert({name: normalised}).select('id,name').single();
    if (result.error && result.error.code === '23505') {
      var retry = await client.from('clubs').select('id,name').ilike('name', normalised).limit(1).maybeSingle();
      if (retry.error || !retry.data) throw (retry.error || result.error);
      existing = retry.data;
    } else {
      if (result.error) throw result.error;
      existing = result.data;
    }
    clubs.push(existing);
    return existing;
  }
  async function commit(event) {
    if (!client || !canAddDates()) return;
    try {
      var club = isAdmin() ? await resolveClub(event.club) : clubForId(profile.club_id);
      if (!club) throw new Error('Your account is not assigned to a club.');
      var payload = {
        start_date: event.start,
        end_date: event.end,
        series_id: event.seriesId,
        club_id: club.id,
        title: event.title,
        status: 'approved',
        created_by: user.id
      };
      var result = editingId ? await client.from('events').update(payload).eq('id', editingId) : await client.from('events').insert(payload);
      if (result.error) throw result.error;
      selectedDay = event.start;
      month = Number(event.start.slice(5, 7)) - 1;
      $('eventDialog').close();
      await loadRemoteData();
      toast('Trial date saved and published');
    } catch (error) {
      alert(messageForError(error, 'The trial date could not be saved.'));
    }
  }

  async function prepareLogo(file) {
    if (!file) return null;
    if (['image/png','image/jpeg','image/webp'].indexOf(file.type) < 0) { alert('Choose a PNG, JPG or WebP image.'); return null; }
    if (file.size > 5 * 1024 * 1024) { alert('Choose an image under 5 MB.'); return null; }
    return new Promise(function (resolve) {
      var image = new Image();
      var reader = new FileReader();
      reader.onerror = function () { alert('Could not read the logo.'); resolve(null); };
      reader.onload = function () { image.src = reader.result; };
      image.onerror = function () { alert('Could not open the logo.'); resolve(null); };
      image.onload = function () {
        var scale = Math.min(1, 420 / image.width, 200 / image.height);
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.84));
      };
      reader.readAsDataURL(file);
    });
  }

  async function loadProfile() {
    profile = null;
    if (!client || !user) return;
    var result = await client.from('profiles').select('user_id,email,display_name,club_id,role,approved').eq('user_id', user.id).maybeSingle();
    if (!result.error) profile = result.data;
  }
  async function loadAdminProfiles() {
    adminProfiles = [];
    if (!client || !isAdmin()) return;
    var result = await client.from('profiles').select('user_id,email,display_name,club_id,role,approved').order('email');
    if (!result.error) adminProfiles = result.data || [];
  }
  function mapEvent(row) {
    var relatedClub = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs;
    var club = relatedClub || clubForId(row.club_id);
    return {
      id: String(row.id),
      start: row.start_date,
      end: row.end_date,
      seriesId: row.series_id,
      clubId: row.club_id,
      club: club ? club.name : 'Unknown club',
      title: row.title,
      status: row.status || 'approved'
    };
  }
  async function loadRemoteData() {
    if (!client || loadingRemote) return;
    loadingRemote = true;
    try {
      await loadProfile();
      var results = await Promise.all([
        client.from('series').select('id,name,colour,logo,sort_order').order('sort_order'),
        client.from('clubs').select('id,name').order('name'),
        client.from('events').select('id,start_date,end_date,series_id,club_id,title,status,clubs(name)').order('start_date'),
        client.from('app_settings').select('header_logo').eq('id', 'main').maybeSingle()
      ]);
      var failed = results.find(function (result) { return result.error; });
      if (failed) throw failed.error;
      state.series = (results[0].data || []).map(function (series) { return {id:String(series.id), name:series.name, colour:colour(series.colour), logo:safeLogo(series.logo)}; });
      clubs = results[1].data || [];
      state.events = (results[2].data || []).map(mapEvent);
      state.acuLogo = safeLogo(results[3].data && results[3].data.header_logo);
      await loadAdminProfiles();
      remoteReady = true;
      connectionError = '';
      saveCache();
      render();
    } catch (error) {
      connectionError = error && error.message ? error.message : 'Connection unavailable';
      renderAccess();
    } finally {
      loadingRemote = false;
    }
  }
  async function applyPendingRegistrationName() {
    if (!client || !user) return;
    var name = '';
    try { name = (localStorage.getItem(REGISTRATION_NAME_KEY) || '').trim(); } catch (error) {}
    if (!name) return;
    var result = await client.rpc('set_my_calendar_display_name', {requested_name:name});
    if (!result.error) {
      try { localStorage.removeItem(REGISTRATION_NAME_KEY); } catch (error) {}
    }
  }
  async function notifyAdministratorOfAccessRequest(session) {
    if (!session || !session.access_token || !profile || profile.approved || notificationAttemptedFor === user.id) return;
    notificationAttemptedFor = user.id;
    try {
      var response = await fetch('/api/access-request', {
        method: 'POST',
        headers: {'Content-Type':'application/json', Authorization:'Bearer ' + session.access_token},
        body: '{}'
      });
      if (response.ok) {
        var result = await response.json();
        if (result.sent) toast('Access request sent to the administrator');
      } else {
        console.warn('Administrator access notification was not sent.');
      }
    } catch (error) {
      console.warn('Administrator access notification was not sent.');
    }
  }
  async function refreshSession(session) {
    user = session && session.user ? session.user : null;
    await applyPendingRegistrationName();
    await loadRemoteData();
    await notifyAdministratorOfAccessRequest(session);
    renderAuthDialog();
  }
  function subscribeToChanges() {
    if (!client || realtimeChannel) return;
    realtimeChannel = client.channel('peak-trials-calendar')
      .on('postgres_changes', {event:'*', schema:'public', table:'events'}, function () { loadRemoteData(); })
      .subscribe();
  }
  async function connectRemote() {
    setConnectionStatus('Connecting…', '');
    try {
      var response = await fetch('/api/config', {cache:'no-store'});
      if (!response.ok) throw new Error('Supabase configuration is not available yet.');
      var config = await response.json();
      if (!config.url || !config.key || !window.supabase) throw new Error('Supabase configuration is incomplete.');
      client = window.supabase.createClient(config.url, config.key, {auth:{persistSession:true, detectSessionInUrl:true, autoRefreshToken:true}});
      var sessionResult = await client.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      client.auth.onAuthStateChange(function (_event, session) {
        setTimeout(function () { refreshSession(session); }, 0);
      });
      await refreshSession(sessionResult.data.session);
      subscribeToChanges();
    } catch (error) {
      connectionError = error && error.message ? error.message : 'Connection unavailable';
      remoteReady = false;
      renderAccess();
    }
  }
  async function preloadDefaultLogo() {
    if (safeLogo(DEFAULT_GROUP_LOGO)) { defaultLogoData = DEFAULT_GROUP_LOGO; return; }
    try {
      var response = await fetch(DEFAULT_GROUP_LOGO);
      if (!response.ok) return;
      var blob = await response.blob();
      defaultLogoData = await new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { resolve(''); };
        reader.readAsDataURL(blob);
      });
      renderHeader();
    } catch (error) {}
  }

  function openAuth() {
    renderAuthDialog();
    $('authDialog').showModal();
  }
  $('authButton').onclick = openAuth;
  $('cancelAuth').onclick = function () { $('authDialog').close(); };
  $('closeAuth').onclick = function () { $('authDialog').close(); };
  $('authForm').onsubmit = async function (event) {
    event.preventDefault();
    if (!client) { alert('The live connection is not ready. Refresh the page and try again.'); return; }
    var name = $('authName').value.trim().replace(/\s+/g, ' ');
    var clubName = $('authClub').value.trim().replace(/\s+/g, ' ');
    var email = $('authEmail').value.trim().toLowerCase();
    if (!this.reportValidity()) return;
    if (!clubName) { alert('Enter your club name.'); $('authClub').focus(); return; }
    if (!name || !email) return;
    var button = this.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      try { localStorage.setItem(REGISTRATION_NAME_KEY, name); } catch (error) {}
      var result = await client.auth.signInWithOtp({email:email, options:{emailRedirectTo:location.origin + '/', shouldCreateUser:true, data:{display_name:name, club_name:clubName}}});
      if (result.error) throw result.error;
      $('authDialog').close();
      toast('Sign-in link sent to ' + email);
    } catch (error) {
      try { localStorage.removeItem(REGISTRATION_NAME_KEY); } catch (storageError) {}
      alert(messageForError(error, 'The sign-in email could not be sent.'));
    } finally {
      button.disabled = false;
    }
  };
  $('signOut').onclick = async function () {
    if (!client) return;
    await client.auth.signOut();
    user = null;
    profile = null;
    notificationAttemptedFor = '';
    $('authDialog').close();
    await loadRemoteData();
    toast('Signed out');
  };

  $('newEvent').onclick = function () { editor(null, selectedDay.slice(0, 4) === String(state.year) ? selectedDay : iso(state.year, month, 1)); };
  $('openSetup').onclick = async function () {
    if (!isAdmin()) return;
    await loadAdminProfiles();
    renderSetup();
    $('setupDialog').showModal();
  };
  $('closeSetup').onclick = function () { $('setupDialog').close(); };
  $('cancelEvent').onclick = function () { $('eventDialog').close(); };
  function moveMonth(step) {
    month += step;
    if (month < 0) { month = 11; state.year--; }
    if (month > 11) { month = 0; state.year++; }
    selectedDay = '';
    saveCache();
    render();
  }
  $('previousMonth').onclick = function () { moveMonth(-1); };
  $('nextMonth').onclick = function () { moveMonth(1); };
  $('yearInput').onchange = function () {
    var value = Number(this.value);
    if (!Number.isInteger(value) || value < 1900 || value > 2100) { this.value = state.year; return; }
    state.year = value;
    selectedDay = '';
    saveCache();
    render();
  };
  $('mobileFilter').onchange = function (event) { filter = event.target.value; render(); };
  $('seriesList').onclick = function (event) { var button = event.target.closest('[data-filter]'); if (button) { filter = button.dataset.filter; render(); } };
  $('monthButtons').onclick = function (event) { var button = event.target.closest('[data-month]'); if (button) { month = Number(button.dataset.month); renderMonth(); } };
  $('calendarGrid').onclick = function (event) {
    var button = event.target.closest('[data-edit]');
    if (button) { var entry = state.events.find(function (item) { return item.id === button.dataset.edit; }); if (entry) editor(entry); return; }
    button = event.target.closest('[data-day]');
    if (button && canAddDates()) { selectedDay = button.dataset.day; editor(null, selectedDay); }
  };
  $('agendaList').onclick = function (event) {
    var button = event.target.closest('[data-edit]');
    if (!button) return;
    var entry = state.events.find(function (item) { return item.id === button.dataset.edit; });
    if (entry) editor(entry);
  };
  $('startDate').onchange = function () { if ($('endDate').value < this.value) $('endDate').value = this.value; $('endDate').min = this.value; };
  $('eventForm').onsubmit = function (event) {
    event.preventDefault();
    if (!this.reportValidity()) return;
    var entry = proposed();
    if (entry.end < entry.start) { alert('The last date must be on or after the first date.'); return; }
    if (!entry.club || !entry.title) { alert('Enter both the club and event title.'); return; }
    var clashes = conflicts(entry);
    if (!clashes.length) { commit(entry); return; }
    pending = entry;
    $('clashList').innerHTML = clashes.map(function (other) { return '<li><strong>' + esc(clashDates(entry, other)) + '</strong><br>' + esc(other.title) + ' — ' + esc(seriesFor(other).name) + ' · ' + esc(other.club) + '</li>'; }).join('');
    $('clashDialog').showModal();
  };
  $('backToEvent').onclick = function () { pending = null; $('clashDialog').close(); };
  $('confirmClash').onclick = function () { if (!pending) return; var entry = pending; pending = null; $('clashDialog').close(); commit(entry); };
  $('deleteEvent').onclick = async function () {
    if (!editingId || !confirm('Delete this trial date?')) return;
    var result = await client.from('events').delete().eq('id', editingId);
    if (result.error) { alert(messageForError(result.error, 'The trial date could not be deleted.')); return; }
    $('eventDialog').close();
    await loadRemoteData();
    toast('Trial date deleted');
  };

  $('acuUpload').onchange = async function (event) {
    var logo = await prepareLogo(event.target.files[0]);
    if (!logo) return;
    var result = await client.from('app_settings').upsert({id:'main', header_logo:logo});
    if (result.error) { alert(messageForError(result.error, 'The app logo could not be updated.')); return; }
    state.acuLogo = logo;
    saveCache();
    renderHeader();
    toast('App logo updated');
  };
  $('resetHeaderLogo').onclick = async function () {
    var result = await client.from('app_settings').upsert({id:'main', header_logo:''});
    if (result.error) { alert(messageForError(result.error, 'The app logo could not be reset.')); return; }
    state.acuLogo = '';
    saveCache();
    $('acuUpload').value = '';
    renderHeader();
    toast('Peak District logo restored');
  };
  $('setupRows').onchange = async function (event) {
    var row = event.target.closest('[data-id]');
    if (!row || !isAdmin()) return;
    var series = state.series.find(function (item) { return item.id === row.dataset.id; });
    if (!series) return;
    if (event.target.type === 'text') {
      var name = event.target.value.trim();
      if (!name) { event.target.value = series.name; return; }
      series.name = name;
    } else if (event.target.type === 'color') {
      series.colour = event.target.value;
    } else if (event.target.type === 'file') {
      var logo = await prepareLogo(event.target.files[0]);
      if (!logo) return;
      series.logo = logo;
    }
    var result = await client.from('series').update({name:series.name, colour:series.colour, logo:series.logo}).eq('id', series.id);
    if (result.error) { alert(messageForError(result.error, 'The series could not be updated.')); await loadRemoteData(); return; }
    saveCache();
    render();
    toast('Series updated');
  };
  $('setupRows').onclick = async function (event) {
    var button = event.target.closest('.remove-series');
    if (!button || !isAdmin()) return;
    var row = button.closest('[data-id]');
    var series = state.series.find(function (item) { return item.id === row.dataset.id; });
    if (!series || series.id === 's15') return;
    var count = state.events.filter(function (item) { return item.seriesId === series.id; }).length;
    if (!confirm(count ? 'Remove ' + series.name + '? Its ' + count + ' event(s) will move to Others.' : 'Remove ' + series.name + ' from the dropdown?')) return;
    var moved = await client.from('events').update({series_id:'s15'}).eq('series_id', series.id);
    if (moved.error) { alert(messageForError(moved.error, 'The events could not be moved.')); return; }
    var removed = await client.from('series').delete().eq('id', series.id);
    if (removed.error) { alert(messageForError(removed.error, 'The series could not be removed.')); return; }
    if (filter === series.id) filter = 'all';
    await loadRemoteData();
    toast('Series removed');
  };
  $('addSeries').onclick = async function () {
    var name = $('newSeriesName').value.trim();
    if (!name) { $('newSeriesName').focus(); return; }
    var entry = {id:makeId(), name:name, colour:'#286aa0', logo:'', sort_order:state.series.length};
    var result = await client.from('series').insert(entry);
    if (result.error) { alert(messageForError(result.error, 'The series could not be added.')); return; }
    $('newSeriesName').value = '';
    await loadRemoteData();
    toast('Series added');
  };

  $('addClub').onclick = async function () {
    var name = $('newClubName').value.trim();
    if (!name) { $('newClubName').focus(); return; }
    try {
      await resolveClub(name);
      $('newClubName').value = '';
      await loadRemoteData();
      toast('Club added');
    } catch (error) {
      alert(messageForError(error, 'The club could not be added.'));
    }
  };
  $('profileAdminList').onclick = async function (event) {
    var row = event.target.closest('[data-profile]');
    if (!row) return;
    var userId = row.dataset.profile;
    if (event.target.closest('.save-profile')) {
      var clubId = row.querySelector('select').value;
      if (!clubId) { alert('Choose a club before approving this representative.'); return; }
      var saved = await client.from('profiles').update({club_id:clubId, role:'club', approved:true}).eq('user_id', userId);
      if (saved.error) { alert(messageForError(saved.error, 'The representative could not be approved.')); return; }
      await loadAdminProfiles(); renderAdminLists(); toast('Club access saved');
    }
    if (event.target.closest('.revoke-profile')) {
      if (!confirm('Revoke this representative’s editing access?')) return;
      var revoked = await client.from('profiles').update({approved:false, access_notification_sent_at:null}).eq('user_id', userId);
      if (revoked.error) { alert(messageForError(revoked.error, 'Access could not be revoked.')); return; }
      await loadAdminProfiles(); renderAdminLists(); toast('Club access revoked');
    }
  };
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], {type:type}));
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function subscriptionAddress() { return location.origin + '/api/calendar.ics'; }
  $('calendarSubscribe').onclick = function () {
    var address = subscriptionAddress();
    $('subscriptionUrl').value = address;
    $('deviceSubscribe').href = address.replace(/^https?:/i, 'webcal:');
    $('subscribeDialog').showModal();
  };
  $('closeSubscribe').onclick = function () { $('subscribeDialog').close(); };
  $('copySubscriptionLink').onclick = async function () {
    var input = $('subscriptionUrl');
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(input.value);
      else {
        input.focus();
        input.select();
        document.execCommand('copy');
      }
      toast('Calendar subscription link copied');
    } catch (error) {
      input.focus();
      input.select();
      toast('Select and copy the calendar link');
    }
  };
  $('backupExport').onclick = function () { download('peak-district-trials-dates-backup-' + state.year + '.json', JSON.stringify(state, null, 2), 'application/json'); };
  $('backupImport').onchange = async function (event) {
    var file = event.target.files[0];
    if (!file) return;
    try {
      var data = JSON.parse(await file.text());
      if (!Number.isInteger(data.year) || data.year < 1900 || data.year > 2100 || !Array.isArray(data.series) || !Array.isArray(data.events) || !data.series.some(function (series) { return series.id === 's15'; })) throw new Error('Invalid data');
      if (!confirm('Replace all centrally stored dates with this backup?')) return;
      var cleared = await client.from('events').delete().gte('start_date', '1900-01-01');
      if (cleared.error) throw cleared.error;
      for (var seriesIndex = 0; seriesIndex < data.series.length; seriesIndex++) {
        var sourceSeries = data.series[seriesIndex];
        var seriesResult = await client.from('series').upsert({id:String(sourceSeries.id), name:String(sourceSeries.name), colour:colour(sourceSeries.colour), logo:safeLogo(sourceSeries.logo), sort_order:seriesIndex});
        if (seriesResult.error) throw seriesResult.error;
      }
      for (var eventIndex = 0; eventIndex < data.events.length; eventIndex++) {
        var sourceEvent = data.events[eventIndex];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceEvent.start) || !/^\d{4}-\d{2}-\d{2}$/.test(sourceEvent.end) || sourceEvent.end < sourceEvent.start || !sourceEvent.title || !sourceEvent.club || !sourceEvent.seriesId) throw new Error('Invalid event data');
        var eventClub = await resolveClub(String(sourceEvent.club));
        var inserted = await client.from('events').insert({start_date:sourceEvent.start, end_date:sourceEvent.end, series_id:String(sourceEvent.seriesId), club_id:eventClub.id, title:String(sourceEvent.title), status:sourceEvent.status === 'rejected' ? 'rejected' : 'approved', created_by:user.id});
        if (inserted.error) throw inserted.error;
      }
      var settingsResult = await client.from('app_settings').upsert({id:'main', header_logo:safeLogo(data.acuLogo)});
      if (settingsResult.error) throw settingsResult.error;
      state.year = data.year;
      month = 0;
      filter = 'all';
      selectedDay = '';
      await loadRemoteData();
      toast('Backup imported');
    } catch (error) {
      alert(messageForError(error, 'This is not a valid Trials Dates backup.'));
    } finally {
      event.target.value = '';
    }
  };

  function printContent() {
    var logo = headerLogoValue();
    $('printSheet').innerHTML = '<div class="print-heading"><img src="' + logo + '" alt="Peak District Trials Group logo"><h1>' + state.year + ' UK TRIALS DATES</h1></div>' +
      Array.from({length:12}, function (_, index) {
        var events = monthEntries(index, true, true);
        return '<section class="print-month"><h2>' + monthName(index) + '</h2>' + (events.length ? events.map(function (event) {
          var series = seriesFor(event);
          return '<div class="print-line"><span class="when">' + esc(range(event)) + '</span>' + logoTag(series.logo, series.name) + '<span class="what"><strong>' + esc(event.title) + '</strong><br>' + esc(series.name) + ' · ' + esc(event.club) + '</span></div>';
        }).join('') : '<div class="print-line">No dates entered</div>') + '</section>';
      }).join('') + '<p class="print-note">' + esc(NOTE) + '</p>';
  }
  function showExportNotice() {
    alert('Dates are subject to change, Subscribe to calendar for the most up to date events');
  }
  $('pdfExport').onclick = function () { showExportNotice(); printContent(); window.print(); };
  $('htmlExport').onclick = function () {
    showExportNotice();
    var logo = headerLogoValue();
    var sections = Array.from({length:12}, function (_, index) {
      var events = monthEntries(index, true, true);
      return '<section id="m' + index + '"><h2>' + monthName(index) + '</h2>' + (events.length ? events.map(function (event) {
        var series = seriesFor(event);
        return '<article style="border-left-color:' + colour(series.colour) + '"><div class="date">' + esc(range(event)) + '</div><div class="detail">' + logoTag(series.logo, series.name) + '<div><strong>' + esc(event.title) + '</strong><small>' + esc(series.name) + ' · ' + esc(event.club) + '</small></div></div></article>';
      }).join('') : '<p class="none">No dates entered</p>') + '</section>';
    }).join('');
    var months = Array.from({length:12}, function (_, index) { return '<a href="#m' + index + '">' + monthName(index).slice(0, 3) + '</a>'; }).join('');
    var mobile = '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + state.year + ' UK TRIALS DATES</title>' +
      '<style>*{box-sizing:border-box}body{margin:0;background:#f2f5f8;color:#15263a;font:16px/1.45 system-ui,sans-serif}header{background:#102b46;color:white;padding:21px 17px;display:flex;align-items:center;gap:15px}header img{width:78px;height:78px;object-fit:contain;background:white;border-radius:50%;padding:3px}h1{font-size:27px;line-height:1.12;margin:0}nav{display:flex;gap:7px;overflow-x:auto;padding:12px;position:sticky;top:0;background:white;border-bottom:1px solid #dce3ea}nav a{white-space:nowrap;color:#3333cc;text-decoration:none;background:#eeeeff;border-radius:7px;padding:9px}main{max-width:720px;margin:auto;padding:0 14px 25px}section{scroll-margin-top:66px}h2{margin:27px 0 9px;border-bottom:3px solid #3333cc;padding-bottom:6px}article{background:white;border-left:5px solid #3333cc;border-radius:8px;padding:13px;margin:8px 0;box-shadow:0 2px 9px #1225360e}.date{color:#3333cc;font-weight:800}.detail{display:flex;align-items:center;gap:10px;margin-top:5px}.detail img{width:42px;height:36px;object-fit:contain}strong,small{display:block}small,.none,footer{color:#637487}footer{padding:17px;background:white;font-size:13px}</style></head><body>' +
      '<header><img src="' + logo + '" alt="Peak District Trials Group logo"><h1>' + state.year + ' UK TRIALS DATES</h1></header><nav aria-label="Months">' + months + '</nav><main>' + sections + '</main><footer>' + esc(NOTE) + '</footer></body></html>';
    download('peak-district-trials-dates-' + state.year + '-mobile.html', mobile, 'text/html;charset=utf-8');
  };
  render();
  preloadDefaultLogo();
  connectRemote();
})();
