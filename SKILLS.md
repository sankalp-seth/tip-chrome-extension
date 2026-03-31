# Playwright Automation Skills — TIP Control Center

## 1. Ant Design Combobox — "No Options" Pattern
When an Ant Design combobox shows "No options" after clicking "Open", the API has not been triggered yet.
**Fix:** Click "Open" → then click "Clear" → this fires the API fetch and populates the list.
Applies to: Team dropdowns, Country, Nationality — any async-loaded combobox in this app.

## 2. MUI Multi-Select Players Dropdown
Players dropdowns use a MUI listbox that stays open after each selection, allowing multi-select.
**Pattern:**
1. Click the combobox to expand the listbox
2. Click each option one by one (no modifier key needed)
3. Press `Escape` to close after all selections are done

## 3. Define Groups Must Come Before Add Series Item
The Team A / Team B dropdowns in "Add Series Item" are only populated after groups are defined.
**Workflow order:**
1. Click "Define Groups" on the substage
2. Add teams + players, submit
3. Then click "Add Series Item" — Team A/B will now show options

## 4. Escape Key to Close Dropdowns
After selecting options in a MUI dropdown, or when a backdrop is blocking a click:
- Press `Escape` to close the dropdown
- Always take a fresh snapshot after pressing Escape — refs get reassigned

## 5. React Controlled Date Input (DOB field)
Hidden `input[type="date"]` fields are React-controlled and ignore `.fill()`.
**Fix via `browser_evaluate`:**
```js
const inputs = document.querySelectorAll('input[type="date"]');
inputs.forEach(i => {
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, '1995-01-01');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('change', { bubbles: true }));
});
```

## 6. Series Form — Required Fields
The Add Series Item form requires:
- Name (text)
- Match Count (number)
- Team A (combobox — from Define Groups)
- Team B (combobox — from Define Groups)
- Column (number) — must be filled or API returns 422
- Offset (number) — must be filled or API returns 422
Start Time and Part are optional.

## 7. Snapshot Refs Change After UI Events
After clicking buttons that open/close dialogs, or pressing Escape:
- Old refs become stale
- Always call `browser_snapshot` again before using any new ref
- The `[active]` attribute marks the currently focused element

## 8. TIP Control Center Entity Hierarchy
```
Tournament → Stage → Substage → Series (match)
                              ↑
                        Define Groups (teams + players)
                        must be done first
```
Teams and Players are independent entities created in the TEAMS and PLAYERS sections.

## 9. Team / Player Creation Flow
**Team:** TEAMS → Create → Name + Abbreviation → Submit
**Player:** PLAYERS → Create → Name + DOB (use JS evaluate) + Team assignment → Submit
Players must be assigned to a team before they appear in Define Groups dropdowns.

## 10. 422 Error Diagnosis
A 422 from the API means a required field is missing or invalid.
Check: Column and Offset spinbuttons in the series form (they default to empty, not 0).
Fix: Type `1` for Column and `0` for Offset before submitting.
