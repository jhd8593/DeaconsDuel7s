# Deacons Duel 7s Tournament Website

A React frontend with Express backend that displays Deacons Duel 7s tournament information fetched from Google Sheets.

## Features

- **Tournament Overview**: Key stats and tournament format information
- **Schedule**: Complete match schedule with phases and timings
- **Bracket**: Interactive championship bracket with score inputs
- **Teams**: Team registration and pool assignments
- **Real-time Data**: All data is fetched from Google Sheets API

## Setup Instructions

### 1. Google Sheets API Setup

1. **Create a Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one

2. **Enable Google Sheets API**
   - In the Google Cloud Console, go to "APIs & Services" > "Library"
   - Search for "Google Sheets API" and enable it

3. **Create Service Account**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Give it a name (e.g., "tournament-api")
   - Grant it the "Editor" role (or create a custom role with Sheets read-only access)

4. **Generate Service Account Key**
   - After creating the service account, click on it
   - Go to "Keys" tab > "Add Key" > "Create new key"
   - Choose JSON format
   - Download the JSON file

5. **Share Google Sheet with Service Account**
   - Open your Google Sheet
   - Click "Share" button
   - Add the service account email (found in the JSON file as `client_email`)
   - Give it "Viewer" or "Editor" access

### 2. Environment Configuration

1. **Copy environment template**
   ```bash
   cp .env.example .env
   ```

2. **Fill in your credentials**
   - `GOOGLE_CLIENT_EMAIL`: From the service account JSON file
   - `GOOGLE_PRIVATE_KEY`: From the service account JSON file (keep the quotes and \n formatting)
   - `GOOGLE_CLIENT_ID`: From the service account JSON file
   - `SPREADSHEET_ID`: Extract from your Google Sheets URL (the long string between `/d/` and `/edit`)

### 3. Google Sheets Structure

Your Google Sheet should have the following tabs/sheets:

- **Overview**: Contains tournament stats (Total Matches, Pool Play, etc.)
- **Schedule**: Match schedule data
- **Teams**: Team names organized by pools
- **Bracket**: Bracket matchups and scores

Example Overview sheet structure:
```
A1: Total Matches    B1: 31
A2: Pool Play       B2: 18
A3: Championship    B3: 7
A4: Estimated Finish B4: 3:30 PM
```

### 4. Installation & Running

1. **Install dependencies**
   ```bash
   npm run install:all
   ```

2. **Start development servers**
   ```bash
   npm run dev
   ```
   This will start both the backend (port 3001) and frontend (port 3000)

3. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001/api/health

### 5. Production Deployment

1. **Build the frontend**
   ```bash
   npm run build
   ```

2. **Start production server**
   ```bash
   npm start
   ```

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/tournament/overview` - Tournament overview stats
- `GET /api/tournament/schedule` - Match schedule
- `GET /api/tournament/teams` - Team information
- `GET /api/tournament/bracket` - Bracket data

## Google Sheets Data Format

The application expects your Google Sheets to be structured as follows:

### Overview Sheet
- Column A: Stat names (e.g., "Total Matches", "Pool Play")
- Column B: Stat values

### Schedule Sheet
- Contains match schedule data organized by phases
- The API will parse different sections for pool play, quarterfinals, semifinals, etc.

### Teams Sheet
- Organized by divisions (Elite/Development) and pools (A, B, C, D)
- Team names listed under their respective pools

### Bracket Sheet
- Matchups and scores for championship bracket
- Consolation matches for both elite and development divisions

## Troubleshooting

### Common Issues

1. **"Failed to fetch tournament data"**
   - Check your `.env` file credentials
   - Ensure the service account has access to the Google Sheet
   - Verify the SPREADSHEET_ID is correct

2. **Google Sheets API errors**
   - Make sure Google Sheets API is enabled in Google Cloud Console
   - Check that your service account credentials are valid
   - Ensure the sheet is shared with the service account email

3. **CORS errors**
   - The backend includes CORS headers for localhost development
   - For production, configure your hosting platform's CORS settings

### Development

- Backend runs on port 3001
- Frontend runs on port 3000 (proxied to backend)
- Hot reloading enabled for both servers

## Technologies Used

- **Frontend**: React, Tailwind CSS, Lucide Icons
- **Backend**: Node.js, Express, Google APIs
- **Styling**: Tailwind CSS for responsive design
- **API**: Google Sheets API for data management
