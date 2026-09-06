const path = require('path');
const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const crypto = require('crypto');
const formatMessage = require('./utils/messages');
const { userJoin, getUserById, userLeave, getRoomUsers, isUsernameTaken } = require('./utils/users');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 8182;

// set static folder
app.use(express.static(path.join(__dirname, 'public')));

const botName = 'ChatCord Bot';

// Ephemeral in-memory active rooms tracker (cleared when 0 users remain)
const activeRooms = new Map();

// Ephemeral in-memory failed passcode attempt tracker: socketId:roomKey -> { count, lockedUntil }
const failedPasscodeAttempts = new Map();

// Ephemeral in-memory rate limiter per socket
const socketRateLimits = new Map();

// Reserved system usernames that regular users cannot claim
const RESERVED_USERNAMES = new Set([
    'chatcord bot',
    'bot',
    'system',
    'admin',
    'administrator',
    'moderator'
]);

// Strip zero-width spaces and normalize text
function sanitizeText(raw) {
    if (typeof raw !== 'string') return '';
    return raw.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

// Constant-time passcode verification using SHA-256 digests
function timingSafeComparePasscode(provided, actual) {
    if (typeof provided !== 'string' || typeof actual !== 'string') return false;
    const hashProvided = crypto.createHash('sha256').update(provided).digest();
    const hashActual = crypto.createHash('sha256').update(actual).digest();
    return crypto.timingSafeEqual(hashProvided, hashActual);
}

// Per-socket sliding window rate limiter
function checkSocketRateLimit(socketId, maxEvents = 8, windowMs = 3000) {
    const now = Date.now();
    let record = socketRateLimits.get(socketId);
    if (!record || now - record.resetTime > windowMs) {
        record = { count: 1, resetTime: now };
        socketRateLimits.set(socketId, record);
        return true;
    }
    if (record.count >= maxEvents) {
        return false;
    }
    record.count++;
    return true;
}

// Run when client is connect
io.on('connection', socket => {
    
    socket.on('joinRoom', ({ username, room, passcode }) => {
        const cleanUser = sanitizeText(username);
        const cleanRoom = sanitizeText(room);

        if (!cleanUser || !cleanRoom) {
            socket.emit('joinError', { message: 'Username and Room are required.' });
            return;
        }

        if (cleanUser.length > 25) {
            socket.emit('joinError', { message: 'Username must be between 1 and 25 characters.' });
            return;
        }

        if (cleanRoom.length > 30) {
            socket.emit('joinError', { message: 'Room name must be between 1 and 30 characters.' });
            return;
        }

        if (RESERVED_USERNAMES.has(cleanUser.toLowerCase())) {
            socket.emit('joinError', { message: `"${cleanUser}" is a reserved system name. Please choose another username.` });
            return;
        }

        const roomKey = cleanRoom.toLowerCase();
        const cleanPasscode = passcode ? String(passcode).trim() : null;

        // Check if room is active in memory
        if (!activeRooms.has(roomKey)) {
            // First user creates and locks the room with their passcode (if provided)
            activeRooms.set(roomKey, {
                room: cleanRoom,
                passcode: cleanPasscode
            });
        } else {
            // Room is already active: verify passcode if one was set
            const activeRoom = activeRooms.get(roomKey);
            if (activeRoom.passcode) {
                const attemptKey = `${socket.id}:${roomKey}`;
                const attemptRecord = failedPasscodeAttempts.get(attemptKey);

                // Check lockout cooldown (30s after 5 failed attempts)
                if (attemptRecord && Date.now() < attemptRecord.lockedUntil) {
                    const remainingSeconds = Math.ceil((attemptRecord.lockedUntil - Date.now()) / 1000);
                    socket.emit('joinError', {
                        message: `Too many failed passcode attempts. Please wait ${remainingSeconds}s before trying again.`,
                        room: activeRoom.room
                    });
                    return;
                }

                if (!cleanPasscode || !timingSafeComparePasscode(cleanPasscode, activeRoom.passcode)) {
                    // Track failed attempt
                    const currentCount = (attemptRecord ? attemptRecord.count : 0) + 1;
                    const lockedUntil = currentCount >= 5 ? Date.now() + 30 * 1000 : 0;
                    failedPasscodeAttempts.set(attemptKey, { count: currentCount, lockedUntil });

                    socket.emit('joinError', {
                        message: `Incorrect passcode for active room "${activeRoom.room}".`,
                        room: activeRoom.room
                    });
                    return;
                }

                // Successful authentication: clear failed attempt tracker
                failedPasscodeAttempts.delete(attemptKey);
            }
        }

        // Check for duplicate username in the same room
        if (isUsernameTaken(roomKey, cleanUser, socket.id)) {
            socket.emit('joinError', {
                message: `Username "${cleanUser}" is already taken in this room. Please choose another username.`,
                room: cleanRoom
            });
            return;
        }

        const user = userJoin(socket.id, cleanUser, cleanRoom);
        socket.join(user.room);

        const currentRoomMeta = activeRooms.get(roomKey);

        // Welcome current user
        socket.emit(
            'message', 
            formatMessage(botName, 'Welcome to ChatCord!')
        );
    
        // Broadcast when a user connects, It will be for other users 
        socket.broadcast
            .to(user.room)
            .emit('message', formatMessage(botName, `${user.username} has joined the chat`)
        );

        // Send users and room info
        io.to(user.room).emit('roomUsers', {
            room: user.room,
            users: getRoomUsers(user.room),
            isProtected: Boolean(currentRoomMeta && currentRoomMeta.passcode)
        });
    });

    // Listen for chatMessage with rate limiting and raster image validation
    socket.on('chatMessage', (msgPayload) => {
        const user = getUserById(socket.id);
        if (!user) return;

        // Rate limit: max 8 messages per 3s
        if (!checkSocketRateLimit(socket.id, 8, 3000)) {
            socket.emit('rateLimited', { message: 'You are sending messages too quickly. Please wait a moment.' });
            return;
        }

        let text = '';
        let replyTo = null;
        let image = null;

        if (typeof msgPayload === 'string') {
            text = sanitizeText(msgPayload);
        } else if (msgPayload && typeof msgPayload === 'object') {
            text = typeof msgPayload.text === 'string' ? sanitizeText(msgPayload.text) : '';
            if (msgPayload.replyTo && typeof msgPayload.replyTo === 'object' && msgPayload.replyTo.id) {
                replyTo = {
                    id: String(msgPayload.replyTo.id),
                    username: sanitizeText(msgPayload.replyTo.username || '').slice(0, 50),
                    text: sanitizeText(msgPayload.replyTo.text || '').slice(0, 200)
                };
            }
            if (typeof msgPayload.image === 'string') {
                // Keep generous buffer size limit (up to 10MB) as requested
                if (msgPayload.image.length < 10 * 1024 * 1024) {
                    // Strictly restrict to safe raster image MIME types (prevent SVG script injection)
                    const SAFE_IMAGE_PREFIXES = [
                        'data:image/jpeg;base64,',
                        'data:image/jpg;base64,',
                        'data:image/png;base64,',
                        'data:image/webp;base64,'
                    ];
                    if (SAFE_IMAGE_PREFIXES.some(prefix => msgPayload.image.startsWith(prefix))) {
                        image = msgPayload.image;
                    }
                }
            }
        }

        if ((text && text.length > 0) || image) {
            io.to(user.room).emit('message', formatMessage(user.username, text, replyTo, image));
        }
    });

    // Listen for typing events with throttling
    socket.on('typing', () => {
        const user = getUserById(socket.id);
        if (user) {
            socket.broadcast.to(user.room).emit('userTyping', { username: user.username });
        }
    });

    socket.on('stopTyping', () => {
        const user = getUserById(socket.id);
        if (user) {
            socket.broadcast.to(user.room).emit('userStopTyping', { username: user.username });
        }
    });

    // Listen for message reactions with rate limiting
    socket.on('messageReaction', ({ messageId, emoji }) => {
        const user = getUserById(socket.id);
        if (user && messageId && emoji) {
            if (!checkSocketRateLimit(`reaction:${socket.id}`, 15, 3000)) {
                return;
            }
            io.to(user.room).emit('messageReaction', {
                messageId: String(messageId),
                emoji: String(emoji).slice(0, 10),
                username: user.username
            });
        }
    });

    // Runs on client disconnects
    socket.on('disconnect', () => {
        // Clean up socket rate limit and failed attempt tracking
        socketRateLimits.delete(socket.id);
        socketRateLimits.delete(`reaction:${socket.id}`);

        const user = userLeave(socket.id);
        if (user) {
            socket.broadcast.to(user.room).emit('userStopTyping', { username: user.username });
            io.to(user.room).emit('message', formatMessage(botName, `${user.username} has left the chat`));
            
            const remainingUsers = getRoomUsers(user.room);
            const roomKey = user.room.trim().toLowerCase();

            // When no users remain, completely delete the room and its temporary passcode!
            if (remainingUsers.length === 0) {
                activeRooms.delete(roomKey);
            } else {
                // Send users and room info
                io.to(user.room).emit('roomUsers', {
                    room: user.room,
                    users: remainingUsers,
                    isProtected: Boolean(activeRooms.get(roomKey)?.passcode)
                });
            }
        }
    });
});

server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));



