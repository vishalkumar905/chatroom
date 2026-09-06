const path = require('path');
const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const formatMessage = require('./utils/messages');
const { userJoin, getUserById, userLeave, getRoomUsers } = require('./utils/users');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 8182;

// set static folder
app.use(express.static(path.join(__dirname, 'public')));


const botName = 'ChatCord Bot';

// Ephemeral in-memory active rooms tracker (cleared when 0 users remain)
const activeRooms = new Map();

// Run when client is connect
io.on('connection', socket => {
    
    socket.on('joinRoom', ({ username, room, passcode }) => {
        if (!username || !room) {
            socket.emit('joinError', { message: 'Username and Room are required.' });
            return;
        }

        const roomKey = String(room).trim().toLowerCase();
        const cleanPasscode = passcode ? String(passcode).trim() : null;

        // Check if room is active in memory
        if (!activeRooms.has(roomKey)) {
            // First user creates and locks the room with their passcode (if provided)
            activeRooms.set(roomKey, {
                room: String(room).trim(),
                passcode: cleanPasscode
            });
        } else {
            // Room is already active: verify passcode if one was set
            const activeRoom = activeRooms.get(roomKey);
            if (activeRoom.passcode) {
                if (!cleanPasscode || cleanPasscode !== activeRoom.passcode) {
                    socket.emit('joinError', {
                        message: `Incorrect passcode for active room "${activeRoom.room}".`,
                        room: activeRoom.room
                    });
                    return;
                }
            }
        }

        const user = userJoin(socket.id, username, room);
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

    // Listen for chatMessage
    socket.on('chatMessage', (msgPayload) => {
        const user = getUserById(socket.id);
        if (!user) return;

        let text = '';
        let replyTo = null;
        let image = null;

        if (typeof msgPayload === 'string') {
            text = msgPayload;
        } else if (msgPayload && typeof msgPayload === 'object') {
            text = typeof msgPayload.text === 'string' ? msgPayload.text : '';
            if (msgPayload.replyTo && typeof msgPayload.replyTo === 'object' && msgPayload.replyTo.id) {
                replyTo = {
                    id: String(msgPayload.replyTo.id),
                    username: String(msgPayload.replyTo.username || '').slice(0, 50),
                    text: String(msgPayload.replyTo.text || '').slice(0, 200)
                };
            }
            if (typeof msgPayload.image === 'string' && msgPayload.image.startsWith('data:image/')) {
                // Safeguard against oversized payloads (max ~2.5MB)
                if (msgPayload.image.length < 2.5 * 1024 * 1024) {
                    image = msgPayload.image;
                }
            }
        }

        if ((text && text.trim().length > 0) || image) {
            io.to(user.room).emit('message', formatMessage(user.username, text.trim(), replyTo, image));
        }
    });

    // Listen for typing events
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

    // Listen for message reactions (ephemeral in-memory)
    socket.on('messageReaction', ({ messageId, emoji }) => {
        const user = getUserById(socket.id);
        if (user && messageId && emoji) {
            io.to(user.room).emit('messageReaction', {
                messageId: String(messageId),
                emoji: String(emoji).slice(0, 10),
                username: user.username
            });
        }
    });

    // Runs on client disconnects
    socket.on('disconnect', () => {
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


