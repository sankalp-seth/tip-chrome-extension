// ===== State =====
let parsedData = null;
let createdIds = {};
let inputMode = 'csv'; // 'csv' | 'manual'
let manualPlayers1 = [];
let manualPlayers2 = [];

// ===== DOM Refs =====
const uploadSection     = document.getElementById('upload-section');
const previewSection    = document.getElementById('preview-section');
const actionSection     = document.getElementById('action-section');
const progressSection   = document.getElementById('progress-section');
const exportSection     = document.getElementById('export-section');
const excelInput        = document.getElementById('excel-input');
const previewStats      = document.getElementById('preview-stats');
const previewWrap       = document.getElementById('preview-table-wrap');
const progressBar       = document.getElementById('progress-bar');
const progressPct       = document.getElementById('progress-percent');
const logBox            = document.getElementById('log-box');
const idsOutput         = document.getElementById('ids-output');
const btnRun            = document.getElementById('btn-run');
const btnExportIds      = document.getElementById('btn-export-ids');
const btnCopyIds        = document.getElementById('btn-copy-ids');
const btnDownloadIds    = document.getElementById('btn-download-ids');
const btnChangeFile     = document.getElementById('change-file');
const uploadLabel       = document.querySelector('.upload-label');
// ===== Upload =====
// Note: no click listener needed — the input is inside the label so the browser handles it natively.
// Adding excelInput.click() here would open two file dialogs and cause the first selection to be lost.
uploadLabel.addEventListener('dragover', e => { e.preventDefault(); uploadLabel.style.borderColor = '#4f6ef7'; });
uploadLabel.addEventListener('dragleave', () => uploadLabel.style.borderColor = '');
uploadLabel.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
excelInput.addEventListener('change', () => {
  if (excelInput.files[0]) handleFile(excelInput.files[0]);
  excelInput.value = ''; // reset so the same file can be re-selected next time
});
btnChangeFile.addEventListener('click', () => {
  parsedData = null;
  excelInput.value = null;
  hideMatchCounter();
  show(uploadSection); hide(previewSection); hide(actionSection); hide(progressSection);
  // Restore correct input mode view
  if (inputMode === 'manual') {
    hide(document.getElementById('csv-content'));
    show(document.getElementById('manual-content'));
  }
});

// ===== Mode Tabs =====
document.getElementById('tab-csv').addEventListener('click', () => {
  inputMode = 'csv';
  document.getElementById('tab-csv').classList.add('active');
  document.getElementById('tab-manual').classList.remove('active');
  show(document.getElementById('csv-content'));
  hide(document.getElementById('manual-content'));
});
document.getElementById('tab-manual').addEventListener('click', () => {
  inputMode = 'manual';
  document.getElementById('tab-manual').classList.add('active');
  document.getElementById('tab-csv').classList.remove('active');
  hide(document.getElementById('csv-content'));
  show(document.getElementById('manual-content'));
});

// ===== Manual Form Logic =====

// Checkbox → toggle placeholder between "New X name" / "Existing X name"
const cbPlaceholders = {
  'cb-tournament': ['inp-tournament', 'New tournament name',      'Existing tournament name'],
  'cb-stage':      ['inp-stage',      'New stage name',           'Existing stage name'],
  'cb-substage':   ['inp-substage',   'New substage name',        'Existing substage name'],
};
Object.entries(cbPlaceholders).forEach(([cbId, [inputId, newPh, existPh]]) => {
  const cb = document.getElementById(cbId);
  const inp = document.getElementById(inputId);
  cb.addEventListener('change', () => {
    inp.placeholder = cb.checked ? newPh : existPh;
    inp.classList.toggle('existing', !cb.checked);
  });
});

// Teams checkbox → toggle abbr visibility + placeholder
document.getElementById('cb-teams').addEventListener('change', () => {
  const checked = document.getElementById('cb-teams').checked;
  ['inp-team1-name','inp-team2-name'].forEach((id, i) => {
    document.getElementById(id).placeholder = checked ? `Team ${i+1} name` : `Existing team ${i+1} name`;
  });
  document.getElementById('inp-team1-abbr').style.display = checked ? '' : 'none';
  document.getElementById('inp-team2-abbr').style.display = checked ? '' : 'none';
});

// Players checkbox → show/hide player section
document.getElementById('cb-players').addEventListener('change', () => {
  document.getElementById('players-section').style.display =
    document.getElementById('cb-players').checked ? '' : 'none';
});

// Match checkbox → show/hide match fields
document.getElementById('cb-match').addEventListener('change', () => {
  document.getElementById('match-fields').style.display =
    document.getElementById('cb-match').checked ? '' : 'none';
});

// Substage checkbox → show/hide format
document.getElementById('cb-substage').addEventListener('change', () => {
  const on = document.getElementById('cb-substage').checked;
  document.getElementById('substage-format-wrap').style.display = on ? '' : 'none';
  if (!on) document.getElementById('ffa-fields').classList.add('hidden');
});

// Format select → show/hide FFA fields
document.getElementById('inp-format').addEventListener('change', function() {
  document.getElementById('ffa-fields').classList.toggle('hidden', this.value !== 'FFA');
});

// Auto-fill abbreviation from team name
['1','2'].forEach(n => {
  document.getElementById(`inp-team${n}-name`).addEventListener('input', function() {
    const abbr = document.getElementById(`inp-team${n}-abbr`);
    if (!abbr._userEdited) {
      abbr.value = this.value.slice(0,3).toUpperCase();
    }
  });
  const abbrEl = document.getElementById(`inp-team${n}-abbr`);
  abbrEl._userEdited = false;
  abbrEl.addEventListener('input', () => { abbrEl._userEdited = true; });
});

// Each field is fully independent — no auto-mirroring

// Player rows
function renderPlayers(teamNum) {
  const arr = teamNum === 1 ? manualPlayers1 : manualPlayers2;
  const container = document.getElementById(`team${teamNum}-players`);
  container.innerHTML = arr.map((p, i) => `
    <div class="player-row" data-team="${teamNum}" data-idx="${i}">
      <div class="player-row-top">
        <input type="checkbox" class="p-cb" ${!p.existing ? 'checked' : ''} />
        <input class="p-name" placeholder="${p.existing ? 'Existing player name' : 'New player name'}" value="${p.name}" />
        <button class="p-remove">×</button>
      </div>
      <input class="p-dob" placeholder="1995-01-01" value="${p.dob}" maxlength="10" style="${p.existing ? 'display:none' : ''}" />
    </div>`).join('');

  container.querySelectorAll('.player-row').forEach(row => {
    const idx = parseInt(row.dataset.idx);
    const arr2 = () => teamNum === 1 ? manualPlayers1 : manualPlayers2;
    const cb   = row.querySelector('.p-cb');
    const nameInp = row.querySelector('.p-name');
    const dobInp  = row.querySelector('.p-dob');
    cb.addEventListener('change', () => {
      arr2()[idx].existing = !cb.checked;
      nameInp.placeholder = cb.checked ? 'New player name' : 'Existing player name';
      dobInp.style.display = cb.checked ? '' : 'none';
    });
    nameInp.addEventListener('input', e => { arr2()[idx].name = e.target.value; });
    dobInp.addEventListener('input',  e => { arr2()[idx].dob  = e.target.value; });
    row.querySelector('.p-remove').addEventListener('click', () => {
      arr2().splice(idx, 1);
      renderPlayers(teamNum);
    });
  });
}
document.querySelectorAll('.btn-add-player').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = parseInt(btn.dataset.team);
    (t === 1 ? manualPlayers1 : manualPlayers2).push({ name: '', dob: '', existing: false });
    renderPlayers(t);
  });
});

// Build config from manual form
function buildManualConfig() {
  const v = id => document.getElementById(id)?.value.trim() || '';
  const cb = id => document.getElementById(id)?.checked;

  const substageName = v('inp-substage');
  const seriesName = v('inp-series-name') || substageName;

  return {
    create: {
      tournament:    cb('cb-tournament'),
      stage:         cb('cb-stage'),
      substage:      cb('cb-substage'),
      teams:         cb('cb-teams'),
      players:       cb('cb-players'),
      defineGroups:  cb('cb-definegroups'),
      match:         cb('cb-match'),
    },
    tournament: { name: v('inp-tournament') },
    stage:      { name: v('inp-stage') },
    substage:   {
      name: substageName,
      format: v('inp-format') || 'ONE_V_ONE',
      ffaOptions: v('inp-format') === 'FFA' ? {
        ffaFormat:       v('inp-ffa-format') || 'Simple Group',
        teams:           parseInt(v('inp-ffa-teams'))   || 2,
        playersPerTeam:  parseInt(v('inp-ffa-ppt'))     || 1,
        matchesPerSeries:parseInt(v('inp-ffa-mps'))     || 1,
        qualifiers:      parseInt(v('inp-ffa-qual'))    || 1,
      } : {}
    },
    teams: [
      { name: v('inp-team1-name'), abbreviation: v('inp-team1-abbr') || v('inp-team1-name').slice(0,3).toUpperCase(), players: manualPlayers1.map(p => ({ name: p.name, dob: formatDob(p.dob), existing: !!p.existing })) },
      { name: v('inp-team2-name'), abbreviation: v('inp-team2-abbr') || v('inp-team2-name').slice(0,3).toUpperCase(), players: manualPlayers2.map(p => ({ name: p.name, dob: formatDob(p.dob), existing: !!p.existing })) },
    ],
    series: { name: seriesName, matchCount: parseInt(v('inp-match-count')) || 1 }
  };
}

function calcManualSteps(config) {
  let s = 1; // login
  if (config.create.tournament) s++;
  if (config.create.stage) s++;
  if (config.create.substage) s++;
  if (config.create.teams) s += 2;
  if (config.create.players) s += config.teams[0].players.length + config.teams[1].players.length;
  if (config.create.defineGroups) s++;
  if (config.create.match) s++;
  return Math.max(s, 1);
}

document.getElementById('btn-run-manual').addEventListener('click', async () => {
  const config = buildManualConfig();

  // Basic validation
  if (!config.tournament.name) { alert('Tournament name is required.'); return; }
  if ((config.create.match || config.create.defineGroups) && (!config.teams[0].name || !config.teams[1].name)) {
    alert('Both team names are required for Define Groups or Match.'); return;
  }

  let tab = await findTipTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url: getSelectedOrigin() });
    await waitForTabLoad(tab.id);
  }

  hide(uploadSection);
  show(progressSection);

  // Setup progress
  stepCount = 0;
  totalSteps = calcManualSteps(config);
  progressBar.style.width = '0%';
  progressBar.style.background = '#4f6ef7';
  progressPct.textContent = '0%';
  logBox.innerHTML = '';
  createdIds = {};
  activeTabId = tab.id;
  isPaused = false;
  lastMatchOnly = false;
  btnPause.disabled = false;
  btnStop.disabled = false;
  btnCancel.disabled = false;
  btnRestart.disabled = false;

  attachMessageHandler();

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_shim.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'], world: 'MAIN' });
    await sleep(500);
  } catch (e) { addLog('Script inject error: ' + e.message, 'error'); }

  chrome.tabs.sendMessage(tab.id, { type: 'START_MANUAL', config, creds: getSelectedCreds() }, response => {
    if (chrome.runtime.lastError) addLog('❌ Could not reach TIP tab: ' + chrome.runtime.lastError.message, 'error');
  });
});

// ===== File Parsing =====
function handleFile(file) {
  const isCSV = file.name.toLowerCase().endsWith('.csv');
  if (isCSV) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const rows = parseCSV(e.target.result);
        parsedData = parseRows(rows);
        showPreview(rows, parsedData);
      } catch (err) { alert('Failed to parse CSV: ' + err.message); }
    };
    reader.readAsText(file);
  } else {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        parsedData = parseRows(rows);
        showPreview(rows, parsedData);
      } catch (err) { alert('Failed to parse Excel: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
  }
}

function parseCSV(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || '');
    return obj;
  });
}

function parseRows(rows) {
  const norm = key => key.toLowerCase().trim().replace(/\s+/g, '_');
  const normRows = rows.map(r => {
    const obj = {};
    for (const k of Object.keys(r)) obj[norm(k)] = String(r[k]).trim();
    return obj;
  });

  // Group by game → tournament → stage → substage → team → players
  const games = {};
  for (const row of normRows) {
    const game      = (row.game || 'CRICKET').toUpperCase();
    const tName     = row.tournament || '';
    const sName     = row.stage || '';
    const ssName    = row.substage || '';
    const format    = row.format || 'ONE_V_ONE';
    const teamName  = row.team || '';
    const abbr      = row.abbreviation || teamName.slice(0, 3).toUpperCase();
    const player    = row.player || '';
    const dob       = formatDob(row.dob || '');
    const seriesName = row.series_name || ssName;
    const matchCount = parseInt(row.match_count) || 1;

    if (!tName) continue;
    if (!games[game]) games[game] = { name: game, tournaments: {} };

    const g = games[game];
    if (!g.tournaments[tName]) g.tournaments[tName] = { name: tName, stages: {} };
    const t = g.tournaments[tName];

    if (sName && !t.stages[sName]) t.stages[sName] = { name: sName, substages: {} };
    if (sName && ssName && !t.stages[sName].substages[ssName]) {
      t.stages[sName].substages[ssName] = { name: ssName, format, teams: {}, seriesName, matchCount };
    }

    if (teamName && sName && ssName) {
      const ss = t.stages[sName].substages[ssName];
      if (!ss.teams[teamName]) ss.teams[teamName] = { name: teamName, abbreviation: abbr, players: [] };
      if (player) ss.teams[teamName].players.push({ name: player, dob });
    }
  }

  // Convert to arrays
  return Object.values(games).map(g => ({
    ...g,
    tournaments: Object.values(g.tournaments).map(t => ({
      ...t,
      stages: Object.values(t.stages).map(s => ({
        ...s,
        substages: Object.values(s.substages).map(ss => ({
          ...ss,
          teams: Object.values(ss.teams)
        }))
      }))
    }))
  }));
}

function formatDob(dob) {
  if (!dob || dob === 'Invalid Date') return '1995-01-01';
  if (!isNaN(dob) && typeof XLSX !== 'undefined') {
    try {
      const date = XLSX.SSF.parse_date_code(parseInt(dob));
      if (date) return `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
    } catch (_) {}
  }
  const d = new Date(dob);
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  return '1995-01-01';
}

function showPreview(rows, data) {
  let teams = new Set(), players = new Set(), games = new Set();
  for (const g of data) {
    games.add(g.name);
    for (const t of g.tournaments) for (const s of t.stages) for (const ss of s.substages) {
      for (const tm of ss.teams) {
        teams.add(tm.name);
        tm.players.forEach(p => players.add(p.name));
      }
    }
  }
  previewStats.innerHTML =
    `<b>Games:</b> ${[...games].join(', ')} &nbsp;·&nbsp; ` +
    `<b>Teams:</b> ${teams.size} &nbsp;·&nbsp; ` +
    `<b>Players:</b> ${players.size}`;

  const cols = Object.keys(rows[0] || {});
  const sample = rows.slice(0, 6);
  let html = '<table><thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of sample) html += '<tr>' + cols.map(c => `<td>${r[c] ?? ''}</td>`).join('') + '</tr>';
  html += '</tbody></table>';
  previewWrap.innerHTML = html;

  hide(uploadSection);
  show(previewSection);
  show(actionSection);
  btnRestart.disabled = false; // restart always available once data is loaded
}

// ===== TIP Environment =====
const envSelect = document.getElementById('env-select');

const ENV_CREDS = {
  'https://tip-control-dev.spectatr.ai/':        { username: 'sankalp', password: 'sankalp' },
  'https://tip-control.production.spectatr.ai/': { username: 'Sankalp', password: 'Sankalp' }
};

function getSelectedOrigin() {
  return envSelect.value;
}
function getSelectedPattern() {
  return getSelectedOrigin() + '*';
}
function getSelectedCreds() {
  return ENV_CREDS[getSelectedOrigin()] || { username: 'sankalp', password: 'sankalp' };
}

async function findTipTab() {
  const [tab] = await chrome.tabs.query({ url: getSelectedPattern() });
  return tab || null;
}

// ===== Pause / Stop =====
let activeTabId = null;
let isPaused = false;
let lastMatchOnly = false; // tracks which mode was last started
const btnPause   = document.getElementById('btn-pause');
const btnStop    = document.getElementById('btn-stop');
const btnRestart = document.getElementById('btn-restart');
const btnCancel  = document.getElementById('btn-cancel');
const matchPrompt      = document.getElementById('match-prompt');
const matchPromptCount = document.getElementById('match-prompt-count');
const btnPromptStart   = document.getElementById('btn-prompt-start');
const btnPromptSkip    = document.getElementById('btn-prompt-skip');

async function getTipTabId() {
  if (activeTabId) return activeTabId;
  // Popup may have been closed/reopened — find the TIP tab dynamically
  const tab = await findTipTab();
  if (tab) { activeTabId = tab.id; }
  return activeTabId;
}

btnPause.addEventListener('click', async () => {
  const tabId = await getTipTabId();
  // Update UI immediately regardless of tab state
  isPaused = !isPaused;
  if (isPaused) {
    btnPause.textContent = '▶ Resume';
    btnPause.classList.add('paused');
    addLog('⏸ Paused — click Resume to continue', 'info');
    if (tabId) chrome.tabs.sendMessage(tabId, { type: 'PAUSE_AUTOMATION' });
  } else {
    btnPause.textContent = '⏸ Pause';
    btnPause.classList.remove('paused');
    addLog('▶ Resumed', 'info');
    if (tabId) chrome.tabs.sendMessage(tabId, { type: 'RESUME_AUTOMATION' });
  }
});

btnStop.addEventListener('click', async () => {
  _matchStopped = true; // also stops the repeat loop
  const tabId = await getTipTabId();
  if (tabId) chrome.tabs.sendMessage(tabId, { type: 'STOP_AUTOMATION' });
  addLog('⏹ Stopping automation...', 'error');
});

function resetControls() {
  activeTabId = null;
  isPaused = false;
  btnPause.textContent = '⏸ Pause';
  btnPause.classList.remove('paused');
  btnPause.disabled = false;
  btnStop.disabled = false;
  btnCancel.disabled = false;
  btnRestart.disabled = false;
}

btnCancel.addEventListener('click', async () => {
  _matchStopped = true;
  const tabId = await getTipTabId();
  if (tabId) chrome.tabs.sendMessage(tabId, { type: 'STOP_AUTOMATION' });
  if (_msgHandler) { chrome.runtime.onMessage.removeListener(_msgHandler); _msgHandler = null; }
  resetControls();
  hideMatchCounter();
  hide(progressSection);
  hide(exportSection);
  if (inputMode === 'manual') {
    show(uploadSection);
    hide(document.getElementById('csv-content'));
    show(document.getElementById('manual-content'));
  } else {
    show(previewSection);
    show(actionSection);
  }
});

async function startAutomation(tabId, matchOnly = false, msgType = null) {
  activeTabId = tabId;
  isPaused = false;
  lastMatchOnly = matchOnly;
  btnPause.disabled = false;
  btnPause.textContent = '⏸ Pause';
  btnPause.classList.remove('paused');
  btnStop.disabled = false;
  btnCancel.disabled = false;
  btnRestart.disabled = false;

  logBox.innerHTML = '';
  createdIds = {};
  stepCount = 0;
  totalSteps = parsedData ? calcTotalSteps(parsedData, matchOnly) : 1;
  progressBar.style.width = '0%';
  progressBar.style.background = '#4f6ef7';
  progressPct.textContent = '0%';

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content_shim.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'], world: 'MAIN' });
    await sleep(500);
  } catch (e) {
    addLog('Script inject error: ' + e.message, 'error');
  }

  if (!msgType) msgType = matchOnly ? 'START_MATCH_ONLY' : 'START_AUTOMATION';
  chrome.tabs.sendMessage(tabId, { type: msgType, data: parsedData, creds: getSelectedCreds() }, (response) => {
    if (chrome.runtime.lastError) {
      addLog('❌ Could not reach TIP tab: ' + chrome.runtime.lastError.message, 'error');
    }
  });
}

btnRestart.addEventListener('click', async () => {
  if (!parsedData) { alert('No data loaded.'); return; }

  // Stop any known running automation
  if (activeTabId) {
    try { chrome.tabs.sendMessage(activeTabId, { type: 'STOP_AUTOMATION' }); } catch (_) {}
    await sleep(500);
  }

  // Also try stopping via any open TIP tab (covers cases where activeTabId was lost)
  try {
    const tabs = await chrome.tabs.query({ url: getSelectedPattern() });
    for (const t of tabs) {
      try { chrome.tabs.sendMessage(t.id, { type: 'STOP_AUTOMATION' }); } catch (_) {}
    }
  } catch (_) {}
  await sleep(500);

  // Detach any stale message handler
  if (_msgHandler) { chrome.runtime.onMessage.removeListener(_msgHandler); _msgHandler = null; }

  // Get or open the TIP tab
  let tab = await findTipTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url: getSelectedOrigin() });
    await waitForTabLoad(tab.id);
  }

  hide(exportSection);
  show(progressSection);
  attachMessageHandler();
  addLog(`↺ Restarting${lastMatchOnly ? ' (Match Only)' : ''}...`, 'info');
  await startAutomation(tab.id, lastMatchOnly);
});

btnPromptSkip.addEventListener('click', () => {
  matchPrompt.classList.add('hidden');
});

btnPromptStart.addEventListener('click', async () => {
  const count = Math.max(1, parseInt(matchPromptCount.value) || 1);
  matchPrompt.classList.add('hidden');

  if (!parsedData) return;
  if (_msgHandler) { chrome.runtime.onMessage.removeListener(_msgHandler); _msgHandler = null; }

  let tab = await findTipTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url: getSelectedOrigin() });
    await waitForTabLoad(tab.id);
  }

  _matchStopped = false;
  hide(exportSection);
  show(progressSection);
  showMatchCounter(count);

  for (let i = 1; i <= count; i++) {
    if (_matchStopped) break;
    if (count > 1) addLog(`━━ Match ${i} / ${count} ━━`, 'info');

    stepCount = 0;
    totalSteps = calcTotalSteps(parsedData, true);
    progressBar.style.width = '0%';
    progressBar.style.background = '#4f6ef7';
    progressPct.textContent = '0%';

    const label = count > 1 ? `Match ${i}/${count}` : 'Match';
    const result = await runOneMatch(tab.id, label);

    if (result === 'stopped') { _matchStopped = true; break; }
    if (result === 'error' && count > 1) { addLog(`⚠️ Match ${i} failed — stopping`, 'error'); break; }
    if (i < count) await sleep(1500);
  }

  if (count > 1 && !_matchStopped) addLog(`🏁 All ${count} matches done!`, 'success');
});

// ===== Message handler (shared by Run and Restart) =====
let _msgHandler = null;
function attachMessageHandler() {
  if (_msgHandler) chrome.runtime.onMessage.removeListener(_msgHandler);
  _msgHandler = (msg) => {
    if (msg.type === 'PROGRESS') { addLog(msg.text, msg.level || 'info'); }
    if (msg.type === 'STEP') { updateProgressBar(); }
    if (msg.type === 'IDS_UPDATE') Object.assign(createdIds, msg.ids);
    if (msg.type === 'DONE') {
      chrome.runtime.onMessage.removeListener(_msgHandler);
      resetControls();
      addLog('✅ All done!', 'success');
      progressBar.style.width = '100%';
      progressBar.style.background = '#22c55e';
      progressPct.textContent = '100%';
      btnExportIds.disabled = false;
      show(exportSection);
      idsOutput.value = JSON.stringify(createdIds, null, 2);
      // Show match prompt only after a full run (not match-only)
      if (!lastMatchOnly) {
        matchPromptCount.value = 1;
        matchPrompt.classList.remove('hidden');
      }
    }
    if (msg.type === 'ERROR') {
      chrome.runtime.onMessage.removeListener(_msgHandler);
      resetControls();
      addLog('❌ ' + msg.text, 'error');
    }
    if (msg.type === 'STOPPED') {
      chrome.runtime.onMessage.removeListener(_msgHandler);
      resetControls();
      addLog('⏹ Automation stopped.', 'error');
    }
  };
  chrome.runtime.onMessage.addListener(_msgHandler);
}

// ===== Run =====
btnRun.addEventListener('click', async () => {
  if (!parsedData) {
    alert('Please upload a data file first.');
    return;
  }

  let tab = await findTipTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url: getSelectedOrigin() });
    await waitForTabLoad(tab.id);
  }

  hide(actionSection);
  show(progressSection);
  attachMessageHandler();
  await startAutomation(tab.id);
});

// ===== Match Only =====
let _matchStopped = false;
const matchCounter    = document.getElementById('match-counter');
const matchCounterNum = document.getElementById('match-counter-num');
const matchCounterTotal = document.getElementById('match-counter-total');

function showMatchCounter(total) {
  matchCounterNum.textContent = '0';
  matchCounterTotal.textContent = total;
  matchCounter.classList.remove('hidden');
}
function incrementMatchCounter() {
  matchCounterNum.textContent = parseInt(matchCounterNum.textContent) + 1;
}
function hideMatchCounter() {
  matchCounter.classList.add('hidden');
}

// Runs one match-only iteration and returns a promise that resolves with 'done'|'error'|'stopped'
function runOneMatch(tabId, label) {
  return new Promise((resolve) => {
    if (_msgHandler) chrome.runtime.onMessage.removeListener(_msgHandler);

    _msgHandler = (msg) => {
      if (msg.type === 'PROGRESS') { addLog(msg.text, msg.level || 'info'); }
      if (msg.type === 'STEP') { updateProgressBar(); }
      if (msg.type === 'IDS_UPDATE') Object.assign(createdIds, msg.ids);
      if (msg.type === 'DONE') {
        chrome.runtime.onMessage.removeListener(_msgHandler);
        resetControls();
        incrementMatchCounter();
        progressBar.style.width = '100%';
        progressBar.style.background = '#22c55e';
        progressPct.textContent = '100%';
        addLog(`✅ ${label} done!`, 'success');
        resolve('done');
      }
      if (msg.type === 'ERROR') {
        chrome.runtime.onMessage.removeListener(_msgHandler);
        resetControls();
        addLog('❌ ' + msg.text, 'error');
        resolve('error');
      }
      if (msg.type === 'STOPPED') {
        chrome.runtime.onMessage.removeListener(_msgHandler);
        resetControls();
        addLog('⏹ Stopped.', 'error');
        resolve('stopped');
      }
    };
    chrome.runtime.onMessage.addListener(_msgHandler);
    startAutomation(tabId, true);
  });
}

document.getElementById('btn-match-only').addEventListener('click', async () => {
  if (!parsedData) { alert('Please upload a data file first.'); return; }

  const repeatCount = Math.max(1, parseInt(document.getElementById('repeat-count').value) || 1);
  _matchStopped = false;

  let tab = await findTipTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url: getSelectedOrigin() });
    await waitForTabLoad(tab.id);
  }

  hide(actionSection);
  show(progressSection);
  showMatchCounter(repeatCount);

  for (let i = 1; i <= repeatCount; i++) {
    if (repeatCount > 1) addLog(`━━ Match ${i} / ${repeatCount} ━━`, 'info');

    // Reset progress bar for each iteration
    stepCount = 0;
    totalSteps = calcTotalSteps(parsedData, true);
    progressBar.style.width = '0%';
    progressBar.style.background = '#4f6ef7';
    progressPct.textContent = '0%';

    const label = repeatCount > 1 ? `Match ${i}/${repeatCount}` : 'Match';
    const result = await runOneMatch(tab.id, label);

    if (result === 'stopped') { _matchStopped = true; break; }
    if (result === 'error' && repeatCount > 1) {
      addLog(`⚠️ Match ${i} failed — stopping loop`, 'error');
      break;
    }

    if (i < repeatCount) await sleep(1500); // brief pause between matches
  }

  if (repeatCount > 1 && !_matchStopped) {
    addLog(`🏁 All ${repeatCount} matches completed!`, 'success');
  }
});

document.getElementById('btn-teams-only').addEventListener('click', async () => {
  if (!parsedData) { alert('Please upload a data file first.'); return; }

  let tab = await findTipTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url: getSelectedOrigin() });
    await waitForTabLoad(tab.id);
  }

  hide(actionSection);
  show(progressSection);
  attachMessageHandler();
  await startAutomation(tab.id, false, 'START_TEAMS_ONLY');
});

let stepCount = 0;
let totalSteps = 1;

function calcTotalSteps(data, matchOnly = false) {
  let steps = 2; // login + game select
  for (const game of data) {
    for (const tournament of game.tournaments) {
      if (!matchOnly) steps++; // createTournament
      for (const stage of tournament.stages) {
        if (!matchOnly) steps++; // createStage
        for (const substage of stage.substages) {
          if (!matchOnly) {
            steps++; // createSubstage
            for (const team of substage.teams) {
              steps++; // createTeam
              steps += team.players.length; // createPlayer each
            }
            steps++; // defineGroups
          }
          steps++; // addSeriesItem
        }
      }
    }
  }
  return steps;
}

function updateProgressBar() {
  stepCount++;
  const pct = Math.min(95, Math.round((stepCount / totalSteps) * 100));
  progressBar.style.width = pct + '%';
  progressPct.textContent = pct + '%';
}

function addLog(text, level = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}

// ===== Export =====
btnExportIds.addEventListener('click', () => {
  show(exportSection);
  idsOutput.value = JSON.stringify(createdIds, null, 2);
});

btnCopyIds.addEventListener('click', () => {
  navigator.clipboard.writeText(idsOutput.value);
  btnCopyIds.textContent = '✓ Copied!';
  setTimeout(() => btnCopyIds.textContent = 'Copy JSON', 1500);
});

btnDownloadIds.addEventListener('click', () => {
  const rows = [['type', 'name', 'id']];
  for (const [type, entries] of Object.entries(createdIds)) {
    if (Array.isArray(entries)) for (const e of entries) rows.push([type, e.name, e.id]);
    else rows.push([type, entries.name || type, entries.id || entries]);
  }
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tip_ids.csv';
  a.click();
});

// ===== Repeat Count +/- =====
const repeatDisplay = document.getElementById('repeat-display');
const repeatInput   = document.getElementById('repeat-count');
document.getElementById('repeat-minus').addEventListener('click', () => {
  const v = Math.max(1, parseInt(repeatInput.value) - 1);
  repeatInput.value = v;
  repeatDisplay.textContent = v;
});
document.getElementById('repeat-plus').addEventListener('click', () => {
  const v = Math.min(100, parseInt(repeatInput.value) + 1);
  repeatInput.value = v;
  repeatDisplay.textContent = v;
});

// ===== Download Template =====
document.getElementById('btn-download-template').addEventListener('click', () => {
  const csv = [
    'game,tournament,stage,substage,format,team,abbreviation,player,dob,series_name,match_count',
    'CRICKET,spectatr league,spectatr league,spectatr league,ONE_V_ONE,striff,STR,naman,1995-01-01,striff vs vu,1',
    'CRICKET,spectatr league,spectatr league,spectatr league,ONE_V_ONE,striff,STR,nitish,1995-01-01,striff vs vu,1',
    'CRICKET,spectatr league,spectatr league,spectatr league,ONE_V_ONE,striff,STR,ujjwal,1995-01-01,striff vs vu,1',
    'CRICKET,spectatr league,spectatr league,spectatr league,ONE_V_ONE,vu,VU,arjun,1995-01-01,striff vs vu,1',
    'CRICKET,spectatr league,spectatr league,spectatr league,ONE_V_ONE,vu,VU,vikram,1995-01-01,striff vs vu,1',
    'CRICKET,spectatr league,spectatr league,spectatr league,ONE_V_ONE,vu,VU,rohit,1995-01-01,striff vs vu,1',
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'template.csv';
  a.click();
});

// ===== Utils =====
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    chrome.tabs.get(tabId, tab => {
      if (tab.status === 'complete') { resolve(); return; }
    });
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1000); // extra buffer after load
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}
