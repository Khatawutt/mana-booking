/**
 * WebApp.gs - Mana Garden + Mana Ratchayothin web booking / food ordering app.
 *
 * doGet(e)  ?b=garden (default) | ?b=ratch   -> HtmlService page (Index.html)
 * doGet(e)  ?api=ping | availability         -> JSON API for the GitHub Pages frontend
 * webApiPost_(e)  POST {api:'submit',...}     -> JSON API (called from doPost in Ratchayothin.gs)
 * webGetAvailability(branch, isoDate, guests)  -> live availability (google.script.run)
 * webSubmitBooking(payload)                    -> validates, re-checks capacity inside the lock,
 *                                                 writes Master Database, sends LINE
 *
 * Needs: WebMenuData.gs (menus), WebQr.gs (QR), Index.html.
 * Soft dependencies (used only if present): SHEET_ID + loadUsage_() (SlotBlocking.gs),
 * updateAvailableSlots(), updateSlotsRatch().
 * Script properties: LINE_CHANNEL_ACCESS_TOKEN / CHANNEL_ACCESS_TOKEN, TARGET_GROUP_ID,
 * TARGET_USER_ID, RT_SHEET_ID, RT_TARGET_GROUP_ID (optional GARDEN_SHEET_ID if SHEET_ID is missing).
 * Every top-level name starts with web / WEB_ to avoid clashing with the other files.
 */

var WEB_TZ = 'Asia/Bangkok';
var WEB_DAYS_AHEAD = 30;
var WEB_MASTER = 'Master Database';
var WEB_CHANNEL = '\u0e40\u0e27\u0e47\u0e1a Web';
var WEB_RECORDER = 'Web';
var WEB_STATUS_PENDING = '\u0e23\u0e2d\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19';
var WEB_DEPOSIT_WAIT = '\u0e23\u0e2d\u0e15\u0e23\u0e27\u0e08\u0e2a\u0e2d\u0e1a\u0e2a\u0e25\u0e34\u0e1b';
var WEB_DEPOSIT_NONE = '\u0e44\u0e21\u0e48\u0e15\u0e49\u0e2d\u0e07\u0e21\u0e31\u0e14\u0e08\u0e33';
var WEB_CANCEL_WORD = '\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01';
var WEB_DUP_WINDOW_MS = 5 * 60 * 1000;
var WEB_MAX_QTY = 99;
var WEB_MAX_LINES = 120;
var WEB_DEPOSIT_PER_TABLE = [300, 500];

var WEB_BRANCHES = {
  garden: {
    key: 'garden',
    name: 'Mana Garden',
    title: 'Mana Garden | \u0e08\u0e2d\u0e07\u0e42\u0e15\u0e4a\u0e30 & \u0e2a\u0e31\u0e48\u0e07\u0e2d\u0e32\u0e2b\u0e32\u0e23',
    slots: ['17:00 - 19:00', '19:00 - 21:00', '21:00 - 23:00'],
    maxGuests: 50,
    slotGuestCap: 0,
    statusIdx: 14,
    cols: 18,
    zones: [
      { key: 'PITI', label: '\u0e1a\u0e49\u0e32\u0e19\u0e1b\u0e34\u0e15\u0e34 Baan Piti', cap: 50, unit: 'seats', note: '\u0e1a\u0e49\u0e32\u0e19\u0e2b\u0e25\u0e31\u0e07\u0e43\u0e2b\u0e0d\u0e48 \u0e08\u0e38\u0e1b\u0e23\u0e30\u0e21\u0e32\u0e13 50 \u0e17\u0e48\u0e32\u0e19 / Large house, about 50 guests' },
      { key: 'MANA', label: 'Mana Garden Cafe', cap: 15, unit: 'tables', note: '\u0e04\u0e32\u0e40\u0e1f\u0e48 15 \u0e42\u0e15\u0e4a\u0e30 \u0e15\u0e48\u0e2d\u0e42\u0e15\u0e4a\u0e30\u0e23\u0e27\u0e21\u0e01\u0e31\u0e19\u0e44\u0e14\u0e49 / Cafe, 15 tables (joinable)' },
      { key: 'OUT', label: 'Outdoor Zone \u0e42\u0e0b\u0e19\u0e14\u0e49\u0e32\u0e19\u0e19\u0e2d\u0e01', cap: 40, unit: 'seats', note: '\u0e42\u0e0b\u0e19\u0e14\u0e49\u0e32\u0e19\u0e19\u0e2d\u0e01 \u0e1b\u0e23\u0e30\u0e21\u0e32\u0e13 40 \u0e17\u0e35\u0e48\u0e19\u0e31\u0e48\u0e07 / Outdoor, about 40 seats' }
    ]
  },
  ratch: {
    key: 'ratch',
    name: 'Mana Ratchayothin',
    title: 'Mana Ratchayothin | \u0e08\u0e2d\u0e07\u0e42\u0e15\u0e4a\u0e30 & \u0e2a\u0e31\u0e48\u0e07\u0e2d\u0e32\u0e2b\u0e32\u0e23',
    slots: ['11:00 - 13:00', '13:00 - 15:00', '15:00 - 17:00', '17:00 - 19:00', '19:00 - 21:00'],
    maxGuests: 18,
    slotGuestCap: 50,
    statusIdx: 15,
    cols: 21,
    zones: [
      { key: 'RT', label: '\u0e2b\u0e49\u0e2d\u0e07\u0e41\u0e2d\u0e23\u0e4c Air-conditioned Room', short: '\u0e2b\u0e49\u0e2d\u0e07\u0e41\u0e2d\u0e23\u0e4c', cap: 15, unit: 'tables', note: '\u0e2b\u0e49\u0e2d\u0e07\u0e41\u0e2d\u0e23\u0e4c 15 \u0e42\u0e15\u0e4a\u0e30 \u0e15\u0e48\u0e2d\u0e44\u0e14\u0e49\u0e2a\u0e39\u0e07\u0e2a\u0e38\u0e14 4 \u0e42\u0e15\u0e4a\u0e30 (18 \u0e17\u0e48\u0e32\u0e19) / 15 tables, join up to 4 (18 guests)' }
    ]
  }
};

// ------------------------------------------------------------------ small helpers

function webCfg_(branch) {
  return WEB_BRANCHES[branch === 'ratch' ? 'ratch' : 'garden'];
}

function webUserError_(msg) {
  var e = new Error(msg);
  e.webUser = true;
  return e;
}

function webPad2_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

function webIsoToDmy_(iso) {
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? (+m[3]) + '/' + (+m[2]) + '/' + m[1] : '';
}

// Date | 'd/M/yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd'  ->  'd/M/yyyy'  ('' if unknown)
function webNormDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, WEB_TZ, 'd/M/yyyy');
  }
  var s = String(v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return (+m[3]) + '/' + (+m[2]) + '/' + m[1];
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return (+m[1]) + '/' + (+m[2]) + '/' + m[3];
  return '';
}

function webNormSlot_(v) {
  var m = String(v === null || v === undefined ? '' : v).match(/(\d{1,2}):(\d{2})\s*[-\u2013\u2014]\s*(\d{1,2}):(\d{2})/);
  return m ? webPad2_(m[1]) + ':' + m[2] + ' - ' + webPad2_(m[3]) + ':' + m[4] : '';
}

function webSeats_(g) {
  var s = String(g === null || g === undefined ? '' : g);
  if (/\u0e21\u0e32\u0e01\u0e01\u0e27\u0e48\u0e32|>|more/i.test(s)) return 12;
  var nums = s.match(/\d+/g);
  if (!nums) return 2;
  return Math.max.apply(null, nums.map(Number));
}

function webGardenZoneKey_(text) {
  var t = String(text === null || text === undefined ? '' : text).toLowerCase();
  if (t.indexOf('piti') > -1 || t.indexOf('\u0e1b\u0e34\u0e15\u0e34') > -1 || t.indexOf('vip') > -1 || t.indexOf('\u0e1a\u0e49\u0e32\u0e19') > -1) return 'PITI';
  if (t.indexOf('out') > -1 || t.indexOf('\u0e19\u0e2d\u0e01') > -1) return 'OUT';
  return 'MANA';
}

function webTablesFor_(guests) {
  var g = Number(guests);
  return (isFinite(g) && g > 0) ? Math.ceil(g / 4) : 0;
}

function webMinSpend_(guests) { return Number(guests) <= 2 ? 300 : 500; }

function webSlotStartMin_(slot) {
  var m = String(slot).match(/^(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : 0;
}

function webNowParts_(now) {
  return {
    iso: Utilities.formatDate(now, WEB_TZ, 'yyyy-MM-dd'),
    min: (+Utilities.formatDate(now, WEB_TZ, 'H')) * 60 + (+Utilities.formatDate(now, WEB_TZ, 'm'))
  };
}

// today .. today+30 as yyyy-MM-dd
function webDates_(now) {
  var out = [];
  for (var d = 0; d <= WEB_DAYS_AHEAD; d++) {
    out.push(Utilities.formatDate(new Date(now.getTime() + d * 86400000), WEB_TZ, 'yyyy-MM-dd'));
  }
  return out;
}

function webDayOfWeek_(iso) {
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : 0;
}

// strings from the client: no control chars, trimmed, length-limited
function webClean_(s, max) {
  var t = String(s === null || s === undefined ? '' : s)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t.length > max ? t.substring(0, max) : t;
}

// value for a spreadsheet cell: stop formula injection (= + - @)
function webCell_(s) {
  var t = String(s === null || s === undefined ? '' : s);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

// ------------------------------------------------------------------ menu

var WEB_MENU_INDEX_CACHE_ = {};

function webMenu_(branch) {
  return branch === 'ratch' ? WEB_MENU_RATCH : WEB_MENU_GARDEN;
}

// id -> {id, th, en, zh, price}
function webMenuIndex_(branch) {
  if (WEB_MENU_INDEX_CACHE_[branch]) return WEB_MENU_INDEX_CACHE_[branch];
  var idx = {};
  webMenu_(branch).forEach(function (c) {
    c.items.forEach(function (it) {
      idx[it[0]] = { id: it[0], th: it[1], en: it[2], zh: it[3], price: it[4] };
    });
  });
  WEB_MENU_INDEX_CACHE_[branch] = idx;
  return idx;
}

// cart from the client = {itemId: qty}. Only ids and quantities are used; prices come from the server menu.
function webPriceCart_(branch, cart) {
  var idx = webMenuIndex_(branch);
  var lines = [], total = 0, count = 0;
  if (!cart || typeof cart !== 'object') return { lines: lines, total: 0, count: 0 };
  Object.keys(cart).forEach(function (id) {
    if (!Object.prototype.hasOwnProperty.call(idx, id)) return;
    var q = Math.floor(Number(cart[id]));
    if (!isFinite(q) || q <= 0) return;
    if (q > WEB_MAX_QTY) throw webUserError_('\u0e08\u0e33\u0e19\u0e27\u0e19\u0e15\u0e48\u0e2d\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e2a\u0e39\u0e07\u0e2a\u0e38\u0e14 ' + WEB_MAX_QTY + ' / Max ' + WEB_MAX_QTY + ' per item');
    var it = idx[id];
    lines.push({ id: id, name: it.th, qty: q, price: it.price, sub: q * it.price });
    total += q * it.price;
    count += q;
  });
  if (lines.length > WEB_MAX_LINES) throw webUserError_('\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e2d\u0e32\u0e2b\u0e32\u0e23\u0e21\u0e32\u0e01\u0e40\u0e01\u0e34\u0e19\u0e44\u0e1b / Too many menu lines');
  return { lines: lines, total: total, count: count };
}

// ------------------------------------------------------------------ usage / capacity

// rows of the Master Database -> {'d/M/yyyy|slot|ZONEKEY': {units, guests}}
function webUsageFromRows_(cfg, rows) {
  var usage = {};
  rows.forEach(function (r) {
    var status = String(r[cfg.statusIdx] === undefined || r[cfg.statusIdx] === null ? '' : r[cfg.statusIdx]);
    if (status.indexOf(WEB_CANCEL_WORD) > -1) return;
    var d = webNormDate_(r[6]), s = webNormSlot_(r[7]);
    if (!d || !s) return;
    var zk, units, guests;
    if (cfg.key === 'garden') {
      zk = webGardenZoneKey_(r[9]);
      var z = webZoneByKey_(cfg, zk);
      guests = webSeats_(r[8]);
      units = z.unit === 'tables' ? Math.ceil(guests / 4) : guests;
    } else {
      zk = 'RT';
      var gv = r[8];
      guests = (gv !== '' && gv !== null && gv !== undefined && isFinite(Number(gv)) && Number(gv) > 0) ? Number(gv) : 0;
      var jv = r[9];
      if (jv !== '' && jv !== null && jv !== undefined && isFinite(Number(jv)) && Number(jv) > 0) units = Math.ceil(Number(jv));
      else if (guests > 0) units = webTablesFor_(guests);
      else return;
    }
    var k = d + '|' + s + '|' + zk;
    var cur = usage[k] || { units: 0, guests: 0 };
    cur.units += units;
    cur.guests += guests;
    usage[k] = cur;
  });
  return usage;
}

function webZoneByKey_(cfg, key) {
  for (var i = 0; i < cfg.zones.length; i++) if (cfg.zones[i].key === key) return cfg.zones[i];
  return cfg.zones[0];
}

function webSheetId_(cfg) {
  var props = PropertiesService.getScriptProperties();
  if (cfg.key === 'ratch') return props.getProperty('RT_SHEET_ID') || '';
  if (typeof SHEET_ID !== 'undefined' && SHEET_ID) return SHEET_ID;
  return props.getProperty('GARDEN_SHEET_ID') || '';
}

function webOpenMaster_(cfg) {
  var id = webSheetId_(cfg);
  if (!id) throw new Error('Spreadsheet id not configured for ' + cfg.key);
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(WEB_MASTER);
  if (!sh) throw new Error('Master Database tab not found for ' + cfg.key);
  return { ss: ss, sheet: sh, id: id };
}

function webReadRows_(cfg, sheet) {
  var last = sheet.getLastRow();
  return last >= 2 ? sheet.getRange(2, 1, last - 1, cfg.cols).getValues() : [];
}

// Garden prefers the existing loadUsage_() (same numbers as the Google Form); Ratchayothin reads the Master Database
function webLoadUsage_(cfg, rows) {
  if (cfg.key === 'garden' && typeof loadUsage_ === 'function') {
    var used = loadUsage_();
    var usage = {};
    Object.keys(used).forEach(function (k) { usage[k] = { units: used[k], guests: 0 }; });
    return usage;
  }
  return webUsageFromRows_(cfg, rows);
}

// state of one zone in one slot for a party of `guests`
function webZoneStatus_(cfg, zone, usage, dmy, slot, guests) {
  var u = usage[dmy + '|' + slot + '|' + zone.key] || { units: 0, guests: 0 };
  var need = zone.unit === 'tables' ? webTablesFor_(guests) : guests;
  var remaining = Math.max(0, zone.cap - u.units);
  var state = 'open';
  if (u.units >= zone.cap || (cfg.slotGuestCap && u.guests >= cfg.slotGuestCap)) state = 'full';
  else if (need > remaining || (cfg.slotGuestCap && u.guests + guests > cfg.slotGuestCap)) state = 'nofit';
  var out = { key: zone.key, label: zone.label, unit: zone.unit, cap: zone.cap, used: u.units, remaining: remaining, need: need, state: state };
  if (cfg.slotGuestCap) out.guestsLeft = Math.max(0, cfg.slotGuestCap - u.guests);
  return out;
}

function webSlotStatus_(cfg, usage, iso, slot, guests, nowP) {
  var dmy = webIsoToDmy_(iso);
  var zones = cfg.zones.map(function (z) { return webZoneStatus_(cfg, z, usage, dmy, slot, guests); });
  var state;
  if (iso === nowP.iso && webSlotStartMin_(slot) <= nowP.min) state = 'past';
  else if (zones.some(function (z) { return z.state === 'open'; })) state = 'open';
  else if (zones.every(function (z) { return z.state === 'full'; })) state = 'full';
  else state = 'nofit';
  return { slot: slot, state: state, zones: zones };
}

// pure: availability for all dates + the slots of one date
function webBuildAvailability_(cfg, usage, isoSel, guests, now) {
  var nowP = webNowParts_(now);
  var dates = webDates_(now);
  if (dates.indexOf(isoSel) < 0) isoSel = dates[0];
  var days = dates.map(function (iso) {
    var open = cfg.slots.some(function (s) { return webSlotStatus_(cfg, usage, iso, s, guests, nowP).state === 'open'; });
    return { iso: iso, dow: webDayOfWeek_(iso), open: open };
  });
  var slots = cfg.slots.map(function (s) { return webSlotStatus_(cfg, usage, isoSel, s, guests, nowP); });
  return { date: isoSel, today: nowP.iso, days: days, slots: slots };
}

// google.script.run entry point
function webGetAvailability(branch, isoDate, guests) {
  try {
    var cfg = webCfg_(branch);
    var g = Math.floor(Number(guests));
    if (!isFinite(g) || g < 1) g = 1;
    if (g > cfg.maxGuests) g = cfg.maxGuests;
    var m = webOpenMaster_(cfg);
    var usage = webLoadUsage_(cfg, webReadRows_(cfg, m.sheet));
    var res = webBuildAvailability_(cfg, usage, String(isoDate || ''), g, new Date());
    res.ok = true;
    res.guests = g;
    return res;
  } catch (err) {
    Logger.log('webGetAvailability failed: ' + err);
    return { ok: false, error: '\u0e42\u0e2b\u0e25\u0e14\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e23\u0e2d\u0e1a\u0e27\u0e48\u0e32\u0e07\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08 \u0e25\u0e2d\u0e07\u0e43\u0e2b\u0e21\u0e48\u0e2d\u0e35\u0e01\u0e04\u0e23\u0e31\u0e49\u0e07 / Could not load availability' };
  }
}

// ------------------------------------------------------------------ validation (pure)

function webValidate_(cfg, p, now) {
  p = p || {};
  if (p.hp) throw webUserError_('\u0e2a\u0e48\u0e07\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08 / Submission rejected');
  var v = {};
  v.name = webClean_(p.name, 80);
  if (v.name.length < 2) throw webUserError_('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e01\u0e23\u0e2d\u0e01\u0e0a\u0e37\u0e48\u0e2d-\u0e19\u0e32\u0e21\u0e2a\u0e01\u0e38\u0e25 / Please enter your name');
  var phone = webClean_(p.phone, 30).replace(/[\s\-().]/g, '');
  if (/^\+66\d{9}$/.test(phone)) phone = '0' + phone.substring(3);
  if (!/^0\d{9}$/.test(phone)) throw webUserError_('\u0e40\u0e1a\u0e2d\u0e23\u0e4c\u0e42\u0e17\u0e23\u0e15\u0e49\u0e2d\u0e07\u0e40\u0e1b\u0e47\u0e19\u0e15\u0e31\u0e27\u0e40\u0e25\u0e02 10 \u0e2b\u0e25\u0e31\u0e01 \u0e40\u0e0a\u0e48\u0e19 0812345678 / Phone must be 10 digits');
  v.phone = phone;
  v.line = webClean_(p.line, 60);
  v.special = webClean_(p.special, 500);

  var iso = String(p.iso || '');
  if (webDates_(now).indexOf(iso) < 0) throw webUserError_('\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48\u0e44\u0e21\u0e48\u0e2d\u0e22\u0e39\u0e48\u0e43\u0e19\u0e0a\u0e48\u0e27\u0e07\u0e17\u0e35\u0e48\u0e08\u0e2d\u0e07\u0e44\u0e14\u0e49 (30 \u0e27\u0e31\u0e19\u0e25\u0e48\u0e27\u0e07\u0e2b\u0e19\u0e49\u0e32) / Date out of range');
  v.iso = iso;
  v.dmy = webIsoToDmy_(iso);
  var slot = webNormSlot_(p.slot);
  if (cfg.slots.indexOf(slot) < 0) throw webUserError_('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e23\u0e2d\u0e1a\u0e40\u0e27\u0e25\u0e32 / Please choose a time slot');
  v.slot = slot;
  var nowP = webNowParts_(now);
  if (iso === nowP.iso && webSlotStartMin_(slot) <= nowP.min) throw webUserError_('\u0e23\u0e2d\u0e1a\u0e40\u0e27\u0e25\u0e32\u0e19\u0e35\u0e49\u0e40\u0e23\u0e34\u0e48\u0e21\u0e44\u0e1b\u0e41\u0e25\u0e49\u0e27 / This slot has already started');

  var g = Number(p.guests);
  if (!isFinite(g) || Math.floor(g) !== g || g < 1) throw webUserError_('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e23\u0e30\u0e1a\u0e38\u0e08\u0e33\u0e19\u0e27\u0e19\u0e1c\u0e39\u0e49\u0e43\u0e0a\u0e49\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23 / Please enter number of guests');
  if (g > cfg.maxGuests) throw webUserError_('\u0e08\u0e2d\u0e07\u0e44\u0e14\u0e49\u0e2a\u0e39\u0e07\u0e2a\u0e38\u0e14 ' + cfg.maxGuests + ' \u0e17\u0e48\u0e32\u0e19\u0e15\u0e48\u0e2d\u0e04\u0e23\u0e31\u0e49\u0e07 / Max ' + cfg.maxGuests + ' guests per booking');
  v.guests = g;
  v.tables = webTablesFor_(g);

  var zoneKey = cfg.key === 'ratch' ? 'RT' : String(p.zone || '');
  var zone = null;
  cfg.zones.forEach(function (z) { if (z.key === zoneKey) zone = z; });
  if (!zone) throw webUserError_('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e42\u0e0b\u0e19\u0e17\u0e35\u0e48\u0e19\u0e31\u0e48\u0e07 / Please choose a seating zone');
  v.zone = zone;

  v.preorder = p.preorder === true || p.preorder === 'true';
  v.minSpend = webMinSpend_(g);
  var order = v.preorder ? webPriceCart_(cfg.key, p.cart) : { lines: [], total: 0, count: 0 };
  v.lines = order.lines;
  v.foodTotal = order.total;
  v.depositRange = [v.tables * WEB_DEPOSIT_PER_TABLE[0], v.tables * WEB_DEPOSIT_PER_TABLE[1]];
  v.amount = 0;
  v.reference = '';
  if (v.preorder) {
    if (!order.lines.length) throw webUserError_('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2d\u0e32\u0e2b\u0e32\u0e23\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e19\u0e49\u0e2d\u0e22 1 \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23 \u0e2b\u0e23\u0e37\u0e2d\u0e40\u0e25\u0e37\u0e2d\u0e01 "\u0e44\u0e21\u0e48\u0e2a\u0e31\u0e48\u0e07\u0e2d\u0e32\u0e2b\u0e32\u0e23\u0e25\u0e48\u0e27\u0e07\u0e2b\u0e19\u0e49\u0e32" / Choose at least one dish or select no pre-order');
    var amt = Number(String(p.amount === null || p.amount === undefined ? '' : p.amount).replace(/[,\s]/g, ''));
    if (!isFinite(amt) || amt <= 0 || amt > 1000000) throw webUserError_('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e01\u0e23\u0e2d\u0e01\u0e22\u0e2d\u0e14\u0e17\u0e35\u0e48\u0e42\u0e2d\u0e19 (\u0e1a\u0e32\u0e17) / Please enter the amount transferred');
    v.amount = Math.round(amt * 100) / 100;
    v.reference = webClean_(p.reference, 120);
    if (!v.reference) throw webUserError_('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e01\u0e23\u0e2d\u0e01\u0e40\u0e27\u0e25\u0e32\u0e17\u0e35\u0e48\u0e42\u0e2d\u0e19\u0e41\u0e25\u0e30\u0e40\u0e25\u0e02\u0e2d\u0e49\u0e32\u0e07\u0e2d\u0e34\u0e07 / Please enter transfer time & reference no.');
    if (p.confirm !== true && p.confirm !== 'true') throw webUserError_('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19\u0e27\u0e48\u0e32\u0e42\u0e2d\u0e19\u0e21\u0e31\u0e14\u0e08\u0e33\u0e41\u0e25\u0e49\u0e27 / Please confirm the deposit transfer');
  }
  return v;
}

function webOrderNote_(v) {
  if (v.preorder) {
    var parts = ['\u0e22\u0e2d\u0e14\u0e2d\u0e32\u0e2b\u0e32\u0e23 ' + v.foodTotal + ' \u0e1a\u0e32\u0e17: ' + v.lines.map(function (l) { return l.name + ' x ' + l.qty; }).join(' ; ')];
    parts.push('\u0e2d\u0e49\u0e32\u0e07\u0e2d\u0e34\u0e07\u0e42\u0e2d\u0e19: ' + v.reference);
    return parts.join(' | ');
  }
  return '\u0e44\u0e21\u0e48\u0e2a\u0e31\u0e48\u0e07\u0e2d\u0e32\u0e2b\u0e32\u0e23\u0e25\u0e48\u0e27\u0e07\u0e2b\u0e19\u0e49\u0e32 (\u0e02\u0e31\u0e49\u0e19\u0e15\u0e48\u0e33 ' + v.minSpend + ' \u0e1a\u0e32\u0e17 \u0e08\u0e48\u0e32\u0e22\u0e17\u0e35\u0e48\u0e23\u0e49\u0e32\u0e19)';
}

// ------------------------------------------------------------------ rows

function webBookingCode_(cfg, now, existingCodes) {
  var prefix = (cfg.key === 'ratch' ? 'RT-' : 'MN-') + Utilities.formatDate(now, WEB_TZ, 'yyMMdd') + '-';
  var max = 0;
  for (var i = 0; i < existingCodes.length; i++) {
    var c = String(existingCodes[i] || '');
    if (c.indexOf(prefix) === 0) {
      var n = parseInt(c.substring(prefix.length), 10);
      if (n > max) max = n;
    }
  }
  var s = String(max + 1);
  while (s.length < 3) s = '0' + s;
  return prefix + s;
}

function webBuildRow_(cfg, v, now, code) {
  var depositStatus = v.preorder ? WEB_DEPOSIT_WAIT : WEB_DEPOSIT_NONE;
  var note = webOrderNote_(v);
  if (cfg.key === 'garden') {
    return [
      now,                          // A
      WEB_CHANNEL,                  // B
      code,                         // C
      webCell_(v.name),             // D
      v.phone,                      // E (text)
      webCell_(v.line),             // F
      v.iso,                        // G yyyy-MM-dd (text)
      v.slot,                       // H (text)
      v.guests,                     // I
      v.zone.label,                 // J
      webCell_(v.special),          // K
      depositStatus,                // L
      v.amount || 0,                // M
      '',                           // N
      WEB_STATUS_PENDING,           // O
      '-',                          // P
      note,                         // Q
      WEB_RECORDER                  // R
    ];
  }
  return [
    now,                            // A
    WEB_CHANNEL,                    // B
    code,                           // C
    webCell_(v.name),               // D
    v.phone,                        // E (text)
    webCell_(v.line),               // F
    v.dmy,                          // G d/M/yyyy (text)
    v.slot,                         // H (text)
    v.guests,                       // I
    v.tables,                       // J
    v.zone.short,                   // K
    webCell_(v.special),            // L
    depositStatus,                  // M
    v.amount || 0,                  // N
    webCell_(v.reference),          // O (text)
    WEB_STATUS_PENDING,             // P
    '',                             // Q
    v.preorder ? '' : note,         // R
    WEB_RECORDER,                   // S
    v.foodTotal,                    // T
    v.lines.map(function (l) { return l.name + ' x ' + l.qty; }).join('\n') // U
  ];
}

// same booking (phone + name + date + slot) written in the last 5 minutes -> treat as double tap
function webFindDuplicate_(cfg, rows, v, nowMs) {
  var pk = v.phone.slice(-9);
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (webNormDate_(r[6]) !== v.dmy) continue;
    if (webNormSlot_(r[7]) !== v.slot) continue;
    if (String(r[4]).replace(/\D/g, '').slice(-9) !== pk) continue;
    if (String(r[3]).replace(/^'/, '').trim() !== v.name) continue;
    var t = (Object.prototype.toString.call(r[0]) === '[object Date]') ? r[0].getTime() : NaN;
    if (isFinite(t) && Math.abs(nowMs - t) <= WEB_DUP_WINDOW_MS) return String(r[2]);
  }
  return '';
}

// ------------------------------------------------------------------ LINE

function webLineText_(cfg, v, code, sheetId) {
  var t = [];
  t.push('\ud83d\udd14 \u0e08\u0e2d\u0e07\u0e43\u0e2b\u0e21\u0e48 ' + cfg.name);
  t.push('\u0e23\u0e2b\u0e31\u0e2a: ' + code);
  t.push('\u0e0a\u0e37\u0e48\u0e2d: ' + v.name);
  t.push('\u0e42\u0e17\u0e23: ' + v.phone);
  if (cfg.key === 'garden') {
    t.push('\u0e27\u0e31\u0e19\u0e40\u0e27\u0e25\u0e32: ' + v.dmy + ' | ' + v.slot + ' | ' + v.zone.label);
    t.push('\u0e08\u0e33\u0e19\u0e27\u0e19: ' + v.guests + ' \u0e17\u0e48\u0e32\u0e19');
  } else {
    t.push('\u0e27\u0e31\u0e19\u0e40\u0e27\u0e25\u0e32: ' + v.dmy + ' | ' + v.slot);
    t.push('\u0e08\u0e33\u0e19\u0e27\u0e19: ' + v.guests + ' \u0e17\u0e48\u0e32\u0e19 (' + v.tables + ' \u0e42\u0e15\u0e4a\u0e30)');
  }
  t.push('\u0e0a\u0e48\u0e2d\u0e07\u0e17\u0e32\u0e07: ' + WEB_CHANNEL);
  if (v.special) t.push('\u0e04\u0e27\u0e32\u0e21\u0e15\u0e49\u0e2d\u0e07\u0e01\u0e32\u0e23\u0e1e\u0e34\u0e40\u0e28\u0e29: ' + v.special);
  if (v.preorder) {
    t.push('\u0e22\u0e2d\u0e14\u0e2d\u0e32\u0e2b\u0e32\u0e23: ' + v.foodTotal + ' \u0e1a\u0e32\u0e17');
    var o = v.lines.map(function (l) { return l.name + ' x ' + l.qty; }).join('\n');
    if (o.length > 3000) o = o.substring(0, 3000) + '...';
    if (o) t.push(o);
    t.push('\u0e21\u0e31\u0e14\u0e08\u0e33: ' + (v.amount || 0) + ' \u0e1a\u0e32\u0e17');
    t.push('\u0e2d\u0e49\u0e32\u0e07\u0e2d\u0e34\u0e07\u0e01\u0e32\u0e23\u0e42\u0e2d\u0e19: ' + v.reference);
  } else {
    t.push('\u0e2d\u0e32\u0e2b\u0e32\u0e23: \u0e44\u0e21\u0e48\u0e2a\u0e31\u0e48\u0e07\u0e25\u0e48\u0e27\u0e07\u0e2b\u0e19\u0e49\u0e32 (\u0e02\u0e31\u0e49\u0e19\u0e15\u0e48\u0e33 ' + v.minSpend + ' \u0e1a\u0e32\u0e17 \u0e08\u0e48\u0e32\u0e22\u0e17\u0e35\u0e48\u0e23\u0e49\u0e32\u0e19)');
  }
  t.push('');
  t.push('\ud83d\udccb Sheet: https://docs.google.com/spreadsheets/d/' + sheetId + '/edit');
  return t.join('\n');
}

function webPushLine_(cfg, v, code, sheetId) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || props.getProperty('CHANNEL_ACCESS_TOKEN');
  var to = cfg.key === 'ratch'
    ? (props.getProperty('RT_TARGET_GROUP_ID') || props.getProperty('TARGET_USER_ID'))
    : (props.getProperty('TARGET_GROUP_ID') || props.getProperty('TARGET_USER_ID'));
  if (!token || !to) {
    Logger.log('webPushLine_: skipped (missing token or target)');
    return 0;
  }
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: webLineText_(cfg, v, code, sheetId) }] }),
    muteHttpExceptions: true
  });
  var rc = res.getResponseCode();
  Logger.log('webPushLine_ HTTP ' + rc + ' ' + res.getContentText());
  return rc;
}

// keep the Google Forms' date lists in sync (best effort)
function webSyncForms_(cfg) {
  try {
    if (cfg.key === 'garden') {
      if (typeof updateAvailableSlots === 'function' && PropertiesService.getScriptProperties().getProperty('MANA_GARDEN_FORM_ID')) updateAvailableSlots();
    } else if (typeof updateSlotsRatch === 'function' && PropertiesService.getScriptProperties().getProperty('RT_FORM_ID')) {
      updateSlotsRatch();
    }
  } catch (err) {
    Logger.log('webSyncForms_ failed: ' + err);
  }
}

// ------------------------------------------------------------------ submit

function webSummary_(cfg, v, code, duplicate) {
  return {
    ok: true,
    duplicate: !!duplicate,
    code: code,
    branch: cfg.name,
    name: v.name,
    phone: v.phone,
    dmy: v.dmy,
    slot: v.slot,
    zone: v.zone.label,
    guests: v.guests,
    tables: v.tables,
    preorder: v.preorder,
    lines: v.lines,
    foodTotal: v.foodTotal,
    amount: v.amount,
    reference: v.reference,
    minSpend: v.minSpend,
    depositRange: v.depositRange
  };
}

// google.script.run entry point
function webSubmitBooking(payload) {
  var cfg = webCfg_(payload && payload.branch);
  var v, code = '', duplicate = false, sheetId = '';
  try {
    var now = new Date();
    v = webValidate_(cfg, payload, now);
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var m = webOpenMaster_(cfg);
      sheetId = m.id;
      var rows = webReadRows_(cfg, m.sheet);
      now = new Date();
      var dupCode = webFindDuplicate_(cfg, rows, v, now.getTime());
      if (dupCode) {
        code = dupCode;
        duplicate = true;
      } else {
        // capacity is checked again here, inside the lock
        var usage = webLoadUsage_(cfg, rows);
        var zs = webZoneStatus_(cfg, v.zone, usage, v.dmy, v.slot, v.guests);
        if (zs.state === 'full') throw webUserError_('\u0e23\u0e2d\u0e1a\u0e19\u0e35\u0e49\u0e40\u0e15\u0e47\u0e21\u0e41\u0e25\u0e49\u0e27 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e23\u0e2d\u0e1a/\u0e42\u0e0b\u0e19\u0e2d\u0e37\u0e48\u0e19 / This slot is full, please pick another');
        if (zs.state === 'nofit') throw webUserError_('\u0e17\u0e35\u0e48\u0e19\u0e31\u0e48\u0e07\u0e40\u0e2b\u0e25\u0e37\u0e2d\u0e44\u0e21\u0e48\u0e1e\u0e2d\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a ' + v.guests + ' \u0e17\u0e48\u0e32\u0e19 (\u0e40\u0e2b\u0e25\u0e37\u0e2d ' + zs.remaining + ' ' + (zs.unit === 'tables' ? '\u0e42\u0e15\u0e4a\u0e30' : '\u0e17\u0e35\u0e48\u0e19\u0e31\u0e48\u0e07') + ') / Not enough capacity left for this party');
        code = webBookingCode_(cfg, now, rows.map(function (r) { return r[2]; }));
        var target = m.sheet.getLastRow() + 1;
        m.sheet.getRange(target, 5, 1, 1).setNumberFormat('@');
        m.sheet.getRange(target, 7, 1, 2).setNumberFormat('@');
        if (cfg.key === 'ratch') m.sheet.getRange(target, 15, 1, 1).setNumberFormat('@');
        var row = webBuildRow_(cfg, v, now, code);
        m.sheet.getRange(target, 1, 1, row.length).setValues([row]);
        SpreadsheetApp.flush();
        Logger.log('webSubmitBooking: saved ' + code + ' row ' + target + ' (' + cfg.key + ')');
      }
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    if (err && err.webUser) return { ok: false, error: err.message };
    Logger.log('webSubmitBooking failed: ' + err + (err && err.stack ? '\n' + err.stack : ''));
    return { ok: false, error: '\u0e23\u0e30\u0e1a\u0e1a\u0e02\u0e31\u0e14\u0e02\u0e49\u0e2d\u0e07 \u0e44\u0e21\u0e48\u0e2a\u0e32\u0e21\u0e32\u0e23\u0e16\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e01\u0e32\u0e23\u0e08\u0e2d\u0e07\u0e44\u0e14\u0e49 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e25\u0e2d\u0e07\u0e43\u0e2b\u0e21\u0e48\u0e2b\u0e23\u0e37\u0e2d\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d\u0e23\u0e49\u0e32\u0e19\u0e17\u0e32\u0e07 LINE / System error, please try again or contact us on LINE' };
  }
  if (!duplicate) {
    try { webPushLine_(cfg, v, code, sheetId); } catch (e2) { Logger.log('LINE push failed: ' + e2); }
    webSyncForms_(cfg);
  }
  return webSummary_(cfg, v, code, duplicate);
}

// google.script.run entry point (loaded on step 3 only, keeps the first page light)
function webGetQr() {
  return typeof WEB_QR_DATA_URI === 'string' ? WEB_QR_DATA_URI : '';
}

// ------------------------------------------------------------------ page

function webBootJson_(branch) {
  var cfg = webCfg_(branch);
  var now = new Date();
  var boot = {
    branch: cfg.key,
    name: cfg.name,
    slots: cfg.slots,
    maxGuests: cfg.maxGuests,
    slotGuestCap: cfg.slotGuestCap,
    zones: cfg.zones.map(function (z) { return { key: z.key, label: z.label, cap: z.cap, unit: z.unit, note: z.note }; }),
    today: webNowParts_(now).iso,
    dates: webDates_(now).map(function (iso) { return { iso: iso, dow: webDayOfWeek_(iso) }; }),
    depositPerTable: WEB_DEPOSIT_PER_TABLE,
    menu: webMenu_(cfg.key)
  };
  return webJsonSafe_(JSON.stringify(boot));
}

// JSON that is safe inside <script> and pure ASCII
function webJsonSafe_(json) {
  return json.replace(/[\u007f-\uffff]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

// ------------------------------------------------------------------ public JSON API
// Used by the static frontend (GitHub Pages). GET  ?api=ping | availability
//                                              POST text/plain JSON {api:'submit', ...booking}
// POST arrives in doPost (Ratchayothin.gs) which delegates here when webIsApiPost_(e) is true.

var WEB_API_VERSION = '2026-10-04-api1';
var WEB_RATE_SUBMIT_PER_MIN = 20;      // all visitors together
var WEB_RATE_PHONE_PER_10MIN = 5;      // one phone number
var WEB_RATE_AVAIL_PER_MIN = 150;      // all visitors together (cache hits are not counted)
var WEB_AVAIL_CACHE_SEC = 8;

function webJsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// short checksum of "id:price" for every item; lets the static page notice an outdated menu copy
function webMenuVersion_(branch) {
  var h = 5381, s = '';
  webMenu_(branch).forEach(function (c) { c.items.forEach(function (it) { s += it[0] + ':' + it[4] + ';'; }); });
  for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// true = allowed. Best effort counter in CacheService (not atomic, fine as a brake).
function webRateAllow_(key, limit, ttlSec) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get(key) || 0);
    if (n >= limit) return false;
    cache.put(key, String(n + 1), ttlSec);
    return true;
  } catch (err) {
    Logger.log('webRateAllow_ skipped: ' + err);
    return true;
  }
}

function webMinuteKey_(prefix) {
  return prefix + Math.floor(new Date().getTime() / 60000);
}

function webAvailVersion_() {
  try { return CacheService.getScriptCache().get('web_av_ver') || '0'; } catch (err) { return '0'; }
}

function webBumpAvailVersion_() {
  try { CacheService.getScriptCache().put('web_av_ver', String(new Date().getTime()), 21600); } catch (err) { Logger.log('bump skipped: ' + err); }
}

function webNormBranch_(b) {
  b = String(b || '').toLowerCase();
  return (b === 'ratch' || b === 'ratchayothin') ? 'ratch' : 'garden';
}

function webApiGet_(e) {
  var p = (e && e.parameter) || {};
  var api = String(p.api || '').toLowerCase();
  try {
    if (api === 'ping') {
      return webJsonOut_({ ok: true, api: WEB_API_VERSION, time: Utilities.formatDate(new Date(), WEB_TZ, "yyyy-MM-dd'T'HH:mm:ss"), menu: { garden: webMenuVersion_('garden'), ratch: webMenuVersion_('ratch') } });
    }
    if (api === 'availability') {
      var branch = webNormBranch_(p.b);
      var g = Math.floor(Number(p.guests));
      if (!isFinite(g) || g < 1) g = 1;
      var date = String(p.date || '').replace(/[^0-9\-]/g, '').slice(0, 10);
      var cacheKey = 'web_av_' + webAvailVersion_() + '_' + branch + '_' + date + '_' + g;
      var cache = null, hit = null;
      try { cache = CacheService.getScriptCache(); hit = cache.get(cacheKey); } catch (err0) { cache = null; }
      if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
      if (!webRateAllow_(webMinuteKey_('web_rl_av_'), WEB_RATE_AVAIL_PER_MIN, 120)) {
        return webJsonOut_({ ok: false, error: '\u0e21\u0e35\u0e1c\u0e39\u0e49\u0e43\u0e0a\u0e49\u0e07\u0e32\u0e19\u0e08\u0e33\u0e19\u0e27\u0e19\u0e21\u0e32\u0e01 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e23\u0e2d\u0e2a\u0e31\u0e01\u0e04\u0e23\u0e39\u0e48\u0e41\u0e25\u0e49\u0e27\u0e25\u0e2d\u0e07\u0e43\u0e2b\u0e21\u0e48 / Busy, please retry in a moment' });
      }
      var res = webGetAvailability(branch, date, g);
      res.menuVersion = webMenuVersion_(branch);
      var out = JSON.stringify(res);
      if (res.ok && cache) { try { cache.put(cacheKey, out, WEB_AVAIL_CACHE_SEC); } catch (err1) { /* too big or quota: ignore */ } }
      return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
    }
    return webJsonOut_({ ok: false, error: 'unknown api' });
  } catch (err) {
    Logger.log('webApiGet_ failed: ' + err);
    return webJsonOut_({ ok: false, error: '\u0e23\u0e30\u0e1a\u0e1a\u0e02\u0e31\u0e14\u0e02\u0e49\u0e2d\u0e07 \u0e25\u0e2d\u0e07\u0e43\u0e2b\u0e21\u0e48\u0e2d\u0e35\u0e01\u0e04\u0e23\u0e31\u0e49\u0e07 / Server error' });
  }
}

function webParseBody_(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return null;
    var o = JSON.parse(e.postData.contents);
    return (o && typeof o === 'object') ? o : null;
  } catch (err) {
    return null;
  }
}

// used by doPost in Ratchayothin.gs to tell a booking call from a LINE webhook
function webIsApiPost_(e) {
  var o = webParseBody_(e);
  return !!(o && o.api === 'submit');
}

function webApiPost_(e) {
  try {
    var o = webParseBody_(e);
    if (!o || o.api !== 'submit') return webJsonOut_({ ok: false, error: 'bad request' });
    var payload = (o.payload && typeof o.payload === 'object') ? o.payload : o;
    if (!webRateAllow_(webMinuteKey_('web_rl_sub_'), WEB_RATE_SUBMIT_PER_MIN, 120)) {
      return webJsonOut_({ ok: false, error: '\u0e21\u0e35\u0e1c\u0e39\u0e49\u0e43\u0e0a\u0e49\u0e07\u0e32\u0e19\u0e08\u0e33\u0e19\u0e27\u0e19\u0e21\u0e32\u0e01 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e23\u0e2d\u0e2a\u0e31\u0e01\u0e04\u0e23\u0e39\u0e48\u0e41\u0e25\u0e49\u0e27\u0e25\u0e2d\u0e07\u0e43\u0e2b\u0e21\u0e48 / Busy, please retry in a moment' });
    }
    var digits = String(payload.phone || '').replace(/\D/g, '').slice(0, 15);
    if (digits && !webRateAllow_('web_rl_ph_' + digits, WEB_RATE_PHONE_PER_10MIN, 600)) {
      return webJsonOut_({ ok: false, error: '\u0e2a\u0e48\u0e07\u0e04\u0e33\u0e02\u0e2d\u0e1a\u0e48\u0e2d\u0e22\u0e40\u0e01\u0e34\u0e19\u0e44\u0e1b \u0e01\u0e23\u0e38\u0e13\u0e32\u0e23\u0e2d 10 \u0e19\u0e32\u0e17\u0e35\u0e2b\u0e23\u0e37\u0e2d\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d\u0e23\u0e49\u0e32\u0e19\u0e17\u0e32\u0e07 LINE / Too many attempts, please wait 10 minutes or contact us on LINE' });
    }
    var res = webSubmitBooking(payload);
    if (res && res.ok && !res.duplicate) webBumpAvailVersion_();
    return webJsonOut_(res);
  } catch (err) {
    Logger.log('webApiPost_ failed: ' + err + (err && err.stack ? '\n' + err.stack : ''));
    return webJsonOut_({ ok: false, error: '\u0e23\u0e30\u0e1a\u0e1a\u0e02\u0e31\u0e14\u0e02\u0e49\u0e2d\u0e07 \u0e25\u0e2d\u0e07\u0e43\u0e2b\u0e21\u0e48\u0e2d\u0e35\u0e01\u0e04\u0e23\u0e31\u0e49\u0e07 / Server error' });
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.api) return webApiGet_(e);
  var b = (e && e.parameter && e.parameter.b) ? String(e.parameter.b).toLowerCase() : 'garden';
  var cfg = webCfg_(b === 'ratch' || b === 'ratchayothin' ? 'ratch' : 'garden');
  var t = HtmlService.createTemplateFromFile('Index');
  t.bootJson = webBootJson_(cfg.key);
  return t.evaluate()
    .setTitle(cfg.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Run once from the editor after pasting: checks sheets, properties and the menu
function webCheckSetup() {
  ['garden', 'ratch'].forEach(function (b) {
    var cfg = webCfg_(b);
    try {
      var m = webOpenMaster_(cfg);
      var rows = webReadRows_(cfg, m.sheet);
      Logger.log(cfg.name + ': Master Database OK, ' + rows.length + ' rows, ' + Object.keys(webMenuIndex_(b)).length + ' menu items');
      var av = webGetAvailability(b, '', 2);
      Logger.log(cfg.name + ': availability ok=' + av.ok + (av.ok ? ' open days=' + av.days.filter(function (d) { return d.open; }).length : ' ' + av.error));
    } catch (err) {
      Logger.log(cfg.name + ': PROBLEM ' + err);
    }
  });
  var props = PropertiesService.getScriptProperties();
  ['LINE_CHANNEL_ACCESS_TOKEN', 'TARGET_GROUP_ID', 'TARGET_USER_ID', 'RT_SHEET_ID', 'RT_TARGET_GROUP_ID'].forEach(function (k) {
    Logger.log('property ' + k + ': ' + (props.getProperty(k) ? 'set' : 'MISSING'));
  });
}
