/* Fit Tracker - all data stays in this browser (localStorage). No server. */
(function () {
  'use strict';
  var KEY = 'fit-tracker.v1';
  var APP_VERSION = '1.0.2';
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MEALS = ['Breakfast', 'Lunch', 'Snack', 'Dinner', 'Evening'];
  var EXPORT_WEEKS = 39;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { if (v === '' || v == null) return null; var n = parseFloat(v); return isNaN(n) ? null : n; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function r0(n) { return Math.round(n); }

  /* ---------- dates (local calendar days, no time zones) ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function dayDiff(a, b) { var x = a.split('-'), y = b.split('-'); return Math.round((Date.UTC(+y[0], +y[1] - 1, +y[2]) - Date.UTC(+x[0], +x[1] - 1, +x[2])) / 864e5); }
  function wd(s) { return (parse(s).getDay() + 6) % 7; }            // 0 = Mon
  function todayIso() { return iso(new Date()); }
  function nice(s) { return parse(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
  function mondayOnOrBefore(s) { return addDays(s, -wd(s)); }

  /* ---------- state ---------- */
  var S = null, cur = todayIso(), tab = 'today', foodTab = 'plan', foodDay = null, saveT = null;
  function blank() { return { v: 1, profile: null, settings: null, strength: {}, cardio: {}, daily: {}, mealPlan: null, foodLog: {}, foods: [], videos: {}, weekly: {} }; }
  function load() {
    try { var raw = localStorage.getItem(KEY); S = raw ? JSON.parse(raw) : blank(); } catch (e) { S = blank(); }
    ['strength', 'cardio', 'daily', 'foodLog', 'videos', 'weekly'].forEach(function (k) { if (!S[k]) S[k] = {}; });
    if (!S.foods) S.foods = [];
  }
  function save() { clearTimeout(saveT); saveT = setTimeout(flush, 250); }
  function flush() { clearTimeout(saveT); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save: storage is full or blocked'); } }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  function P() { return window.PLANS[S.profile.plan]; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- plan logic (same rules as the Excel tracker) ---------- */
  function weekOf(d) { return Math.floor(dayDiff(S.settings.start, d) / 7) + 1; }
  function dateFor(w, off) { return addDays(S.settings.start, (w - 1) * 7 + off); }
  function isDeload(w) { return w > 4 && (w - 4) % 6 === 0; }
  function weekType(w) { return w <= 4 ? 'Starter: 4 exercises, 2 sets' : isDeload(w) ? 'Lighter week: 2 sets' : 'Normal week'; }
  function targetSets(ex, w) {
    if (w <= 4) return ex.tier === 'core' ? 2 : 0;
    return isDeload(w) ? Math.min(2, ex.base) : ex.base;
  }
  function cardioList(w) { return w <= 4 ? P().cardioStart : P().cardioFull; }
  function sKey(w, si, ex) { return w + '|' + si + '|' + ex.id; }
  function cKey(w, c) { return w + '|' + c.off + '|' + c.name; }
  function sRec(k) { return S.strength[k] || { sets: [], eff: '', notes: '' }; }
  function setsFilled(rec) { return (rec.sets || []).filter(function (s) { return s && num(s.reps) != null; }); }
  function bestKg(rec) { var m = 0; (rec.sets || []).forEach(function (s) { var k = s ? num(s.kg) : null; if (k != null && k > m) m = k; }); return m || null; }
  function cueFor(ex, w, rec) {
    var eff = num(rec.eff), lim = num(S.settings.limit);
    if (eff != null && lim != null && eff > lim) return { cls: 'bad', text: P().limitCue };
    var f = setsFilled(rec), t = targetSets(ex, w);
    if (t > 0 && f.length >= t && Math.min.apply(null, f.map(function (s) { return num(s.reps); })) >= ex.hi) return { cls: 'good', text: 'Top of range hit: add weight next time' };
    return null;
  }

  /* ---------- food ---------- */
  function foods() { return window.FOODS.concat(S.foods); }
  function foodMap() { var m = {}; foods().forEach(function (f) { m[f.name] = f; }); return m; }
  function itemTotals(items, fm) {
    var t = { kcal: 0, p: 0, c: 0, f: 0, unknown: 0 };
    (items || []).forEach(function (it) { var f = fm[it.food], sv = num(it.sv) || 0; if (!f) { t.unknown++; return; } t.kcal += f.kcal * sv; t.p += f.p * sv; t.c += f.c * sv; t.f += f.f * sv; });
    return t;
  }
  function isVegDay(d) { return P().vegDays.indexOf(wd(d) + 1) >= 0; }
  function dayNutrition(d) {
    var rec = S.daily[d] || {}, fm = foodMap();
    if (rec.fol === 'Y') { var t = itemTotals(S.mealPlan[DAYS[wd(d)]], fm); return { kcal: r0(t.kcal + (num(rec.xk) || 0)), p: r0(t.p + (num(rec.xp) || 0)), src: 'Meal plan' + ((num(rec.xk) || num(rec.xp)) ? ' + extras' : '') }; }
    var log = S.foodLog[d];
    if (log && log.length) { var u = itemTotals(log, fm); return { kcal: r0(u.kcal), p: r0(u.p), src: 'Food log' }; }
    return { kcal: null, p: null, src: '' };
  }

  /* ---------- weekly aggregates ---------- */
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function weekAgg(w) {
    var W = [], St = [], Sl = [], K = [], Pr = [], B1 = [], B2 = [], onPlan = 0, i;
    for (i = 0; i < 7; i++) {
      var d = dateFor(w, i), r = S.daily[d] || {}, n = dayNutrition(d);
      if (num(r.w) != null) W.push(num(r.w)); if (num(r.steps) != null) St.push(num(r.steps)); if (num(r.sleep) != null) Sl.push(num(r.sleep));
      if (n.kcal != null) { K.push(n.kcal); Pr.push(n.p); }
      if (num(r.bpS) != null) B1.push(num(r.bpS)); if (num(r.bpD) != null) B2.push(num(r.bpD));
      if (r.fol === 'Y') onPlan++;
    }
    var sd = 0, st = 0, cd = 0, ct = 0;
    P().sessions.forEach(function (s, si) { s.ex.forEach(function (ex) { if (targetSets(ex, w) > 0) { st++; if (setsFilled(sRec(sKey(w, si, ex))).length) sd++; } }); });
    cardioList(w).forEach(function (c) { ct++; var r = S.cardio[cKey(w, c)]; if (r && num(r.min) > 0) cd++; });
    return { w: w, start: dateFor(w, 0), weight: avg(W), steps: avg(St), sleep: avg(Sl), kcal: avg(K), prot: avg(Pr), bpS: avg(B1), bpD: avg(B2), onPlan: onPlan, sd: sd, st: st, cd: cd, ct: ct };
  }
  function bmi(kg) { var h = num(S.settings.height) / 100; return kg && h ? r1(kg / (h * h)) : null; }

  /* ---------- small UI helpers ---------- */
  var toastT;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2600); }
  function modal(html) { $('#modal-body').innerHTML = html; $('#modal').hidden = false; }
  function closeModal() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }
  function field(label, attrs, val) { return '<label class="f"><span>' + esc(label) + '</span><input ' + attrs + ' value="' + esc(val == null ? '' : val) + '"></label>'; }
  function bar(v, target, lowerIsBetter) {
    if (v == null || !target) return '<div class="bar"><i style="width:0"></i></div>';
    var pct = Math.min(100, Math.round(v / target * 100)), over = lowerIsBetter && v > target * 1.05;
    return '<div class="bar"><i class="' + (over ? 'over' : '') + '" style="width:' + pct + '%"></i></div>';
  }
  function foodOptions(sel) {
    var has = false, h = foods().map(function (f) { if (f.name === sel) has = true; return '<option' + (f.name === sel ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('');
    return (has || !sel ? '' : '<option selected>' + esc(sel) + '</option>') + h;
  }

  /* ---------- shell ---------- */
  function render() {
    var onboard = !S.profile;
    $('#tabs').hidden = onboard;
    $('#datebar').hidden = onboard || tab === 'progress' || tab === 'more';
    if (onboard) { $('#top-sub').textContent = 'Set up your profile'; $('#top-right').textContent = ''; return renderOnboard(); }
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    var w = weekOf(cur);
    $('#top-sub').textContent = S.profile.name + ' · ' + P().label.split(':')[0];
    $('#top-right').innerHTML = w >= 1 ? 'Week ' + w : 'Not started';
    $('#date-label').textContent = (cur === todayIso() ? 'Today, ' : '') + nice(cur);
    $('#date-input').value = cur;
    ({ today: renderToday, train: renderTrain, food: renderFood, progress: renderProgress, more: renderMore })[tab]();
  }
  function go(t) { tab = t; window.scrollTo(0, 0); render(); }
  function setDate(d) { cur = d; foodDay = null; render(); }

  /* ---------- onboarding ---------- */
  var obPlan = 'A';
  function renderOnboard() {
    var mon = mondayOnOrBefore(todayIso());
    $('#view').innerHTML =
      '<div class="card"><h2>Welcome</h2><p class="sub">Pick the plan for this phone. Everything you log stays on this device. You can export to Excel or make a backup any time.</p>' +
      field('Your name', 'type="text" id="ob-name" autocomplete="given-name" placeholder="Name"', '') + '</div>' +
      Object.keys(window.PLANS).map(function (k) { var p = window.PLANS[k]; return '<button class="plan-pick' + (k === obPlan ? ' on' : '') + '" data-act="ob-plan" data-plan="' + k + '"><b>' + esc(p.label) + '</b><span class="sub">' + esc(p.blurb) + '</span></button>'; }).join('') +
      '<div class="card">' + field('Program start date (a Monday)', 'type="date" id="ob-start"', mon) +
      '<p class="sub">Week 1 starts on this date. You can change it later in More.</p></div>' +
      '<button class="btn primary block" data-act="ob-go">Start</button>' +
      '<p class="sub" style="text-align:center;margin-top:14px">Have a backup file? <button class="btn small" data-act="restore">Restore it</button></p>';
  }
  function createProfile() {
    var name = $('#ob-name').value.trim() || 'Me', start = $('#ob-start').value || mondayOnOrBefore(todayIso());
    var p = window.PLANS[obPlan];
    S.profile = { plan: obPlan, name: name };
    S.settings = Object.assign({ start: start }, p.defaults);
    S.mealPlan = clone(p.meals);
    flush(); cur = todayIso(); tab = 'today'; render();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  }

  /* ---------- Today ---------- */
  function renderToday() {
    var w = weekOf(cur), h = '';
    if (w < 1) {
      h += '<div class="card"><h2>Program starts ' + esc(nice(S.settings.start)) + '</h2><p class="sub">You can still log weight, steps and food before then.</p><button class="btn small" data-act="goto-start">Go to start date</button></div>';
    } else {
      var items = [];
      P().sessions.forEach(function (s, si) { if (s.off === wd(cur)) { var t = 0, d = 0; s.ex.forEach(function (ex) { if (targetSets(ex, w) > 0) { t++; if (setsFilled(sRec(sKey(w, si, ex))).length) d++; } }); items.push({ name: s.name, sub: d + ' of ' + t + ' exercises logged', done: d >= t && t > 0 }); } });
      cardioList(w).forEach(function (c) { if (c.off === wd(cur)) { var r = S.cardio[cKey(w, c)]; items.push({ name: c.name, sub: c.plan, done: !!(r && num(r.min) > 0) }); } });
      h += '<div class="card"><div class="spread"><h2>Training</h2><span class="chip">' + esc(weekType(w)) + '</span></div>';
      if (!items.length) h += '<p class="sub">Rest day. An easy walk counts toward your steps.</p>';
      else h += items.map(function (it) { return '<div class="spread" style="margin-top:10px"><div><b>' + esc(it.name) + '</b><div class="sub">' + esc(it.sub) + '</div></div>' + (it.done ? '<span class="chip good">Done</span>' : '') + '</div>'; }).join('') + '<button class="btn primary block" style="margin-top:12px" data-act="tab" data-tab="train">Open workout</button>';
      h += '</div>';
    }
    var r = S.daily[cur] || {}, st = S.settings, plan = P();
    h += '<div class="card"><h2>Daily check-in</h2><div class="grid2" style="margin-top:8px">' +
      field('Weight (kg)', 'type="number" inputmode="decimal" step="0.1" data-d="w"', r.w) +
      field('Steps (target ' + st.steps + ')', 'type="number" inputmode="numeric" data-d="steps"', r.steps) +
      field('Sleep hours (target ' + st.sleep + ')', 'type="number" inputmode="decimal" step="0.5" data-d="sleep"', r.sleep) +
      (plan.track === 'bp'
        ? '<div class="grid2">' + field('BP sys', 'type="number" inputmode="numeric" data-d="bpS"', r.bpS) + field('BP dia', 'type="number" inputmode="numeric" data-d="bpD"', r.bpD) + '</div>'
        : field('Knee this morning (0-10)', 'type="number" inputmode="numeric" min="0" max="10" data-d="knee"', r.knee)) +
      '</div>' + (plan.track === 'bp' ? '<p class="sub" style="margin:6px 0 0">Blood pressure: same time each morning, seated, after 5 minutes of rest.</p>' : '') +
      '<label class="f" style="margin-top:10px"><span>Notes</span><textarea data-d="notes" rows="1">' + esc(r.notes || '') + '</textarea></label></div>';

    h += '<div class="card"><div class="spread"><h2>Food</h2>' + (isVegDay(cur) ? '<span class="chip good">Vegetarian day</span>' : '') + '</div>' +
      '<label class="f" style="margin-top:8px"><span>Followed the meal plan today?</span></label>' +
      '<div class="toggle"><button data-act="fol" data-v="Y" class="' + (r.fol === 'Y' ? 'on' : '') + '">Yes</button><button data-act="fol" data-v="N" class="no ' + (r.fol === 'N' ? 'on' : '') + '">No</button></div>' +
      '<div id="extras" class="grid2" style="margin-top:10px"' + (r.fol === 'Y' ? '' : ' hidden') + '>' +
      field('Extras kcal (+ or -)', 'type="number" inputmode="text" data-d="xk"', r.xk) + field('Extras protein g (+ or -)', 'type="number" inputmode="text" data-d="xp"', r.xp) + '</div>' +
      '<div id="nutri" style="margin-top:12px"></div>' +
      '<button class="btn block" style="margin-top:12px" data-act="tab" data-tab="food">Open food</button></div>';
    $('#view').innerHTML = h; refreshNutri();
  }
  function refreshNutri() {
    var el = $('#nutri'); if (!el) return;
    var n = dayNutrition(cur), st = S.settings;
    el.innerHTML = n.kcal == null
      ? '<p class="sub" style="margin:0">Nothing counted yet. Tap Yes if you followed the plan, or add items in the food log.</p>'
      : '<div class="grid2"><div class="stat"><b>' + n.kcal + '</b><span>kcal of ' + st.kcal + '</span>' + bar(n.kcal, st.kcal, true) + '</div><div class="stat"><b>' + n.p + ' g</b><span>protein of ' + st.prot + ' g</span>' + bar(n.p, st.prot) + '</div></div><p class="sub" style="margin:6px 0 0">From: ' + esc(n.src) + '</p>';
  }

  /* ---------- Train ---------- */
  function renderTrain() {
    var w = weekOf(cur), h = '';
    if (w < 1) { $('#view').innerHTML = '<div class="card"><h2>Program starts ' + esc(nice(S.settings.start)) + '</h2><button class="btn small" data-act="goto-start">Go to start date</button></div>'; return; }
    var cl = cardioList(w);
    h += '<div class="days">' + DAYS.map(function (d, i) {
      var has = P().sessions.some(function (s) { return s.off === i; }) || cl.some(function (c) { return c.off === i; });
      return '<button data-act="setdate" data-d="' + dateFor(w, i) + '" class="' + (i === wd(cur) ? 'on' : '') + '">' + d + (has ? '' : ' <span style="opacity:.5">rest</span>') + '</button>';
    }).join('') + '</div>';
    h += '<div class="sub" style="margin:-4px 2px 10px">Week ' + w + ' · ' + esc(weekType(w)) + '</div>';
    var any = false;
    P().sessions.forEach(function (s, si) {
      if (s.off !== wd(cur)) return; any = true;
      h += '<div class="card"><h2>' + esc(s.name) + '</h2><p class="sub" style="margin:0">Warm up 5 minutes first. Fill lb (or plate number) and ' + 'reps for each set.</p>';
      s.ex.forEach(function (ex) { h += exCard(ex, w, si); });
      h += '</div>';
    });
    cl.forEach(function (c) { if (c.off !== wd(cur)) return; any = true; h += cardioCard(c, w); });
    if (!any) h += '<div class="card"><h2>Rest day</h2><p class="sub">Nothing scheduled. Pick another day above.</p></div>';
    $('#view').innerHTML = h;
  }
  function unitLabel(u) { return u === 'sec' ? 'Seconds' : u === 'sec/side' ? 'Sec / side' : u === 'metres' ? 'Metres' : u === 'reps/side' ? 'Reps / side' : 'Reps'; }
  function exCard(ex, w, si) {
    var k = sKey(w, si, ex), rec = sRec(k), t = targetSets(ex, w);
    var head = '<div class="ex-head"><div><div class="ex-name">' + esc(ex.name) + '</div>';
    if (t === 0) return '<div class="ex later">' + head + '<div class="sub">Starts in week 5</div></div><button class="play" data-act="video" data-ex="' + ex.id + '">▶ Video</button></div></div>';
    var range = ex.lo === ex.hi ? ex.lo : ex.lo + '-' + ex.hi, prev = w > 1 ? bestKg(sRec(sKey(w - 1, si, ex))) : null;
    var n = Math.min(4, Math.max(t, (rec.sets || []).length)), rows = '';
    for (var i = 0; i < n; i++) {
      var s = (rec.sets || [])[i] || {};
      rows += '<div class="n">' + (i + 1) + '</div><input type="number" inputmode="decimal" step="any" aria-label="Set ' + (i + 1) + ' lb" data-s="' + esc(k) + '" data-i="' + i + '" data-f="kg" value="' + esc(s.kg == null ? '' : s.kg) + '">' +
        '<input type="number" inputmode="numeric" aria-label="Set ' + (i + 1) + ' ' + unitLabel(ex.unit) + '" data-s="' + esc(k) + '" data-i="' + i + '" data-f="reps" value="' + esc(s.reps == null ? '' : s.reps) + '">';
    }
    var cue = cueFor(ex, w, rec);
    return '<div class="ex" data-exwrap="' + esc(k) + '" data-exid="' + ex.id + '" data-si="' + si + '">' + head +
      '<div class="sub">' + t + ' sets × ' + range + ' ' + esc(ex.unit) + (prev ? ' · last week ' + prev + ' lb' : '') + '</div>' +
      (ex.note ? '<div class="sub">' + esc(ex.note) + '</div>' : '') + '</div>' +
      '<button class="play" data-act="video" data-ex="' + ex.id + '">▶ Video</button></div>' +
      '<div class="sets"><div class="h">Set</div><div class="h">Lb</div><div class="h">' + unitLabel(ex.unit) + '</div>' + rows + '</div>' +
      (n < 4 ? '<button class="btn small" style="margin-top:8px" data-act="addset" data-k="' + esc(k) + '">+ Set</button>' : '') +
      '<div class="meta">' + field(P().limitLabel, 'type="number" inputmode="numeric" min="0" max="10" data-s="' + esc(k) + '" data-f="eff"', rec.eff) +
      field('Notes', 'type="text" data-s="' + esc(k) + '" data-f="notes"', rec.notes) + '</div>' +
      '<div class="cue ' + (cue ? cue.cls : '') + '" data-cue="' + esc(k) + '">' + (cue ? esc(cue.text) : '') + '</div></div>';
  }
  function cardioCard(c, w) {
    var k = cKey(w, c), r = S.cardio[k] || {}, a = 'data-c="' + esc(k) + '"';
    return '<div class="card"><div class="spread"><h2>' + esc(c.name) + '</h2>' + (num(r.min) > 0 ? '<span class="chip good">Done</span>' : '') + '</div>' +
      '<p class="sub" style="margin:0 0 8px">' + esc(c.machine) + ' · ' + esc(c.plan) + '</p><div class="grid3">' +
      field('Minutes', 'type="number" inputmode="decimal" ' + a + ' data-f="min"', r.min) +
      field('Rounds', 'type="number" inputmode="numeric" ' + a + ' data-f="rounds"', r.rounds) +
      field('Avg HR', 'type="number" inputmode="numeric" ' + a + ' data-f="hr"', r.hr) +
      field('Distance / kcal', 'type="text" ' + a + ' data-f="dist"', r.dist) +
      field('Effort (1-10)', 'type="number" inputmode="numeric" min="1" max="10" ' + a + ' data-f="eff"', r.eff) +
      (P().track === 'bp'
        ? '<label class="f"><span>Felt unwell?</span><select ' + a + ' data-f="flag"><option value=""></option><option' + (r.flag === 'N' ? ' selected' : '') + '>N</option><option' + (r.flag === 'Y' ? ' selected' : '') + '>Y</option></select></label>'
        : field('Knee (0-10)', 'type="number" inputmode="numeric" min="0" max="10" ' + a + ' data-f="flag"', r.flag)) +
      '</div><label class="f" style="margin-top:8px"><span>Notes</span><input type="text" ' + a + ' data-f="notes" value="' + esc(r.notes || '') + '"></label></div>';
  }
  function findEx(id) { var f = null; P().sessions.forEach(function (s) { s.ex.forEach(function (e) { if (e.id === id) f = e; }); }); return f; }

  /* ---------- videos ---------- */
  function ytId(u) { var m = String(u).match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(u) ? u : null); }
  function showVideo(exId) {
    var ex = findEx(exId), id = S.videos[exId] || ex.vid, custom = !!S.videos[exId];
    var search = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(ex.q);
    modal('<div class="spread"><h3>' + esc(ex.name) + '</h3><button class="btn small" data-act="close">Close</button></div>' +
      (navigator.onLine === false ? '<p class="sub">You are offline. Videos need a connection.</p>' :
        '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/' + id + '?rel=0&playsinline=1" title="' + esc(ex.name) + ' video" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>') +
      (ex.note ? '<p class="sub">' + esc(ex.note) + '</p>' : '') +
      '<div class="row wrap"><a class="btn small" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=' + id + '">Open in YouTube</a>' +
      '<a class="btn small" target="_blank" rel="noopener" href="' + search + '">Find other videos</a></div>' +
      '<label class="f" style="margin-top:14px"><span>Use a different video (paste a YouTube link)</span><input type="url" id="vid-url" inputmode="url" placeholder="https://youtu.be/..."></label>' +
      '<div class="row" style="margin-top:8px"><button class="btn small primary" data-act="vid-save" data-ex="' + exId + '">Save link</button>' +
      (custom ? '<button class="btn small" data-act="vid-reset" data-ex="' + exId + '">Back to default</button>' : '') + '</div>');
  }

  /* ---------- Food ---------- */
  function renderFood() {
    if (!foodDay) foodDay = DAYS[wd(cur)];
    var h = '<div class="seg">' + [['plan', 'Meal plan'], ['log', 'Food log'], ['lib', 'Library']].map(function (t) { return '<button data-act="foodtab" data-t="' + t[0] + '" class="' + (foodTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    $('#view').innerHTML = h + (foodTab === 'plan' ? foodPlan() : foodTab === 'log' ? foodLogView() : foodLib());
    refreshFoodTotals();
  }
  function foodRow(it, i, where, veg, fm) {
    var f = fm[it.food], sv = num(it.sv) || 0;
    var sub = f ? (sv + ' × ' + esc(f.serving) + ' · ' + r0(f.kcal * sv) + ' kcal · ' + r1(f.p * sv) + ' g protein') : 'Not in the library';
    var warn = f && f.emf && veg ? ' <span class="chip bad">Not on a vegetarian day</span>' : '';
    return '<div class="food-row"><select aria-label="Food" data-fi="' + i + '" data-w="' + where + '" data-f="food">' + foodOptions(it.food) + '</select>' +
      '<input type="number" inputmode="decimal" step="0.25" aria-label="Servings" data-fi="' + i + '" data-w="' + where + '" data-f="sv" value="' + esc(it.sv) + '">' +
      '<button class="x" aria-label="Remove" data-act="food-del" data-i="' + i + '" data-w="' + where + '">×</button>' +
      '<div class="food-sub" data-fsub="' + where + i + '">' + sub + warn + '</div></div>';
  }
  function groupByMeal(items, where, veg) {
    var fm = foodMap(), h = '';
    MEALS.concat(['']).forEach(function (m) {
      var rows = ''; items.forEach(function (it, i) { if ((it.meal || '') === m || (m === '' && MEALS.indexOf(it.meal) < 0 && it.meal !== '')) rows += foodRow(it, i, where, veg, fm); });
      if (rows) h += '<div class="meal-h">' + esc(m || 'Other') + '</div>' + rows;
    });
    return h;
  }
  function addForm(where) {
    return '<div class="meal-h">Add an item</div><div class="food-row" style="grid-template-columns:110px 1fr"><select id="add-meal" aria-label="Meal">' + MEALS.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select>' +
      '<select id="add-food" aria-label="Food">' + foodOptions('') + '</select></div>' +
      '<div class="row" style="margin-top:8px"><input type="number" inputmode="decimal" step="0.25" id="add-sv" value="1" aria-label="Servings" style="width:90px"><button class="btn small primary" data-act="food-add" data-w="' + where + '">Add</button></div>';
  }
  function foodPlan() {
    var vegIdx = P().vegDays, items = S.mealPlan[foodDay] || [], veg = vegIdx.indexOf(DAYS.indexOf(foodDay) + 1) >= 0;
    return '<div class="days">' + DAYS.map(function (d, i) { return '<button data-act="foodday" data-day="' + d + '" class="' + (d === foodDay ? 'on' : '') + (vegIdx.indexOf(i + 1) >= 0 ? ' veg' : '') + '">' + d + '</button>'; }).join('') + '</div>' +
      '<div class="card"><div class="spread"><h2>' + foodDay + ' plan</h2>' + (veg ? '<span class="chip good">Vegetarian day</span>' : '') + '</div><div id="food-totals"></div></div>' +
      '<div class="card"><p class="sub" style="margin:0">Servings multiply the library serving. 1.5 of a "100 g" food is 150 g cooked.</p>' + groupByMeal(items, 'plan', veg) + addForm('plan') + '</div>' +
      '<button class="btn small" data-act="plan-reset">Reset ' + foodDay + ' to the original plan</button>';
  }
  function foodLogView() {
    var items = S.foodLog[cur] || [], veg = isVegDay(cur), rec = S.daily[cur] || {};
    return '<div class="card"><div class="spread"><h2>Log for ' + esc(nice(cur)) + '</h2>' + (veg ? '<span class="chip good">Vegetarian day</span>' : '') + '</div>' +
      (rec.fol === 'Y' ? '<p class="sub">This day is marked as "followed the meal plan", so the plan totals are used. Set that to No on Today to count this log.</p>' : '') + '<div id="food-totals"></div></div>' +
      '<div class="card">' + (items.length ? groupByMeal(items, 'log', veg) : '<p class="sub" style="margin:0">Nothing logged for this day.</p>') + addForm('log') + '</div>' +
      '<button class="btn small" data-act="log-copy">Copy this day\'s meal plan into the log</button>';
  }
  function foodLib() {
    var base = window.FOODS.length;
    return '<div class="card"><h2>Food library</h2><p class="sub">Approximate values from standard nutrition tables. Home cooking varies.</p><table class="t"><tr><th>Food</th><th>Serving</th><th>kcal</th><th>P</th><th></th></tr>' +
      foods().map(function (f, i) { return '<tr><td>' + esc(f.name) + (f.emf ? ' <span class="sub">(egg/meat/fish)</span>' : '') + '</td><td>' + esc(f.serving) + '</td><td>' + f.kcal + '</td><td>' + f.p + '</td><td>' + (i >= base ? '<button class="btn small" data-act="lib-del" data-i="' + (i - base) + '">×</button>' : '') + '</td></tr>'; }).join('') + '</table></div>' +
      '<div class="card"><h2>Add your own food</h2><div class="grid2" style="margin-top:8px">' + field('Name', 'type="text" id="nf-name"', '') + field('Serving (e.g. 1 cup)', 'type="text" id="nf-serv"', '') +
      field('kcal', 'type="number" inputmode="decimal" id="nf-kcal"', '') + field('Protein g', 'type="number" inputmode="decimal" id="nf-p"', '') +
      field('Carbs g', 'type="number" inputmode="decimal" id="nf-c"', '') + field('Fat g', 'type="number" inputmode="decimal" id="nf-f"', '') + '</div>' +
      '<label class="row" style="margin-top:10px"><input type="checkbox" id="nf-emf" style="width:20px;height:20px"> <span>Contains egg, meat or fish</span></label>' +
      '<button class="btn primary" style="margin-top:10px" data-act="lib-add">Add food</button></div>';
  }
  function foodItems(where) { if (where === 'plan') return S.mealPlan[foodDay] || (S.mealPlan[foodDay] = []); return S.foodLog[cur] || (S.foodLog[cur] = []); }
  function refreshFoodTotals() {
    var el = $('#food-totals'); if (!el) return;
    var t = itemTotals(foodTab === 'plan' ? S.mealPlan[foodDay] : S.foodLog[cur], foodMap()), st = S.settings;
    el.innerHTML = '<div class="grid2" style="margin-top:8px"><div class="stat"><b>' + r0(t.kcal) + '</b><span>kcal of ' + st.kcal + '</span>' + bar(t.kcal, st.kcal, true) + '</div><div class="stat"><b>' + r0(t.p) + ' g</b><span>protein of ' + st.prot + ' g</span>' + bar(t.p, st.prot) + '</div></div>' +
      '<p class="sub" style="margin:6px 0 0">Carbs ' + r0(t.c) + ' g · Fat ' + r0(t.f) + ' g</p>';
  }

  /* ---------- Progress ---------- */
  function lineChart(series, opts) {
    var W = 320, H = 150, L = 34, R = 8, T = 10, B = 22, all = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { all.push(p.y); }); });
    (opts.lines || []).forEach(function (l) { all.push(l.y); });
    if (all.length < 1) return '<p class="sub">Log a few days to see the chart.</p>';
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all); if (mx - mn < 2) { mx += 1; mn -= 1; }
    var pad2 = (mx - mn) * 0.1; mn -= pad2; mx += pad2;
    var xs = series[0].pts.map(function (p) { return p.x; }), x0 = Math.min.apply(null, xs), x1 = Math.max(Math.max.apply(null, xs), x0 + 1);
    var X = function (x) { return L + (x - x0) / (x1 - x0) * (W - L - R); }, Y = function (y) { return T + (mx - y) / (mx - mn) * (H - T - B); };
    var g = '';
    for (var i = 0; i <= 3; i++) { var yv = mn + (mx - mn) * i / 3; g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(yv) + '" y2="' + Y(yv) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 5) + '" y="' + (Y(yv) + 3) + '" font-size="9" text-anchor="end" fill="var(--muted)">' + r0(yv) + '</text>'; }
    (opts.lines || []).forEach(function (l) { g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(l.y) + '" y2="' + Y(l.y) + '" stroke="var(--accent)" stroke-dasharray="4 4" stroke-width="1.2"/><text x="' + (W - R) + '" y="' + (Y(l.y) - 3) + '" font-size="9" text-anchor="end" fill="var(--accent)">' + esc(l.label) + '</text>'; });
    series.forEach(function (s) {
      g += '<polyline fill="none" stroke="' + s.color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" points="' + s.pts.map(function (p) { return X(p.x) + ',' + Y(p.y); }).join(' ') + '"/>';
      s.pts.forEach(function (p) { g += '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="3" fill="' + s.color + '"/>'; });
    });
    g += '<text x="' + L + '" y="' + (H - 6) + '" font-size="9" fill="var(--muted)">Week ' + x0 + '</text><text x="' + (W - R) + '" y="' + (H - 6) + '" font-size="9" text-anchor="end" fill="var(--muted)">Week ' + x1 + '</text>';
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label) + '">' + g + '</svg>';
  }
  function fmt(v, d) { return v == null ? '–' : (d ? r1(v) : r0(v)); }
  function renderProgress() {
    var now = Math.max(1, weekOf(todayIso())), st = S.settings, aggs = [], w;
    for (w = 1; w <= now; w++) aggs.push(weekAgg(w));
    var wp = aggs.filter(function (a) { return a.weight != null; }).map(function (a) { return { x: a.w, y: a.weight }; });
    var latest = wp.length ? wp[wp.length - 1].y : null;
    var h = '<div class="card"><h2>Weight</h2><div class="grid3" style="margin:8px 0">' +
      '<div class="stat"><b>' + fmt(latest, 1) + '</b><span>latest weekly avg</span></div>' +
      '<div class="stat"><b>' + (latest == null ? '–' : r1(st.w0 - latest)) + '</b><span>kg lost</span></div>' +
      '<div class="stat"><b>' + (latest == null ? '–' : r1(latest - st.goal)) + '</b><span>kg to goal</span></div></div>' +
      (wp.length ? lineChart([{ color: '#3b82c4', pts: wp }], { label: 'Weekly average weight', lines: [{ y: num(st.goal), label: 'Goal ' + st.goal }] }) : '<p class="sub">Log your weight on a few days to see the chart.</p>') + '</div>';
    if (P().track === 'bp') {
      var s1 = aggs.filter(function (a) { return a.bpS != null; }).map(function (a) { return { x: a.w, y: a.bpS }; }), s2 = aggs.filter(function (a) { return a.bpD != null; }).map(function (a) { return { x: a.w, y: a.bpD }; });
      h += '<div class="card"><h2>Blood pressure (weekly average)</h2>' + (s1.length ? lineChart([{ color: '#c2410c', pts: s1 }, { color: '#3b82c4', pts: s2 }], { label: 'Weekly average blood pressure' }) + '<p class="sub">Orange: systolic. Blue: diastolic. Share these with your doctor.</p>' : '<p class="sub">Log morning readings to see the trend.</p>') + '</div>';
    }
    aggs.slice().reverse().forEach(function (a, idx) {
      var prev = aggs[a.w - 2], ch = a.weight != null && prev && prev.weight != null ? a.weight - prev.weight : null, wk = S.weekly[a.w] || {};
      h += '<div class="card"><div class="spread"><h2>Week ' + a.w + '</h2><span class="chip">' + esc(weekType(a.w)) + '</span></div><div class="sub">Starts ' + esc(nice(a.start)) + '</div><div class="wk">' +
        '<div class="stat"><b>' + fmt(a.weight, 1) + '</b><span>avg kg' + (ch == null ? '' : ' (' + (ch > 0 ? '+' : '') + r1(ch) + ')') + '</span></div>' +
        '<div class="stat"><b>' + (a.weight == null ? '–' : bmi(a.weight)) + '</b><span>BMI</span></div>' +
        '<div class="stat"><b>' + fmt(a.steps) + '</b><span>avg steps</span></div>' +
        '<div class="stat"><b>' + fmt(a.kcal) + '</b><span>avg kcal</span></div>' +
        '<div class="stat"><b>' + fmt(a.prot) + '</b><span>avg protein g</span></div>' +
        '<div class="stat"><b>' + fmt(a.sleep, 1) + '</b><span>avg sleep h</span></div>' +
        '<div class="stat"><b>' + a.sd + ' / ' + a.st + '</b><span>exercises logged</span></div>' +
        '<div class="stat"><b>' + a.cd + ' / ' + a.ct + '</b><span>cardio done</span></div>' +
        '<div class="stat"><b>' + a.onPlan + ' / 7</b><span>days on meal plan</span></div>' +
        (P().track === 'bp' ? '<div class="stat"><b>' + (a.bpS == null ? '–' : r0(a.bpS) + '/' + fmt(a.bpD)) + '</b><span>avg BP</span></div>' : '') +
        '</div><div class="grid2" style="margin-top:10px">' + field('Waist at navel (cm)', 'type="number" inputmode="decimal" step="0.5" data-wk="' + a.w + '" data-f="waist"', wk.waist) +
        '<label class="f"><span>Progress photos taken?</span><select data-wk="' + a.w + '" data-f="photos"><option value=""></option><option' + (wk.photos === 'Y' ? ' selected' : '') + '>Y</option><option' + (wk.photos === 'N' ? ' selected' : '') + '>N</option></select></label></div></div>';
    });
    $('#view').innerHTML = h;
  }

  /* ---------- More ---------- */
  function renderMore() {
    var st = S.settings, pl = P();
    $('#view').innerHTML =
      '<div class="card"><h2>Export and backup</h2><p class="sub">Excel export has the same sheets as the spreadsheet tracker. The backup file restores everything on another phone or after reinstalling.</p>' +
      '<div class="row wrap"><button class="btn primary" data-act="export">Export to Excel</button><button class="btn" data-act="backup">Save backup</button><button class="btn" data-act="restore">Restore backup</button></div></div>' +
      '<div class="card"><h2>Settings</h2><div class="grid2" style="margin-top:8px">' +
      field('Name', 'type="text" data-set="name"', S.profile.name) + field('Program start (Monday)', 'type="date" data-set="start"', st.start) +
      field('Height (cm)', 'type="number" inputmode="decimal" data-set="height"', st.height) + field('Starting weight (kg)', 'type="number" inputmode="decimal" data-set="w0"', st.w0) +
      field('Goal weight (kg)', 'type="number" inputmode="decimal" data-set="goal"', st.goal) + field('Daily calories (kcal)', 'type="number" inputmode="numeric" data-set="kcal"', st.kcal) +
      field('Daily protein (g)', 'type="number" inputmode="numeric" data-set="prot"', st.prot) + field('Daily steps', 'type="number" inputmode="numeric" data-set="steps"', st.steps) +
      field('Sleep (hours)', 'type="number" inputmode="decimal" data-set="sleep"', st.sleep) + field(pl.limitName, 'type="number" inputmode="numeric" data-set="limit"', st.limit) +
      '</div><p class="sub">Calorie and goal figures are estimates. Changing the start date keeps what you logged by week number.</p></div>' +
      '<div class="card"><h2>' + esc(pl.label) + '</h2><ul class="rules">' + pl.rules.map(function (r) { return '<li><b>' + esc(r[0]) + '</b>' + esc(r[1]) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="card"><h2>Install on your phone</h2><ul class="rules"><li><b>iPhone (Safari)</b>Share button, then "Add to Home Screen".</li><li><b>Android (Chrome)</b>Menu, then "Add to Home screen" or "Install app".</li><li><b>Offline</b>Logging works without a connection. Videos need one.</li></ul></div>' +
      '<div class="card"><h2>Start over</h2><p class="sub">Deletes everything on this phone. Save a backup first.</p><button class="btn danger" data-act="wipe">Erase all data</button></div>' +
      '<p class="sub" style="text-align:center">Version ' + APP_VERSION + '</p>';
  }

  /* ---------- export ---------- */
  function loadScript(src) { return new Promise(function (res, rej) { if (window.ExcelJS) return res(); var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('load')); }; document.head.appendChild(s); }); }
  function deliver(blob, name, mime) {
    var file; try { file = new File([blob], name, { type: mime }); } catch (e) { file = null; }
    var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (mobile && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: name }).catch(function (e) { if (e && e.name !== 'AbortError') anchor(blob, name); });
    }
    anchor(blob, name); return Promise.resolve();
  }
  function anchor(blob, name) { var a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 4000); }
  function fileStem() { return 'Fitness_Tracker_' + S.profile.name.replace(/[^A-Za-z0-9]+/g, '_') + '_' + todayIso(); }
  function xdate(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }

  function buildWorkbook() {
    var wb = new ExcelJS.Workbook(); wb.creator = 'Fit Tracker'; wb.created = new Date();
    var st = S.settings, pl = P(), fm = foodMap();
    var HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }, INPUT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4C2' } };
    function sheet(name, cols, title, note, inputCols) {
      var ws = wb.addWorksheet(name);
      ws.getCell('A1').value = title; ws.getCell('A1').font = { name: 'Arial', bold: true, size: 14 };
      ws.getCell('A2').value = note || ''; ws.getCell('A2').font = { name: 'Arial', italic: true, color: { argb: 'FF666666' } };
      var hr = ws.getRow(4); hr.height = 32;
      cols.forEach(function (c, i) { var cell = hr.getCell(i + 1); cell.value = c[0]; cell.fill = HEAD; cell.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } }; cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }; ws.getColumn(i + 1).width = c[1]; });
      ws.views = [{ state: 'frozen', ySplit: 4 }];
      ws._inputs = inputCols || []; ws._n = 4;
      ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
      return ws;
    }
    function add(ws, vals, fmts) {
      var row = ws.getRow(++ws._n);
      vals.forEach(function (v, i) { var c = row.getCell(i + 1); c.value = (v === '' || v === undefined) ? null : v; c.font = { name: 'Arial' }; if (ws._inputs.indexOf(i + 1) >= 0) c.fill = INPUT; if (fmts && fmts[i]) c.numFmt = fmts[i]; });
      return row;
    }
    var lastWeek = Math.max(EXPORT_WEEKS, weekOf(todayIso())), w;

    // Settings
    var s0 = wb.addWorksheet('Settings'); s0.getColumn(1).width = 32; s0.getColumn(2).width = 20; s0.getColumn(3).width = 46;
    s0.getCell('A1').value = 'Settings'; s0.getCell('A1').font = { name: 'Arial', bold: true, size: 14 };
    [['Name', S.profile.name], ['Plan', pl.label], ['Program start date (a Monday)', xdate(st.start)], ['Height (cm)', num(st.height)], ['Starting weight (kg)', num(st.w0)], ['Goal weight (kg)', num(st.goal)],
     ['Daily calorie target (kcal)', num(st.kcal)], ['Daily protein target (g)', num(st.prot)], ['Daily step target', num(st.steps)], ['Sleep target (hours)', num(st.sleep)], [pl.limitName, num(st.limit)], ['Exported', new Date()]]
      .forEach(function (r, i) { var a = s0.getCell(i + 3, 1), b = s0.getCell(i + 3, 2); a.value = r[0]; a.font = { name: 'Arial' }; b.value = r[1]; b.font = { name: 'Arial', color: { argb: 'FF0000FF' } }; b.fill = INPUT; if (r[1] instanceof Date) b.numFmt = 'ddd dd-mmm-yyyy'; });

    // Strength Log
    var sl = sheet('Strength Log', [['Week', 6], ['Date', 12], ['Day', 5], ['Session', 12], ['Exercise', 36], ['Unit', 9], ['Rep low', 6], ['Rep high', 6], ['Base sets', 6], ['Target sets', 7],
      ['S1 lb', 7], ['S1 reps', 7], ['S2 lb', 7], ['S2 reps', 7], ['S3 lb', 7], ['S3 reps', 7], ['S4 lb', 7], ['S4 reps', 7], [pl.limitLabel, 9], ['Last week best lb', 9], ['Cue', 30], ['Notes', 30]],
      'Strength Log', 'Exported from the Fit Tracker app. Target sets 0 = exercise not due that week.', [11, 12, 13, 14, 15, 16, 17, 18, 19, 22]);
    for (w = 1; w <= lastWeek; w++) pl.sessions.forEach(function (s, si) {
      s.ex.forEach(function (ex) {
        var rec = sRec(sKey(w, si, ex)), sets = rec.sets || [], v = [w, xdate(dateFor(w, s.off)), s.day, s.name, ex.name, ex.unit, ex.lo, ex.hi, ex.base, targetSets(ex, w)];
        for (var i = 0; i < 4; i++) { var x = sets[i] || {}; v.push(num(x.kg), num(x.reps)); }
        var cue = cueFor(ex, w, rec), prev = w > 1 ? bestKg(sRec(sKey(w - 1, si, ex))) : null;
        v.push(num(rec.eff), prev, cue ? cue.text : null, rec.notes || ex.note || null);
        add(sl, v, [null, 'dd-mmm-yy']);
      });
    });

    // Cardio Log
    var flagH = pl.track === 'bp' ? 'Felt unwell? (Y/N)' : 'Knee pain (0-10)';
    var cl = sheet('Cardio Log', [['Week', 6], ['Date', 12], ['Day', 5], ['Session', 18], ['Machine', 26], ['Plan', 40], ['Minutes done', 9], ['Rounds done', 8], ['Avg HR', 8], ['Distance / kcal', 12], ['Effort (1-10)', 8], [flagH, 10], ['Notes', 30]],
      'Cardio & Conditioning Log', '', [7, 8, 9, 10, 11, 12, 13]);
    for (w = 1; w <= lastWeek; w++) cardioList(w).forEach(function (c) {
      var r = S.cardio[cKey(w, c)] || {};
      add(cl, [w, xdate(dateFor(w, c.off)), c.day, c.name, c.machine, c.plan, num(r.min), num(r.rounds), num(r.hr), r.dist || null, num(r.eff), pl.track === 'bp' ? (r.flag || null) : num(r.flag), r.notes || null], [null, 'dd-mmm-yy']);
    });

    // Daily
    var dcols = [['Date', 14], ['Week', 6], ['Weight (kg)', 10], ['Steps', 9], ['Meal plan followed? (Y/N)', 11], ['Extras kcal (+/-)', 10], ['Extras protein g (+/-)', 10], ['Calories', 9], ['Protein (g)', 9], ['Sleep (h)', 9]];
    if (pl.track === 'bp') dcols.push(['Morning BP systolic', 10], ['Morning BP diastolic', 10]); else dcols.push(['Knee next morning (0-10)', 12]);
    dcols.push(['Notes', 36]);
    var dl = sheet('Daily', dcols, 'Daily Check-in', 'Calories and protein come from the meal plan (when followed) or the food log.', pl.track === 'bp' ? [3, 4, 5, 6, 7, 10, 11, 12, 13] : [3, 4, 5, 6, 7, 10, 11, 12]);
    var allDates = Object.keys(S.daily).concat(Object.keys(S.foodLog)).sort(), first = st.start, lastD = dateFor(lastWeek, 6), d;
    if (allDates.length && allDates[0] < first) first = allDates[0];
    for (d = first; d <= lastD; d = addDays(d, 1)) {
      var r = S.daily[d] || {}, n = dayNutrition(d), v = [xdate(d), weekOf(d), num(r.w), num(r.steps), r.fol || null, num(r.xk), num(r.xp), n.kcal, n.p, num(r.sleep)];
      if (pl.track === 'bp') v.push(num(r.bpS), num(r.bpD)); else v.push(num(r.knee));
      v.push(r.notes || null); add(dl, v, ['ddd dd-mmm-yy']);
    }

    // Meal Plan
    var mp = sheet('Meal Plan', [['Day', 6], ['Meal', 11], ['Food', 40], ['Servings', 9], ['Amount', 14], ['kcal', 8], ['Protein (g)', 10], ['Carbs (g)', 9], ['Fat (g)', 8], ['Check', 30]],
      'Weekly Meal Plan', 'Servings are multiples of the Food Library serving.', [3, 4]);
    var totals = [];
    DAYS.forEach(function (day, di) {
      var veg = pl.vegDays.indexOf(di + 1) >= 0, items = S.mealPlan[day] || [], t = itemTotals(items, fm); totals.push([day, r0(t.kcal), r0(t.p), r0(t.c), r0(t.f)]);
      MEALS.concat(['__other']).forEach(function (m) { items.forEach(function (it) {
        if (m === '__other' ? MEALS.indexOf(it.meal) >= 0 : it.meal !== m) return;
        var f = fm[it.food], sv = num(it.sv) || 0;
        add(mp, [day, it.meal, it.food, sv, f ? sv + ' x ' + f.serving : '?', f ? r0(f.kcal * sv) : null, f ? r1(f.p * sv) : null, f ? r1(f.c * sv) : null, f ? r1(f.f * sv) : null, f && f.emf && veg ? 'Vegetarian day: no egg/meat/fish' : null]);
      }); });
    });
    mp._n += 2; add(mp, ['Daily totals']).getCell(1).font = { name: 'Arial', bold: true };
    add(mp, ['Day', 'kcal', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'kcal vs target', 'Protein vs target']).eachCell(function (c) { c.font = { name: 'Arial', bold: true }; });
    totals.forEach(function (t) { add(mp, t.concat([t[1] - num(st.kcal), t[2] - num(st.prot)])); });

    // Food Log
    var fl = sheet('Food Log', [['Date', 14], ['Meal', 11], ['Food', 40], ['Servings', 9], ['kcal', 8], ['Protein (g)', 10], ['Carbs (g)', 9], ['Fat (g)', 8], ['Check', 30]], 'Food Log', '', [1, 2, 3, 4]);
    Object.keys(S.foodLog).sort().forEach(function (d) { (S.foodLog[d] || []).forEach(function (it) {
      var f = fm[it.food], sv = num(it.sv) || 0;
      add(fl, [xdate(d), it.meal, it.food, sv, f ? r0(f.kcal * sv) : null, f ? r1(f.p * sv) : null, f ? r1(f.c * sv) : null, f ? r1(f.f * sv) : null, f && f.emf && isVegDay(d) ? 'Vegetarian day: no egg/meat/fish' : null], ['ddd dd-mmm-yy']);
    }); });

    // Food Library
    var lib = sheet('Food Library', [['Food', 40], ['Serving', 12], ['kcal', 8], ['Protein (g)', 10], ['Carbs (g)', 9], ['Fat (g)', 8], ['Egg / meat / fish?', 12]], 'Food Library', 'Approximate values from standard nutrition tables.', []);
    foods().forEach(function (f) { add(lib, [f.name, f.serving, f.kcal, f.p, f.c, f.f, f.emf ? 'Y' : 'N']); });

    // Weekly Summary
    var wc = [['Week', 6], ['Starts', 12], ['Week type', 26], ['Avg weight (kg)', 10], ['Change vs last wk', 10], ['Lost so far (kg)', 10], ['Left to goal (kg)', 10], ['BMI', 7], ['Avg steps', 9], ['Avg protein (g)', 10], ['Avg kcal', 9], ['Avg sleep (h)', 9],
      ['Strength rows logged', 11], ['Cardio sessions done', 11], ['Days on meal plan', 10], ['Waist (cm)', 9], ['Photos taken?', 9]];
    if (pl.track === 'bp') wc.push(['Avg BP systolic', 10], ['Avg BP diastolic', 10]);
    var ws = sheet('Weekly Summary', wc, 'Weekly Summary', '', [16, 17]), prevW = null;
    for (w = 1; w <= lastWeek; w++) {
      var a = weekAgg(w), wk = S.weekly[w] || {}, rd = function (x, dp) { return x == null ? null : (dp ? Math.round(x * 100) / 100 : r0(x)); };
      var row = [w, xdate(a.start), weekType(w), rd(a.weight, 1), a.weight != null && prevW != null ? rd(a.weight - prevW, 1) : null, a.weight != null ? rd(st.w0 - a.weight, 1) : null, a.weight != null ? rd(a.weight - st.goal, 1) : null,
        a.weight != null ? bmi(a.weight) : null, rd(a.steps), rd(a.prot), rd(a.kcal), a.sleep == null ? null : r1(a.sleep), a.sd + ' / ' + a.st, a.cd + ' / ' + a.ct, a.onPlan + ' / 7', num(wk.waist), wk.photos || null];
      if (pl.track === 'bp') row.push(rd(a.bpS), rd(a.bpD));
      add(ws, row, [null, 'dd-mmm-yy']); prevW = a.weight != null ? a.weight : null;
    }
    return wb;
  }
  function exportExcel() {
    toast('Building the Excel file…');
    loadScript('vendor/exceljs.min.js').then(function () { return buildWorkbook().xlsx.writeBuffer(); }).then(function (buf) {
      var mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      window.__lastExport = buf; return deliver(new Blob([buf], { type: mime }), fileStem() + '.xlsx', mime);
    }).then(function () { toast('Excel file ready'); }).catch(function (e) { console.error(e); toast('Export failed. Open the app online once, then try again.'); });
  }
  function backup() { flush(); deliver(new Blob([JSON.stringify({ app: 'fit-tracker', exported: new Date().toISOString(), data: S }, null, 1)], { type: 'application/json' }), fileStem() + '_backup.json', 'application/json').then(function () { toast('Backup saved'); }); }
  function restore() {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return; var rd = new FileReader();
      rd.onload = function () {
        try { var o = JSON.parse(rd.result), d = o && o.app === 'fit-tracker' ? o.data : null; if (!d || !d.profile || !window.PLANS[d.profile.plan] || !d.settings) throw new Error('bad'); }
        catch (e) { return toast('That file is not a Fit Tracker backup'); }
        if (S.profile && !confirm('Replace everything on this phone with the backup from ' + (o.exported || '').slice(0, 10) + '?')) return;
        S = d; ['strength', 'cardio', 'daily', 'foodLog', 'videos', 'weekly'].forEach(function (k) { if (!S[k]) S[k] = {}; }); if (!S.foods) S.foods = []; if (!S.mealPlan) S.mealPlan = clone(P().meals);
        flush(); cur = todayIso(); tab = 'today'; render(); toast('Backup restored');
      };
      rd.readAsText(f);
    };
    inp.click();
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act],[data-tab]'); if (!t) { if (e.target.id === 'modal') closeModal(); return; }
    if (t.dataset.tab && !t.dataset.act) return go(t.dataset.tab);
    var a = t.dataset.act, items, k;
    switch (a) {
      case 'tab': return go(t.dataset.tab);
      case 'date-prev': return setDate(addDays(cur, -1));
      case 'date-next': return setDate(addDays(cur, 1));
      case 'date-today': return setDate(todayIso());
      case 'date-pick': var di = $('#date-input'); if (di.showPicker) { try { di.showPicker(); } catch (x) { di.focus(); } } else { di.focus(); di.click(); } return;
      case 'setdate': return setDate(t.dataset.d);
      case 'goto-start': return setDate(S.settings.start);
      case 'ob-plan': obPlan = t.dataset.plan; var nm = $('#ob-name').value, sd = $('#ob-start').value; renderOnboard(); $('#ob-name').value = nm; $('#ob-start').value = sd; return;
      case 'ob-go': return createProfile();
      case 'fol': var r = S.daily[cur] || (S.daily[cur] = {}); r.fol = r.fol === t.dataset.v ? '' : t.dataset.v; save(); return render();
      case 'addset': k = t.dataset.k; var rec = S.strength[k] || (S.strength[k] = { sets: [], eff: '', notes: '' }); var wrap = t.closest('[data-exwrap]'); var cnt = $$('[data-f="reps"]', wrap).length; while (rec.sets.length < cnt + 1) rec.sets.push({}); save(); var y = window.scrollY; render(); window.scrollTo(0, y); return;
      case 'video': return showVideo(t.dataset.ex);
      case 'close': return closeModal();
      case 'vid-save': var id = ytId($('#vid-url').value.trim()); if (!id) return toast('That does not look like a YouTube link'); S.videos[t.dataset.ex] = id; save(); return showVideo(t.dataset.ex);
      case 'vid-reset': delete S.videos[t.dataset.ex]; save(); return showVideo(t.dataset.ex);
      case 'foodtab': foodTab = t.dataset.t; return render();
      case 'foodday': foodDay = t.dataset.day; return render();
      case 'food-add': items = foodItems(t.dataset.w); items.push({ meal: $('#add-meal').value, food: $('#add-food').value, sv: num($('#add-sv').value) || 1 }); save(); return keepScroll();
      case 'food-del': items = foodItems(t.dataset.w); items.splice(+t.dataset.i, 1); save(); return keepScroll();
      case 'plan-reset': if (confirm('Reset ' + foodDay + ' to the original plan?')) { S.mealPlan[foodDay] = clone(P().meals[foodDay]); save(); render(); } return;
      case 'log-copy': S.foodLog[cur] = (S.foodLog[cur] || []).concat(clone(S.mealPlan[DAYS[wd(cur)]] || [])); save(); return render();
      case 'lib-add':
        var nf = { name: $('#nf-name').value.trim(), serving: $('#nf-serv').value.trim() || '1 serving', kcal: num($('#nf-kcal').value) || 0, p: num($('#nf-p').value) || 0, c: num($('#nf-c').value) || 0, f: num($('#nf-f').value) || 0, emf: $('#nf-emf').checked };
        if (!nf.name) return toast('Give the food a name'); if (foodMap()[nf.name]) return toast('That name is already in the library');
        S.foods.push(nf); save(); toast('Added'); return render();
      case 'lib-del': S.foods.splice(+t.dataset.i, 1); save(); return render();
      case 'export': return exportExcel();
      case 'backup': return backup();
      case 'restore': return restore();
      case 'wipe': if (confirm('Erase everything on this phone? This cannot be undone.')) { localStorage.removeItem(KEY); S = blank(); render(); } return;
    }
  });
  function keepScroll() { var y = window.scrollY; render(); window.scrollTo(0, y); }

  document.addEventListener('input', function (e) {
    var t = e.target, d = t.dataset, v = t.value;
    if (t.id === 'date-input') return;
    if (d.d) { var r = S.daily[cur] || (S.daily[cur] = {}); r[d.d] = v; save(); if (d.d === 'xk' || d.d === 'xp') refreshNutri(); return; }
    if (d.s) {
      var rec = S.strength[d.s] || (S.strength[d.s] = { sets: [], eff: '', notes: '' });
      if (d.i != null) { var i = +d.i; while (rec.sets.length <= i) rec.sets.push({}); rec.sets[i][d.f] = v; } else rec[d.f] = v;
      save();
      var wrap = t.closest('[data-exwrap]'), ex = findEx(wrap.dataset.exid), cue = cueFor(ex, +d.s.split('|')[0], rec), el = $('[data-cue]', wrap);
      el.className = 'cue ' + (cue ? cue.cls : ''); el.textContent = cue ? cue.text : ''; return;
    }
    if (d.c) { var c = S.cardio[d.c] || (S.cardio[d.c] = {}); c[d.f] = v; save(); return; }
    if (d.wk) { var w = S.weekly[d.wk] || (S.weekly[d.wk] = {}); w[d.f] = v; save(); return; }
    if (d.fi != null && d.f === 'sv') { var items = foodItems(d.w), it = items[+d.fi]; it.sv = v === '' ? 0 : parseFloat(v) || 0; save(); var f = foodMap()[it.food], sub = $('[data-fsub="' + d.w + d.fi + '"]'); if (f && sub) sub.firstChild.textContent = it.sv + ' × ' + f.serving + ' · ' + r0(f.kcal * it.sv) + ' kcal · ' + r1(f.p * it.sv) + ' g protein'; refreshFoodTotals(); return; }
    if (d.set) {
      if (d.set === 'name') { S.profile.name = v.trim() || 'Me'; }
      else if (d.set === 'start') { if (v) S.settings.start = v; }
      else S.settings[d.set] = v === '' ? '' : parseFloat(v);
      save(); $('#top-sub').textContent = S.profile.name + ' · ' + P().label.split(':')[0]; return;
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target, d = t.dataset;
    if (t.id === 'date-input' && t.value) return setDate(t.value);
    if (d.fi != null && d.f === 'food') { foodItems(d.w)[+d.fi].food = t.value; save(); return keepScroll(); }
  });

  /* ---------- boot ---------- */
  load(); render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
    var had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (had) toast('App updated. Reopen to use the new version.'); });
  }
  window.__ft = { state: function () { return S; }, buildWorkbook: buildWorkbook, loadScript: loadScript };
})();
