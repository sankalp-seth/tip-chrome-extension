# CLAUDE.md — TIP Control Center Session Log

> **Skills reference:** See [SKILLS.md](./SKILLS.md) for reusable Playwright patterns discovered during this session.

---

## Project Overview

**App:** TIP Control Center (https://tip-control-dev.spectatr.ai)
**Goal:** Automate creation of a tournament match using Playwright MCP browser tools.
**Sport context:** Cricket — CRICKET sport selected in sidebar.

## Login Credentials

| Field    | Value   |
|----------|---------|
| Username | sankalp |
| Password | sankalp |

---

## Session Goal

Create a match inside the "small bro" tournament by:
1. Navigating to the Substages section
2. Defining groups (teams + players) for the "small bro" substage
3. Adding a series item (the match) with spectatr ops vs spec ops

---

## Entity Hierarchy

```
Tournament: small bro (ID: 69bb98483d5534dfa82a5f11)
  └── Stage: small bro (ID: 69bb9b4c9750e5adbaabf2f1)
        └── Substage: small bro (ID: 69bb9b6a9750e5adbaabf2f2)
              Format: ONE_V_ONE
              └── Series: small bro (Series Count: 1) ✅
```

---

## Teams Created

| Team        | Abbreviation | ID                         |
|-------------|--------------|----------------------------|
| spectatr ops | SO          | 69bb98663d5534dfa82a5f12   |
| spec ops     | SO          | 69bb9cfe9750e5adbaabf2f3   |

---

## Players Created

| Player  | Team         | DOB        | ID                         |
|---------|--------------|------------|----------------------------|
| naman   | spectatr ops | 1995-01-01 | 69bb98b33d5534dfa82a5f13   |
| nitish  | spectatr ops | 1995-01-01 | 69bb996f3d5534dfa82a5f14   |
| ujjwal  | spectatr ops | 1995-01-01 | 69bb9a029750e5adbaabf2f0   |
| arjun   | spec ops     | 1995-01-01 | 69bb9de59750e5adbaabf2f4   |
| vikram  | spec ops     | 1995-01-01 | 69bb9e179750e5adbaabf2f5   |
| rohit   | spec ops     | 1995-01-01 | 69bb9e4a9750e5adbaabf2f6   |

---

## What Was Done

### Step 1 — Setup Teams & Players
- Created team **spectatr ops** via TEAMS section
- Created 3 players (naman, nitish, ujjwal) assigned to spectatr ops
- Created team **spec ops** via TEAMS section
- Created 3 players (arjun, vikram, rohit) assigned to spec ops
- DOB fields required JavaScript `nativeInputValueSetter` approach (React controlled inputs)

### Step 2 — Define Groups (Substages page)
- Opened Define Groups dialog on "small bro" substage
- Added Team 1: **spectatr ops** with players naman, nitish, ujjwal
- Added Team 2: **spec ops** with players arjun, vikram, rohit
- Submitted → success toast: "Substage rosters successfully defined!"
- **Key insight:** Define Groups must be completed before Add Series Item, otherwise Team A/B dropdowns are empty

### Step 3 — Add Series Item
- Opened Add Series Item dialog on "small bro" substage
- Filled form:
  - Name: `small bro`
  - Match Count: `1`
  - Team A: `spectatr ops`
  - Team B: `spec ops`
  - Column: `1`
  - Offset: `0`
- Submitted → Series Count updated to **1** on the substage card ✅

---

## Errors Encountered & Fixed

| Error | Cause | Fix |
|-------|-------|-----|
| Team A/B dropdowns empty | Define Groups not done first | Do Define Groups before Add Series Item |
| "No options" on team dropdown | API not triggered | Click "Open" then "Clear" to fire API fetch |
| Minimum 1 player required | spec ops had no players | Created 3 players for spec ops first |
| 422 from API on series submit | Column/Offset fields empty | Fill Column=1, Offset=0 before submitting |
| Click blocked by dropdown backdrop | MUI dropdown open | Press Escape first, then take fresh snapshot |
| Stale refs after Escape | UI re-renders assign new refs | Always snapshot after any modal/dropdown close |

---

## Navigation Paths

| Action | Path |
|--------|------|
| Create team | Sidebar → TEAMS → Create button |
| Create player | Sidebar → PLAYERS → Create button |
| Define groups | Sidebar → SUBSTAGES → "Define Groups" button on card |
| Add series/match | Sidebar → SUBSTAGES → "Add Series Item" button on card |

---

## Key Playwright Patterns Used

- `browser_snapshot` → get accessibility tree with refs
- `browser_click` → click by ref
- `browser_type` → fill text/number inputs
- `browser_press_key` with `Escape` → close dropdowns
- `browser_evaluate` → set React-controlled date inputs via JS

For full details on each pattern, see [SKILLS.md](./SKILLS.md).

---

## Important Notes

- Always take a fresh snapshot after Escape or dialog close — refs change
- The Ant Design combobox pattern (Open → Clear → select) is used consistently throughout the app
- Players must be linked to a team at creation time to appear in Define Groups
- Start Time field is optional in the series form
- **MUI option `.click()` from JS evaluate() is untrusted and ignored** — use Playwright `browser_click` (trusted CDP events) to select MUI listbox options
- **Define Groups players dropdown** requires trusted clicks — use `browser_click` on each `[role="option"]` element
- **In content.js extension context**, use ArrowDown+Enter keyboard navigation (trusted by MUI) instead of `.click()` on options
