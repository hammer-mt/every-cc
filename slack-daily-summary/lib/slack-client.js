const { WebClient } = require('@slack/web-api');

class SlackClient {
  constructor(token) {
    if (!token) {
      throw new Error('SLACK_BOT_TOKEN is vereist. Zie .env.example voor setup instructies.');
    }
    this.client = new WebClient(token);
    this.userCache = new Map();
  }

  async fetchChannels(filterNames) {
    const channels = [];
    let cursor;

    do {
      const result = await this.client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        cursor,
      });

      for (const channel of result.channels) {
        if (channel.is_member) {
          channels.push({ id: channel.id, name: channel.name });
        }
      }

      cursor = result.response_metadata?.next_cursor;
    } while (cursor);

    if (filterNames && filterNames.length > 0) {
      const names = filterNames.map((n) => n.replace(/^#/, '').toLowerCase());
      return channels.filter((ch) => names.includes(ch.name.toLowerCase()));
    }

    return channels;
  }

  async fetchChannelHistory(channelId, oldest) {
    const messages = [];
    let cursor;

    do {
      const result = await this.client.conversations.history({
        channel: channelId,
        oldest: String(oldest),
        limit: 200,
        cursor,
      });

      if (result.messages) {
        messages.push(...result.messages);
      }

      cursor = result.response_metadata?.next_cursor;
      if (cursor) await this._rateLimit();
    } while (cursor);

    return messages;
  }

  async fetchThreadReplies(channelId, threadTs) {
    try {
      const result = await this.client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 200,
      });

      // First message is the parent, skip it
      return (result.messages || []).slice(1);
    } catch (err) {
      if (err.data?.error === 'thread_not_found') return [];
      throw err;
    }
  }

  async resolveUser(userId) {
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId);
    }

    try {
      const result = await this.client.users.info({ user: userId });
      const user = {
        id: userId,
        name: result.user.name,
        displayName: result.user.profile.display_name || result.user.real_name || result.user.name,
      };
      this.userCache.set(userId, user);
      return user;
    } catch {
      const fallback = { id: userId, name: userId, displayName: userId };
      this.userCache.set(userId, fallback);
      return fallback;
    }
  }

  async fetchRecentMessages(hoursBack = 24, filterChannels) {
    const oldest = Math.floor(Date.now() / 1000) - hoursBack * 3600;
    const channels = await this.fetchChannels(filterChannels);

    console.log(`  Gevonden: ${channels.length} kanalen`);

    const results = [];

    for (const channel of channels) {
      console.log(`  Ophalen: #${channel.name}...`);
      await this._rateLimit();

      const rawMessages = await this.fetchChannelHistory(channel.id, oldest);

      // Filter out bot messages and subtypes we don't care about
      const filtered = rawMessages.filter(
        (m) => !m.bot_id && !m.subtype
      );

      if (filtered.length === 0) continue;

      const messages = [];

      for (const msg of filtered) {
        const user = msg.user ? await this.resolveUser(msg.user) : null;

        let threadReplies = [];
        if (msg.reply_count && msg.reply_count > 0) {
          await this._rateLimit();
          const rawReplies = await this.fetchThreadReplies(channel.id, msg.ts);

          for (const reply of rawReplies) {
            const replyUser = reply.user ? await this.resolveUser(reply.user) : null;
            threadReplies.push({
              user: replyUser,
              text: reply.text,
              timestamp: reply.ts,
            });
          }
        }

        messages.push({
          id: msg.ts,
          user,
          text: msg.text,
          timestamp: msg.ts,
          threadReplies,
          reactions: (msg.reactions || []).map((r) => ({
            name: r.name,
            count: r.count,
          })),
        });
      }

      results.push({ channel, messages });
    }

    return results;
  }

  async _rateLimit() {
    return new Promise((resolve) => setTimeout(resolve, 1100));
  }
}

module.exports = { SlackClient };
