const Anthropic = require('@anthropic-ai/sdk');

const CATEGORIES = {
  ACTION_ITEM: { label: 'Taken', color: '#007AFF', icon: 'checkmark.circle' },
  DECISION: { label: 'Beslissingen', color: '#34C759', icon: 'checkmark.seal' },
  ANNOUNCEMENT: { label: 'Mededelingen', color: '#AF52DE', icon: 'megaphone' },
  QUESTION: { label: 'Open Vragen', color: '#FF9500', icon: 'questionmark.circle' },
  FYI: { label: 'Om te Onthouden', color: '#8E8E93', icon: 'bookmark' },
};

const SYSTEM_PROMPT = `Je bent een assistent die Slack-berichten analyseert en categoriseert.
Je ontvangt berichten uit Slack-kanalen en moet elk bericht categoriseren.

Categorieën:
- ACTION_ITEM: Een taak, verzoek, opdracht, of iets dat iemand moet doen. Bevat vaak woorden als "graag", "kun je", "moet", "todo", "deadline", of directe verzoeken.
- DECISION: Een beslissing die genomen is of genomen moet worden. Bevat vaak woorden als "besloten", "we gaan", "goedgekeurd", "akkoord".
- ANNOUNCEMENT: Een belangrijke mededeling, nieuws, of update voor het team.
- QUESTION: Een open vraag die nog beantwoord moet worden of follow-up nodig heeft.
- FYI: Informatief bericht dat de moeite waard is om te onthouden, maar geen directe actie vereist.

Voor elk bericht, geef:
- category: een van de bovenstaande categorieën
- summary: een beknopte samenvatting in 1 zin (Nederlands)
- priority: "high", "medium", of "low"
- assignee: als er iemand specifiek wordt aangesproken of een taak krijgt (anders null)
- deadline: als er een deadline wordt genoemd (anders null)

Reageer UITSLUITEND met valide JSON. Geen toelichting, geen markdown.`;

class Categorizer {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async categorize(channelMessages) {
    const allItems = [];

    for (const { channel, messages } of channelMessages) {
      if (messages.length === 0) continue;

      const batch = messages.map((msg) => ({
        id: msg.id,
        channel: channel.name,
        user: msg.user?.displayName || 'Onbekend',
        text: msg.text,
        thread: msg.threadReplies.length > 0
          ? msg.threadReplies.map((r) => `${r.user?.displayName || '?'}: ${r.text}`).join('\n')
          : null,
        reactions: msg.reactions.length > 0
          ? msg.reactions.map((r) => `${r.name} (${r.count})`).join(', ')
          : null,
      }));

      const categorized = this.client
        ? await this._categorizeWithAI(batch)
        : this._categorizeWithRules(batch);

      for (const item of categorized) {
        const originalMsg = messages.find((m) => m.id === item.id);
        allItems.push({
          ...item,
          channel,
          originalMessage: originalMsg,
          timestamp: originalMsg?.timestamp,
        });
      }
    }

    // Sort: high priority first, then by category importance
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const categoryOrder = { ACTION_ITEM: 0, DECISION: 1, QUESTION: 2, ANNOUNCEMENT: 3, FYI: 4 };
    allItems.sort((a, b) => {
      const pDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      if (pDiff !== 0) return pDiff;
      return (categoryOrder[a.category] ?? 4) - (categoryOrder[b.category] ?? 4);
    });

    return {
      items: allItems,
      stats: this._computeStats(channelMessages, allItems),
      categories: CATEGORIES,
    };
  }

  async _categorizeWithAI(batch) {
    // Process in chunks of 25 messages
    const chunkSize = 25;
    const results = [];

    for (let i = 0; i < batch.length; i += chunkSize) {
      const chunk = batch.slice(i, i + chunkSize);

      const userPrompt = `Categoriseer de volgende ${chunk.length} Slack-berichten.

Berichten:
${JSON.stringify(chunk, null, 2)}

Reageer met een JSON array van objecten met deze velden: id, category, summary, priority, assignee, deadline.
Retourneer ALLEEN de JSON array, geen andere tekst.`;

      try {
        const response = await this.client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [
            { role: 'user', content: userPrompt },
          ],
          system: SYSTEM_PROMPT,
        });

        const text = response.content[0].text.trim();
        // Extract JSON array from response
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          results.push(...parsed);
        }
      } catch (err) {
        console.warn(`  AI categorisatie mislukt voor batch, fallback naar regels: ${err.message}`);
        results.push(...this._categorizeWithRules(chunk));
      }
    }

    return results;
  }

  _categorizeWithRules(batch) {
    const actionWords = /\b(todo|task|actie|graag|kun je|moet|deadline|voor\s+\w+dag|dringend|asap|urgent)\b/i;
    const decisionWords = /\b(besloten|besluit|akkoord|goedgekeurd|we gaan|approved|decided)\b/i;
    const questionWords = /\?\s*$|\b(vraag|question|weet iemand|heeft iemand|wie kan)\b/i;
    const announcementWords = /\b(heads up|fyi|mededeling|announcement|update|nieuws|let op)\b/i;

    return batch.map((msg) => {
      const text = `${msg.text} ${msg.thread || ''}`;
      let category = 'FYI';
      let priority = 'low';

      if (actionWords.test(text)) {
        category = 'ACTION_ITEM';
        priority = /\b(dringend|asap|urgent)\b/i.test(text) ? 'high' : 'medium';
      } else if (decisionWords.test(text)) {
        category = 'DECISION';
        priority = 'medium';
      } else if (questionWords.test(text)) {
        category = 'QUESTION';
        priority = 'medium';
      } else if (announcementWords.test(text)) {
        category = 'ANNOUNCEMENT';
        priority = 'low';
      }

      // Extract potential assignee from @mentions
      const mentionMatch = text.match(/<@(\w+)>/);

      return {
        id: msg.id,
        category,
        summary: msg.text.length > 100 ? msg.text.substring(0, 97) + '...' : msg.text,
        priority,
        assignee: mentionMatch ? mentionMatch[1] : null,
        deadline: null,
      };
    });
  }

  _computeStats(channelMessages, categorizedItems) {
    let totalMessages = 0;
    let totalThreads = 0;

    for (const { messages } of channelMessages) {
      totalMessages += messages.length;
      totalThreads += messages.filter((m) => m.threadReplies.length > 0).length;
    }

    const categoryCounts = {};
    for (const item of categorizedItems) {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    }

    return {
      totalMessages,
      totalChannels: channelMessages.filter((c) => c.messages.length > 0).length,
      totalThreads,
      actionItems: categoryCounts.ACTION_ITEM || 0,
      decisions: categoryCounts.DECISION || 0,
      questions: categoryCounts.QUESTION || 0,
      announcements: categoryCounts.ANNOUNCEMENT || 0,
      fyi: categoryCounts.FYI || 0,
    };
  }
}

module.exports = { Categorizer, CATEGORIES };
