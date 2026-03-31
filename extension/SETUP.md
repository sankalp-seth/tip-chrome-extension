# TIP Automator — Setup Guide

## Step 1: Download SheetJS (xlsx library)

The extension needs SheetJS to parse Excel files.

1. Go to: https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.min.js
2. Save the file as: `extension/lib/xlsx.min.js`

(Right-click the page → Save As → save inside the `lib/` folder)

## Step 2: Load the Extension in Chrome

1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `C:\matchforge\extension` folder
5. The TIP Automator icon appears in your toolbar

## Step 3: Prepare Your Excel File

Use this column structure (one row per player):

| tournament | stage | substage | format | team | abbreviation | player | dob | series_name | match_count |
|---|---|---|---|---|---|---|---|---|---|
| IPL 2025 | Group Stage | Week 1 | ONE_V_ONE | Mumbai Indians | MI | Rohit Sharma | 1987-04-30 | MI vs CSK | 1 |
| IPL 2025 | Group Stage | Week 1 | ONE_V_ONE | Mumbai Indians | MI | Jasprit Bumrah | 1993-12-06 | MI vs CSK | 1 |
| IPL 2025 | Group Stage | Week 1 | ONE_V_ONE | CSK | CSK | MS Dhoni | 1981-07-07 | MI vs CSK | 1 |

Download the blank template: `template.xlsx` (in this folder)

## Step 4: Run

1. Open TIP Control Center in Chrome
2. Click the TIP Automator extension icon
3. Upload your Excel file
4. Click **Start Automation**
5. Watch the progress log
6. When done, click **Export IDs** to download all created entity IDs

## Excel Column Reference

| Column | Required | Description | Example |
|--------|----------|-------------|---------|
| tournament | ✅ | Tournament name | IPL 2025 |
| stage | ✅ | Stage name | Group Stage |
| substage | ✅ | Substage name | Week 1 |
| format | ❌ | Match format (default: ONE_V_ONE) | ONE_V_ONE |
| team | ✅ | Team name | Mumbai Indians |
| abbreviation | ❌ | Team short name (default: first 3 chars) | MI |
| player | ✅ | Player name | Rohit Sharma |
| dob | ❌ | Date of birth YYYY-MM-DD (default: 1995-01-01) | 1987-04-30 |
| series_name | ❌ | Match/series name (default: substage name) | MI vs CSK |
| match_count | ❌ | Number of matches (default: 1) | 1 |

## Troubleshooting

- **Extension not finding elements**: The TIP UI may have updated. Check the browser console for `[TIP Automator]` logs.
- **Team dropdown shows No options**: Already handled automatically by the extension (Open → Clear → select).
- **Player not found in Define Groups**: Make sure player was created successfully in Step 3 before Define Groups runs.
- **422 error on series**: Column and Offset fields are auto-filled as 1 and 0.

## File Structure

```
extension/
├── manifest.json      Chrome extension config
├── popup.html         Upload UI
├── popup.css          Styles
├── popup.js           Excel parser + UI logic
├── content.js         Automation engine (runs inside TIP)
├── background.js      Service worker
├── lib/
│   └── xlsx.min.js    SheetJS (you download this)
└── SETUP.md           This file
```
