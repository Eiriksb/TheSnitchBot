// src/index.js

require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const winston = require('winston');

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(
      ({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`
    )
  ),
  transports: [new winston.transports.Console()],
});

const prisma = new PrismaClient();

// Create a new Discord client instance with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // For guild-related events
    GatewayIntentBits.GuildMessages, // For message-related events
    GatewayIntentBits.MessageContent, // To read message content
    GatewayIntentBits.GuildMessageReactions, // To listen to reaction events
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// When the client is ready, run this code (only once)
client.once('ready', () => {
  logger.info(`Logged in as ${client.user.tag}!`);
});

// Listen to messages in specific channels
client.on('messageCreate', async (message) => {
  try {
    // Ignore messages from bots (including itself)
    if (message.author.bot) return;

    // Specify the channel ID you want to monitor
    const targetChannelId = '1190989767219875870'; // Replace with your channel ID

    if (message.channel.id !== targetChannelId) return;

    // Extract necessary data from the message
    const { id, author, content, createdAt, attachments } = message;

    // Process mentions (if any)
    const mentions = message.mentions.users.map((user) => ({
      userId: user.id,
      userName: user.username,
      userTag: user.discriminator,
    }));

    // Process attachments (if any)
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

    // Determine if the message is from a bot
    const isBot = author.bot;

    // Create or update the user in the database
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

    // Create the message in the database with discordId
    const dbMessage = await prisma.message.create({
      data: {
        discordId: id, // Use the Discord ID as a string
        userId: user.id,
        userName: user.userName,
        userTag: user.userTag,
        avatarUrl: user.avatarUrl,
        isBot: user.isBot,
        date: createdAt,
        content: content,
        upvotes: 0, // Initialize upvotes to 0
        tier: null, // Default to 'None' or as per your logic
        // Attachments and mentions will be handled separately
      },
    });

    // Handle Mentions
    if (mentions.length > 0) {
      const mentionPromises = mentions.map(async (mention) => {
        // Upsert the mentioned user to ensure they exist in the User table
        const mentionedUser = await prisma.user.upsert({
          where: { id: mention.userId },
          update: {
            userName: mention.userName,
            userTag: mention.userTag,
            // Optionally, you can update avatarUrl if available
          },
          create: {
            id: mention.userId,
            userName: mention.userName,
            userTag: mention.userTag,
            avatarUrl: null, // Set to null or a default avatar if available
            isBot: false, // Assuming mentions are of human users
          },
        });

        // Create the Mention entry linking to the message and user
        return prisma.mention.create({
          data: {
            messageId: dbMessage.id,
            userId: mentionedUser.id,
          },
        });
      });

      await Promise.all(mentionPromises);
    }

    // Handle Attachments
    if (processedAttachments.length > 0) {
      const attachmentPromises = processedAttachments.map((attachment) =>
        prisma.attachment.create({
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
        })
      );

      await Promise.all(attachmentPromises);
    }

    logger.info(`Saved message discordId ${dbMessage.discordId} from user ${user.userName}`);
  } catch (error) {
    logger.error(`Error processing message: ${error.message}`);
  }
});

// Listen for reaction additions (upvotes)
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    // Ignore reactions from bots
    if (user.bot) return;

    // Fetch partials if necessary
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        logger.error('Error fetching reaction:', error);
        return;
      }
    }

    const { message } = reaction;

    // Only consider reactions in the target channel
    const targetChannelId = '1190989767219875870'; // Replace with your channel ID
    if (message.channel.id !== targetChannelId) return;

    // Find the corresponding message in the database
    const dbMessage = await prisma.message.findUnique({
      where: { discordId: message.id },
    });

    if (!dbMessage) {
      logger.warn(`Message with discordId ${message.id} not found in the database.`);
      return;
    }

    // Increment the upvotes count
    await prisma.message.update({
      where: { id: dbMessage.id },
      data: { upvotes: dbMessage.upvotes + 1 },
    });

    logger.info(`Upvote added to message discordId ${dbMessage.discordId}. Total upvotes: ${dbMessage.upvotes + 1}`);
  } catch (error) {
    logger.error(`Error handling reaction add: ${error.message}`);
  }
});

// Listen for reaction removals (upvotes)
client.on('messageReactionRemove', async (reaction, user) => {
  try {
    // Ignore reactions from bots
    if (user.bot) return;

    // Fetch partials if necessary
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        logger.error('Error fetching reaction:', error);
        return;
      }
    }

    const { message } = reaction;

    // Only consider reactions in the target channel
    const targetChannelId = '1190989767219875870'; // Replace with your channel ID
    if (message.channel.id !== targetChannelId) return;

    // Find the corresponding message in the database
    const dbMessage = await prisma.message.findUnique({
      where: { discordId: message.id },
    });

    if (!dbMessage) {
      logger.warn(`Message with discordId ${message.id} not found in the database.`);
      return;
    }

    // Decrement the upvotes count, ensuring it doesn't go below 0
    const newUpvotes = dbMessage.upvotes > 0 ? dbMessage.upvotes - 1 : 0;

    await prisma.message.update({
      where: { id: dbMessage.id },
      data: { upvotes: newUpvotes },
    });

    logger.info(`Upvote removed from message discordId ${dbMessage.discordId}. Total upvotes: ${newUpvotes}`);
  } catch (error) {
    logger.error(`Error handling reaction remove: ${error.message}`);
  }
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
