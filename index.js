// index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const winston = require('winston');

const prisma = new PrismaClient();

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
  ),
  transports: [new winston.transports.Console()],
});

// Create a new Discord client instance with partials for uncached data
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions, // If tracking reactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Ready Event
client.once('ready', () => {
  logger.info(`Logged in as ${client.user.tag}!`);
});

// Message Create Event
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;

    const targetChannelId = 'YOUR_TARGET_CHANNEL_ID';

    if (message.channel.id !== targetChannelId) return;

    const { id, author, content, createdAt, attachments } = message;

    // Handle Mentions
    const mentions = message.mentions.users.map((user) => ({
      userId: user.id,
      userName: user.username,
      userTag: user.discriminator,
    }));

    // Handle Attachments
    const processedAttachments = [];
    attachments.forEach((attachment) => {
      processedAttachments.push({
        url: attachment.url,
        filename: attachment.name,
        size: attachment.size,
        contentType: attachment.contentType,
        proxyUrl: attachment.proxyURL,
        height: attachment.height,
        width: attachment.width,
      });
    });

    const upvotes = 0; // Initialize upvotes or fetch from reactions

    const isBot = author.bot;

    // Upsert User
    const user = await prisma.user.upsert({
      where: { id: author.id },
      update: {
        userName: author.username,
        userTag: author.discriminator,
        avatarUrl: author.displayAvatarURL(),
        isBot: isBot,
      },
      create: {
        id: author.id,
        userName: author.username,
        userTag: author.discriminator,
        avatarUrl: author.displayAvatarURL(),
        isBot: isBot,
      },
    });

    // Create Message
    const dbMessage = await prisma.message.create({
      data: {
        id: id, // Ensure Prisma schema uses String for ID
        userId: user.id,
        userName: user.userName,
        userTag: user.userTag,
        avatarUrl: user.avatarUrl,
        isBot: user.isBot,
        date: createdAt,
        content: content,
        upvotes: upvotes,
        tier: null,
      },
    });

    // Create Mentions
    for (const mention of mentions) {
      await prisma.mention.create({
        data: {
          messageId: dbMessage.id,
          userId: mention.userId,
        },
      });
    }

    // Create Attachments
    for (const attachment of processedAttachments) {
      await prisma.attachment.create({
        data: {
          messageId: dbMessage.id,
          url: attachment.url,
          filename: attachment.filename,
          size: attachment.size,
          contentType: attachment.contentType,
          proxyUrl: attachment.proxyUrl,
          height: attachment.height,
          width: attachment.width,
        },
      });
    }

    logger.info(`Saved message ID ${dbMessage.id} from user ${user.userName}`);
  } catch (error) {
    logger.error(`Error processing message: ${error.message}`);
  }
});

// Handle Errors
client.on('error', (error) => {
  logger.error(`Client error: ${error.message}`);
});

// Log in to Discord
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  logger.error(`Failed to login: ${error.message}`);
});
