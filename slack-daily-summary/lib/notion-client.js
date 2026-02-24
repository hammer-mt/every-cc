const { Client } = require('@notionhq/client');

class NotionClient {
  constructor(apiKey, databaseId) {
    if (!apiKey || !databaseId) {
      throw new Error(
        'NOTION_API_KEY en NOTION_DATABASE_ID zijn vereist. Zie .env.example voor setup.'
      );
    }
    this.client = new Client({ auth: apiKey });
    this.databaseId = databaseId;
  }

  async pushDailySummary(categorizedData) {
    const { items, stats } = categorizedData;
    const today = new Date().toISOString().split('T')[0];

    const children = [];

    // Header
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: `Overzicht - ${this._formatDate(today)}` } }],
      },
    });

    // Stats callout
    children.push({
      object: 'block',
      type: 'callout',
      callout: {
        icon: { type: 'emoji', emoji: '📊' },
        rich_text: [
          {
            type: 'text',
            text: {
              content: `${stats.totalMessages} berichten | ${stats.totalChannels} kanalen | ${stats.actionItems} taken | ${stats.decisions} beslissingen`,
            },
          },
        ],
      },
    });

    children.push({ object: 'block', type: 'divider', divider: {} });

    // Group items by category
    const grouped = this._groupByCategory(items);

    const categoryEmojis = {
      ACTION_ITEM: '✅',
      DECISION: '🟢',
      ANNOUNCEMENT: '📢',
      QUESTION: '❓',
      FYI: '📌',
    };

    const categoryLabels = {
      ACTION_ITEM: 'Taken',
      DECISION: 'Beslissingen',
      ANNOUNCEMENT: 'Mededelingen',
      QUESTION: 'Open Vragen',
      FYI: 'Om te Onthouden',
    };

    for (const [category, categoryItems] of Object.entries(grouped)) {
      children.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: `${categoryEmojis[category] || ''} ${categoryLabels[category] || category}`,
              },
            },
          ],
        },
      });

      for (const item of categoryItems) {
        if (category === 'ACTION_ITEM') {
          children.push({
            object: 'block',
            type: 'to_do',
            to_do: {
              checked: false,
              rich_text: this._buildRichText(item),
            },
          });
        } else {
          children.push({
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: this._buildRichText(item),
            },
          });
        }
      }

      children.push({ object: 'block', type: 'divider', divider: {} });
    }

    // Create the page
    const page = await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties: {
        title: {
          title: [
            {
              text: { content: `Daily Summary - ${this._formatDate(today)}` },
            },
          ],
        },
      },
      children: children.slice(0, 100), // Notion API limit
    });

    return page.url;
  }

  async pushSingleItem(item) {
    const today = new Date().toISOString().split('T')[0];

    const page = await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties: {
        title: {
          title: [{ text: { content: item.summary } }],
        },
      },
      children: [
        {
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: `Categorie: ${item.category}\nKanaal: #${item.channel?.name || '?'}\nPrioriteit: ${item.priority}\nDatum: ${today}`,
                },
              },
            ],
          },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: item.originalMessage?.text || item.summary },
              },
            ],
          },
        },
      ],
    });

    return page.url;
  }

  _buildRichText(item) {
    const parts = [];

    parts.push({
      type: 'text',
      text: { content: item.summary },
      annotations: { bold: item.priority === 'high' },
    });

    const meta = [];
    if (item.assignee) meta.push(`@${item.assignee}`);
    if (item.channel?.name) meta.push(`#${item.channel.name}`);
    if (item.deadline) meta.push(`📅 ${item.deadline}`);

    if (meta.length > 0) {
      parts.push({
        type: 'text',
        text: { content: `  —  ${meta.join('  ')}` },
        annotations: { color: 'gray' },
      });
    }

    return parts;
  }

  _groupByCategory(items) {
    const order = ['ACTION_ITEM', 'DECISION', 'QUESTION', 'ANNOUNCEMENT', 'FYI'];
    const grouped = {};

    for (const cat of order) {
      const catItems = items.filter((i) => i.category === cat);
      if (catItems.length > 0) {
        grouped[cat] = catItems;
      }
    }

    return grouped;
  }

  _formatDate(isoDate) {
    const [year, month, day] = isoDate.split('-');
    const months = [
      'januari', 'februari', 'maart', 'april', 'mei', 'juni',
      'juli', 'augustus', 'september', 'oktober', 'november', 'december',
    ];
    return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`;
  }
}

module.exports = { NotionClient };
