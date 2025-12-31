# 🔧 Setup Instructions - Google Sheets Permissions

## ⚠️ CRITICAL: Share Your Google Sheet

Your server is authenticated correctly, but it **doesn't have permission** to access your Google Sheet. You need to share it with the service account.

### Steps to Fix:

1. **Open your Google Sheet:**
   - Go to: https://docs.google.com/spreadsheets/d/1EzqQXzMCO06oBlQmfc0oqunIA8x4_VLSQB-Rs_wQtng/edit

2. **Click the "Share" button** (top right corner)

3. **Add the service account email:**
   ```
   tournament-api@scenic-sorter-482903-f0.iam.gserviceaccount.com
   ```

4. **Set permission level:**
   - Choose "Viewer" (read-only access)
   - Or "Editor" if you want the API to write data in the future

5. **Uncheck "Notify people"** (the service account doesn't need an email notification)

6. **Click "Share" or "Done"**

7. **Restart your server** (if it's still running)

---

## ✅ Testing the Connection

After sharing the sheet, test if it works:

1. Visit: `http://localhost:3001/api/health`
   - Should return: `{"ok":true,"time":"..."}`

2. Visit: `http://localhost:3001/api/tournament/teams`
   - Should return your teams data

3. Open your React app at `http://localhost:3000`
   - Should now load tournament data

---

## 📋 Current Configuration

**Service Account Email:**
```
tournament-api@scenic-sorter-482903-f0.iam.gserviceaccount.com
```

**Spreadsheet ID:**
```
1EzqQXzMCO06oBlQmfc0oqunIA8x4_VLSQB-Rs_wQtng
```

**Google Sheet URL:**
```
https://docs.google.com/spreadsheets/d/1EzqQXzMCO06oBlQmfc0oqunIA8x4_VLSQB-Rs_wQtng/edit
```

---

## 🔍 Troubleshooting

### Still getting 403 errors?

1. **Check the email is correct:**
   - Make sure you copied: `tournament-api@scenic-sorter-482903-f0.iam.gserviceaccount.com`
   - It should appear in the "Share" dialog with "Can view" or "Can edit"

2. **Wait a moment:**
   - Sometimes permissions take a few seconds to propagate
   - Restart your server after sharing

3. **Check the spreadsheet ID:**
   - Verify the SPREADSHEET_ID in `.env` matches your actual sheet
   - Current ID: `1EzqQXzMCO06oBlQmfc0oqunIA8x4_VLSQB-Rs_wQtng`

4. **Verify sheet names:**
   - Your sheet must have tabs named: Teams, Schedule, Standings, Bracket, Overview
   - Names are case-sensitive!

---

## 🎯 Quick Checklist

- [ ] Opened Google Sheet
- [ ] Clicked "Share" button
- [ ] Added service account email
- [ ] Set permission to "Viewer" or "Editor"
- [ ] Unchecked "Notify people"
- [ ] Clicked "Share"
- [ ] Restarted server
- [ ] Tested API endpoints
- [ ] Refreshed React app

---

## 📝 What's Happening Behind the Scenes

Your application uses a **service account** (like a robot user) to access Google Sheets on behalf of your app. For security, Google requires explicit permission - just like you would share a document with a colleague.

The service account email acts as a regular Google account, but it's controlled programmatically by your application through the credentials in your `.env` file.

---

*After completing these steps, your tournament site should successfully load data from Google Sheets!*
