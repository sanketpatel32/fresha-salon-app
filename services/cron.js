const cron = require('node-cron');
const Chat = require('../models/chatModel');
const ArchivedChat = require('../models/archivedChatModel');
const {Op} = require('sequelize');

const archiveOldChats = async () => {
    try {
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        // Fetch chats older than 1 day
        const oldChats = await Chat.findAll({
            where: {
                createdAt: { [Op.lt]: oneDayAgo },
            },
        });

        if (oldChats.length === 0) {
            console.log('No chats to archive.');
            return;
        }

        // Move chats to the ArchivedChat table
        const archivedChats = oldChats.map((chat) => ({
            id: chat.id,
            message: chat.message,
            fileUrl: chat.fileUrl,
            userId: chat.userId,
            groupId: chat.groupId,
            createdAt: chat.createdAt,
        }));
        await ArchivedChat.bulkCreate(archivedChats);

        // Delete the old chats from the Chat table
        await Chat.destroy({
            where: {
                createdAt: { [Op.lt]: oneDayAgo },
            },
        });

        console.log(`${oldChats.length} chats archived successfully.`);
    } catch (error) {
        console.error('Error archiving chats:', error);
    }
};

// Schedule the cron job to run every night at midnight
cron.schedule('0 0 * * *', archiveOldChats);

module.exports = archiveOldChats;