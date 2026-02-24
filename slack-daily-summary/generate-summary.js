#!/usr/bin/env node

/**
 * Slack Daily Summary Generator
 *
 * Haalt Slack-berichten op van de afgelopen 24 uur, categoriseert ze met AI,
 * en genereert een Apple-stijl HTML dashboard.
 *
 * Gebruik:
 *   node generate-summary.js                  # Standaard: 24 uur, alle kanalen
 *   node generate-summary.js --dry-run        # Mock data, geen API calls
 *   node generate-summary.js --hours 12       # Afgelopen 12 uur
 *   node generate-summary.js --channels eng,product  # Specifieke kanalen
 *   node generate-summary.js --notion         # Push ook naar Notion
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { SlackClient } = require('./lib/slack-client');
const { Categorizer } = require('./lib/categorizer');
const { NotionClient } = require('./lib/notion-client');
const htmlRenderer = require('./lib/html-renderer');

function parseArgs(argv) {
  const args = {
    dryRun: false,
    hours: parseInt(process.env.HOURS_BACK, 10) || 24,
    channels: process.env.SLACK_CHANNELS ? process.env.SLACK_CHANNELS.split(',').map((s) => s.trim()).filter(Boolean) : null,
    notion: false,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--hours':
        args.hours = parseInt(argv[++i], 10);
        break;
      case '--channels':
        args.channels = argv[++i].split(',').map((s) => s.trim());
        break;
      case '--notion':
        args.notion = true;
        break;
      case '--help':
        console.log(`
Slack Daily Summary Generator

Gebruik:
  node generate-summary.js [opties]

Opties:
  --dry-run              Gebruik mock data (geen API calls)
  --hours <n>            Uren terug kijken (standaard: 24)
  --channels <a,b,c>     Alleen deze kanalen ophalen
  --notion               Push samenvatting naar Notion
  --help                 Toon dit bericht
`);
        process.exit(0);
    }
  }

  return args;
}

function getMockData() {
  const mockPath = path.join(__dirname, 'test-data', 'mock-messages.json');
  if (fs.existsSync(mockPath)) {
    return JSON.parse(fs.readFileSync(mockPath, 'utf-8'));
  }

  // Built-in mock data
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      channel: { id: 'C001', name: 'engineering' },
      messages: [
        {
          id: `${now - 3600}`,
          user: { id: 'U001', name: 'janedoe', displayName: 'Jane' },
          text: 'Kun je de v2.1 hotfix deployen naar productie vandaag? Het is dringend.',
          timestamp: `${now - 3600}`,
          threadReplies: [
            { user: { id: 'U002', name: 'bob', displayName: 'Bob' }, text: 'Ik pak het op, wordt voor 15:00.', timestamp: `${now - 3400}` },
          ],
          reactions: [{ name: 'eyes', count: 2 }],
        },
        {
          id: `${now - 7200}`,
          user: { id: 'U003', name: 'alice', displayName: 'Alice' },
          text: 'We hebben besloten om over te stappen naar PostgreSQL voor de nieuwe service. Migration plan volgt volgende week.',
          timestamp: `${now - 7200}`,
          threadReplies: [],
          reactions: [{ name: '+1', count: 5 }],
        },
        {
          id: `${now - 5400}`,
          user: { id: 'U002', name: 'bob', displayName: 'Bob' },
          text: 'Heads up: de API rate limits worden per 1 maart aangepast. Zie docs voor details.',
          timestamp: `${now - 5400}`,
          threadReplies: [],
          reactions: [],
        },
        {
          id: `${now - 4800}`,
          user: { id: 'U004', name: 'charlie', displayName: 'Charlie' },
          text: 'Weet iemand of we al een staging environment hebben voor de nieuwe microservice?',
          timestamp: `${now - 4800}`,
          threadReplies: [
            { user: { id: 'U001', name: 'janedoe', displayName: 'Jane' }, text: 'Nog niet, staat op de roadmap voor Q2.', timestamp: `${now - 4600}` },
          ],
          reactions: [],
        },
      ],
    },
    {
      channel: { id: 'C002', name: 'product' },
      messages: [
        {
          id: `${now - 6000}`,
          user: { id: 'U005', name: 'diana', displayName: 'Diana' },
          text: '@anna Kun je de client presentatie voorbereiden voor vrijdag? Graag de nieuwe features meenemen.',
          timestamp: `${now - 6000}`,
          threadReplies: [],
          reactions: [],
        },
        {
          id: `${now - 2400}`,
          user: { id: 'U006', name: 'erik', displayName: 'Erik' },
          text: 'NPS score van deze maand is 72, een stijging van 8 punten. Goed bezig team!',
          timestamp: `${now - 2400}`,
          threadReplies: [],
          reactions: [{ name: 'tada', count: 8 }, { name: 'rocket', count: 3 }],
        },
      ],
    },
    {
      channel: { id: 'C003', name: 'general' },
      messages: [
        {
          id: `${now - 1800}`,
          user: { id: 'U007', name: 'frank', displayName: 'Frank' },
          text: 'Nieuwe collega Lisa begint maandag! Ze gaat bij het design team zitten. Welkom!',
          timestamp: `${now - 1800}`,
          threadReplies: [],
          reactions: [{ name: 'wave', count: 12 }],
        },
        {
          id: `${now - 900}`,
          user: { id: 'U001', name: 'janedoe', displayName: 'Jane' },
          text: 'Todo voor iedereen: vul je OKRs in voor Q2. Deadline is aanstaande vrijdag.',
          timestamp: `${now - 900}`,
          threadReplies: [],
          reactions: [],
        },
      ],
    },
  ];
}

async function main() {
  const args = parseArgs(process.argv);
  const startTime = Date.now();

  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║     Slack Daily Summary Generator     ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  // Step 1: Fetch messages
  let channelMessages;

  if (args.dryRun) {
    console.log('⚡ Dry-run modus: mock data wordt gebruikt');
    console.log('');
    channelMessages = getMockData();
  } else {
    if (!process.env.SLACK_BOT_TOKEN) {
      console.error('❌ SLACK_BOT_TOKEN niet gevonden. Kopieer .env.example naar .env en vul je token in.');
      process.exit(1);
    }

    console.log(`📡 Slack berichten ophalen (afgelopen ${args.hours} uur)...`);
    const slack = new SlackClient(process.env.SLACK_BOT_TOKEN);
    channelMessages = await slack.fetchRecentMessages(args.hours, args.channels);
  }

  const totalMessages = channelMessages.reduce((sum, c) => sum + c.messages.length, 0);
  console.log(`  ✓ ${totalMessages} berichten uit ${channelMessages.length} kanalen`);
  console.log('');

  if (totalMessages === 0) {
    console.log('ℹ️  Geen berichten gevonden in de opgegeven periode.');
    console.log('');
    // Still generate the HTML with empty state
  }

  // Step 2: Categorize
  console.log('🧠 Berichten categoriseren...');
  const categorizer = new Categorizer(args.dryRun ? null : process.env.ANTHROPIC_API_KEY);
  const categorized = await categorizer.categorize(channelMessages);

  console.log(`  ✓ ${categorized.items.length} items gecategoriseerd`);
  console.log(`    Taken: ${categorized.stats.actionItems}, Beslissingen: ${categorized.stats.decisions}, Vragen: ${categorized.stats.questions}`);
  console.log('');

  // Step 3: Generate HTML
  console.log('🎨 HTML samenvatting genereren...');
  const html = htmlRenderer.render(categorized);

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const today = new Date().toISOString().split('T')[0];
  const outputPath = path.join(outputDir, `summary-${today}.html`);
  fs.writeFileSync(outputPath, html, 'utf-8');

  console.log(`  ✓ Opgeslagen: ${outputPath}`);
  console.log('');

  // Step 4: Notion (optional)
  if (args.notion) {
    if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
      console.warn('⚠️  Notion overgeslagen: NOTION_API_KEY of NOTION_DATABASE_ID ontbreekt in .env');
    } else {
      console.log('📝 Pushen naar Notion...');
      try {
        const notion = new NotionClient(process.env.NOTION_API_KEY, process.env.NOTION_DATABASE_ID);
        const notionUrl = await notion.pushDailySummary(categorized);
        console.log(`  ✓ Notion pagina: ${notionUrl}`);
      } catch (err) {
        console.error(`  ❌ Notion fout: ${err.message}`);
      }
      console.log('');
    }
  }

  // Done
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Klaar in ${elapsed}s`);
  console.log(`   Open ${outputPath} in je browser om het overzicht te bekijken.`);
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('❌ Onverwachte fout:', err.message);
  console.error('');
  if (err.data?.error) {
    console.error('Slack API fout:', err.data.error);
  }
  process.exit(1);
});
