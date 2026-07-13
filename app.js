/* ════════════════════════════════════════════════════════════════════
   FIREBASE CONFIGURATION
   ─────────────────────────────────────────────────────────────────
   วิธีหาค่าเหล่านี้:
     1. ไปที่ https://console.firebase.google.com
     2. เลือก Project ของคุณ (หรือสร้างใหม่)
     3. กดไอคอน ⚙️  → "Project settings"
     4. เลื่อนลงหา "Your apps" → กด "</>" (Web app)
     5. ลงทะเบียน app แล้ว copy ค่าจาก firebaseConfig object
     6. วางค่าทับ "YOUR_..." ด้านล่างนี้

   ถ้ายังไม่มี Realtime Database:
     Firebase Console → Build → Realtime Database → Create database
     เลือก Region ใกล้ที่สุด → Start in test mode (ปรับ rules ทีหลัง)

   Security Rules แนะนำ (Realtime Database → Rules):
     {
       "rules": {
         "workforceData": {
           ".read": true,
           ".write": true
         }
       }
     }
   ════════════════════════════════════════════════════════════════ */

/* ▼▼▼ แก้ค่าด้านล่างนี้ด้วยค่าจาก Firebase Console ▼▼▼ */
var FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
/* ▲▲▲ แก้แค่นี้เท่านั้น ▲▲▲ */

/* ตั้งเป็น false เพื่อปิด Firebase และใช้แค่ระบบ download */
var FIREBASE_ENABLED = true;

/* ════════════════════════════════════════════════════════
   Workforce Manager — Application Logic (app.js)
   Sections: State · Boot/Migration · Dirty Flag
             Save/Download · Import · Image Helpers
             UI Helpers · Render · Employees · Missions
             Workers · Items · Attendance · Utilities
════════════════════════════════════════════════════════ */



/* ════ STATE ═══════════════════════════════════════════ */
let employees = [];
let missions  = [];
let empIdSeq  = 0;
let jobIdSeq  = 0;
let isDirty   = false;
let editEmpNewImg = null;
let editJobNewImg = null;
let pendingImport = null;
let confirmCallback = null;
let leaveCallback = null;
let addEmpImg = null;
let addJobImg = null;

/* ════ FIREBASE STATE ══════════════════════════════════════════ */
var firebaseApp    = null;
var firebaseDb     = null;
var autoSaveTimer  = null;
var fbInitialized  = false;
var AUTOSAVE_DELAY = 2000;

let attendanceDays = [];
let dayIdSeq = 0;
let items = [];
let itemIdSeq = 0;
let editItemNewImg = null;
let addItemImg = null;
let swipeSelectedDayId = null;
let swipeSelectedEmpId = null;
let swipeClockTimer = null;
const THAI_MONTHS_SHORT = ['\u0e21.\u0e04.','\u0e01.\u0e1e.','\u0e21\u0e35.\u0e04.','\u0e40\u0e21.\u0e22.','\u0e1e.\u0e04.','\u0e21\u0e34.\u0e22.','\u0e01.\u0e04.','\u0e2a.\u0e04.','\u0e01.\u0e22.','\u0e15.\u0e04.','\u0e1e.\u0e22.','\u0e18.\u0e04.'];


/* ════ BOOT & MIGRATION ════════════════════════════════ */
(function boot() {
  var raw = document.getElementById('wm-data') ? document.getElementById('wm-data').textContent.trim() : '';
  if (raw) {
    try {
      var d = JSON.parse(raw);
      var migrated = migrateData(d);
      employees      = migrated.employees;
      missions       = migrated.missions;
      empIdSeq       = migrated.empIdSeq;
      jobIdSeq       = migrated.jobIdSeq;
      attendanceDays = migrated.attendanceDays;
      dayIdSeq       = migrated.dayIdSeq;
      items          = migrated.items;
      itemIdSeq      = migrated.itemIdSeq;
    } catch(e) { console.warn('wm-data parse error', e); }
  }
  var hasLocalData = employees.length > 0 || missions.length > 0 || attendanceDays.length > 0 || items.length > 0;
  if (hasLocalData) markClean(); else markDirty();
  renderAll();
  startSwipeClock();
  initFirebase();
})();

function migrateData(d) {
  const out = {
    version:        4,
    empIdSeq:       d.empIdSeq ?? d.empSeq ?? 0,
    jobIdSeq:       d.jobIdSeq ?? d.jobSeq ?? 0,
    dayIdSeq:       d.dayIdSeq ?? 0,
    itemIdSeq:      d.itemIdSeq ?? 0,
    employees:      (d.employees ?? []).map(migrateEmployee),
    missions:       (d.missions  ?? []).map(migrateMission),
    attendanceDays: (d.attendanceDays ?? []).map(migrateDay),
    items:          (d.items ?? []).map(migrateItem),
  };
  out.empIdSeq  = Math.max(out.empIdSeq,  ...out.employees.map(e => e.id), 0);
  out.jobIdSeq  = Math.max(out.jobIdSeq,  ...out.missions.map(j => j.id),  0);
  out.dayIdSeq  = Math.max(out.dayIdSeq,  ...out.attendanceDays.map(dd => dd.id), 0);
  out.itemIdSeq = Math.max(out.itemIdSeq, ...out.items.map(it => it.id), 0);
  return out;
}
function migrateItem(it) {
  return {
    id:      it.id      ?? 0,
    name:    it.name    ?? '',
    img:     it.img     ?? null,
    desc:    it.desc    ?? '',
    note:    it.note    ?? '',
    status:  it.status  ?? 'available',
    jobId:   it.jobId   ?? null,
    jobName: it.jobName ?? null,
  };
}
function migrateEmployee(e) {
  return { id: e.id ?? 0, name: e.name ?? '', note: e.note ?? '', img: e.img ?? null, jobId: e.jobId ?? null, jobName: e.jobName ?? null, attendance: e.attendance ?? {} };
}
function migrateMission(j) {
  return { id: j.id ?? 0, name: j.name ?? '', desc: j.desc ?? '', note: j.note ?? '', img: j.img ?? null, required: j.required ?? 1, workers: j.workers ?? [], items: j.items ?? [] };
}
function migrateDay(d) {
  return { id: d.id ?? 0, date: d.date ?? '' };
}
function formatThaiDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const dd = parseInt(parts[2], 10);
  const beYear = y + 543;
  return dd + ' ' + (THAI_MONTHS_SHORT[m - 1] || '') + ' ' + beYear;
}


/* ════ DIRTY FLAG ══════════════════════════════════════ */
function markDirty() {
  isDirty = true;
  document.getElementById('save-dot').className = 'save-dot unsaved';
  document.getElementById('save-label').textContent = '\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01';
  scheduleAutoSave();
}
function markClean() {
  isDirty = false;
  document.getElementById('save-dot').className = 'save-dot saved';
  document.getElementById('save-label').textContent = '\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e41\u0e25\u0e49\u0e27 \u2714';
}


/* ════ UNSAVED GUARD ═══════════════════════════════════ */
window.addEventListener('beforeunload', e => {
  if (isDirty) { e.preventDefault(); e.returnValue = ''; }
});

/* ════ FIREBASE — INIT / LOAD / AUTO-SAVE ══════════════════════════ */

function initFirebase() {
  if (!FIREBASE_ENABLED) { setSyncUI('disabled'); return; }
  if (FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
    setSyncUI('disabled');
    console.info('Firebase: ยังไม่ได้ตั้งค่า — ใช้ระบบ download เท่านั้น');
    return;
  }
  if (typeof firebase === 'undefined') {
    console.warn('Firebase SDK \u0e44\u0e21\u0e48\u0e44\u0e14\u0e49\u0e42\u0e2b\u0e25\u0e14 \u0e15\u0e23\u0e27\u0e08 internet \u0e2b\u0e23\u0e37\u0e2d CDN');
    setSyncUI('error');
    return;
  }
  try {
    firebaseApp   = firebase.initializeApp(FIREBASE_CONFIG);
    firebaseDb    = firebase.database();
    fbInitialized = true;
    setSyncUI('loading');
    loadFromFirebase();
  } catch(e) {
    console.warn('Firebase init error:', e.message);
    setSyncUI('error');
  }
}

function loadFromFirebase() {
  if (!firebaseDb) return;
  setSyncUI('loading');
  firebaseDb.ref('workforceData').once('value')
    .then(function(snapshot) {
      var data = snapshot.val();
      var hasData = data && (
        (data.employees     && data.employees.length     > 0) ||
        (data.missions      && data.missions.length      > 0) ||
        (data.items         && data.items.length         > 0) ||
        (data.attendanceDays && data.attendanceDays.length > 0)
      );
      if (hasData) {
        var migrated   = migrateData(data);
        employees      = migrated.employees;
        missions       = migrated.missions;
        empIdSeq       = migrated.empIdSeq;
        jobIdSeq       = migrated.jobIdSeq;
        attendanceDays = migrated.attendanceDays;
        dayIdSeq       = migrated.dayIdSeq;
        items          = migrated.items;
        itemIdSeq      = migrated.itemIdSeq;
        renderAll();
        showToast('\u2601\ufe0f \u0e42\u0e2b\u0e25\u0e14\u0e08\u0e32\u0e01 Firebase \u0e41\u0e25\u0e49\u0e27');
      }
      isDirty = false;
      setSyncUI('ok');
    })
    .catch(function(e) {
      console.warn('Firebase load error:', e);
      setSyncUI('error');
      showToast('\u26a0 \u0e44\u0e21\u0e48\u0e2a\u0e32\u0e21\u0e32\u0e23\u0e16\u0e40\u0e0a\u0e37\u0e48\u0e2d\u0e21 Firebase \u0e43\u0e0a\u0e49\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25 local \u0e41\u0e17\u0e19');
    });
}

function scheduleAutoSave() {
  if (!firebaseDb) return;
  clearTimeout(autoSaveTimer);
  setSyncUI('pending');
  autoSaveTimer = setTimeout(autoSaveToFirebase, AUTOSAVE_DELAY);
}

function autoSaveToFirebase() {
  if (!firebaseDb) return;
  setSyncUI('saving');
  var data = {
    version: 4,
    empIdSeq: empIdSeq, jobIdSeq: jobIdSeq,
    dayIdSeq: dayIdSeq, itemIdSeq: itemIdSeq,
    employees: employees, missions: missions,
    attendanceDays: attendanceDays, items: items
  };
  firebaseDb.ref('workforceData').set(data)
    .then(function() {
      isDirty = false;
      document.getElementById('save-dot').className    = 'save-dot saved';
      document.getElementById('save-label').textContent = '\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e41\u0e25\u0e49\u0e27 \u2714';
      setSyncUI('ok');
    })
    .catch(function(e) {
      console.warn('Firebase save error:', e);
      setSyncUI('error');
      showToast('\u26a0 Auto-save \u0e25\u0e49\u0e21\u0e40\u0e2b\u0e25\u0e27 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e43\u0e0a\u0e49 Backup \u0e41\u0e17\u0e19');
    });
}

function setSyncUI(state) {
  var el = document.getElementById('sync-status');
  if (!el) return;
  var S = {
    disabled: { cls:'sync-disabled', icon:'\u2601\ufe0f',       label:'\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49\u0e40\u0e0a\u0e37\u0e48\u0e2d\u0e21\u0e15\u0e48\u0e2d' },
    loading:  { cls:'sync-loading',  icon:'\ud83d\udd04',       label:'\u0e01\u0e33\u0e25\u0e31\u0e07\u0e42\u0e2b\u0e25\u0e14...' },
    pending:  { cls:'sync-pending',  icon:'\u23f3',              label:'\u0e23\u0e2d sync...' },
    saving:   { cls:'sync-saving',   icon:'\ud83d\udd04',       label:'\u0e01\u0e33\u0e25\u0e31\u0e07 sync...' },
    ok:       { cls:'sync-ok',       icon:'\u2601\ufe0f\u2714',label:'Synced' },
    error:    { cls:'sync-err',      icon:'\u2601\ufe0f\u2717',label:'Offline' }
  };
  var s = S[state] || S.disabled;
  el.className = 'sync-status ' + s.cls;
  var iconEl  = el.querySelector('.sync-icon');
  var labelEl = el.querySelector('.sync-label');
  if (iconEl)  iconEl.textContent  = s.icon;
  if (labelEl) labelEl.textContent = s.label;
}



/* ════ SAVE & DOWNLOAD ═════════════════════════════════ */
function saveAndDownload() {
  if (!employees.length && !missions.length && !items.length && !attendanceDays.length) {
    showToast('\u26a0 \u0e44\u0e21\u0e48\u0e21\u0e35\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e43\u0e2b\u0e49\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01'); return;
  }
  var payload = JSON.stringify({
    version: 4, empIdSeq: empIdSeq, jobIdSeq: jobIdSeq,
    dayIdSeq: dayIdSeq, itemIdSeq: itemIdSeq,
    employees: employees, missions: missions,
    attendanceDays: attendanceDays, items: items
  });

  function injectData(html) {
    return html.replace(
      /(<script[^>]+id="wm-data"[^>]*>)([\s\S]*?)(<\/script>)/,
      function(_m, open, _old, close) { return open + '\n' + payload + '\n' + close; }
    );
  }
  function triggerDownload(content) {
    var blob = new Blob([content], { type: 'text/html;charset=utf-8' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    var ts   = new Date().toISOString().slice(0,16).replace('T','_').replace(':','-');
    a.href = url;
    a.download = 'workforce_' + ts + '.html';
    a.click();
    URL.revokeObjectURL(url);
    markClean();
    showToast('\ud83d\udcbe \u0e14\u0e32\u0e27\u0e19\u0e4c\u0e42\u0e2b\u0e25\u0e14\u0e44\u0e1f\u0e25\u0e4c\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08!');
  }

  var inlineCss = document.getElementById('main-css');
  var inlineJs  = document.getElementById('main-js');

  if (inlineCss && inlineJs) {
    triggerDownload(injectData(document.documentElement.outerHTML));
    return;
  }

  Promise.all([fetch('index.html'), fetch('style.css'), fetch('app.js')])
    .then(function(res) { return Promise.all(res.map(function(r) { return r.text(); })); })
    .then(function(texts) {
      var bundled = texts[0]
        .replace('<link rel="stylesheet" href="style.css">', '<style id="main-css">\n' + texts[1] + '\n</style>')
        .replace('<script src="app.js"></script>', '<script id="main-js">\n' + texts[2] + '\n</script>');
      triggerDownload(injectData(bundled));
    })
    .catch(function() {
      showToast('\u26a0 \u0e44\u0e21\u0e48\u0e2a\u0e32\u0e21\u0e32\u0e23\u0e16\u0e42\u0e2b\u0e25\u0e14\u0e44\u0e14\u0e49 \u0e25\u0e2d\u0e07\u0e43\u0e2b\u0e21\u0e48');
    });
}

function openImportModal() {
  pendingImport = null;
  document.getElementById('import-result').className = 'import-result';
  document.getElementById('import-result').innerHTML = '';
  document.getElementById('import-confirm-btn').style.display = 'none';
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-mode').className = 'import-mode';
  const radios = document.getElementsByName('import-mode-radio');
  for (let i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === 'merge');
  openModal('import-modal');
}
function onDragOver(e)  { e.preventDefault(); document.getElementById('import-drop').classList.add('drag-over'); }
function onDragLeave(e) { document.getElementById('import-drop').classList.remove('drag-over'); }
function onDrop(e)      { e.preventDefault(); onDragLeave(e); readImportFile(e.dataTransfer.files[0]); }

function readImportFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.html')) { showToast('\u26a0 \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e40\u0e09\u0e1e\u0e32\u0e30\u0e44\u0e1f\u0e25\u0e4c .html'); return; }
  const reader = new FileReader();
  reader.onload = function(e) { parseImportedHTML(e.target.result); };
  reader.readAsText(file, 'utf-8');
}

function parseImportedHTML(html) {
  const resultEl = document.getElementById('import-result');
  const btnEl    = document.getElementById('import-confirm-btn');
  let importedEmps = [], importedJobs = [], importedDays = [], importedItems = [];
  let log = [];

  const v2match = html.match(/<script[^>]+id="wm-data"[^>]*>([\s\S]*?)<\/script>/);
  if (v2match) {
    try {
      const d = JSON.parse(v2match[1].trim());
      const migrated = migrateData(d);
      importedEmps = migrated.employees;
      importedJobs = migrated.missions;
      importedDays = migrated.attendanceDays;
      importedItems = migrated.items;
      log.push('<span class="import-ok">\u2714 \u0e15\u0e23\u0e27\u0e08\u0e1e\u0e1a\u0e23\u0e39\u0e1b\u0e41\u0e1a\u0e1a v' + (d.version ?? 2) + ' (JSON data tag)</span>');
    } catch(err) {
      log.push('<span class="import-err">\u2715 \u0e2d\u0e48\u0e32\u0e19 JSON \u0e44\u0e21\u0e48\u0e44\u0e14\u0e49: ' + err.message + '</span>');
    }
  }

  if (!importedEmps.length && !importedJobs.length) {
    const empMatch = html.match(/\/\*EMPLOYEES_DATA\*\/([\s\S]*?)\/\*END\*\//);
    const jobMatch = html.match(/\/\*MISSIONS_DATA\*\/([\s\S]*?)\/\*END\*\//);
    if (empMatch || jobMatch) {
      log.push('<span class="import-ok">\u2714 \u0e15\u0e23\u0e27\u0e08\u0e1e\u0e1a\u0e23\u0e39\u0e1b\u0e41\u0e1a\u0e1a v1 (comment-injected)</span>');
      try { importedEmps = JSON.parse(empMatch ? empMatch[1] : '[]'); } catch(e) { importedEmps = []; }
      try { importedJobs = JSON.parse(jobMatch ? jobMatch[1] : '[]'); } catch(e) { importedJobs = []; }
      importedEmps = importedEmps.map(migrateEmployee);
      importedJobs = importedJobs.map(migrateMission);
    }
  }

  if (!importedEmps.length && !importedJobs.length && !importedDays.length && !importedItems.length) {
    log.push('<span class="import-err">\u2715 \u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e43\u0e19\u0e44\u0e1f\u0e25\u0e4c\u0e19\u0e35\u0e49</span>');
    pendingImport = null;
    btnEl.style.display = 'none';
    document.getElementById('import-mode').className = 'import-mode';
  } else {
    log.push('<span class="import-ok">\ud83d\udc65 \u0e1e\u0e1a\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19: ' + importedEmps.length + ' \u0e04\u0e19</span>');
    log.push('<span class="import-ok">\ud83d\udccb \u0e1e\u0e1a\u0e07\u0e32\u0e19: ' + importedJobs.length + ' \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23</span>');
    if (importedDays.length) {
      log.push('<span class="import-ok">\ud83d\udcc5 \u0e1e\u0e1a\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48\u0e40\u0e0a\u0e47\u0e04\u0e0a\u0e37\u0e48\u0e2d: ' + importedDays.length + ' \u0e27\u0e31\u0e19</span>');
    }
    if (importedItems.length) {
      log.push('<span class="import-ok">\u2b50 \u0e1e\u0e1a Items: ' + importedItems.length + ' \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23</span>');
    }
    pendingImport = { employees: importedEmps, missions: importedJobs, attendanceDays: importedDays, items: importedItems };
    btnEl.style.display = '';
    document.getElementById('import-mode').className = 'import-mode show';
  }

  resultEl.innerHTML = log.join('<br>');
  resultEl.className = 'import-result show';
}

function getSelectedImportMode() {
  const radios = document.getElementsByName('import-mode-radio');
  for (let i = 0; i < radios.length; i++) {
    if (radios[i].checked) return radios[i].value;
  }
  return 'merge';
}

function applyImport() {
  if (!pendingImport) return;
  const mode = getSelectedImportMode();
  if (mode === 'replace') {
    showConfirm(
      '\u0e41\u0e17\u0e19\u0e17\u0e35\u0e48\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14?',
      '\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e41\u0e25\u0e30\u0e07\u0e32\u0e19\u0e17\u0e35\u0e48\u0e21\u0e35\u0e2d\u0e22\u0e39\u0e48\u0e15\u0e2d\u0e19\u0e19\u0e35\u0e49\u0e08\u0e30\u0e16\u0e39\u0e01\u0e25\u0e1a\u0e2d\u0e2d\u0e01\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14 \u0e41\u0e25\u0e49\u0e27\u0e41\u0e17\u0e19\u0e17\u0e35\u0e48\u0e14\u0e49\u0e27\u0e22\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e08\u0e32\u0e01\u0e44\u0e1f\u0e25\u0e4c\u0e17\u0e35\u0e48\u0e19\u0e33\u0e40\u0e02\u0e49\u0e32 \u0e01\u0e32\u0e23\u0e01\u0e23\u0e30\u0e17\u0e33\u0e19\u0e35\u0e49\u0e44\u0e21\u0e48\u0e2a\u0e32\u0e21\u0e32\u0e23\u0e16\u0e22\u0e49\u0e2d\u0e19\u0e01\u0e25\u0e31\u0e1a\u0e44\u0e14\u0e49',
      '\u26a0 \u0e41\u0e17\u0e19\u0e17\u0e35\u0e48\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14',
      function() { doReplaceImport(); }
    );
  } else {
    doMergeImport();
  }
}

function performImportData(impEmps, impJobs, impDays, impItems) {
  const empIdMap  = {};
  const dayIdMap  = {};
  const itemIdMap = {};

  const newDays = (impDays || []).map(function(d) {
    const newId = ++dayIdSeq;
    dayIdMap[d.id] = newId;
    return { id: newId, date: d.date };
  });

  const newItems = (impItems || []).map(function(it) {
    const newId = ++itemIdSeq;
    itemIdMap[it.id] = newId;
    return Object.assign({}, it, { id: newId, jobId: null, jobName: null, status: it.status === 'in-use' ? 'available' : (it.status || 'available') });
  });

  const newEmps = (impEmps || []).map(function(e) {
    const newId = ++empIdSeq;
    empIdMap[e.id] = newId;
    const oldAttendance = e.attendance || {};
    const newAttendance = {};
    Object.keys(oldAttendance).forEach(function(oldDayId) {
      const mappedId = dayIdMap[oldDayId];
      if (mappedId) newAttendance[mappedId] = oldAttendance[oldDayId];
    });
    return Object.assign({}, e, { id: newId, jobId: null, jobName: null, attendance: newAttendance });
 
