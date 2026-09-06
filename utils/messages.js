const crypto = require('crypto');
const moment = require("moment");

function formatMessages(username, text, replyTo = null, image = null) {
    const id = typeof crypto.randomUUID === 'function' 
        ? crypto.randomUUID() 
        : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
        id,
        username,
        text,
        time: moment().format('h:mm a'),
        replyTo: (replyTo && replyTo.id) ? {
            id: String(replyTo.id),
            username: String(replyTo.username || ''),
            text: String(replyTo.text || '')
        } : null,
        image: (image && typeof image === 'string' && image.startsWith('data:image/')) ? image : null
    };
}

module.exports = formatMessages;