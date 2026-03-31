// ===== TIP Automator — Content Script =====
// Use var (not const) so re-injection doesn't throw SyntaxError
// Guard: only one instance of this script should register listeners per tab.
// Page navigations cause re-injection — skip registration if already loaded.
if (window.__TIP_LOADED__) {
  console.log('[TIP Automator] Already loaded — skipping re-registration');
} else {
window.__TIP_LOADED__ = true;

// Pause / Stop / Running flags — declared before sleep/waitFor so they can reference them
var _paused = false;
var _stopped = false;
var _running = false;

// Global error handler — stop automation on any uncaught error
window.addEventListener('error', (event) => {
  if (_running) {
    _stopped = true;
    _paused = false;
    _running = false;
    const msg = event.error?.message || event.message || 'Unknown error';
    console.error(`[TIP Automator] Uncaught error — automation stopped: ${msg}`);
    window.postMessage({ source: 'tip-main-to-shim', payload: { type: 'ERROR', text: `Uncaught error: ${msg}` } }, '*');
    window.postMessage({ source: 'tip-main-to-shim', payload: { type: 'STOPPED' } }, '*');
  }
});
window.addEventListener('unhandledrejection', (event) => {
  if (_running) {
    _stopped = true;
    _paused = false;
    _running = false;
    const msg = event.reason?.message || String(event.reason) || 'Unhandled promise rejection';
    console.error(`[TIP Automator] Unhandled rejection — automation stopped: ${msg}`);
    window.postMessage({ source: 'tip-main-to-shim', payload: { type: 'ERROR', text: `Unhandled rejection: ${msg}` } }, '*');
    window.postMessage({ source: 'tip-main-to-shim', payload: { type: 'STOPPED' } }, '*');
  }
});

// Pause-aware sleep — checks flags every 100ms so pause/stop take effect immediately
var sleep = async (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (_stopped) throw new Error('STOPPED');
    while (_paused) {
      await new Promise(r => setTimeout(r, 100));
      if (_stopped) throw new Error('STOPPED');
    }
    await new Promise(r => setTimeout(r, Math.min(100, end - Date.now())));
  }
};

// Call at key checkpoints — resolves when resumed, throws if stopped
async function checkPauseStop() {
  if (_stopped) throw new Error('STOPPED');
  while (_paused) {
    await new Promise(r => setTimeout(r, 100));
    if (_stopped) throw new Error('STOPPED');
  }
}

async function waitFor(fn, timeout = 12000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (_stopped) throw new Error('STOPPED');
    while (_paused) {
      await new Promise(r => setTimeout(r, 100));
      if (_stopped) throw new Error('STOPPED');
    }
    try { const r = fn(); if (r) return r; } catch (_) {}
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`waitFor timeout: ${fn.toString().slice(0, 80)}`);
}

function setReactInput(input, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function mainEl() {
  return document.querySelector('main') || document.body;
}

// Returns the open modal/dialog element, or null.
// TIP uses MuiModal-root for the Define Groups / Add Series dialogs (no role="dialog").
// Team/Player create modals also use MuiModal-root.
function activeDialog() {
  return document.querySelector('[role="dialog"]')
    || document.querySelector('.MuiModal-root:not([aria-hidden="true"])')
    || null;
}

// ===== Navigation =====

async function navigateTo(section) {
  log(`Navigating to ${section}...`);
  // Sidebar uses `button` on some pages and `menuitem` on others — check both
  const btn = await waitFor(() => {
    const candidates = [
      ...Array.from(document.querySelectorAll('button')),
      ...Array.from(document.querySelectorAll('[role="menuitem"]'))
    ];
    return candidates.find(b =>
      b.textContent.trim().toUpperCase().includes(section.toUpperCase()) &&
      !mainEl().contains(b)
    );
  });
  btn.click();
  await sleep(1200);
}

function findMainButton(...texts) {
  // Search ALL buttons on page except sidebar nav buttons
  const aside = document.querySelector('aside, [role="complementary"]');
  const header = document.querySelector('header, [role="banner"]');
  const btns = Array.from(document.querySelectorAll('button')).filter(b => {
    if (b.disabled) return false;
    if (aside && aside.contains(b)) return false;
    if (header && header.contains(b)) return false;
    return true;
  });
  for (const text of texts) {
    const found = btns.find(b => b.textContent.trim().toLowerCase().includes(text.toLowerCase()));
    if (found) return found;
  }
  return null;
}

async function clickMainButton(...texts) {
  const btn = await waitFor(() => findMainButton(...texts));
  btn.scrollIntoView({ block: 'center' });
  btn.click();
  await sleep(300);
}

// Close any open panel/dialog (leftover from failed/previous run)
async function closeAnyPanel() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(400);
}

// Open a form panel safely: close leftovers, then click button, then wait for heading
async function openForm(buttonTexts, expectedHeading) {
  // Check if the form panel/dialog is already open — but SKIP headings inside <main>
  // (page section headings like "Stages", "Tournaments" must not be confused with form headings)
  const main = document.querySelector('main');
  const alreadyOpen = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .find(el => {
      if (main && main.contains(el)) return false; // skip page-level headings
      return el.textContent.trim().includes(expectedHeading);
    });
  if (alreadyOpen) return;

  // Press Escape to close any leftover panel from previous run
  await closeAnyPanel();

  // Click the open button
  await clickMainButton(...buttonTexts);
  await waitForDialog(expectedHeading);
}

async function waitForHeading(text, timeout = 8000) {
  return waitFor(() =>
    Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .find(h => h.textContent.toLowerCase().includes(text.toLowerCase()))
  , timeout);
}

// Wait for a form panel/dialog to open.
// TIP uses: h3 headings for side panels (Add Stage/Tournament/Substage),
// and <div> headings inside role=dialog for modals (Add Team/Player).
async function waitForDialog(heading) {
  const main = document.querySelector('main');
  return waitFor(() => {
    // 1. active side panel with matching text (most specific — checked first)
    const active = document.querySelector('[active]');
    if (active && active.textContent.includes(heading)) return active;
    // 2. role=dialog OR MuiModal-root with matching text
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .MuiModal-root:not([aria-hidden="true"])'));
    for (const d of dialogs) {
      if (d.textContent.includes(heading)) return d;
    }
    // 3. h1-h6 headings OUTSIDE <main> only (skip page-level headings like "Stages", "Tournaments")
    const h = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .find(el => {
        if (main && main.contains(el)) return false;
        return el.textContent.trim().includes(heading);
      });
    if (h) return h;
    return null;
  });
}

async function waitForToast(timeout = 6000) {
  return waitFor(() =>
    document.querySelector(
      '[class*="toast"], [class*="Toast"], [class*="snack"], [class*="Snack"], ' +
      '[class*="alert"], [class*="Alert"], [class*="notification"], [class*="success"], ' +
      '[class*="message"], [class*="Message"]'
    )
  , timeout).catch(() => null);
}

// ===== ID Scraping =====

// Scrape ID by entity name — for Teams/Players whose ID is in a <strong> with no "ID:" prefix
function scrapeEntityIdByName(name) {
  for (const el of document.querySelectorAll('h2, h3, h4, h5, h6')) {
    if (el.textContent.trim().toLowerCase() === name.toLowerCase()) {
      const container = el.parentElement?.parentElement?.parentElement || el.closest('[class]');
      if (container) {
        for (const strong of container.querySelectorAll('strong')) {
          const t = strong.textContent.trim();
          if (/^[a-f0-9]{24}$/i.test(t)) return t;
        }
      }
    }
  }
  return null;
}

// Fallback: last "ID: <hex24>" on page (Tournaments)
function scrapeLastId() {
  const matches = [...document.body.innerHTML.matchAll(/ID:\s*([a-f0-9]{24})/gi)];
  if (matches.length) return matches[matches.length - 1][1];
  // Also try bare hex24 in <strong>
  const strongs = Array.from(document.querySelectorAll('strong'));
  for (let i = strongs.length - 1; i >= 0; i--) {
    const t = strongs[i].textContent.trim();
    if (/^[a-f0-9]{24}$/i.test(t)) return t;
  }
  return null;
}

// ===== Input Helpers =====

function _findInputIn(root, labelText) {
  // 1. Exact aria-label
  let el = root.querySelector(`input[aria-label="${labelText}"], textarea[aria-label="${labelText}"]`);
  if (el && !el.disabled) return el;
  // 2. Partial aria-label (handles "* Team Name" for "Team Name")
  el = root.querySelector(`input[aria-label*="${labelText}" i], textarea[aria-label*="${labelText}" i]`);
  if (el && !el.disabled) return el;
  // 3. Placeholder
  el = root.querySelector(`input[placeholder*="${labelText}" i]`);
  if (el && !el.disabled) return el;
  // 4. Label element
  for (const lbl of root.querySelectorAll('label')) {
    if (lbl.textContent.trim().includes(labelText)) {
      const id = lbl.getAttribute('for');
      if (id) { el = document.getElementById(id); if (el && !el.disabled) return el; }
      el = lbl.querySelector('input') || lbl.nextElementSibling?.querySelector('input');
      if (el && !el.disabled) return el;
    }
  }
  // 5. Wrapper div with direct child text matching label
  for (const div of root.querySelectorAll('div, li')) {
    const hasLabel = Array.from(div.childNodes).map(n => n.textContent?.trim() || '')
      .some(t => t === labelText || t === `* ${labelText}` || t === `${labelText} *` || t === `${labelText}*`);
    if (hasLabel) {
      el = div.querySelector('input:not([disabled]):not([type="hidden"]):not([type="date"])');
      if (el) return el;
    }
  }
  return null;
}

async function fillInputNear(labelText, value) {
  const input = await waitFor(() => {
    const main = document.querySelector('main') || document.body;

    // 1. Check role=dialog first (Team/Player modals)
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      const el = _findInputIn(dialog, labelText);
      if (el) return el;
    }

    // 2. Search inputs that are OUTSIDE <main> — form panels (Tournament/Stage/Substage)
    //    live outside main, while filter inputs live inside main
    const allInputs = Array.from(document.querySelectorAll(
      'input:not([disabled]):not([type="hidden"]):not([type="date"])'
    ));
    for (const inp of allInputs) {
      if (main.contains(inp)) continue; // skip filter inputs inside main
      const ariaLabel = (inp.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (inp.getAttribute('placeholder') || '').toLowerCase();
      const label = labelText.toLowerCase();
      if (ariaLabel.includes(label) || placeholder.includes(label)) return inp;
      // Check wrapper text
      let el = inp.parentElement;
      for (let i = 0; i < 4; i++) {
        if (!el) break;
        const directText = Array.from(el.childNodes).map(n => n.textContent?.trim() || '')
          .some(t => t === labelText || t === `* ${labelText}` || t === `${labelText} *` || t === `${labelText}*`);
        if (directText) return inp;
        el = el.parentElement;
      }
    }

    // 3. Fallback: search everywhere
    return _findInputIn(document.body, labelText);
  });
  input.focus();
  setReactInput(input, value);
  await sleep(200);
}

// ===== Close MUI Menu/Popover dropdown =====
// MAIN world: Escape key on the menu or backdrop mousedown sequence works natively.

async function closeMuiDropdown() {
  // Only act if a dropdown is actually open (listbox, menu, or popover backdrop)
  // The Define Groups dialog also has a MuiModal — avoid closing it by checking for the dropdown-specific elements
  const isDropdownOpen = () => !!document.querySelector('[role="listbox"]') || !!document.querySelector('#menu-selectedPlayer');

  if (!isDropdownOpen()) {
    log(`[DEBUG] closeMuiDropdown: no dropdown open, skipping`);
    return;
  }

  // Layer 1: Escape on the menu/listbox element directly (NOT activeElement — that could be the dialog)
  const menu = document.querySelector('[role="menu"]') || document.querySelector('[role="listbox"]');
  if (menu) {
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, code: 'Escape', bubbles: true, cancelable: true }));
    await sleep(400);
  }
  if (!isDropdownOpen()) return;

  // Layer 2: full mousedown→mouseup→click on the dropdown's backdrop (NOT the dialog backdrop)
  const menuRoot = document.querySelector('#menu-selectedPlayer');
  const backdrop = menuRoot ? menuRoot.querySelector('.MuiBackdrop-root') : null;
  if (backdrop) {
    const rect = backdrop.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y };
    backdrop.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    await sleep(30);
    backdrop.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    await sleep(30);
    backdrop.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
    await sleep(400);
  }
}

// ===== MUI Multi-select (Players field in Define Groups) =====

async function muiMultiSelect(comboboxEl, values) {
  if (!comboboxEl) return;

  const _check = () => !!document.querySelector('[role="listbox"]') || !!document.querySelector('[role="menu"]');

  log(`[DEBUG] muiMultiSelect: tag=${comboboxEl.tagName}, id=${comboboxEl.id}, role=${comboboxEl.getAttribute('role')}, disabled=${comboboxEl.hasAttribute('disabled')}, aria-disabled=${comboboxEl.getAttribute('aria-disabled')}, values=${values.join(',')}`);

  // Layer A: focus + click (simplest — full mousedown→mouseup→click sequence)
  comboboxEl.focus();
  await sleep(100);
  comboboxEl.click();
  await sleep(800);
  let opened = _check();
  log(`[DEBUG] after focus+click: opened=${opened}`);

  // Layer B: React fiber onMouseDown
  if (!opened) {
    const fk = Object.keys(comboboxEl).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (fk) {
      let fiber = comboboxEl[fk];
      while (fiber) {
        const md = fiber.memoizedProps?.onMouseDown || fiber.pendingProps?.onMouseDown;
        if (md) {
          md({ target: comboboxEl, currentTarget: comboboxEl, type: 'mousedown', button: 0, buttons: 1, preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: { stopImmediatePropagation: () => {} } });
          break;
        }
        fiber = fiber.return;
      }
    }
    await sleep(800);
    opened = _check();
    log(`[DEBUG] after fiber onMouseDown: opened=${opened}`);
  }

  // Layer C: click the dropdown arrow SVG inside the combobox
  if (!opened) {
    const arrow = comboboxEl.querySelector('svg') || comboboxEl.querySelector('[data-testid]');
    if (arrow) {
      (arrow.closest('div') || arrow).click();
      await sleep(800);
      opened = _check();
      log(`[DEBUG] after arrow click: opened=${opened}`);
    }
  }

  if (!opened) {
    throw new Error('Could not open players dropdown after 3 attempts');
  }

  // Wait for at least one option to appear (API may be loading players)
  await waitFor(() => {
    const count = document.querySelectorAll('[role="option"],[role="menuitem"]').length;
    log(`[DEBUG] waiting for options... count=${count}`);
    return count > 0;
  }, 10000).catch(() => {
    log(`[DEBUG] No options appeared after 10s — dropdown may be empty`, 'error');
  });

  // Select each player
  for (const val of values) {
    const opt = await waitFor(() =>
      Array.from(document.querySelectorAll('[role="option"],[role="menuitem"]'))
        .find(o => o.textContent.trim().toLowerCase() === val.toLowerCase())
    , 6000);

    log(`[DEBUG] Found option "${val}": tag=${opt.tagName}, role=${opt.getAttribute('role')}, aria-selected=${opt.getAttribute('aria-selected')}`);

    // Try full mouse sequence (MUI options use mousedown+click)
    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0 }));
    await sleep(50);
    opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0 }));
    await sleep(50);
    opt.click();
    await sleep(300);

    // Check if it worked
    const selected = opt.getAttribute('aria-selected') === 'true' || opt.classList.contains('Mui-selected');
    log(`[DEBUG] After click: aria-selected=${opt.getAttribute('aria-selected')}, selected=${selected}`);

    // Fallback: fiber onClick
    if (!selected) {
      log(`[DEBUG] click didn't work, trying fiber onClick...`);
      const fk = Object.keys(opt).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (fk) {
        let fiber = opt[fk];
        while (fiber) {
          const onClick = fiber.memoizedProps?.onClick;
          if (onClick) {
            onClick({ target: opt, currentTarget: opt, type: 'click', button: 0, preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: { stopImmediatePropagation: () => {} } });
            break;
          }
          fiber = fiber.return;
        }
      }
      await sleep(300);
    }

    log(`Selected player "${val}"`);
  }
}

// Get the effective label of a button — checks aria-label, title, then textContent.
// Buttons in TIP Control Center are icon-only (empty textContent) with aria-label.
function _btnLabel(b) {
  return (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().toLowerCase();
}

// Ant Design Select requires mousedown to open — plain .click() doesn't work.
function triggerOpen(el) {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, view: window }));
  el.dispatchEvent(new MouseEvent('click',     { bubbles: true, view: window }));
}

// Find a combobox in the form panel (never in the filter bar inside <main>).
// Form rows are always: LABEL(labelText) + DIV(contains combobox)
function _findFormCombobox(labelText) {
  const dialog = activeDialog();
  const main = document.querySelector('main');

  for (const div of document.body.querySelectorAll('div')) {
    // If a modal dialog is open, only search inside it
    if (dialog && !dialog.contains(div)) continue;
    // Otherwise skip anything inside <main> (those are filter controls)
    if (!dialog && main && main.contains(div)) continue;

    // Form row pattern: first child is label, second child contains combobox
    const kids = div.children;
    if (kids.length < 2) continue;
    const labelEl = kids[0];
    if (!labelEl.textContent.trim().toLowerCase().includes(labelText.toLowerCase())) continue;
    const combo = div.querySelector('[role="combobox"]:not([disabled])');
    if (combo) return combo;
  }
  return null;
}

// Select the first available option from a combobox identified by label text.
// Throws on failure — callers that want silent skip must add .catch(() => {}) themselves.
async function selectFirstDropdownOption(labelText) {
  const combo = await waitFor(() => _findFormCombobox(labelText), 5000);

  // For MUI Autocomplete there's an "Open" button; Ant Design Select: click combobox directly
  const container = combo.parentElement;
  const openBtn = container && Array.from(container.querySelectorAll('button'))
    .find(b => b.getAttribute('aria-label') === 'Open' || b.title === 'Open');

  if (openBtn) { openBtn.click(); } else { triggerOpen(combo); }
  await sleep(600);

  // If options haven't appeared yet, try Clear to trigger API fetch
  if (!document.querySelector('[role="option"]') ||
      document.querySelector('[class*="noOptions"], [class*="NoOptions"]')) {
    const root = activeDialog() || document.body;
    const clearBtn = Array.from(root.querySelectorAll('button'))
      .find(b => b.getAttribute('aria-label') === 'Clear' || b.title === 'Clear');
    if (clearBtn) {
      clearBtn.click();
      await sleep(1200);
    } else {
      await sleep(1000);
    }
  }

  const firstOpt = await waitFor(() => document.querySelector('[role="option"]'), 6000);
  firstOpt.click();
  await sleep(300);
}

// ===== Create Tournament =====

async function createTournament(name) {
  log(`Creating tournament: ${name}`);
  await navigateTo('TOURNAMENTS');
  await waitForHeading('Tournament', 12000);
  await openForm(['Add Tournament', 'Create Tournament', 'Create', 'Add', '+'], 'Add Tournament');

  await fillInputNear('Name', name);

  // Prizepool Currency (combobox)
  await selectFirstDropdownOption('Prizepool Currency');

  // Prizepool Amount — number/spinbutton input outside <main>
  const prizeInput = await waitFor(() => {
    const main = document.querySelector('main') || document.body;
    for (const inp of document.querySelectorAll('input[type="number"], input[role="spinbutton"], [role="spinbutton"]')) {
      if (inp.tagName !== 'INPUT') continue;
      if (inp.disabled || main.contains(inp)) continue;
      const lbl = (inp.getAttribute('aria-label') || '').toLowerCase();
      const ph  = (inp.getAttribute('placeholder') || '').toLowerCase();
      if (lbl.includes('amount') || lbl.includes('prizepool') ||
          ph.includes('amount')  || ph.includes('prizepool')) return inp;
      // check wrapper label text
      let el = inp.parentElement;
      for (let i = 0; i < 4; i++) {
        if (!el) break;
        const texts = Array.from(el.childNodes).map(n => n.textContent?.trim() || '');
        if (texts.some(t => /prizepool|amount/i.test(t) && !/currency/i.test(t))) return inp;
        el = el.parentElement;
      }
    }
    return null;
  }, 5000);
  prizeInput.focus();
  setReactInput(prizeInput, '100000');
  await sleep(200);

  // Fan Tier
  await selectFirstDropdownOption('Fan Tier');

  // Start Date and End Date — text inputs (DD/MM/YYYY format)
  await fillInputNear('Start Date', '01/01/2026');
  await fillInputNear('End Date', '31/12/2026');

  // Region + Country (Country becomes enabled after Region is selected)
  await selectFirstDropdownOption('Region');
  await sleep(800);
  await selectFirstDropdownOption('Country');

  await clickMainButton('Submit', 'Save', 'Create');

  await waitForToast();
  await sleep(800);

  // After creation, close the form (Escape) so the tournament card is visible
  await closeAnyPanel();
  await sleep(400);

  // Try to find the ID by tournament name first, then fallback to last ID on page
  const id = await waitFor(() => {
    // Look for "ID: <hex24>" near the tournament name
    for (const el of document.querySelectorAll('h2, h3, h4')) {
      if (el.textContent.trim().toLowerCase() === name.toLowerCase()) {
        const container = el.closest('[class]') || el.parentElement?.parentElement;
        if (container) {
          const match = container.innerHTML.match(/ID:\s*([a-f0-9]{24})/i);
          if (match) return match[1];
          // Also try bare hex24 in strong
          for (const s of container.querySelectorAll('strong, span, p')) {
            if (/^[a-f0-9]{24}$/i.test(s.textContent.trim())) return s.textContent.trim();
          }
        }
      }
    }
    return scrapeLastId();
  }, 5000).catch(() => scrapeLastId());

  log(`Tournament "${name}" created — ID: ${id || 'unknown'}`, 'success');
  step();
  return id;
}

// ===== Create Stage =====

async function createStage(name, tournamentName) {
  log(`Creating stage: ${name}`);
  await navigateTo('TOURNAMENTS');
  await waitForHeading('Tournament', 12000);
  await sleep(400);

  // Find the "Stages" button on the matching tournament card.
  // Buttons are icon-only — must check aria-label, not textContent.
  // Also must NOT match the "SUBSTAGES" sidebar button.
  const stagesBtn = await waitFor(() => {
    for (const heading of document.querySelectorAll('h2, h3')) {
      if (heading.textContent.trim().toLowerCase() === tournamentName.toLowerCase()) {
        let el = heading.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!el) break;
          const btn = Array.from(el.querySelectorAll('button')).find(b => {
            const lbl = _btnLabel(b);
            return lbl === 'stages' || (lbl.includes('stage') && !lbl.includes('substage'));
          });
          if (btn) return btn;
          el = el.parentElement;
        }
      }
    }
    return null;
  }, 8000);

  stagesBtn.click();
  // Wait for URL to change to exactly /stages (not /substages which also contains 'stages')
  await waitFor(() => window.location.pathname === '/stages', 8000).catch(() => {});
  await sleep(400);

  // Find and click the Add Stage button (it lives in <main> on the /stages page)
  const addStageBtn = await waitFor(() =>
    findMainButton('Add Stage', 'Create Stage')
  , 8000);
  addStageBtn.click();
  await waitForDialog('Add Stage');

  await fillInputNear('Name', name);
  // Order is required (*)
  await fillInputNear('Order', '1');
  await clickMainButton('Submit', 'Save', 'Create');

  await waitForToast();
  await sleep(600);
  await closeAnyPanel();
  await sleep(300);

  const id = scrapeLastId();
  log(`Stage "${name}" created — ID: ${id || 'unknown'}`, 'success');
  step();
  return id;
}

// ===== Create Substage =====
// Substages are added from the /stages page via "Add Substage" on the stage card.
// The SUBSTAGES page has no Add Substage button.

async function createSubstage(name, format, stageName, tournamentName, ffaOptions = {}) {
  log(`Creating substage: ${name}`);

  // Navigate back to the tournament's stages page
  await navigateTo('TOURNAMENTS');
  await waitForHeading('Tournament', 12000);
  await sleep(400);

  const stagesBtn = await waitFor(() => {
    for (const heading of document.querySelectorAll('h2, h3')) {
      if (heading.textContent.trim().toLowerCase() === tournamentName.toLowerCase()) {
        let el = heading.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!el) break;
          const btn = Array.from(el.querySelectorAll('button')).find(b => {
            const lbl = _btnLabel(b);
            return lbl === 'stages' || (lbl.includes('stage') && !lbl.includes('substage'));
          });
          if (btn) return btn;
          el = el.parentElement;
        }
      }
    }
    return null;
  }, 8000);
  stagesBtn.click();
  // Wait for URL to change to exactly /stages (not /substages)
  await waitFor(() => window.location.pathname === '/stages', 8000).catch(() => {});
  await sleep(400);

  // Close any leftover panel from createStage
  await closeAnyPanel();
  await sleep(300);

  // Find the "Add Substage" button on the stage card.
  // Buttons are icon-only — must check aria-label, not textContent.
  const addSubstageBtn = await waitFor(() => {
    for (const heading of document.querySelectorAll('h2, h3, h4')) {
      if (heading.textContent.trim().toLowerCase() === stageName.toLowerCase()) {
        let el = heading.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!el) break;
          const btn = Array.from(el.querySelectorAll('button')).find(b => {
            const lbl = _btnLabel(b);
            return lbl.includes('substage') || lbl.includes('add sub');
          });
          if (btn) return btn;
          el = el.parentElement;
        }
      }
    }
    return null;
  }, 8000);

  addSubstageBtn.click();
  await waitForDialog('Substage');
  await sleep(300);

  await fillInputNear('Name', name);

  // Format is a radio group: ONE_V_ONE → "1 vs 1", FFA → "FFA"
  const radioLabel = format === 'ONE_V_ONE' ? '1 vs 1' : (format || 'FFA');
  const radio = await waitFor(() => {
    for (const r of document.querySelectorAll('[role="radio"], input[type="radio"]')) {
      const lbl = r.getAttribute('aria-label') || r.getAttribute('value') || '';
      if (lbl.toLowerCase().includes(radioLabel.toLowerCase())) return r;
      const parent = r.closest('label') || r.parentElement;
      if (parent && parent.textContent.trim().toLowerCase().includes(radioLabel.toLowerCase())) return r;
    }
    // Ant Design radio: click the <span> with matching text
    for (const span of document.querySelectorAll('span, label')) {
      if (span.textContent.trim() === radioLabel) {
        return span.querySelector('input[type="radio"]') || span;
      }
    }
    return null;
  }, 5000);
  radio.click();
  await sleep(400);

  // FFA-specific fields (appear after selecting FFA)
  if (format === 'FFA') {
    // FFA Format sub-type: Simple Group / Round Robin
    if (ffaOptions.ffaFormat) {
      const subLabel = ffaOptions.ffaFormat; // 'Simple Group' or 'Round Robin'
      const subRadio = await waitFor(() => {
        for (const span of document.querySelectorAll('span, label')) {
          if (span.textContent.trim() === subLabel) return span.querySelector('input[type="radio"]') || span;
        }
        return null;
      }, 3000).catch(() => null);
      if (subRadio) { subRadio.click(); await sleep(200); }
    }
    if (ffaOptions.teams)           { await fillInputNear('Teams', String(ffaOptions.teams)); }
    if (ffaOptions.playersPerTeam)  { await fillInputNear('Players per Team', String(ffaOptions.playersPerTeam)); }
    if (ffaOptions.matchesPerSeries){ await fillInputNear('Matches per Series', String(ffaOptions.matchesPerSeries)); }
    if (ffaOptions.qualifiers)      { await fillInputNear('Qualifiers', String(ffaOptions.qualifiers)); }
  }

  await clickMainButton('Submit', 'Save', 'Create');
  await waitForToast();
  await sleep(600);
  await closeAnyPanel();
  await sleep(300);

  const id = scrapeLastId();
  log(`Substage "${name}" created — ID: ${id || 'unknown'}`, 'success');
  step();
  return id;
}

// ===== Create Team =====

async function createTeam(name, abbreviation) {
  log(`Creating team: ${name}`);
  await navigateTo('TEAMS');
  await waitForHeading('Team');
  await sleep(300);

  await openForm(['Add New Entry', 'Create Team', 'Add Team', 'Create', 'Add', '+'], 'Add Team');

  // "* Team Name" field — fillInputNear handles partial aria-label match
  await fillInputNear('Team Name', name);
  await fillInputNear('Abbreviation', abbreviation).catch(() =>
    fillInputNear('Short', abbreviation).catch(() => {})
  );

  await clickMainButton('Save', 'Submit', 'Create');
  await waitForToast();
  await sleep(600);

  // ID is in <strong> with no "ID:" prefix on the team card
  const id = await waitFor(() => scrapeEntityIdByName(name), 5000).catch(() => scrapeLastId());
  log(`Team "${name}" created — ID: ${id || 'unknown'}`, 'success');
  step();
  return { name, id };
}

// ===== Create Player =====

async function createPlayer(playerName, dob, teamName) {
  log(`Creating player: ${playerName}`);
  await navigateTo('PLAYERS');
  await waitForHeading('Player');
  await sleep(300);

  await openForm(['Add New Entry', 'Create Player', 'Add Player', 'Create', 'Add', '+'], 'Add Player');

  // Fill Name
  await fillInputNear('Name', playerName);

  // Fill "In Game Name" — REQUIRED field
  await fillInputNear('In Game Name', playerName).catch(() => {});

  // Fill DOB (input[type="date"] is excluded from fillInputNear, handle separately)
  if (dob) {
    try {
      const dialog = activeDialog() || document.body;
      const dobInput = dialog.querySelector('input[type="date"]');
      if (dobInput) {
        dobInput.focus();
        setReactInput(dobInput, dob); // expects YYYY-MM-DD
        await sleep(200);
      }
    } catch (_) {}
  }

  // Add team via "Add Team" button in the dialog
  if (teamName) {
    try {
      const addTeamBtn = await waitFor(() =>
        Array.from((activeDialog() || document.body).querySelectorAll('button'))
          .find(b => b.textContent.trim().toLowerCase().includes('add team'))
      , 3000).catch(() => null);

      if (addTeamBtn) {
        addTeamBtn.click();
        await sleep(400);

        const dialog = activeDialog() || document.body;
        // The team search is an Ant Design Select with showSearch.
        // Click the last combobox to open it, then type in the search input.
        const allCombos = Array.from(dialog.querySelectorAll('[role="combobox"]'));
        const lastCombo = allCombos[allCombos.length - 1];

        if (lastCombo) {
          // Open the Ant Design Select by clicking the outer .ant-select-selector container
          const selectorDiv = lastCombo.closest('.ant-select-selector') || lastCombo.parentElement?.parentElement;
          const target = selectorDiv || lastCombo;
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
          await sleep(600);

          // Type team name char-by-char into the search input (lastCombo IS the search input)
          // This triggers Ant Design's onSearch which calls the API
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(lastCombo, '');
          for (const ch of teamName) {
            lastCombo.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
            lastCombo.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
            nativeSetter.call(lastCombo, lastCombo.value + ch);
            lastCombo.dispatchEvent(new Event('input', { bubbles: true }));
            lastCombo.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
            await sleep(40);
          }
          await sleep(800);

          // Wait for an option to appear (Ant Design shows ID as text, not team name)
          const hasOpt = await waitFor(() => document.querySelector('[role="option"]'), 5000).catch(() => null);
          if (hasOpt) {
            // Select with keyboard: ArrowDown to highlight, Enter to confirm
            // This works because Ant Design responds to keyboard events (unlike synthetic mouse clicks)
            lastCombo.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
            await sleep(200);
            lastCombo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            await sleep(400);
            log(`Team "${teamName}" assigned to player "${playerName}"`);
          } else {
            log(`Warning: team option "${teamName}" not found`, 'error');
          }
        }
      }
    } catch (e) {
      log(`Warning: Could not set team for ${playerName}: ${e.message}`, 'error');
    }
  }

  await clickMainButton('Save', 'Submit', 'Create');
  await waitForToast();
  await sleep(500);

  const id = await waitFor(() => scrapeEntityIdByName(playerName), 5000).catch(() => scrapeLastId());
  log(`Player "${playerName}" created — ID: ${id || 'unknown'}`, 'success');
  step();
  return { name: playerName, id };
}

// ===== MUI Autocomplete helper (shared by defineGroups and addSeriesItem) =====
// Opens a MUI Autocomplete via React fiber, types to filter, selects the matching option.
// aria-label="Open" lives only in React fiber props (not DOM attrs) — must use fiber approach.

async function selectMuiAutocomplete(comboEl, optionName, multiple = false) {
  const wrapper = comboEl.closest('[class]') || comboEl.parentElement;
  const btns = wrapper ? Array.from(wrapper.querySelectorAll('button')) : [];

  // Open via the ▼ button's React fiber onClick
  let opened = false;
  for (const btn of btns) {
    const fk = Object.keys(btn).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (!fk) continue;
    let fiber = btn[fk];
    while (fiber) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if ((props?.['aria-label'] === 'Open' || props?.['aria-label'] === 'Close') && props?.onClick) {
        props.onClick({ target: btn, currentTarget: btn, type: 'click', button: 0, preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: { stopImmediatePropagation: () => {} } });
        opened = true;
        break;
      }
      fiber = fiber.return;
    }
    if (opened) break;
  }

  // Fallback: invoke onMouseDown on the combobox element
  if (!opened) {
    const fk = Object.keys(comboEl).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (fk) {
      let fiber = comboEl[fk];
      while (fiber) {
        const h = fiber.memoizedProps?.onMouseDown || fiber.pendingProps?.onMouseDown;
        if (h) { h({ target: comboEl, currentTarget: comboEl, type: 'mousedown', button: 0, buttons: 1, preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: { stopImmediatePropagation: () => {} } }); opened = true; break; }
        fiber = fiber.return;
      }
    }
    if (!opened) comboEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  }
  await sleep(400);

  // Type search term via React fiber onChange to trigger API fetch
  const inputEl = (comboEl.tagName === 'INPUT') ? comboEl : comboEl.querySelector('input');
  if (inputEl) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(inputEl, optionName);
    let triggered = false;
    const fk = Object.keys(inputEl).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (fk) {
      let fiber = inputEl[fk];
      while (fiber) {
        const onChange = fiber.memoizedProps?.onChange || fiber.pendingProps?.onChange;
        if (onChange) {
          onChange({ target: inputEl, currentTarget: inputEl, type: 'change', preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: { stopImmediatePropagation: () => {} } });
          triggered = true; break;
        }
        fiber = fiber.return;
      }
    }
    if (!triggered) inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(1000);
  }

  // Wait for the matching option to appear
  const opt = await waitFor(() =>
    Array.from(document.querySelectorAll('[role="option"]')).find(o =>
      o.textContent.trim().toLowerCase() === optionName.toLowerCase()
    )
  , 6000);

  log(`[DEBUG] selectMuiAutocomplete: found option "${opt.textContent.trim()}", clicking it directly`);

  // MAIN world: click the matching option directly (no ArrowDown+Enter guessing)
  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0 }));
  await sleep(50);
  opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0 }));
  await sleep(50);
  opt.click();
  await sleep(400);
}

// ===== Define Groups =====

async function defineGroups(substageCard, teams) {
  if (!teams || teams.length === 0) return;
  log(`Defining groups...`);

  const defineBtn = Array.from(substageCard.querySelectorAll('button'))
    .find(b => _btnLabel(b).includes('define groups') || _btnLabel(b).includes('define group'));
  if (!defineBtn) throw new Error('Define Groups button not found on card');
  defineBtn.click();
  await sleep(1000);

  await waitForDialog('Define Groups');
  await sleep(500);

  // Detect mode ONCE before the loop:
  // FFA — all team slots are pre-rendered in the dialog (no "Add Team" button needed).
  // ONE_V_ONE — only the first slot exists; "Add Team and Players" must be clicked for each extra team.
  const modal = () => document.querySelector('.MuiModal-root:not([aria-hidden="true"])') || document.body;
  const _findAddTeamBtn = () => {
    const btn = Array.from(modal().querySelectorAll('button'))
      .find(b => _btnLabel(b).includes('add team and players') || _btnLabel(b).includes('add team'));
    return btn || null;
  };
  const prePopulated = document.querySelectorAll('input#selectedTeam').length >= teams.length;
  log(`[DEBUG] Define Groups mode: ${prePopulated ? 'FFA (pre-populated)' : 'ONE_V_ONE (add-per-team)'}`);

  for (let ti = 0; ti < teams.length; ti++) {
    const team = teams[ti];

    // ONE_V_ONE: click "Add Team and Players" for every team after the first slot
    if (!prePopulated && ti > 0) {
      let addTeamBtn = _findAddTeamBtn();
      if (!addTeamBtn) {
        try { addTeamBtn = await waitFor(_findAddTeamBtn, 2000); } catch (_) {}
      }
      if (addTeamBtn) {
        addTeamBtn.click();
        await sleep(800);
      }
    }
    // FFA: slots already exist — no button click needed, go straight to filling

    // Find the team search input for THIS row by index (ti).
    // FFA pre-populates all rows so all inputs start empty — must use ti to pick the correct slot,
    // not always the last one (which caused team[0] to land in Team 2's slot).
    const teamInput = await waitFor(() => {
      const byId = Array.from(document.querySelectorAll('input#selectedTeam:not([disabled])'));
      const empty = byId.filter(i => !i.value);
      // Pick the ti-th empty slot; fall back to last if index out of range (ONE_V_ONE adds rows one at a time)
      if (empty.length) return empty[ti] || empty[empty.length - 1];
      if (byId.length) return byId[ti] || byId[byId.length - 1];
      const inputs = Array.from(document.querySelectorAll('input:not([disabled])'));
      return inputs.filter(i => (i.type === 'text' || i.type === '') && !i.value).pop() || null;
    }, 5000);
    log(`[DEBUG] Team input found: value="${teamInput?.value}", disabled=${teamInput?.disabled}`);

    log(`Selecting team "${team.name}"...`);
    const teamFailed = await selectMuiAutocomplete(teamInput, team.name).then(() => false).catch(async (e) => {
      log(`Warning: team "${team.name}" not found — skipping (${e.message})`, 'error');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(500);
      return true;
    });
    if (teamFailed) continue;

    // Verify team was actually selected correctly (check the ti-th slot)
    const allTeamInputs = Array.from(document.querySelectorAll('input#selectedTeam'));
    const teamCheck = allTeamInputs[ti] || allTeamInputs[allTeamInputs.length - 1];
    const teamVal = teamCheck?.value || '';
    log(`[DEBUG] Team input value: "${teamVal}" (expected: "${team.name}")`);
    if (!teamVal) {
      throw new Error(`Team "${team.name}" was not selected — input is empty`);
    }
    if (!teamVal.toLowerCase().includes(team.name.toLowerCase()) && !team.name.toLowerCase().includes(teamVal.toLowerCase())) {
      throw new Error(`Team "${team.name}" mismatch — input shows "${teamVal}"`);
    }

    // Wait for Players field to become ready (not fixed sleep)
    log(`[DEBUG] Waiting for #selectedPlayer to be ready...`);
    await waitFor(() => {
      const combos = document.querySelectorAll('#selectedPlayer');
      const combo = combos[ti] || combos[combos.length - 1];
      return combo && combo.getAttribute('aria-disabled') !== 'true' && !combo.hasAttribute('disabled');
    }, 8000).catch(() => {
      log(`[DEBUG] Players field not ready after 8s, proceeding anyway...`, 'error');
    });
    await sleep(500);

    // Find the players combobox for THIS row by index (ti) — same reason as teamInput above.
    // FFA pre-populates all rows so picking "last empty" always hits the wrong slot.
    const allPlayerCombos = Array.from(document.querySelectorAll('#selectedPlayer'));
    log(`[DEBUG] Found ${allPlayerCombos.length} #selectedPlayer elements`);
    const emptyPlayerCombos = allPlayerCombos.filter(el => {
      const hidden = el.querySelector('input[type="hidden"]') || el.querySelector('input');
      return !hidden?.value;
    });
    const playersCombo = emptyPlayerCombos[ti] || emptyPlayerCombos[emptyPlayerCombos.length - 1]
      || allPlayerCombos[ti] || allPlayerCombos[allPlayerCombos.length - 1]
      || Array.from(document.querySelectorAll('[role="combobox"]')).filter(el => el.tagName !== 'INPUT').pop();
    log(`[DEBUG] Using playersCombo: tag=${playersCombo?.tagName}, id=${playersCombo?.id}, hasValue=${!!playersCombo?.querySelector('input')?.value}`);

    const validPlayers = team.players.map(p => p.name).filter(n => n && n.trim());
    if (playersCombo && validPlayers.length) {
      await muiMultiSelect(playersCombo, validPlayers);
    }
    // Close the player dropdown (MUI Menu with mousedown-guarded backdrop)
    await closeMuiDropdown();
  }

  // Ensure any remaining dropdown is closed before submit
  await closeMuiDropdown();

  const submitBtn = await waitFor(() => {
    const modal = document.querySelector('.MuiModal-root:not([aria-hidden="true"])') || document.body;
    return Array.from(modal.querySelectorAll('button'))
      .find(b => b.textContent.trim().toLowerCase() === 'submit' && !b.disabled);
  });
  submitBtn.click();

  await waitForToast(8000);
  await sleep(500);
  log('Groups defined!', 'success');
  step();

  // Click the X close button on the Define Groups modal (untrusted Escape is ignored by MUI)
  const groupsModal = document.querySelector('.MuiModal-root:not([aria-hidden="true"])') || document.querySelector('[role="dialog"]');
  const closeXBtn = groupsModal
    ? Array.from(groupsModal.querySelectorAll('button')).find(b => {
        const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
        return lbl === 'close' || lbl.includes('close') || b.textContent.trim() === '×' || b.textContent.trim() === 'Close';
      })
    : null;
  if (closeXBtn) {
    closeXBtn.click();
    log('[DEBUG] Define Groups modal closed via X button');
  } else {
    await closeAnyPanel(); // fallback
  }
  await sleep(600);
}

// ===== Add Series Item =====

async function addSeriesItem(substageCard, seriesName, matchCount, teamA, teamB) {
  log(`Creating series: ${teamA} vs ${teamB}`);

  const addBtn = Array.from(substageCard.querySelectorAll('button'))
    .find(b => _btnLabel(b).includes('add series') || _btnLabel(b).includes('series item'));
  if (!addBtn) throw new Error('Add Series Item button not found');
  addBtn.click();
  await sleep(600);

  await waitForDialog('Add Series Item');

  await fillInputNear('Name', seriesName);
  await fillInputNear('Match Count', String(matchCount));

  // Fill Start Time with today's date (optional field but included for completeness)
  try {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    await fillInputNear('Start Time', `${dd}/${mm}/${yyyy} 12:00:00`);
  } catch (_) {}

  // Team A
  const teamACombo = await waitFor(() =>
    document.getElementById('teamA') ||
    _findFormCombobox('Team A') || _findFormCombobox('Team a')
  , 6000);
  await selectMuiAutocomplete(teamACombo, teamA);

  // Team B
  const teamBCombo = await waitFor(() =>
    document.getElementById('teamB') ||
    _findFormCombobox('Team B') || _findFormCombobox('Team b')
  , 6000);
  await selectMuiAutocomplete(teamBCombo, teamB);

  const spinners = Array.from(document.querySelectorAll('[role="spinbutton"]'));
  const col = spinners.find(s => (s.getAttribute('aria-label') || '').toLowerCase().includes('column'));
  const off = spinners.find(s => (s.getAttribute('aria-label') || '').toLowerCase().includes('offset'));
  if (col) { col.focus(); setReactInput(col, '1'); await sleep(150); }
  if (off) { off.focus(); setReactInput(off, '0'); await sleep(150); }

  // Fallback: fill by input labels if spinbuttons weren't found by aria-label
  if (!col) await fillInputNear('Column', '1').catch(() => {});
  if (!off) await fillInputNear('Offset', '0').catch(() => {});

  // Submit — try dialog button first, then any visible Submit button
  const submitBtn = await waitFor(() =>
    Array.from(document.querySelectorAll('[role="dialog"] button, button'))
      .find(b => b.textContent.trim().toLowerCase() === 'submit' && !b.disabled)
  );
  submitBtn.click();

  await waitForToast(8000);
  await sleep(400);
  log(`Series "${seriesName}" created!`, 'success');
  step();

  // Close the Add Series Item dialog
  const seriesModal = document.querySelector('.MuiModal-root:not([aria-hidden="true"])') || document.querySelector('[role="dialog"]');
  const seriesCloseBtn = Array.from((seriesModal || document).querySelectorAll('button')).find(b => {
    const label = (b.getAttribute('aria-label') || '').toLowerCase();
    return label === 'close' || label.includes('close') || b.textContent.trim() === 'Close';
  });
  if (seriesCloseBtn) { seriesCloseBtn.click(); await sleep(500); }
  else { await closeAnyPanel(); await sleep(400); }
}

// ===== Find Substage Card =====

async function findSubstageCard(name) {
  return waitFor(() => {
    for (const h of document.querySelectorAll('h2, h3, h4')) {
      if (h.textContent.trim() === name) {
        // Walk up to find a container with buttons
        let el = h.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!el) break;
          if (el.querySelectorAll('button').length > 0) return el;
          el = el.parentElement;
        }
        return h.parentElement?.parentElement;
      }
    }
    return null;
  });
}

// ===== Progress Reporter =====

function _send(msg) {
  window.postMessage({ source: 'tip-main-to-shim', payload: msg }, '*');
}

function log(text, level = 'info') {
  _send({ type: 'PROGRESS', text, level });
  console.log(`[TIP Automator][${level}] ${text}`);
}

function step() {
  _send({ type: 'STEP' });
}

function reportIds(ids) {
  _send({ type: 'IDS_UPDATE', ids });
}

// ===== Login =====

var TIP_USERNAME = 'sankalp';
var TIP_PASSWORD = 'sankalp';

async function login() {
  if (!document.querySelector('input[type="password"]')) {
    log('Already logged in', 'success');
    return;
  }

  log('Logging in...');

  const userInput = await waitFor(() =>
    document.querySelector('input[type="text"], input[name="username"], input[placeholder*="user" i]')
  , 10000);
  userInput.focus();
  setReactInput(userInput, TIP_USERNAME);
  await sleep(200);

  const passInput = await waitFor(() => document.querySelector('input[type="password"]'));
  passInput.focus();
  setReactInput(passInput, TIP_PASSWORD);
  await sleep(200);

  const loginBtn = await waitFor(() =>
    Array.from(document.querySelectorAll('button'))
      .find(b => /login|sign in|submit/i.test(b.textContent.trim()))
  );
  loginBtn.click();

  await waitFor(() => !document.querySelector('input[type="password"]'), 12000);
  log('Logged in successfully', 'success');
  step();
  await sleep(500);
}

// ===== Game Selection =====

async function selectGame(gameName) {
  log(`Selecting game: ${gameName}`);

  // If already inside the game's section (not on /games hub), skip re-selection.
  // Clicking the CRICKET sidebar button from within the game navigates BACK to /games.
  if (window.location.pathname !== '/games') {
    log(`Already in game context, skipping game tile click`, 'info');
    log(`Game "${gameName}" selected`, 'success');
    step();
    return;
  }

  // On /games: clickable items are <p> inside a div.gameBox wrapper
  // Must click the parent div, not the <p> itself
  const gameEl = await waitFor(() => {
    for (const p of document.querySelectorAll('p')) {
      if (p.textContent.trim().toUpperCase() === gameName.toUpperCase()) {
        // Only click game tiles on the /games page, not sidebar items
        const el = p.parentElement;
        if (el && !el.closest('nav, aside, [role="navigation"], [role="complementary"]')) {
          return el;
        }
      }
    }
    return null;
  }, 10000);

  gameEl.click();

  // Wait for URL to change to /tournaments
  await waitFor(() => window.location.pathname.includes('tournament'), 8000)
    .catch(() => {});
  await sleep(400);
  log(`Game "${gameName}" selected`, 'success');
  step();
}

// ===== Main Orchestrator =====

async function runAutomation(data) {
  const allIds = { tournaments: [], stages: [], substages: [], teams: [], players: [], series: [] };

  try {
    await login();
    await checkPauseStop();

    for (const gameGroup of data) {
      await selectGame(gameGroup.name);
      await checkPauseStop();

      for (const tournament of gameGroup.tournaments) {
        await checkPauseStop();
        const tId = await createTournament(tournament.name);
        allIds.tournaments.push({ name: tournament.name, id: tId });
        reportIds({ tournaments: allIds.tournaments });

        for (const stage of tournament.stages) {
          await checkPauseStop();
          const sId = await createStage(stage.name, tournament.name);
          allIds.stages.push({ name: stage.name, id: sId });
          reportIds({ stages: allIds.stages });

          for (const substage of stage.substages) {
            await checkPauseStop();
            const ssId = await createSubstage(substage.name, substage.format, stage.name, tournament.name);
            allIds.substages.push({ name: substage.name, id: ssId });
            reportIds({ substages: allIds.substages });

            for (const team of substage.teams) {
              await checkPauseStop();
              const teamResult = await createTeam(team.name, team.abbreviation);
              allIds.teams.push(teamResult);
              reportIds({ teams: allIds.teams });

              for (const player of team.players) {
                await checkPauseStop();
                const pResult = await createPlayer(player.name, player.dob, team.name);
                allIds.players.push(pResult);
                reportIds({ players: allIds.players });
              }
            }

            // Define Groups first
            await checkPauseStop();
            await navigateTo('SUBSTAGES');
            await sleep(500);
            const card = await findSubstageCard(substage.name);
            try {
              await defineGroups(card, substage.teams);
            } catch (e) {
              log(`Define groups warning: ${e.message}`, 'error');
            } finally {
              await sleep(3500);
            }

            await checkPauseStop();
            const teamNames = substage.teams.map(t => t.name);
            const freshCard = await findSubstageCard(substage.name);
            await addSeriesItem(freshCard, substage.seriesName || substage.name, substage.matchCount || 1, teamNames[0], teamNames[1]);
            allIds.series.push({ name: substage.seriesName || substage.name, teams: teamNames });
            reportIds({ series: allIds.series });
            await closeAnyPanel();
            await sleep(500);
          }
        }
      }
    }

    _send({ type: 'DONE' });

  } catch (err) {
    if (err.message === 'STOPPED') {
      _send({ type: 'STOPPED' });
      log('Automation stopped by user', 'error');
    } else {
      _send({ type: 'ERROR', text: err.message });
      console.error('[TIP Automator]', err);
    }
  }

  return allIds;
}

// ===== Manual Orchestrator =====
// Runs only the entities that are checked in the manual config.
// Does NOT call selectGame — uses whatever game context is active in the tab.

async function runManual(config) {
  const allIds = {};

  try {
    await login();
    await checkPauseStop();

    // Tournament
    if (config.create.tournament) {
      const id = await createTournament(config.tournament.name);
      allIds.tournament = { name: config.tournament.name, id };
      reportIds({ tournaments: [allIds.tournament] });
      await checkPauseStop();
    }

    // Stage
    if (config.create.stage) {
      const id = await createStage(config.stage.name, config.tournament.name);
      allIds.stage = { name: config.stage.name, id };
      reportIds({ stages: [allIds.stage] });
      await checkPauseStop();
    }

    // Substage
    if (config.create.substage) {
      const id = await createSubstage(config.substage.name, config.substage.format, config.stage.name, config.tournament.name, config.substage.ffaOptions || {});
      allIds.substage = { name: config.substage.name, id };
      reportIds({ substages: [allIds.substage] });
      await checkPauseStop();
    }

    // Teams
    if (config.create.teams) {
      allIds.teams = [];
      for (const team of config.teams) {
        await checkPauseStop();
        const result = await createTeam(team.name, team.abbreviation);
        allIds.teams.push(result);
        reportIds({ teams: allIds.teams });
      }
    }

    // Players
    if (config.create.players) {
      allIds.players = [];
      for (const team of config.teams) {
        for (const player of team.players) {
          if (player.existing) { log(`Skipping existing player: ${player.name}`); continue; }
          await checkPauseStop();
          const result = await createPlayer(player.name, player.dob, team.name);
          allIds.players.push(result);
          reportIds({ players: allIds.players });
        }
      }
    }

    // Define Groups
    if (config.create.defineGroups) {
      await checkPauseStop();
      await navigateTo('SUBSTAGES');
      await sleep(500);
      const card = await findSubstageCard(config.substage.name);
      try {
        await defineGroups(card, config.teams);
      } catch (e) {
        log(`Define groups warning: ${e.message}`, 'error');
      } finally {
        await sleep(3500);
      }
    }

    // Match
    if (config.create.match) {
      await checkPauseStop();
      await navigateTo('SUBSTAGES');
      await sleep(500);
      const card = await findSubstageCard(config.substage.name);
      const teamNames = config.teams.map(t => t.name);
      await addSeriesItem(card, config.series.name, config.series.matchCount, teamNames[0], teamNames[1]);
      allIds.series = { name: config.series.name, teams: teamNames };
      reportIds({ series: [allIds.series] });
      await closeAnyPanel();
      await sleep(500);
    }

    _send({ type: 'DONE' });

  } catch (err) {
    if (err.message === 'STOPPED') {
      _send({ type: 'STOPPED' });
      log('Automation stopped by user', 'error');
    } else {
      _send({ type: 'ERROR', text: err.message });
      console.error('[TIP Automator]', err);
    }
  }
}

// ===== Match Only Orchestrator =====
// Skips tournament/stage/substage/team/player creation.
// Goes straight to: login → select game → create teams + players only.

async function runTeamsOnly(data) {
  const allIds = { teams: [], players: [] };

  try {
    await login();
    await checkPauseStop();

    for (const gameGroup of data) {
      await selectGame(gameGroup.name);
      await checkPauseStop();

      for (const tournament of gameGroup.tournaments) {
        for (const stage of tournament.stages) {
          for (const substage of stage.substages) {
            for (const team of substage.teams) {
              await checkPauseStop();
              const teamResult = await createTeam(team.name, team.abbreviation);
              allIds.teams.push(teamResult);
              reportIds({ teams: allIds.teams });

              for (const player of team.players) {
                await checkPauseStop();
                const pResult = await createPlayer(player.name, player.dob, team.name);
                allIds.players.push(pResult);
                reportIds({ players: allIds.players });
              }
            }
          }
        }
      }
    }

    _send({ type: 'DONE' });

  } catch (err) {
    if (err.message === 'STOPPED') {
      _send({ type: 'STOPPED' });
      log('Automation stopped by user', 'error');
    } else {
      _send({ type: 'ERROR', text: err.message });
      console.error('[TIP Automator]', err);
    }
  }
}

// Goes straight to: login → select game → define groups → add series item.

async function runMatchOnly(data) {
  const allIds = { series: [] };

  try {
    await login();
    await checkPauseStop();

    for (const gameGroup of data) {
      await selectGame(gameGroup.name);
      await checkPauseStop();

      for (const tournament of gameGroup.tournaments) {
        for (const stage of tournament.stages) {
          for (const substage of stage.substages) {
            await checkPauseStop();
            log(`Match Only: targeting substage "${substage.name}"`);

            await navigateTo('SUBSTAGES');
            await sleep(500);
            const card = await findSubstageCard(substage.name);

            const teamNames = substage.teams.map(t => t.name);
            await addSeriesItem(card, substage.seriesName || substage.name, substage.matchCount || 1, teamNames[0], teamNames[1]);
            allIds.series.push({ name: substage.seriesName || substage.name, teams: teamNames });
            reportIds({ series: allIds.series });
            await closeAnyPanel();
            await sleep(500);
          }
        }
      }
    }

    _send({ type: 'DONE' });

  } catch (err) {
    if (err.message === 'STOPPED') {
      _send({ type: 'STOPPED' });
      log('Automation stopped by user', 'error');
    } else {
      _send({ type: 'ERROR', text: err.message });
      console.error('[TIP Automator]', err);
    }
  }

  return allIds;
}

// ===== Message Listener =====

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== 'tip-shim-to-main') return;
  const msg = event.data.payload;

  if (msg.creds) {
    TIP_USERNAME = msg.creds.username;
    TIP_PASSWORD = msg.creds.password;
  }

  if (msg.type === 'START_AUTOMATION') {
    if (_running) return;
    _paused = false; _stopped = false; _running = true;
    log('Automation started', 'info');
    runAutomation(msg.data).finally(() => { _running = false; });
  }
  if (msg.type === 'START_MATCH_ONLY') {
    if (_running) return;
    _paused = false; _stopped = false; _running = true;
    log('Match Only mode started', 'info');
    runMatchOnly(msg.data).finally(() => { _running = false; });
  }
  if (msg.type === 'START_MANUAL') {
    if (_running) return;
    _paused = false; _stopped = false; _running = true;
    log('Manual mode started', 'info');
    runManual(msg.config).finally(() => { _running = false; });
  }
  if (msg.type === 'START_TEAMS_ONLY') {
    if (_running) return;
    _paused = false; _stopped = false; _running = true;
    log('Teams & Players Only mode started', 'info');
    runTeamsOnly(msg.data).finally(() => { _running = false; });
  }
  if (msg.type === 'PAUSE_AUTOMATION') { _paused = true; log('Automation paused', 'info'); }
  if (msg.type === 'RESUME_AUTOMATION') { _paused = false; log('Automation resumed', 'info'); }
  if (msg.type === 'STOP_AUTOMATION') { _stopped = true; _paused = false; log('Automation stopping...', 'error'); }
});

console.log('[TIP Automator] Content script loaded ✓');
} // end window.__TIP_LOADED__ guard
