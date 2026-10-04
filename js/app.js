
(function () {
  'use strict';

  /* ---------- branch + boot data ---------- */
  var BR = (new URLSearchParams(location.search).get('b') || window.MANA_DEFAULT_BRANCH || 'garden').toLowerCase();
  var SMOOTH = (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth';
  var BR_LOGO = null;
  BR = (BR === 'ratch' || BR === 'ratchayothin') ? 'ratch' : 'garden';

  function addDates(B) {            // Bangkok is UTC+7 all year (no DST)
    var base = Date.now() + 7 * 3600 * 1000, out = [];
    for (var d = 0; d <= 30; d++) {
      var dt = new Date(base + d * 86400000), iso = dt.toISOString().slice(0, 10);
      out.push({ iso: iso, dow: dt.getUTCDay() });
    }
    B.today = out[0].iso; B.dates = out;
  }

  /* ---------- API client (fetch) ---------- */
  var MSG_OFFLINE = 'ไม่มีสัญญาณอินเทอร์เน็ต กรุณาตรวจสอบการเชื่อมต่อ / No internet connection';
  var MSG_TIMEOUT = 'ระบบตอบกลับช้าเกินไป / The server took too long to respond';
  var MSG_NETWORK = 'เชื่อมต่อระบบไม่ได้ / Could not reach the server';
  var MSG_BADRESP = 'ระบบตอบกลับไม่ถูกต้อง กรุณาแจ้งร้าน / Unexpected response from the server';

  function apiFetch(url, opts, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (navigator.onLine === false) { reject(MSG_OFFLINE); return; }
      var ctl = window.AbortController ? new AbortController() : null, done = false;
      var timer = setTimeout(function () { if (done) return; done = true; if (ctl) ctl.abort(); reject(MSG_TIMEOUT); }, timeoutMs);
      if (ctl) opts.signal = ctl.signal;
      fetch(url, opts).then(function (res) { return res.text(); }).then(function (txt) {
        if (done) return; done = true; clearTimeout(timer);
        var j; try { j = JSON.parse(txt); } catch (e) { reject(MSG_BADRESP); return; }
        if (!j || typeof j !== 'object') { reject(MSG_BADRESP); return; }
        resolve(j);
      }, function () {
        if (done) return; done = true; clearTimeout(timer);
        reject(navigator.onLine === false ? MSG_OFFLINE : MSG_NETWORK);
      });
    });
  }

  function apiAvailability(branch, iso, guests, tries) {
    var url = API_URL + '?api=availability&b=' + encodeURIComponent(branch) + '&date=' + encodeURIComponent(iso) + '&guests=' + encodeURIComponent(guests);
    return apiFetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow' }, AVAIL_TIMEOUT_MS).catch(function (err) {
      if (tries > 1) return new Promise(function (r) { setTimeout(r, 800); }).then(function () { return apiAvailability(branch, iso, guests, tries - 1); });
      throw err;
    });
  }

  function apiSubmit(payload) {
    // text/plain keeps this a "simple" CORS request (no preflight); Apps Script reads the JSON from postData.contents
    var body = JSON.stringify(Object.assign({ api: 'submit' }, payload));
    return apiFetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow' }, SUBMIT_TIMEOUT_MS);
  }

  function setAttr(sel, attr, v) { var e = document.querySelector(sel); if (e) e.setAttribute(attr, v); }
  function applyBrand(branch) {
    var b = BRANDS[branch] || BRANDS.garden;
    ['logoHero', 'logoDone'].forEach(function (id) { var e = document.getElementById(id); if (e) e.src = b.logo; });
    var m = document.getElementById('markImg'); if (m) m.src = b.mark;
    setAttr('link[rel="icon"]', 'href', b.favicon);
    setAttr('link[rel="apple-touch-icon"]', 'href', b.apple);
    setAttr('meta[property="og:image"]', 'content', new URL(b.og, location.href).href);
    setAttr('meta[name="theme-color"]', 'content', b.theme);
  }
  function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

  function manaStart(BOOT) {
    var B = BOOT; addDates(B);
    document.title = B.title || document.title;
    applyBrand(B.branch);
    var MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    var DOWS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    var S = {
      step: 1, iso: B.today, slot: '', zone: B.zones.length === 1 ? B.zones[0].key : '', guests: 2,
      preorder: null, cart: {}, avail: null, availErr: '', loading: false, qr: '', submitting: false, openCats: {}, q: '', cat: 'all'
    };
    var ITEMS = {};
    B.menu.forEach(function (c) { c.items.forEach(function (it) { ITEMS[it[0]] = { id: it[0], th: it[1], en: it[2], zh: it[3], price: it[4], cat: c.id }; }); });

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function money(n) { return '฿' + Number(n).toLocaleString('en-US'); }
    function minSpend() { return S.guests <= 2 ? 300 : 500; }
    function tablesFor(g) { return Math.max(1, Math.ceil(g / 4)); }
    function dmy(iso) { var p = iso.split('-'); return (+p[2]) + '/' + (+p[1]) + '/' + p[0]; }
    function dateLong(iso) { var p = iso.split('-'); return (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }
    function zoneObj(k) { for (var i = 0; i < B.zones.length; i++) if (B.zones[i].key === k) return B.zones[i]; return null; }
    function foodTotal() { var t = 0; Object.keys(S.cart).forEach(function (id) { t += S.cart[id] * ITEMS[id].price; }); return t; }
    function itemCount() { var t = 0; Object.keys(S.cart).forEach(function (id) { t += S.cart[id]; }); return t; }

    function run(name, args, ok, fail) {
      var p = name === 'webGetAvailability' ? apiAvailability(args[0], args[1], args[2], 2) : apiSubmit(args[0]);
      p.then(ok, function (msg) { fail(String(msg)); });
    }

    /* ---------- header ---------- */
    function renderHeader() {
      $('brand').firstChild.nodeValue = 'MANA';
      $('brandSub').textContent = B.name;
      $('eyebrow').textContent = B.name;
      var t = foodTotal();
      $('steps').style.display = S.step === 4 ? 'none' : '';
      $('cartBtn').style.display = S.step === 4 ? 'none' : '';
      $('cartTotal').textContent = money(t);
      var ic = itemCount();
      if (String($('cartCnt').textContent) !== String(ic)) { $('cartCnt').textContent = ic; if (ic > 0) bump($('cartCnt')); }
      $('cbText').textContent = ic + ' รายการ';
      $('cbTotal').textContent = money(t);
      $('mhSub').textContent = B.name + ' \u2014 Food Pre-order';
      $('cartBar').classList.toggle('show', S.step === 2 && S.preorder === true && ic > 0);
      Array.prototype.forEach.call($('steps').children, function (d) {
        var n = +d.getAttribute('data-s');
        d.className = n === S.step ? 'on' : (n < S.step ? 'done' : '');
      });
      var prog = $('prog');
      if (S.step >= 2 && S.preorder) {
        prog.className = 'prog show';
        var min = minSpend(), pct = Math.min(100, Math.round(t / min * 100));
        $('progBar').style.width = pct + '%';
        $('progL').innerHTML = t >= min ? '✓ ถึงขั้นต่ำแล้ว' : 'เหลืออีก <b>' + money(min - t) + '</b> ถึงขั้นต่ำ';
        $('progR').innerHTML = 'ขั้นต่ำ <b>' + money(min) + '</b> (' + S.guests + ' ท่าน)';
      } else prog.className = 'prog';
      var top = document.querySelector('.top');
      document.documentElement.style.setProperty('--tabtop', (top ? top.offsetHeight : 118) + 'px');
    }

    function renderStats() {
      $('stDate').textContent = S.iso ? dateLong(S.iso) : '-';
      $('stSlot').textContent = S.slot ? S.slot.replace(/ /g, '') : '-';
      $('stGuests').textContent = S.guests + ' ท่าน';
      var z = zoneObj(S.zone);
      var unitTables = !z || z.unit === 'tables';
      $('stUnitL').textContent = unitTables ? 'โต๊ะที่ใช้' : 'ที่นั่งที่ใช้';
      $('stUnit').textContent = unitTables ? '~' + tablesFor(S.guests) + ' โต๊ะ' : S.guests + ' ที่นั่ง';
    }

    function renderInfoChips() {
      var c = [];
      if (B.branch === 'ratch') {
        c.push('<span class="pill green">ห้องแอร์ 15 โต๊ะ</span>', '<span class="pill">ต่อโต๊ะได้สูงสุด 4 โต๊ะ = 18 ท่าน</span>', '<span class="pill">รวมไม่เกิน 50 ท่านต่อรอบ</span>');
      } else {
        c.push('<span class="pill green">3 โซนที่นั่ง</span>', '<span class="pill">จองล่วงหน้า 30 วัน</span>');
      }
      c.push('<span class="pill">มัดจำเฉพาะผู้สั่งอาหารล่วงหน้า</span>');
      $('infoChips').innerHTML = c.join('');
    }

    /* ---------- availability ---------- */
    function fetchAvail(keepSlot) {
      S.loading = true; S.availErr = '';
      renderDates(); renderSlots(); renderZones();
      var g = S.guests, iso = S.iso, token = (S.token = (S.token || 0) + 1);
      run('webGetAvailability', [B.branch, iso, g], function (r) {
        if (token !== S.token) return;
        S.loading = false;
        if (r && r.menuVersion && B.menuVersion && r.menuVersion !== B.menuVersion) $('verBanner').className = 'banner bad show';
        if (!r || !r.ok) { S.availErr = (r && r.error) || 'โหลดรอบว่างไม่สำเร็จ'; S.avail = null; }
        else {
          S.avail = r;
          if (r.date !== S.iso) S.iso = r.date;
          var cur = null;
          r.slots.forEach(function (s) { if (s.slot === S.slot) cur = s; });
          if (!cur || cur.state !== 'open') { S.slot = ''; if (B.zones.length > 1) S.zone = ''; }
          else if (B.zones.length > 1) {
            var zs = null; cur.zones.forEach(function (z) { if (z.key === S.zone) zs = z; });
            if (!zs || zs.state !== 'open') S.zone = '';
          }
        }
        renderDates(); renderSlots(); renderZones(); renderStats();
      }, function (msg) {
        if (token !== S.token) return;
        S.loading = false; S.availErr = 'เชื่อมต่อไม่ได้ / ' + msg; S.avail = null;
        renderDates(); renderSlots(); renderZones();
      });
    }

    function renderDates() {
      var open = {};
      if (S.avail) S.avail.days.forEach(function (d) { open[d.iso] = d.open; });
      var h = B.dates.map(function (d) {
        var p = d.iso.split('-'), isOpen = S.avail ? open[d.iso] !== false : true;
        var cls = 'day' + (d.iso === S.iso ? ' on' : '') + (isOpen ? '' : ' full');
        return '<div class="' + cls + '" role="button" tabindex="0" aria-pressed="' + (d.iso === S.iso) + '" data-iso="' + d.iso + '"><small>' + (d.iso === B.today ? 'วันนี้' : DOWS[d.dow]) + '</small><b>' + (+p[2]) + '</b><small>' + MONTHS[+p[1] - 1] + '</small></div>';
      }).join('');
      $('dates').innerHTML = h;
      var on = $('dates').querySelector('.on');
      if (on) { var box = $('dates'); box.scrollLeft = on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2; }
    }

    function renderSlots() {
      var el = $('slots');
      el.classList.toggle('busy', !!(S.loading && S.avail));
      if (S.loading && !S.avail) { el.innerHTML = '<div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div>'; return; }
      if (S.availErr) { el.innerHTML = '<div class="sub" style="grid-column:1/-1;color:var(--bad)">' + esc(S.availErr) + ' <a href="#" id="retry" style="color:var(--gold2)">ลองใหม่</a></div>'; return; }
      if (!S.avail) { el.innerHTML = ''; return; }
      el.innerHTML = S.avail.slots.map(function (s) {
        var cls = 'opt' + (s.slot === S.slot ? ' on' : '') + (s.state === 'open' ? '' : ' dis');
        var note = s.state === 'full' ? 'เต็ม' : s.state === 'nofit' ? 'ไม่พอสำหรับ ' + S.guests + ' ท่าน' : s.state === 'past' ? 'ผ่านไปแล้ว' : 'ว่าง';
        return '<div class="' + cls + '" role="button" tabindex="0" aria-pressed="' + (s.slot === S.slot) + '" data-slot="' + esc(s.slot) + '">' + esc(s.slot.replace(/ /g, '')) + '<small>' + note + '</small></div>';
      }).join('');
    }

    function renderZones() {
      var el = $('zones');
      var cur = null;
      if (S.avail) S.avail.slots.forEach(function (s) { if (s.slot === S.slot) cur = s; });
      el.innerHTML = B.zones.map(function (z) {
        var st = null;
        if (cur) cur.zones.forEach(function (x) { if (x.key === z.key) st = x; });
        var unit = z.unit === 'tables' ? 'โต๊ะ' : 'ที่นั่ง';
        var sm = !st ? 'เลือกรอบเวลาก่อน / choose a slot first' : st.state === 'full' ? 'เต็ม' : st.state === 'nofit' ? 'เหลือ ' + st.remaining + ' ' + unit + ' (ไม่พอ)' : 'เหลือ ' + st.remaining + ' ' + unit;
        var ok = st && st.state === 'open';
        var cls = 'opt zone' + (z.key === S.zone ? ' on' : '') + (ok ? '' : ' dis');
        return '<div class="' + cls + '" role="button" tabindex="0" aria-pressed="' + (z.key === S.zone) + '" data-zone="' + z.key + '"><b>' + esc(z.label) + '</b><small style="color:' + (ok ? 'var(--muted)' : 'var(--bad)') + '">' + esc(sm) + '</small><small>' + esc(z.note) + '</small></div>';
      }).join('');
      if (B.branch === 'ratch' && cur && cur.zones[0].state === 'open') S.zone = B.zones[0].key;
    }

    function renderGuestHint() {
      var t = tablesFor(S.guests);
      var h = 'ใช้ประมาณ <b>' + t + ' โต๊ะ</b> (4 ท่าน/โต๊ะ)';
      if (B.branch === 'ratch') h += ' &middot; จองได้สูงสุด ' + B.maxGuests + ' ท่านต่อการจอง (ต่อได้ 4 โต๊ะ)';
      else h += ' &middot; บ้านปิติ/Outdoor คิดตามที่นั่ง';
      $('gHint').innerHTML = h;
    }

    /* ---------- menu ---------- */
    var CAM = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/></svg>';
    function buildMenu() {
      var h = B.menu.map(function (c) {
        var tag = esc(String(c.en || c.th).toUpperCase());
        var cards = c.items.map(function (it) {
          var primary = it[2] || it[1];
          var subs = (it[2] ? '<div class="mc-sub">' + esc(it[1]) + '</div>' : '') + (it[3] ? '<div class="mc-sub zh">' + esc(it[3]) + '</div>' : '');
          return '<article class="item mc" data-id="' + it[0] + '">' +
            '<div class="mc-img">' + CAM + '<span>Photo coming soon</span><em>' + esc(it[0]) + '</em></div>' +
            '<div class="mc-body"><div class="mc-tag">' + tag + '</div><div class="mc-name">' + esc(primary) + '</div>' + subs +
            '<div class="it-sub"></div>' +
            '<div class="mc-foot"><span class="mc-price">' + Number(it[4]).toLocaleString('en-US') + ' .-</span>' +
            '<button type="button" class="add" data-act="inc" aria-label="เพิ่ม ' + esc(primary) + '">Add</button>' +
            '<div class="step"><button type="button" data-act="dec" aria-label="ลด">&minus;</button><span class="q">0</span><button type="button" class="p" data-act="inc" aria-label="เพิ่ม">+</button></div></div>' +
            '</div></article>';
        }).join('');
        return '<section class="cat" data-cat="' + c.id + '"><h3 class="cat-title"><span>' + esc(c.th) + '</span><small>' + esc(c.en) + ' &middot; ' + c.items.length + ' รายการ</small></h3><div class="mgrid">' + cards + '</div></section>';
      }).join('');
      $('menu').innerHTML = h;
      $('tabs').innerHTML = '<div class="tab on" data-cat="all">ALL<span class="tth"> ทั้งหมด</span></div>' + B.menu.map(function (c) { return '<div class="tab" data-cat="' + c.id + '">' + esc(c.th) + '<i class="hide">0</i></div>'; }).join('');
    }

    function refreshItem(id) {
      var q = S.cart[id] || 0, it = ITEMS[id];
      var rows = document.querySelectorAll('.item[data-id="' + id + '"]');
      Array.prototype.forEach.call(rows, function (row) {
        row.classList.toggle('on', q > 0);
        var qe = row.querySelector('.q');
        if (String(qe.textContent) !== String(q)) { qe.textContent = q; if (q > 0) bump(qe); }
        var sub = row.querySelector('.it-sub');
        if (sub) sub.textContent = q > 0 ? 'รวม ' + money(q * it.price) : (row.classList.contains('mc') ? '' : '-');
      });
      var n = 0;
      B.menu.forEach(function (c) { if (c.id === it.cat) c.items.forEach(function (x) { n += S.cart[x[0]] || 0; }); });
      var tab = document.querySelector('.tab[data-cat="' + it.cat + '"] i');
      if (tab) { tab.textContent = n; tab.className = n > 0 ? '' : 'hide'; }
    }

    function setQty(id, q) {
      if (!ITEMS[id]) return;
      q = Math.max(0, Math.min(99, q));
      if (q === 0) delete S.cart[id]; else S.cart[id] = q;
      refreshItem(id);
      renderHeader();
      if ($('sheet').className.indexOf('show') > -1) renderSheet();
    }

    function applySearch() {
      var q = S.q.trim().toLowerCase(), any = false;
      var sel = q ? 'all' : (S.cat || 'all');
      Array.prototype.forEach.call(document.querySelectorAll('.cat'), function (cat) {
        var vis = 0, inCat = sel === 'all' || cat.getAttribute('data-cat') === sel;
        Array.prototype.forEach.call(cat.querySelectorAll('.item'), function (row) {
          var it = ITEMS[row.getAttribute('data-id')];
          var hit = !q || (it.th + ' ' + it.en + ' ' + it.zh).toLowerCase().indexOf(q) > -1;
          row.style.display = hit ? '' : 'none';
          if (hit) vis++;
        });
        cat.style.display = (vis && inCat) ? '' : 'none';
        if (vis && inCat) any = true;
      });
      $('noRes').className = 'empty' + (any ? ' hide' : '');
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.classList.toggle('on', t.getAttribute('data-cat') === sel); });
    }

    // category tabs: show one category (or ALL) as a card grid
    function openCat(id, scroll) {
      if (id !== 'all' && !document.querySelector('.cat[data-cat="' + id + '"]')) return;
      S.cat = id;
      if (S.q) { S.q = ''; $('fSearch').value = ''; }
      applySearch();
      var t = document.querySelector('.tab.on');
      if (t && t.scrollIntoView) { var box = $('tabs'); box.scrollLeft = t.offsetLeft - (box.clientWidth - t.offsetWidth) / 2; }
      if (scroll) {
        var top = document.querySelector('.top').offsetHeight + 8;
        window.scrollTo({ top: Math.max(0, $('menuHead').getBoundingClientRect().top + window.pageYOffset - top), behavior: SMOOTH });
      }
    }

    /* ---------- cart sheet ---------- */
    function renderSheet() {
      var ids = Object.keys(S.cart);
      $('sheetB').innerHTML = ids.length ? ids.map(function (id) {
        var it = ITEMS[id], q = S.cart[id];
        return '<div class="item on" data-id="' + id + '" style="grid-template-areas:\'main step\' \'price sub\'"><div class="it-main"><div class="it-name">' + esc(it.th) + '</div></div><div class="it-price">' + money(it.price) + ' x ' + q + '</div>' +
          '<div class="step"><button type="button" data-act="dec">&minus;</button><span class="q">' + q + '</span><button type="button" class="p" data-act="inc">+</button></div><div class="it-sub">' + money(q * it.price) + '</div></div>';
      }).join('') : '<div class="empty">ยังไม่ได้เลือกอาหาร / Cart is empty</div>';
      $('sheetTotal').textContent = money(foodTotal());
    }
    function showSheet(on) {
      if (on) renderSheet();
      $('sheet').className = 'sheet' + (on ? ' show' : '');
      $('ov').className = 'ov' + (on ? ' show' : '');
    }

    /* ---------- steps ---------- */
    function showStep(n) {
      S.step = n;
      ['s1', 's2', 's3', 'done'].forEach(function (id) { $(id).className = 'hide'; });
      $(n === 4 ? 'done' : 's' + n).className = '';
      $('bar').className = n === 4 ? 'bar hide' : 'bar';
      $('backBtn').style.display = n === 1 ? 'none' : '';
      var nx = $('nextBtn');
      nx.disabled = false;
      nx.innerHTML = n === 3 ? 'ยืนยันการจอง ✓' : 'ถัดไป &rarr;';
      if (n === 2) renderStep2();
      if (n === 3) renderStep3();
      renderHeader();
      window.scrollTo(0, 0);
    }

    function renderStep2() {
      $('modeYes').className = 'mode' + (S.preorder === true ? ' on' : '');
      $('modeNo').className = 'mode' + (S.preorder === false ? ' on' : '');
      $('menuBox').className = S.preorder === true ? '' : 'hide';
      $('modeCard').className = 'card gold' + (S.preorder === true ? ' compact' : '');
      var mn = minSpend();
      $('minNotice').innerHTML = 'การจองมี<b>ยอดสั่งขั้นต่ำ ' + money(mn) + '</b> (' + (S.guests <= 2 ? '1-2' : '3 ท่านขึ้นไป') + ' ท่าน: ' + (S.guests <= 2 ? '300' : '500') + ' บาท) ชำระที่ร้าน<br><span class="sub">Minimum spend ' + money(mn) + ' – 300 THB for 1-2 guests, 500 THB for 3+, paid at the restaurant.</span>';
      if (S.preorder === true) { $('minNotice').innerHTML += '<br>สั่งล่วงหน้าได้ถึงขั้นต่ำแล้วดูแถบด้านบน'; }
    }

    function renderStep3() {
      var z = zoneObj(S.zone), t = tablesFor(S.guests), rows = [];
      rows.push(['ชื่อ', esc(val('fName'))], ['โทร', esc(val('fPhone'))]);
      rows.push(['วันที่', esc(dateLong(S.iso))], ['รอบเวลา', esc(S.slot)]);
      rows.push(['จำนวน', S.guests + ' ท่าน' + (!z || z.unit === 'tables' ? ' (~' + t + ' โต๊ะ)' : '')], ['โซน', esc(z ? z.label : '-')]);
      if (val('fSpecial')) rows.push(['ความต้องการพิเศษ', esc(val('fSpecial'))]);
      $('sumBox').innerHTML = rows.map(function (r) { return '<div class="row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('');
      var pre = S.preorder === true;
      $('orderCard').className = pre ? 'card' : 'card hide';
      $('depCard').className = pre ? 'card' : 'card hide';
      $('noDepCard').className = pre ? 'card hide' : 'card';
      if (pre) {
        var ids = Object.keys(S.cart);
        $('orderBox').innerHTML = ids.map(function (id) { var it = ITEMS[id], q = S.cart[id]; return '<div class="row"><span style="color:var(--text)">' + esc(it.th) + ' x ' + q + '</span><b>' + money(q * it.price) + '</b></div>'; }).join('') +
          '<div class="total"><span>ยอดอาหารรวม</span><b>' + money(foodTotal()) + '</b></div>';
        var lo = t * B.depositPerTable[0], hi = t * B.depositPerTable[1];
        $('depInfo').innerHTML = 'ค่ามัดจำ <b>' + B.depositPerTable[0] + '-' + B.depositPerTable[1] + ' บาทต่อโต๊ะ</b> (ประมาณ ' + money(lo) + '-' + money(hi) + ' สำหรับ ' + t + ' โต๊ะ) ทีมงานจะยืนยันยอดที่แน่นอน<br><span class="sub">Deposit is 300-500 THB per table; our staff will confirm the exact amount.</span>';
        if (!$('fAmount').value) $('fAmount').placeholder = String(lo);
        loadQr();
      } else {
        $('noDepInfo').innerHTML = 'ไม่สั่งอาหารล่วงหน้า ไม่ต้องมัดจำ<br>ยอดสั่งขั้นต่ำ <b>' + money(minSpend()) + '</b> ชำระที่ร้าน<br><span class="sub">No pre-order, no deposit. Minimum spend ' + money(minSpend()) + ' paid at the restaurant.</span>';
      }
      $('submitErr').className = 'banner bad';
    }

    function loadQr() {
      $('qrBox').className = '';
      $('qrBox').innerHTML = '<img class="qr" alt="PromptPay QR" src="' + QR_URL + '">';
    }

    /* ---------- validation / submit ---------- */
    function val(id) { return ($(id).value || '').trim(); }
    function setErr(id, msg) { var e = $(id); e.textContent = msg || ''; e.className = 'err' + (msg ? ' show' : ''); return !!msg; }
    function validate1() {
      var bad = '';
      function mark(id, el, msg) { if (setErr(id, msg) && !bad) bad = el; }
      mark('eName', 'fName', val('fName').length < 2 ? 'กรุณากรอกชื่อ-นามสกุล' : '');
      mark('ePhone', 'fPhone', /^0\d{9}$/.test(val('fPhone').replace(/[\s-]/g, '')) ? '' : 'เบอร์โทรต้องเป็นตัวเลข 10 หลัก เช่น 0812345678');
      mark('eDate', 'dates', S.iso ? '' : 'กรุณาเลือกวันที่');
      mark('eSlot', 'slots', S.slot ? '' : 'กรุณาเลือกรอบเวลาที่ว่าง');
      mark('eGuests', 'fGuests', (S.guests >= 1 && S.guests <= B.maxGuests) ? '' : 'จำนวนต้องอยู่ระหว่าง 1-' + B.maxGuests);
      mark('eZone', 'zones', S.zone ? '' : 'กรุณาเลือกโซนที่นั่ง');
      if (bad) { var el = $(bad); window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 150, behavior: SMOOTH }); }
      return !bad;
    }

    function validate3() {
      if (S.preorder !== true) return true;
      var bad = false;
      var a = Number(val('fAmount'));
      bad = setErr('eAmount', (a > 0) ? '' : 'กรุณากรอกยอดที่โอน') || bad;
      bad = setErr('eRef', val('fRef') ? '' : 'กรุณากรอกเวลาโอนและเลขอ้างอิง') || bad;
      bad = setErr('eConfirm', $('fConfirm').checked ? '' : 'กรุณาติ๊กยืนยันการโอน') || bad;
      return !bad;
    }

    function payload() {
      return {
        branch: B.branch, name: val('fName'), phone: val('fPhone'), line: val('fLine'), iso: S.iso, slot: S.slot,
        guests: S.guests, zone: S.zone, special: val('fSpecial'), preorder: S.preorder === true,
        cart: S.preorder === true ? S.cart : {}, amount: val('fAmount'), reference: val('fRef'), confirm: $('fConfirm').checked, hp: val('fHp')
      };
    }

    function submit() {
      if (S.submitting || !validate3()) return;
      S.submitting = true;
      var nx = $('nextBtn'); nx.disabled = true; nx.innerHTML = '<span class="sp"></span>กำลังส่ง...';
      var eb = $('submitErr'); eb.className = 'banner bad';
      run('webSubmitBooking', [payload()], function (r) {
        S.submitting = false;
        if (r && r.ok) return showDone(r);
        nx.disabled = false; nx.innerHTML = 'ยืนยันการจอง ✓';
        eb.textContent = (r && r.error) || 'ส่งไม่สำเร็จ กรุณาลองใหม่'; eb.className = 'banner bad show';
        fetchAvail(true);
        eb.scrollIntoView({ behavior: SMOOTH, block: 'center' });
      }, function (msg) {
        S.submitting = false;
        nx.disabled = false; nx.innerHTML = 'ยืนยันการจอง ✓';
        eb.innerHTML = esc(msg) + '<br>ยังไม่แน่ใจว่าการจองถูกบันทึกหรือไม่ — กดปุ่มยืนยันอีกครั้งได้เลย (ระบบกันการจองซ้ำให้อัตโนมัติ) หรือสอบถามร้านทาง LINE<br><span class="sub">Not sure if your booking was saved? Press Confirm again (duplicates are blocked) or contact us on LINE.</span>';
        eb.className = 'banner bad show';
        eb.scrollIntoView({ behavior: SMOOTH, block: 'center' });
      });
    }

    function showDone(r) {
      $('doneCode').textContent = r.code;
      var rows = [['สาขา', r.branch], ['ชื่อ', r.name], ['วันที่', r.dmy], ['รอบเวลา', r.slot], ['โซน', r.zone], ['จำนวน', r.guests + ' ท่าน (~' + r.tables + ' โต๊ะ)']];
      var h = rows.map(function (x) { return '<div class="row"><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('');
      if (r.preorder) {
        h += r.lines.map(function (l) { return '<div class="row"><span style="color:var(--text)">' + esc(l.name) + ' x ' + l.qty + '</span><b>' + money(l.sub) + '</b></div>'; }).join('');
        h += '<div class="total"><span>ยอดอาหารรวม</span><b>' + money(r.foodTotal) + '</b></div><div class="row"><span>มัดจำที่แจ้งโอน</span><b>' + money(r.amount) + '</b></div>';
      }
      $('doneBox').innerHTML = h;
      $('doneNote').innerHTML = r.preorder ?
        '<b>ขั้นต่อไป:</b> ส่งสลิปโอนเงินให้ร้านทาง LINE พร้อมรหัสการจอง ทีมงานจะตรวจสอบและติดต่อกลับเพื่อยืนยัน<br><span class="sub">Please send your transfer slip on LINE with your booking code. Our team will confirm.</span>' :
        '<b>ขั้นต่อไป:</b> ทีมงานจะติดต่อกลับเพื่อยืนยัน ยอดสั่งขั้นต่ำ ' + money(r.minSpend) + ' ชำระที่ร้าน<br><span class="sub">Our team will contact you to confirm. Minimum spend ' + money(r.minSpend) + ' paid at the restaurant.</span>';
      showStep(4);
      $('prog').className = 'prog';
    }

    /* ---------- events ---------- */
    function onNext() {
      if (S.step === 1) { if (validate1()) showStep(2); return; }
      if (S.step === 2) {
        if (S.preorder === null) { $('minNotice').scrollIntoView({ behavior: SMOOTH, block: 'center' }); return; }
        if (S.preorder === true && foodTotal() <= 0) { $('fSearch').scrollIntoView({ behavior: SMOOTH, block: 'center' }); alertBar('กรุณาเลือกอาหารอย่างน้อย 1 รายการ หรือเลือก "ไม่สั่งอาหารล่วงหน้า"'); return; }
        showStep(3); return;
      }
      if (S.step === 3) submit();
    }
    function alertBar(msg) {
      var b = $('nextBtn'), old = b.innerHTML; b.innerHTML = msg; b.disabled = true;
      setTimeout(function () { b.innerHTML = old; b.disabled = false; }, 2600);
    }

    function bind() {
      $('nextBtn').onclick = onNext;
      $('backBtn').onclick = function () { if (S.step > 1) showStep(S.step - 1); };
      $('againBtn').onclick = function () { location.reload(); };
      $('cartBtn').onclick = function () { showSheet(true); };
      $('cartBar').onclick = function () { showSheet(true); };
      document.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.getAttribute && e.target.getAttribute('role') === 'button') { e.preventDefault(); e.target.click(); }
      });
      $('sheetX').onclick = $('sheetOk').onclick = $('ov').onclick = function () { showSheet(false); };
      $('dates').onclick = function (e) {
        var d = e.target.closest('.day'); if (!d || d.classList.contains('full')) return;
        S.iso = d.getAttribute('data-iso'); S.slot = ''; if (B.zones.length > 1) S.zone = '';
        setErr('eDate', ''); renderStats(); fetchAvail();
      };
      $('slots').onclick = function (e) {
        if (e.target.id === 'retry') { e.preventDefault(); fetchAvail(); return; }
        var s = e.target.closest('.opt'); if (!s || s.classList.contains('dis')) return;
        S.slot = s.getAttribute('data-slot'); if (B.zones.length > 1) S.zone = '';
        setErr('eSlot', ''); renderSlots(); renderZones(); renderStats();
      };
      $('zones').onclick = function (e) {
        var z = e.target.closest('.opt'); if (!z || z.classList.contains('dis')) return;
        S.zone = z.getAttribute('data-zone'); setErr('eZone', ''); renderZones(); renderStats();
      };
      var gt;
      function setGuests(n) {
        n = Math.max(1, Math.min(B.maxGuests, Math.floor(n) || 1));
        $('fGuests').value = n;
        if (n === S.guests) return;
        S.guests = n; renderGuestHint(); renderStats(); renderHeader(); setErr('eGuests', '');
        clearTimeout(gt); gt = setTimeout(function () { fetchAvail(); }, 350);
      }
      $('gMinus').onclick = function () { setGuests(S.guests - 1); };
      $('gPlus').onclick = function () { setGuests(S.guests + 1); };
      $('fGuests').onchange = function () { setGuests(Number($('fGuests').value)); };
      $('fGuests').max = B.maxGuests;
      $('modeYes').onclick = function () { S.preorder = true; renderStep2(); renderHeader(); };
      $('modeNo').onclick = function () { S.preorder = false; renderStep2(); renderHeader(); };
      $('fSearch').oninput = function () { S.q = $('fSearch').value; applySearch(); };
      $('tabs').onclick = function (e) { var t = e.target.closest('.tab'); if (t) openCat(t.getAttribute('data-cat'), true); };
      $('menu').onclick = stepClick;
      $('fullMenu').onclick = function () { openCat('all', true); };
      $('tabNext').onclick = function () { $('tabs').scrollBy({ left: 220, behavior: SMOOTH }); };
      $('sheetB').onclick = stepClick;
      function stepClick(e) {
        var b = e.target.closest('button[data-act]'); if (!b) return;
        var row = b.closest('.item'), id = row.getAttribute('data-id'), q = S.cart[id] || 0;
        setQty(id, b.getAttribute('data-act') === 'inc' ? q + 1 : q - 1);
      }
      ['fName', 'fPhone', 'fLine'].forEach(function (id) { $(id).addEventListener('input', function () { setErr({ fName: 'eName', fPhone: 'ePhone' }[id] || 'eName', ''); }); });
    }

    function init() {
      renderInfoChips(); renderGuestHint(); buildMenu(); bind();
      renderStats(); renderHeader(); showStep(1);
      fetchAvail();
    }
    window.__MANA = { S: S, B: B, go: showStep, setQty: setQty, openCat: openCat, renderStep3: renderStep3, showSheet: showSheet, fetchAvail: fetchAvail, setGuests: function (n) { $('fGuests').value = n; $('fGuests').onchange(); }, applySearch: applySearch };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }

  /* ---------- load branch data, then start ---------- */
  function load() {
    var boot = document.getElementById('boot'), txt = document.getElementById('bootTxt'), btn = document.getElementById('bootRetry');
    btn.className = 'hide'; txt.textContent = 'กำลังโหลด... / Loading...';
    fetch(DATA_URL[BR], { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (data) {
      manaStart(data);
      boot.className = 'bootmsg hide';
    }).catch(function (err) {
      if (window.console) console.error(err);
      txt.textContent = 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่ / Could not load the page data';
      btn.className = ''; btn.onclick = load;
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
