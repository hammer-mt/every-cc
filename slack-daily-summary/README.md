# Slack Daily Summary

Automatische dagelijkse samenvatting van Slack-berichten. Haalt berichten op van de afgelopen 24 uur, categoriseert ze met AI, en genereert een overzichtelijk HTML dashboard.

## Wat doet het?

1. **Slack ophalen** — Leest berichten uit alle kanalen waar de bot lid is
2. **AI categoriseren** — Claude classificeert berichten als taken, beslissingen, vragen, mededelingen of FYI
3. **HTML genereren** — Maakt een mooi overzicht dat je in de browser opent
4. **Notion pushen** — Optioneel: slaat items op in je Notion database

## Quick Start

```bash
# 1. Installeer dependencies
npm install

# 2. Kopieer en vul de config in
cp .env.example .env
# Bewerk .env met je tokens (zie setup hieronder)

# 3. Genereer een samenvatting
npm run summary

# Of met mock data (geen API keys nodig)
npm run summary:dry
```

## Setup

### Slack App aanmaken

1. Ga naar **https://api.slack.com/apps** en klik **Create New App**
2. Kies **From scratch**, geef een naam (bijv. "Daily Summary") en selecteer je workspace
3. Ga naar **OAuth & Permissions** in de sidebar
4. Scroll naar **Bot Token Scopes** en voeg toe:
   - `channels:history` — Berichten lezen in publieke kanalen
   - `channels:read` — Kanaallijst ophalen
   - `groups:history` — Berichten lezen in privé kanalen
   - `groups:read` — Privé kanaallijst ophalen
   - `users:read` — Gebruikersnamen ophalen
5. Klik **Install to Workspace** bovenaan de pagina
6. Kopieer het **Bot User OAuth Token** (begint met `xoxb-`)
7. Plak dit in je `.env` als `SLACK_BOT_TOKEN`

**Belangrijk:** Nodig de bot uit in de kanalen die je wilt monitoren:
```
/invite @DailySummary
```

### Anthropic API (voor AI categorisatie)

1. Ga naar **https://console.anthropic.com/**
2. Maak een API key aan onder **API Keys**
3. Plak in `.env` als `ANTHROPIC_API_KEY`

> Zonder API key valt de tool terug op regelgebaseerde categorisatie (minder nauwkeurig maar functioneel).

### Notion (optioneel)

1. Ga naar **https://www.notion.so/my-integrations**
2. Klik **New integration**, geef een naam, en selecteer je workspace
3. Kopieer het **Internal Integration Secret**
4. Maak een database aan in Notion met een **Title** property
5. Klik op **...** → **Connections** → voeg je integratie toe
6. Kopieer het **Database ID** uit de URL:
   `https://notion.so/workspace/DATABASE_ID?v=...`
7. Vul `NOTION_API_KEY` en `NOTION_DATABASE_ID` in je `.env`

## Gebruik

```bash
# Standaard: afgelopen 24 uur, alle kanalen
node slack-daily-summary/generate-summary.js

# Dry-run met mock data (test zonder API calls)
node slack-daily-summary/generate-summary.js --dry-run

# Afgelopen 12 uur
node slack-daily-summary/generate-summary.js --hours 12

# Alleen specifieke kanalen
node slack-daily-summary/generate-summary.js --channels engineering,product

# Push ook naar Notion
node slack-daily-summary/generate-summary.js --notion

# Combineren
node slack-daily-summary/generate-summary.js --hours 8 --channels eng --notion
```

### npm scripts

```bash
npm run summary          # Standaard uitvoering
npm run summary:dry      # Dry-run met mock data
npm run summary:notion   # Met Notion push
```

## Output

Het gegenereerde HTML-bestand staat in `slack-daily-summary/output/` en heet `summary-YYYY-MM-DD.html`. Open het in je browser.

### Categorieen

| Categorie | Beschrijving |
|-----------|-------------|
| **Taken** | Actiepunten, verzoeken, toewijzingen |
| **Beslissingen** | Genomen of te nemen beslissingen |
| **Open Vragen** | Vragen die follow-up nodig hebben |
| **Mededelingen** | Belangrijke updates en nieuws |
| **Om te Onthouden** | Informatieve berichten om te bewaren |

## Dagelijks automatiseren

### macOS (launchd)

Maak `~/Library/LaunchAgents/com.slack-summary.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.slack-summary</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/pad/naar/every-cc/slack-daily-summary/generate-summary.js</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>18</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>WorkingDirectory</key>
    <string>/pad/naar/every-cc</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.slack-summary.plist
```

### Linux (cron)

```bash
crontab -e
# Voeg toe (elke dag om 18:00):
0 18 * * * cd /pad/naar/every-cc && /usr/bin/node slack-daily-summary/generate-summary.js
```
