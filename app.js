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
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCYnxKyWVWVEwtYbL2f4QbQgEHGO0Vxr5M",
  authDomain: "workforce-manager-14c7a.firebaseapp.com",
  databaseURL: "https://workforce-manager-14c7a-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "workforce-manager-14c7a",
  storageBucket: "workforce-manager-14c7a.firebasestorage.app",
  messagingSenderId: "622283071544",
  appId: "1:622283071544:web:f668ff2a2d90fef43d46cd",
  measurementId: "G-CLZ5R08MB8"
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
  try {
    firebaseApp   = firebase.initializeApp(FIREBASE_CONFIG);
    firebaseDb    = firebase.database();
    fbInitialized = true;
    setSyncUI('loading');
    loadFromFirebase();
  } catch(e) {
    console.warn('Firebase init error:', e);
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
  });

  const newJobs = (impJobs || []).map(function(j) {
    const newId      = ++jobIdSeq;
    const newWorkers = (j.workers || []).map(function(wId) { return empIdMap[wId] || null; }).filter(Boolean);
    const newJobItems= (j.items   || []).ma/* ════ BOOT & MIGRATION ════════════════════════════════ */
(function boot() {
  const raw = document.getElementById('wm-data')?.textContent?.trim();
  if (raw) {
    try {
      const d = JSON.parse(raw);
      const migrated = migrateData(d);
      employees = migrated.employees;
      missions  = migrated.missions;
      empIdSeq  = migrated.empIdSeq;
      jobIdSeq  = migrated.jobIdSeq;
      attendanceDays = migrated.attendanceDays;
      dayIdSeq  = migrated.dayIdSeq;
      items     = migrated.items;
      itemIdSeq = migrated.itemIdSeq;
    } catch(e) { console.warn('wm-data parse error', e); }
  }
  const hasData = employees.length > 0 || missions.length > 0 || attendanceDays.length > 0 || items.length > 0;
  if (hasData) markClean(); else markDirty();
  renderAll();
  startSwipeClock();
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
  });

  const newJobs = (impJobs || []).map(function(j) {
    const newId      = ++jobIdSeq;
    const newWorkers = (j.workers || []).map(function(wId) { return empIdMap[wId] || null; }).filter(Boolean);
    const newJobItems= (j.items   || []).map(function(iId) { return itemIdMap[iId] || null; }).filter(Boolean);
    const newJob = Object.assign({}, j, { id: newId, workers: newWorkers, items: newJobItems });
    newWorkers.forEach(function(wId) {
      const emp = newEmps.find(function(e) { return e.id === wId; });
      if (emp) { emp.jobId = newId; emp.jobName = newJob.name; }
    });
    newJobItems.forEach(function(iId) {
      const it = newItems.find(function(x) { return x.id === iId; });
      if (it) { it.status = 'in-use'; it.jobId = newId; it.jobName = newJob.name; }
    });
    return newJob;
  });

  return { newEmps: newEmps, newJobs: newJobs, newDays: newDays, newItems: newItems };
}

function doMergeImport() {
  const r = performImportData(pendingImport.employees, pendingImport.missions, pendingImport.attendanceDays || [], pendingImport.items || []);
  employees = employees.concat(r.newEmps);
  missions  = missions.concat(r.newJobs);
  attendanceDays = attendanceDays.concat(r.newDays);
  items = items.concat(r.newItems);
  closeModal('import-modal');
  markDirty();
  renderAll();
  showToast('\u2705 \u0e23\u0e27\u0e21\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e41\u0e25\u0e49\u0e27: ' + r.newEmps.length + ' \u0e04\u0e19, ' + r.newJobs.length + ' \u0e07\u0e32\u0e19, ' + r.newItems.length + ' items');
  pendingImport = null;
}

function doReplaceImport() {
  employees = [];
  missions  = [];
  attendanceDays = [];
  items     = [];
  empIdSeq  = 0;
  jobIdSeq  = 0;
  dayIdSeq  = 0;
  itemIdSeq = 0;

  const r = performImportData(pendingImport.employees, pendingImport.missions, pendingImport.attendanceDays || [], pendingImport.items || []);
  employees = r.newEmps;
  missions  = r.newJobs;
  attendanceDays = r.newDays;
  items = r.newItems;

  closeModal('import-modal');
  markDirty();
  renderAll();
  showToast('\u2705 \u0e41\u0e17\u0e19\u0e17\u0e35\u0e48\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e41\u0e25\u0e49\u0e27: ' + employees.length + ' \u0e04\u0e19, ' + missions.length + ' \u0e07\u0e32\u0e19, ' + items.length + ' items');
  pendingImport = null;
}


/* ════ IMAGE HELPERS ════════════════════════════════════ */
function toB64(file) {
  return new Promise(function(res) {
    const r = new FileReader();
    r.onload = function(e) { res(e.target.result); };
    r.readAsDataURL(file);
  });
}
async function previewImg(input, prevId, phId) {
  if (!input.files[0]) return;
  const b64  = await toB64(input.files[0]);
  const prev = document.getElementById(prevId);
  const ph   = document.getElementById(phId);
  prev.src = b64;
  prev.style.display = 'block';
  if (ph) ph.style.display = 'none';
  if (prevId === 'emp-add-prev')  addEmpImg     = b64;
  if (prevId === 'job-add-prev')  addJobImg     = b64;
  if (prevId === 'edit-emp-prev') editEmpNewImg = b64;
  if (prevId === 'edit-job-prev') editJobNewImg = b64;
  if (prevId === 'item-add-prev')  addItemImg    = b64;
  if (prevId === 'edit-item-prev') editItemNewImg = b64;
}


/* ════ UI HELPERS — TOAST / MODAL / CONFIRM ════════════ */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2800);
}

function openModal(id)  { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function showConfirm(title, body, okLabel, cb) {
  document.getElementById('confirm-title').textContent   = title;
  document.getElementById('confirm-body').textContent    = body;
  document.getElementById('confirm-ok-btn').textContent  = okLabel;
  confirmCallback = cb;
  openModal('confirm-modal');
}
function runConfirm() {
  closeModal('confirm-modal');
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
}
function confirmUnsavedLeave() {
  isDirty = false;
  closeModal('unsaved-modal');
  if (leaveCallback) leaveCallback();
  leaveCallback = null;
}


/* ════ RENDER — EMPLOYEE CARD ══════════════════════════ */
function renderEmpCard(emp) {
  const isWorking   = emp.jobId !== null;
  const statusClass = isWorking ? 'working' : 'available';
  const statusLabel = isWorking ? '\u0e17\u0e33\u0e07\u0e32\u0e19: ' + emp.jobName : '\u0e27\u0e48\u0e32\u0e07\u0e07\u0e32\u0e19';
  const imgHtml = emp.img
    ? '<img class="emp-card-img" src="' + emp.img + '" alt="' + h(emp.name) + '">'
    : '<div class="emp-card-img-placeholder">\ud83d\udc64</div>';
  return '<div class="emp-card" id="emp-' + emp.id + '">'
    + '<div class="emp-card-actions">'
    + '<button class="card-action-btn edit" onclick="openEditEmployee(' + emp.id + ')" title="\u0e41\u0e01\u0e49\u0e44\u0e02">\u270f\ufe0f</button>'
    + '<button class="card-action-btn del"  onclick="askDeleteEmployee(' + emp.id + ')" title="\u0e25\u0e1a">\ud83d\uddd1</button>'
    + '</div>'
    + imgHtml
    + '<div class="emp-card-body">'
    + '<div class="emp-card-name">' + h(emp.name) + '</div>'
    + '<div class="emp-card-note">' + h(emp.note || '\u2014') + '</div>'
    + '<div class="emp-status ' + statusClass + '">'
    + '<span class="status-dot"></span>'
    + '<span>' + h(statusLabel) + '</span>'
    + '</div></div></div>';
}


/* ════ RENDER — MISSION CARD ═══════════════════════════ */
function renderMissionCard(job) {
  const wc       = job.workers.length;
  const isEnough = wc >= job.required;
  const capClass = isEnough ? 'cap-ok' : 'cap-low';
  const capLabel = isEnough
    ? '\u2714 ' + wc + '/' + job.required + ' \u0e04\u0e19'
    : '\u26a0 \u0e04\u0e19\u0e44\u0e21\u0e48\u0e1e\u0e2d (' + wc + '/' + job.required + ')';
  const imgHtml = job.img
    ? '<img class="mission-img" src="' + job.img + '" alt="' + h(job.name) + '">'
    : '<div class="mission-img-ph">\ud83d\udccc</div>';
  const chips = job.workers.map(function(wId) {
    const w = employees.find(function(e) { return e.id === wId; });
    if (!w) return '';
    const av = w.img
      ? '<div class="worker-chip-avatar"><img src="' + w.img + '"></div>'
      : '<div class="worker-chip-avatar">\ud83d\udc64</div>';
    return '<span class="worker-chip">' + av + h(w.name)
      + '<button class="worker-chip-remove" onclick="removeWorker(' + job.id + ',' + w.id + ')">\u2715</button></span>';
  }).join('');
  const jobItems = (job.items || []);
  const itemChips = jobItems.map(function(iId) {
    const it = items.find(function(x) { return x.id === iId; });
    if (!it) return '';
    const av = it.img
      ? '<div class="worker-chip-avatar"><img src="' + it.img + '"></div>'
      : '<div class="item-chip-icon">\u2605</div>';
    return '<span class="item-chip">' + av + h(it.name)
      + '<button class="item-chip-remove" onclick="removeItemFromMission(' + job.id + ',' + it.id + ')">\u2715</button></span>';
  }).join('');
  const availItems = items.filter(function(it) { return it.status === 'available'; });
  const itemOpts = availItems.length
    ? '<option value="">\u0e40\u0e25\u0e37\u0e2d\u0e01 Item...</option>'
      + availItems.map(function(it) { return '<option value="' + it.id + '">' + h(it.name) + '</option>'; }).join('')
    : '<option value="">\u0e44\u0e21\u0e48\u0e21\u0e35 Item \u0e27\u0e48\u0e32\u0e07</option>';
  const avail = employees.filter(function(e) { return e.jobId === null; });
  const opts  = avail.length
    ? '<option value="">\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19...</option>'
      + avail.map(function(e) { return '<option value="' + e.id + '">' + h(e.name) + '</option>'; }).join('')
    : '<option value="">\u0e44\u0e21\u0e48\u0e21\u0e35\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e27\u0e48\u0e32\u0e07</option>';
  return '<div class="mission-card" id="job-' + job.id + '">'
    + '<div class="mission-card-inner">'
    + '<div class="mission-img-col">' + imgHtml + '</div>'
    + '<div class="mission-content">'
    + '<div class="mission-top">'
    + '<div class="mission-name">' + h(job.name) + '</div>'
    + '<span class="mission-capacity ' + capClass + '">' + capLabel + '</span>'
    + '<button class="btn btn-ghost btn-icon" onclick="openEditMission(' + job.id + ')" title="\u0e41\u0e01\u0e49\u0e44\u0e02">\u270f\ufe0f</button>'
    + '<button class="btn btn-danger btn-sm" onclick="askDeleteMission(' + job.id + ')">\u2715 \u0e25\u0e1a</button>'
    + '</div>'
    + (job.desc ? '<div class="mission-desc">' + h(job.desc) + '</div>' : '')
    + (job.note ? '<div class="mission-note">\ud83d\udcdd ' + h(job.note) + '</div>' : '')
    + '<div class="mission-workers">'
    + (chips || '<span style="font-size:12px;color:var(--text-dim)">\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e44\u0e14\u0e49\u0e23\u0e31\u0e1a\u0e21\u0e2d\u0e1a\u0e2b\u0e21\u0e32\u0e22</span>')
    + '</div>'
    + '<div class="mission-footer">'
    + '<select class="add-worker-select" id="worker-sel-' + job.id + '">' + opts + '</select>'
    + '<button class="btn btn-primary btn-sm" onclick="addWorker(' + job.id + ')">+ \u0e40\u0e1e\u0e34\u0e48\u0e21\u0e04\u0e19</button>'
    + '</div>'
    + '<div style="height:1px;background:var(--border);margin:10px 0"></div>'
    + '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">&#9733; Items \u0e17\u0e35\u0e48\u0e43\u0e0a\u0e49\u0e43\u0e19\u0e07\u0e32\u0e19\u0e19\u0e35\u0e49</div>'
    + '<div class="mission-workers" id="job-items-' + job.id + '">'
    + (itemChips || '<span style="font-size:12px;color:var(--text-dim)">\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35 Item \u0e44\u0e14\u0e49\u0e23\u0e31\u0e1a\u0e21\u0e2d\u0e1a\u0e2b\u0e21\u0e32\u0e22</span>')
    + '</div>'
    + '<div class="mission-footer">'
    + '<select class="add-worker-select" id="item-sel-' + job.id + '">' + itemOpts + '</select>'
    + '<button class="btn btn-purple btn-sm" onclick="assignItemToMission(' + job.id + ')">+ \u0e40\u0e1e\u0e34\u0e48\u0e21 Item</button>'
    + '</div></div></div></div>';
}


/* ════ RENDER — ALL ════════════════════════════════════ */
function renderAll()    { renderRoster(); renderMissions(); renderItemsGrid(); renderAttendanceTable(); renderSwipeSelects(); }
function renderRoster() {
  const grid  = document.getElementById('emp-grid');
  const empty = document.getElementById('emp-empty');
  document.getElementById('roster-count').textContent = employees.length + ' \u0e04\u0e19';
  if (!employees.length) {
    grid.innerHTML = '';
    grid.appendChild(empty);
    empty.style.display = 'block';
    return;
  }
  grid.innerHTML = employees.map(renderEmpCard).join('');
}
function renderMissions() {
  const list  = document.getElementById('mission-list');
  const empty = document.getElementById('mission-empty');
  document.getElementById('mission-count').textContent = missions.length + ' \u0e07\u0e32\u0e19';
  if (!missions.length) {
    list.innerHTML = '';
    list.appendChild(empty);
    empty.style.display = 'block';
    return;
  }
  list.innerHTML = missions.map(renderMissionCard).join('');
}


/* ════ EMPLOYEES ═══════════════════════════════════════ */
function addEmployee() {
  const name = document.getElementById('emp-name').value.trim();
  if (!name) { showToast('\u26a0 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e43\u0e2a\u0e48\u0e0a\u0e37\u0e48\u0e2d\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19'); return; }
  const note = document.getElementById('emp-note').value.trim();
  employees.push({ id: ++empIdSeq, name: name, note: note, img: addEmpImg, jobId: null, jobName: null });
  resetAddEmpForm();
  markDirty(); renderAll();
  showToast('\u2714 \u0e40\u0e1e\u0e34\u0e48\u0e21 ' + name + ' \u0e40\u0e02\u0e49\u0e32\u0e04\u0e25\u0e31\u0e07\u0e41\u0e25\u0e49\u0e27');
}
function resetAddEmpForm() {
  document.getElementById('emp-name').value = '';
  document.getElementById('emp-note').value = '';
  document.getElementById('emp-img-input').value = '';
  const prev = document.getElementById('emp-add-prev');
  const ph   = document.getElementById('emp-add-ph');
  prev.src = ''; prev.style.display = 'none';
  ph.style.display = '';
  addEmpImg = null;
}

function openEditEmployee(id) {
  const emp = employees.find(function(e) { return e.id === id; });
  if (!emp) return;
  document.getElementById('edit-emp-id').value   = id;
  document.getElementById('edit-emp-name').value = emp.name;
  document.getElementById('edit-emp-note').value = emp.note ?? '';
  const curImg = document.getElementById('edit-emp-cur-img');
  if (emp.img) { curImg.src = emp.img; curImg.style.display = 'block'; }
  else { curImg.style.display = 'none'; }
  editEmpNewImg = null;
  document.getElementById('edit-emp-img-input').value = '';
  document.getElementById('edit-emp-prev').style.display = 'none';
  document.getElementById('edit-emp-ph').style.display = '';
  openModal('edit-emp-modal');
}
function saveEditEmployee() {
  const id   = parseInt(document.getElementById('edit-emp-id').value);
  const name = document.getElementById('edit-emp-name').value.trim();
  if (!name) { showToast('\u26a0 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e43\u0e2a\u0e48\u0e0a\u0e37\u0e48\u0e2d\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19'); return; }
  const emp = employees.find(function(e) { return e.id === id; });
  if (!emp) return;
  emp.name = name;
  emp.note = document.getElementById('edit-emp-note').value.trim();
  if (editEmpNewImg) emp.img = editEmpNewImg;
  closeModal('edit-emp-modal');
  markDirty(); renderAll();
  showToast('\u2714 \u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25 ' + name + ' \u0e41\u0e25\u0e49\u0e27');
}
function askDeleteEmployee(id) {
  const emp = employees.find(function(e) { return e.id === id; });
  if (!emp) return;
  showConfirm('\u0e25\u0e1a\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19', '\u0e25\u0e1a "' + emp.name + '" \u0e2d\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e04\u0e25\u0e31\u0e07\u0e2b\u0e23\u0e37\u0e2d\u0e44\u0e21\u0e48?', '\ud83d\uddd1 \u0e25\u0e1a', function() { removeEmployee(id); });
}
function removeEmployee(id) {
  const emp = employees.find(function(e) { return e.id === id; });
  if (!emp) return;
  if (emp.jobId !== null) {
    const job = missions.find(function(j) { return j.id === emp.jobId; });
    if (job) job.workers = job.workers.filter(function(w) { return w !== id; });
  }
  employees = employees.filter(function(e) { return e.id !== id; });
  markDirty(); renderAll(); showToast('\ud83d\uddd1 \u0e25\u0e1a\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e41\u0e25\u0e49\u0e27');
}


/* ════ MISSIONS ════════════════════════════════════════ */
function addMission() {
  const name = document.getElementById('job-name').value.trim();
  const req  = parseInt(document.getElementById('job-count').value);
  if (!name)       { showToast('\u26a0 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e43\u0e2a\u0e48\u0e0a\u0e37\u0e48\u0e2d\u0e07\u0e32\u0e19'); return; }
  if (!req||req<1) { showToast('\u26a0 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e43\u0e2a\u0e48\u0e08\u0e33\u0e19\u0e27\u0e19\u0e04\u0e19'); return; }
  const desc = document.getElementById('job-desc').value.trim();
  const note = document.getElementById('job-note').value.trim();
  missions.push({ id: ++jobIdSeq, name: name, desc: desc, note: note, img: addJobImg, required: req, workers: [], items: [] });
  resetAddJobForm();
  markDirty(); renderAll();
  showToast('\u26a1 \u0e2a\u0e23\u0e49\u0e32\u0e07\u0e07\u0e32\u0e19 "' + name + '" \u0e41\u0e25\u0e49\u0e27');
}
function resetAddJobForm() {
  document.getElementById('job-name').value  = '';
  document.getElementById('job-count').value = '';
  document.getElementById('job-desc').value  = '';
  document.getElementById('job-note').value  = '';
  document.getElementById('job-img-input').value = '';
  const prev = document.getElementById('job-add-prev');
  const ph   = document.getElementById('job-add-ph');
  prev.src = ''; prev.style.display = 'none';
  ph.style.display = '';
  addJobImg = null;
}

function openEditMission(id) {
  const job = missions.find(function(j) { return j.id === id; });
  if (!job) return;
  document.getElementById('edit-job-id').value    = id;
  document.getElementById('edit-job-name').value  = job.name;
  document.getElementById('edit-job-count').value = job.required;
  document.getElementById('edit-job-desc').value  = job.desc ?? '';
  document.getElementById('edit-job-note').value  = job.note ?? '';
  const curImg = document.getElementById('edit-job-cur-img');
  if (job.img) { curImg.src = job.img; curImg.style.display = 'block'; }
  else { curImg.style.display = 'none'; }
  editJobNewImg = null;
  document.getElementById('edit-job-img-input').value = '';
  document.getElementById('edit-job-prev').style.display = 'none';
  document.getElementById('edit-job-ph').style.display = '';
  openModal('edit-job-modal');
}
function saveEditMission() {
  const id   = parseInt(document.getElementById('edit-job-id').value);
  const name = document.getElementById('edit-job-name').value.trim();
  const req  = parseInt(document.getElementById('edit-job-count').value);
  if (!name)       { showToast('\u26a0 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e43\u0e2a\u0e48\u0e0a\u0e37\u0e48\u0e2d\u0e07\u0e32\u0e19'); return; }
  if (!req||req<1) { showToast('\u26a0 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e43\u0e2a\u0e48\u0e08\u0e33\u0e19\u0e27\u0e19\u0e04\u0e19'); return; }
  const job = missions.find(function(j) { return j.id === id; });
  if (!job) return;
  const oldName = job.name;
  job.name     = name;
  job.required = req;
  job.desc     = document.getElementById('edit-job-desc').value.trim();
  job.note     = document.getElementById('edit-job-note').value.trim();
  if (editJobNewImg) job.img = editJobNewImg;
  if (oldName !== name) {
    job.workers.forEach(function(wId) {
      const emp = employees.find(function(e) { return e.id === wId; });
      if (emp) emp.jobName = name;
    });
  }
  closeModal('edit-job-modal');
  markDirty(); renderAll();
  showToast('\u2714 \u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15\u0e07\u0e32\u0e19 "' + name + '" \u0e41\u0e25\u0e49\u0e27');
}
function askDeleteMission(id) {
  const job = missions.find(function(j) { return j.id === id; });
  if (!job) return;
  showConfirm('\u0e25\u0e1a\u0e07\u0e32\u0e19', '\u0e25\u0e1a\u0e07\u0e32\u0e19 "' + job.name + '" \u0e2b\u0e23\u0e37\u0e2d\u0e44\u0e21\u0e48?', '\ud83d\uddd1 \u0e25\u0e1a', function() { removeMission(id); });
}
function removeMission(id) {
  const job = missions.find(function(j) { return j.id === id; });
  if (!job) return;
  job.workers.forEach(function(wId) {
    const emp = employees.find(function(e) { return e.id === wId; });
    if (emp) { emp.jobId = null; emp.jobName = null; }
  });
  missions = missions.filter(function(j) { return j.id !== id; });
  markDirty(); renderAll(); showToast('\ud83d\uddd1 \u0e25\u0e1a\u0e07\u0e32\u0e19\u0e41\u0e25\u0e49\u0e27');
}


/* ════ WORKER ASSIGNMENT ═══════════════════════════════ */
function addWorker(jobId) {
  const empId = parseInt(document.getElementById('worker-sel-' + jobId).value);
  if (!empId) { showToast('\u26a0 \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e01\u0e48\u0e2d\u0e19'); return; }
  const job = missions.find(function(j) { return j.id === jobId; });
  const emp = employees.find(function(e) { return e.id === empId; });
  if (!job || !emp) return;
  if (job.workers.includes(empId)) { showToast('\u26a0 \u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e19\u0e35\u0e49\u0e2d\u0e22\u0e39\u0e48\u0e43\u0e19\u0e07\u0e32\u0e19\u0e19\u0e35\u0e49\u0e41\u0e25\u0e49\u0e27'); return; }
  job.workers.push(empId);
  emp.jobId   = jobId;
  emp.jobName = job.name;
  markDirty(); renderAll();
  showToast('\u2714 \u0e21\u0e2d\u0e1a\u0e2b\u0e21\u0e32\u0e22 ' + emp.name + ' \u2192 ' + job.name);
}
function removeWorker(jobId, empId) {
  const job = missions.find(function(j) { return j.id === jobId; });
  const emp = employees.find(function(e) { return e.id === empId; });
  if (!job || !emp) return;
  job.workers = job.workers.filter(function(w) { return w !== empId; });
  emp.jobId   = null;
  emp.jobName = null;
  markDirty(); renderAll();
  showToast('\u21a9 ' + emp.name + ' \u0e16\u0e39\u0e01\u0e16\u0e2d\u0e14\u0e2d\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e07\u0e32\u0e19\u0e41\u0e25\u0e49\u0e27');
}


/* ════ ATTENDANCE — DAY COLUMNS ════════════════════════ */
function openAddDayModal() {
  document.getElementById('new-day-date').value = '';
  openModal('add-day-modal');
}
function saveNewDay() {
  const dateVal = document.getElementById('new-day-date').value;
  if (!dateVal) { showToast('\u26a0 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48'); return; }
  const exists = attendanceDays.some(function(d) { return d.date === dateVal; });
  if (exists) { showToast('\u26a0 \u0e21\u0e35\u0e04\u0e2d\u0e25\u0e31\u0e21\u0e19\u0e4c\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48\u0e19\u0e35\u0e49\u0e2d\u0e22\u0e39\u0e48\u0e41\u0e25\u0e49\u0e27'); return; }
  attendanceDays.push({ id: ++dayIdSeq, date: dateVal });
  closeModal('add-day-modal');
  markDirty();
  renderAll();
  showToast('\u2714 \u0e40\u0e1e\u0e34\u0e48\u0e21\u0e04\u0e2d\u0e25\u0e31\u0e21\u0e19\u0e4c\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48\u0e41\u0e25\u0e49\u0e27');
}
function askDeleteDay(dayId) {
  const day = attendanceDays.find(function(d) { return d.id === dayId; });
  if (!day) return;
  showConfirm(
    '\u0e25\u0e1a\u0e04\u0e2d\u0e25\u0e31\u0e21\u0e19\u0e4c\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48',
    '\u0e25\u0e1a\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48 ' + formatThaiDate(day.date) + ' \u0e2d\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e15\u0e32\u0e23\u0e32\u0e07\u0e2b\u0e23\u0e37\u0e2d\u0e44\u0e21\u0e48? \u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e01\u0e32\u0e23\u0e40\u0e0a\u0e47\u0e04\u0e0a\u0e37\u0e48\u0e2d\u0e02\u0e2d\u0e07\u0e27\u0e31\u0e19\u0e19\u0e35\u0e49\u0e08\u0e30\u0e2b\u0e32\u0e22\u0e44\u0e1b\u0e14\u0e49\u0e27\u0e22',
    '\ud83d\uddd1 \u0e25\u0e1a',
    function() { removeDay(dayId); }
  );
}
function removeDay(dayId) {
  attendanceDays = attendanceDays.filter(function(d) { return d.id !== dayId; });
  employees.forEach(function(e) {
    if (e.attendance && Object.prototype.hasOwnProperty.call(e.attendance, dayId)) delete e.attendance[dayId];
  });
  if (swipeSelectedDayId === dayId) swipeSelectedDayId = null;
  markDirty();
  renderAll();
  showToast('\ud83d\uddd1 \u0e25\u0e1a\u0e04\u0e2d\u0e25\u0e31\u0e21\u0e19\u0e4c\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48\u0e41\u0e25\u0e49\u0e27');
}



/* ════ ITEMS ═══════════════════════════════════════════ */
function renderItemsGrid() {
  var grid  = document.getElementById('items-grid');
  var empty = document.getElementById('items-empty');
  var countEl = document.getElementById('items-count');
  if (!grid) return;
  if (countEl) countEl.textContent = items.length + ' \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23';
  if (!items.length) {
    grid.innerHTML = '';
    grid.appendChild(empty);
    empty.style.display = 'block';
    return;
  }
  grid.innerHTML = items.map(renderItemCard).join('');
}

function renderItemCard(it) {
  var st = it.status;
  var stClass, stLabel;
  if (st === 'in-use') {
    stClass = 'st-inuse';
    stLabel = '\u0e16\u0e39\u0e01\u0e43\u0e0a\u0e49: ' + (it.jobName || '');
  } else if (st === 'damaged') {
    stClass = 'st-damaged';
    stLabel = '\u0e40\u0e2a\u0e35\u0e22\u0e2b\u0e32\u0e22';
  } else {
    stClass = 'st-available';
    stLabel = '\u0e27\u0e48\u0e32\u0e07';
  }
  var imgHtml = it.img
    ? '<img class="item-card-img" src="' + it.img + '" alt="' + h(it.name) + '">'
    : '<div class="item-card-img-placeholder">\u2b50</div>';
  return '<div class="item-card" id="item-' + it.id + '">'
    + '<div class="emp-card-actions">'
    + '<button class="card-action-btn edit" onclick="openEditItem(' + it.id + ')" title="\u0e41\u0e01\u0e49\u0e44\u0e02">\u270f\ufe0f</button>'
    + '<button class="card-action-btn del"  onclick="askDeleteItem(' + it.id + ')" title="\u0e25\u0e1a">\ud83d\uddd1</button>'
    + '</div>'
    + imgHtml
    + '<div class="item-card-body">'
    + '<div class="item-card-name">' + h(it.name) + '</div>'
    + '<div class="item-card-desc">' + h(it.desc || '\u2014') + '</div>'
    + '<div class="item-status ' + stClass + '">'
    + '<span class="status-dot"></span>'
    + '<span>' + h(stLabel) + '</span>'
    + '</div></div></div>';
}

function addItem() {
  var name = document.getElementById('item-name').value.trim();
  if (!name) { showToast('\u26a0 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e43\u0e2a\u0e48\u0e0a\u0e37\u0e48\u0e2d Item'); return; }
  var desc   = document.getElementById('item-desc').value.trim();
  var note   = document.getElementById('item-note').value.trim();
  var status = document.getElementById('item-init-status').value;
  items.push({ id: ++itemIdSeq, name: name, img: addItemImg, desc: desc, note: note, status: status, jobId: null, jobName: null });
  document.getElementById('item-name').value  = '';
  document.getElementById('item-desc').value  = '';
  document.getElementById('item-note').value  = '';
  document.getElementById('item-init-status').value = 'available';
  document.getElementById('item-img-input').value   = '';
  var prev = document.getElementById('item-add-prev');
  var ph   = document.getElementById('item-add-ph');
  prev.src = ''; prev.style.display = 'none'; ph.style.display = '';
  addItemImg = null;
  markDirty(); renderAll();
  showToast('\u2714 \u0e40\u0e1e\u0e34\u0e48\u0e21 ' + name + ' \u0e40\u0e02\u0e49\u0e32\u0e04\u0e25\u0e31\u0e07\u0e41\u0e25\u0e49\u0e27');
}

function openEditItem(id) {
  var it = items.find(function(x) { return x.id === id; });
  if (!it) return;
  document.getElementById('edit-item-id').value     = id;
  document.getElementById('edit-item-name').value   = it.name;
  document.getElementById('edit-item-desc').value   = it.desc || '';
  document.getElementById('edit-item-note').value   = it.note || '';
  document.getElementById('edit-item-status').value = it.status;
  var curImg = document.getElementById('edit-item-cur-img');
  if (it.img) { curImg.src = it.img; curImg.style.display = 'block'; }
  else { curImg.style.display = 'none'; }
  editItemNewImg = null;
  document.getElementById('edit-item-img-input').value  = '';
  document.getElementById('edit-item-prev').style.display = 'none';
  document.getElementById('edit-item-ph').style.display  = '';
  var jobInfo     = document.getElementById('edit-item-job-info');
  var unassignBtn = document.getElementById('edit-item-unassign-btn');
  if (it.status === 'in-use' && it.jobId !== null) {
    jobInfo.textContent = '\ud83d\udccc \u0e16\u0e39\u0e01\u0e43\u0e0a\u0e49\u0e43\u0e19\u0e07\u0e32\u0e19: ' + (it.jobName || '');
    jobInfo.style.display = 'block';
    unassignBtn.style.display = '';
  } else {
    jobInfo.style.display = 'none';
    unassignBtn.style.display = 'none';
  }
  openModal('edit-item-modal');
}

function saveEditItem() {
  var id   = parseInt(document.getElementById('edit-item-id').value);
  var name = document.getElementById('edit-item-name').value.trim();
  if (!name) { showToast('\u26a0 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e43\u0e2a\u0e48\u0e0a\u0e37\u0e48\u0e2d Item'); return; }
  var it = items.find(function(x) { return x.id === id; });
  if (!it) return;
  var newStatus = document.getElementById('edit-item-status').value;
  var oldStatus = it.status;
  it.name   = name;
  it.desc   = document.getElementById('edit-item-desc').value.trim();
  it.note   = document.getElementById('edit-item-note').value.trim();
  it.status = newStatus;
  if (editItemNewImg) it.img = editItemNewImg;
  if (oldStatus === 'in-use' && newStatus !== 'in-use' && it.jobId !== null) {
    var job = missions.find(function(j) { return j.id === it.jobId; });
    if (job) job.items = (job.items || []).filter(function(iId) { return iId !== id; });
    it.jobId   = null;
    it.jobName = null;
  }
  closeModal('edit-item-modal');
  markDirty(); renderAll();
  showToast('\u2714 \u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15 Item "' + name + '" \u0e41\u0e25\u0e49\u0e27');
}

function unassignItemFromJob() {
  var id = parseInt(document.getElementById('edit-item-id').value);
  var it = items.find(function(x) { return x.id === id; });
  if (!it || it.jobId === null) return;
  var job = missions.find(function(j) { return j.id === it.jobId; });
  if (job) job.items = (job.items || []).filter(function(iId) { return iId !== id; });
  it.status  = 'available';
  it.jobId   = null;
  it.jobName = null;
  closeModal('edit-item-modal');
  markDirty(); renderAll();
  showToast('\u2190 Item \u0e19\u0e33\u0e2d\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e07\u0e32\u0e19\u0e41\u0e25\u0e49\u0e27 \u0e2a\u0e16\u0e32\u0e19\u0e30: \u0e27\u0e48\u0e32\u0e07');
}

function askDeleteItem(id) {
  var it = items.find(function(x) { return x.id === id; });
  if (!it) return;
  showConfirm(
    '\u0e25\u0e1a Item',
    '\u0e25\u0e1a "' + it.name + '" \u0e2d\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e04\u0e25\u0e31\u0e07\u0e2b\u0e23\u0e37\u0e2d\u0e44\u0e21\u0e48?' + (it.jobId ? ' (\u0e08\u0e30\u0e16\u0e39\u0e01\u0e16\u0e2d\u0e14\u0e2d\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e07\u0e32\u0e19\u0e14\u0e49\u0e27\u0e22)' : ''),
    '\ud83d\uddd1 \u0e25\u0e1a',
    function() { removeItem(id); }
  );
}

function removeItem(id) {
  var it = items.find(function(x) { return x.id === id; });
  if (!it) return;
  if (it.jobId !== null) {
    var job = missions.find(function(j) { return j.id === it.jobId; });
    if (job) job.items = (job.items || []).filter(function(iId) { return iId !== id; });
  }
  items = items.filter(function(x) { return x.id !== id; });
  markDirty(); renderAll();
  showToast('\ud83d\uddd1 \u0e25\u0e1a Item \u0e41\u0e25\u0e49\u0e27');
}


/* ════ ITEM ASSIGNMENT ══════════════════════════════════ */
function assignItemToMission(jobId) {
  var sel = document.getElementById('item-sel-' + jobId);
  if (!sel) return;
  var itemId = parseInt(sel.value);
  if (!itemId) { showToast('\u26a0 \u0e40\u0e25\u0e37\u0e2d\u0e01 Item \u0e01\u0e48\u0e2d\u0e19'); return; }
  var job = missions.find(function(j) { return j.id === jobId; });
  var it  = items.find(function(x) { return x.id === itemId; });
  if (!job || !it) return;
  if (!job.items) job.items = [];
  if (job.items.includes(itemId)) { showToast('\u26a0 Item \u0e19\u0e35\u0e49\u0e2d\u0e22\u0e39\u0e48\u0e43\u0e19\u0e07\u0e32\u0e19\u0e19\u0e35\u0e49\u0e41\u0e25\u0e49\u0e27'); return; }
  job.items.push(itemId);
  it.status  = 'in-use';
  it.jobId   = jobId;
  it.jobName = job.name;
  markDirty(); renderAll();
  showToast('\u2714 \u0e21\u0e2d\u0e1a\u0e2b\u0e21\u0e32\u0e22 ' + it.name + ' \u2192 ' + job.name);
}

function removeItemFromMission(jobId, itemId) {
  var job = missions.find(function(j) { return j.id === jobId; });
  var it  = items.find(function(x) { return x.id === itemId; });
  if (!job || !it) return;
  job.items = (job.items || []).filter(function(iId) { return iId !== itemId; });
  it.status  = 'available';
  it.jobId   = null;
  it.jobName = null;
  markDirty(); renderAll();
  showToast('\u21a9 ' + it.name + ' \u0e16\u0e39\u0e01\u0e16\u0e2d\u0e14\u0e2d\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e07\u0e32\u0e19\u0e41\u0e25\u0e49\u0e27');
}


/* ════ ATTENDANCE — TABLE RENDER ════════════════════ */
function renderAttendanceTable() {
  const wrap = document.getElementById('attendance-table-wrap');
  if (!wrap) return;
  const countEl = document.getElementById('attendance-day-count');
  if (countEl) countEl.textContent = attendanceDays.length + ' \u0e27\u0e31\u0e19';

  if (!attendanceDays.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\ud83d\udcc5</div><div class="empty-state-text">\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e04\u0e2d\u0e25\u0e31\u0e21\u0e19\u0e4c\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48<br>\u0e01\u0e14\u0e1b\u0e38\u0e48\u0e21 "+ \u0e40\u0e1e\u0e34\u0e48\u0e21\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48" \u0e14\u0e49\u0e32\u0e19\u0e1a\u0e19\u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e40\u0e23\u0e34\u0e48\u0e21\u0e40\u0e0a\u0e47\u0e04\u0e0a\u0e37\u0e48\u0e2d</div></div>';
    return;
  }
  if (!employees.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\ud83d\udc65</div><div class="empty-state-text">\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e43\u0e19\u0e04\u0e25\u0e31\u0e07<br>\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e43\u0e19\u0e2a\u0e48\u0e27\u0e19\u0e04\u0e25\u0e31\u0e07\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e14\u0e49\u0e32\u0e19\u0e1a\u0e19\u0e01\u0e48\u0e2d\u0e19</div></div>';
    return;
  }

  const sortedDays = attendanceDays.slice().sort(function(a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });

  let thead = '<tr><th class="emp-col-head">\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19</th>';
  sortedDays.forEach(function(d) {
    thead += '<th><div class="attendance-day-head"><span class="attendance-day-date">' + formatThaiDate(d.date) + '</span>'
      + '<button class="attendance-day-del" onclick="askDeleteDay(' + d.id + ')" title="\u0e25\u0e1a\u0e04\u0e2d\u0e25\u0e31\u0e21\u0e19\u0e4c\u0e19\u0e35\u0e49">\u2715</button></div></th>';
  });
  thead += '</tr>';

  let tbody = '';
  employees.forEach(function(emp) {
    tbody += '<tr><th class="emp-row-head">' + h(emp.name) + '</th>';
    sortedDays.forEach(function(d) {
      const rec = (emp.attendance || {})[d.id];
      let cellClass = 'empty', cellContent = '\u2014';
      if (rec) {
        if (rec.status === 'present') { cellClass = 'present'; cellContent = '\u2705'; }
        else { cellClass = 'absent'; cellContent = '\u274c'; }
      }
      tbody += '<td class="attendance-cell ' + cellClass + '" onclick="openAttendanceDetail(' + emp.id + ',' + d.id + ')">' + cellContent + '</td>';
    });
    tbody += '</tr>';
  });

  wrap.innerHTML = '<table class="attendance-table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>';
}


/* ════ SWIPE MACHINE ═══════════════════════════════════ */
function renderSwipeSelects() {
  const daySel = document.getElementById('swipe-day-select');
  const empSel = document.getElementById('swipe-emp-select');
  if (!daySel || !empSel) return;

  if (swipeSelectedDayId !== null && !attendanceDays.some(function(d) { return d.id === swipeSelectedDayId; })) {
    swipeSelectedDayId = null;
  }
  if (swipeSelectedEmpId !== null && !employees.some(function(e) { return e.id === swipeSelectedEmpId; })) {
    swipeSelectedEmpId = null;
  }

  const sortedDays = attendanceDays.slice().sort(function(a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  daySel.innerHTML = '<option value="">-- \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48 --</option>' + sortedDays.map(function(d) {
    const sel = (d.id === swipeSelectedDayId) ? ' selected' : '';
    return '<option value="' + d.id + '"' + sel + '>' + formatThaiDate(d.date) + '</option>';
  }).join('');

  empSel.innerHTML = '<option value="">-- \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19 --</option>' + employees.map(function(e) {
    const sel = (e.id === swipeSelectedEmpId) ? ' selected' : '';
    return '<option value="' + e.id + '"' + sel + '>' + h(e.name) + '</option>';
  }).join('');

  updateSwipeDisplay();
}

function onSwipeDayChange() {
  const v = document.getElementById('swipe-day-select').value;
  swipeSelectedDayId = v ? parseInt(v) : null;
  updateSwipeDisplay();
}
function onSwipeEmpChange() {
  const v = document.getElementById('swipe-emp-select').value;
  swipeSelectedEmpId = v ? parseInt(v) : null;
  updateSwipeDisplay();
}

function updateSwipeDisplay() {
  const dateDisplay = document.getElementById('swipe-date-display');
  if (dateDisplay) {
    if (swipeSelectedDayId !== null) {
      const day = attendanceDays.find(function(d) { return d.id === swipeSelectedDayId; });
      dateDisplay.textContent = day ? formatThaiDate(day.date) : '-- \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48 --';
    } else {
      dateDisplay.textContent = '-- \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48 --';
    }
  }
  const avatarEl = document.getElementById('swipe-card-avatar');
  const nameEl   = document.getElementById('swipe-card-name');
  if (avatarEl && nameEl) {
    if (swipeSelectedEmpId !== null) {
      const emp = employees.find(function(e) { return e.id === swipeSelectedEmpId; });
      if (emp) {
        avatarEl.innerHTML = emp.img ? '<img src="' + emp.img + '">' : '\ud83d\udc64';
        nameEl.textContent = emp.name;
      }
    } else {
      avatarEl.innerHTML = '\ud83d\udc64';
      nameEl.textContent = '\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19';
    }
  }
}

function startSwipeClock() {
  updateSwipeClock();
  if (swipeClockTimer) clearInterval(swipeClockTimer);
  swipeClockTimer = setInterval(updateSwipeClock, 1000);
}
function updateSwipeClock() {
  const el = document.getElementById('swipe-time-display');
  if (!el) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  el.textContent = hh + ':' + mm + ':' + ss;
}

function performSwipe() {
  if (swipeSelectedDayId === null) { showToast('\u26a0 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48\u0e01\u0e48\u0e2d\u0e19'); return; }
  if (swipeSelectedEmpId === null) { showToast('\u26a0 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e1e\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e01\u0e48\u0e2d\u0e19'); return; }

  const emp = employees.find(function(e) { return e.id === swipeSelectedEmpId; });
  const day = attendanceDays.find(function(d) { return d.id === swipeSelectedDayId; });
  if (!emp || !day) return;

  const cardEl  = document.getElementById('swipe-card');
  const lightEl = document.getElementById('swipe-light');
  if (cardEl) {
    cardEl.classList.remove('swiping');
    void cardEl.offsetWidth;
    cardEl.classList.add('swiping');
  }

  setTimeout(function() {
    if (!emp.attendance) emp.attendance = {};
    const existing = emp.attendance[day.id];
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    emp.attendance[day.id] = {
      status: 'present',
      time: hh + ':' + mm,
      job: emp.jobName || null,
      note: existing ? (existing.note || '') : ''
    };
    if (cardEl) cardEl.classList.remove('swiping');
    if (lightEl) {
      lightEl.classList.add('ok');
      setTimeout(function() { lightEl.classList.remove('ok'); }, 900);
    }
    markDirty();
    renderAttendanceTable();
    showToast('\u2705 \u0e23\u0e39\u0e14\u0e1a\u0e31\u0e15\u0e23 ' + emp.name + ' \u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08 (' + hh + ':' + mm + ')');
  }, 600);
}


/* ════ ATTENDANCE — DETAIL MODAL ═══════════════════════ */
function openAttendanceDetail(empId, dayId) {
  const emp = employees.find(function(e) { return e.id === empId; });
  const day = attendanceDays.find(function(d) { return d.id === dayId; });
  if (!emp || !day) return;

  document.getElementById('att-detail-emp-id').value = empId;
  document.getElementById('att-detail-day-id').value = dayId;
  document.getElementById('att-detail-subtitle').textContent = emp.name + '  \u2022  ' + formatThaiDate(day.date);

  const rec = (emp.attendance || {})[dayId];
  const radios = document.getElementsByName('att-status-radio');

  if (rec) {
    for (let i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === rec.status);
    document.getElementById('att-detail-time').value = rec.time || '';
    document.getElementById('att-detail-job').value  = rec.job  || '';
    document.getElementById('att-detail-note').value = rec.note || '';
  } else {
    for (let i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === 'absent');
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('att-detail-time').value = hh + ':' + mm;
    document.getElementById('att-detail-job').value  = emp.jobName || '';
    document.getElementById('att-detail-note').value = '';
  }

  onAttStatusChange();
  openModal('attendance-detail-modal');
}

function onAttStatusChange() {
  const radios = document.getElementsByName('att-status-radio');
  let status = 'absent';
  for (let i = 0; i < radios.length; i++) { if (radios[i].checked) status = radios[i].value; }
  const fieldsEl = document.getElementById('att-present-fields');
  if (fieldsEl) fieldsEl.style.display = (status === 'present') ? '' : 'none';
}

function saveAttendanceDetail() {
  const empId = parseInt(document.getElementById('att-detail-emp-id').value);
  const dayId = parseInt(document.getElementById('att-detail-day-id').value);
  const emp = employees.find(function(e) { return e.id === empId; });
  if (!emp) return;

  const radios = document.getElementsByName('att-status-radio');
  let status = 'absent';
  for (let i = 0; i < radios.length; i++) { if (radios[i].checked) status = radios[i].value; }

  const time = document.getElementById('att-detail-time').value.trim();
  const job  = document.getElementById('att-detail-job').value.trim();
  const note = document.getElementById('att-detail-note').value.trim();

  if (!emp.attendance) emp.attendance = {};
  emp.attendance[dayId] = {
    status: status,
    time: status === 'present' ? time : '',
    job:  status === 'present' ? job  : '',
    note: note
  };

  closeModal('attendance-detail-modal');
  markDirty();
  renderAttendanceTable();
  showToast('\u2714 \u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e01\u0e32\u0e23\u0e40\u0e0a\u0e47\u0e04\u0e0a\u0e37\u0e48\u0e2d\u0e41\u0e25\u0e49\u0e27');
}


/* ════ UTILITIES ═══════════════════════════════════════ */
function h(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
