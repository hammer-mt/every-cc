const fs = require('fs');
const path = require('path');

const CATEGORY_COLORS = {
  ACTION_ITEM: '#007AFF',
  DECISION: '#34C759',
  ANNOUNCEMENT: '#AF52DE',
  QUESTION: '#FF9500',
  FYI: '#8E8E93',
};

const CATEGORY_LABELS = {
  ACTION_ITEM: 'Taken',
  DECISION: 'Beslissingen',
  ANNOUNCEMENT: 'Mededelingen',
  QUESTION: 'Open Vragen',
  FYI: 'Om te Onthouden',
};

const STAT_STYLES = {
  messages: { color: '', css: '' },
  channels: { color: '', css: '' },
  actionItems: { color: 'accent', css: 'accent' },
  decisions: { color: 'green', css: 'green' },
  questions: { color: 'amber', css: 'amber' },
};

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTimestamp(ts) {
  const date = new Date(parseFloat(ts) * 1000);
  return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function renderStats(stats) {
  const items = [
    { value: stats.totalMessages, label: 'Berichten', css: '' },
    { value: stats.totalChannels, label: 'Kanalen', css: '' },
    { value: stats.actionItems, label: 'Taken', css: 'accent' },
    { value: stats.decisions, label: 'Beslissingen', css: 'green' },
  ];

  return items
    .map(
      (s) => `
      <div class="stat-card ${s.css}">
        <div class="stat-value">${s.value}</div>
        <div class="stat-label">${escapeHtml(s.label)}</div>
      </div>`
    )
    .join('\n');
}

function renderItem(item, category) {
  const isAction = category === 'ACTION_ITEM';
  const color = CATEGORY_COLORS[category] || '#8E8E93';

  // Left indicator
  const leftEl = isAction
    ? `<div class="item-check" role="checkbox" aria-checked="false" tabindex="0"></div>`
    : `<div class="item-dot" style="background:${color}"></div>`;

  // Summary
  const summaryClass = item.priority === 'high' ? 'item-summary high' : 'item-summary';
  const summaryText = escapeHtml(item.summary);

  // Meta tags
  const metaParts = [];

  if (item.channel?.name) {
    metaParts.push(`<span class="item-tag item-tag-channel">#${escapeHtml(item.channel.name)}</span>`);
  }
  if (item.assignee) {
    metaParts.push(`<span class="item-tag item-tag-assignee">@${escapeHtml(item.assignee)}</span>`);
  }
  if (item.deadline) {
    metaParts.push(`<span class="item-tag item-tag-deadline">${escapeHtml(item.deadline)}</span>`);
  }
  if (item.priority === 'high') {
    metaParts.push(`<span class="item-tag item-tag-priority priority-high">Hoog</span>`);
  } else if (item.priority === 'medium') {
    metaParts.push(`<span class="item-tag item-tag-priority priority-medium">Medium</span>`);
  }
  if (item.timestamp) {
    metaParts.push(`<span class="item-tag">${formatTimestamp(item.timestamp)}</span>`);
  }

  const metaHtml = metaParts.length > 0 ? `<div class="item-meta">${metaParts.join('')}</div>` : '';

  // Thread preview
  let threadHtml = '';
  const replies = item.originalMessage?.threadReplies || [];
  if (replies.length > 0) {
    const firstReply = replies[0];
    const replyText = escapeHtml(
      firstReply.text?.length > 120 ? firstReply.text.substring(0, 117) + '...' : firstReply.text
    );
    const replyUser = escapeHtml(firstReply.user?.displayName || '?');

    let repliesHtml = '';
    if (replies.length > 1) {
      repliesHtml = `<div class="thread-replies">` +
        replies.slice(1).map((r) => {
          const rText = escapeHtml(
            r.text?.length > 120 ? r.text.substring(0, 117) + '...' : r.text
          );
          const rUser = escapeHtml(r.user?.displayName || '?');
          return `<div class="thread-reply"><span class="thread-reply-user">${rUser}:</span> ${rText}</div>`;
        }).join('') +
        `</div>`;
    }

    threadHtml = `
      <div class="item-thread">
        <div class="thread-reply"><span class="thread-reply-user">${replyUser}:</span> ${replyText}</div>
        ${replies.length > 1 ? `<button class="item-thread-toggle" data-label="${replies.length - 1} meer reacties">${replies.length - 1} meer reacties</button>` : ''}
        ${repliesHtml}
      </div>`;
  }

  // Notion button
  const notionSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 14v6"/><path d="M14 17h6"/></svg>`;
  const notionBtn = `<div class="item-actions"><button class="btn-notion" data-id="${escapeHtml(item.id || item.timestamp)}" title="Opslaan in Notion">${notionSvg} Notion</button></div>`;

  return `
    <div class="item">
      ${leftEl}
      <div class="item-content">
        <div class="${summaryClass}">${summaryText}</div>
        ${metaHtml}
        ${threadHtml}
      </div>
      ${notionBtn}
    </div>`;
}

function renderSection(category, items) {
  const color = CATEGORY_COLORS[category] || '#8E8E93';
  const label = CATEGORY_LABELS[category] || category;

  const itemsHtml = items.map((item) => renderItem(item, category)).join('');

  return `
    <div class="section">
      <div class="section-header">
        <div class="section-dot" style="background:${color}"></div>
        <div class="section-title">${escapeHtml(label)}</div>
        <div class="section-count">${items.length}</div>
      </div>
      <div class="card">
        ${itemsHtml}
      </div>
    </div>`;
}

function render(categorizedData) {
  const { items, stats } = categorizedData;
  const templatePath = path.join(__dirname, 'template.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const now = new Date();
  const weekdays = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const months = [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december',
  ];

  const dateFormatted = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  const dateWeekday = weekdays[now.getDay()];
  const generatedAt = now.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

  // Build sections
  const categoryOrder = ['ACTION_ITEM', 'DECISION', 'QUESTION', 'ANNOUNCEMENT', 'FYI'];
  const sectionsHtml = [];

  for (const cat of categoryOrder) {
    const catItems = items.filter((i) => i.category === cat);
    if (catItems.length > 0) {
      sectionsHtml.push(renderSection(cat, catItems));
    }
  }

  if (sectionsHtml.length === 0) {
    sectionsHtml.push(`
      <div class="empty-state">
        <div class="empty-state-icon">☀️</div>
        <div class="empty-state-text">Geen belangrijke items gevonden in de afgelopen periode.</div>
      </div>
    `);
  }

  // Replace placeholders
  html = html.replace(/\{\{DATE_FORMATTED\}\}/g, dateFormatted);
  html = html.replace(/\{\{DATE_WEEKDAY\}\}/g, dateWeekday);
  html = html.replace(/\{\{GENERATED_AT\}\}/g, generatedAt);
  html = html.replace('{{STATS_HTML}}', renderStats(stats));
  html = html.replace('{{SECTIONS_HTML}}', sectionsHtml.join('\n'));

  return html;
}

module.exports = { render };
