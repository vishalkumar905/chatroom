const users = [];

// Join user to chat (safely deduplicates by socket id to prevent memory leaks)
function userJoin(id, username, room) {
    // Purge any existing entry for this socket id
    const existingIndex = users.findIndex(user => user.id === id);
    if (existingIndex !== -1) {
        users.splice(existingIndex, 1);
    }

    const user = { id, username, room };
    users.push(user);
    return user;
}

// Get current user
function getUserById(id) {
    return users.find(user => user.id === id);
}

// User leaves chat (removes all entries matching socket id)
function userLeave(id) {
    const index = users.findIndex(user => user.id === id);

    if (index !== -1) {
        const removed = users.splice(index, 1)[0];
        // Clean up any other duplicates for this id if any exist
        for (let i = users.length - 1; i >= 0; i--) {
            if (users[i].id === id) {
                users.splice(i, 1);
            }
        }
        return removed;
    }
}

// Get room users (normalized comparison)
function getRoomUsers(room) {
    const normalizedRoom = String(room).trim().toLowerCase();
    return users.filter(user => String(user.room).trim().toLowerCase() === normalizedRoom);
}

// Check if a username is already taken in the given room (case-insensitive)
function isUsernameTaken(room, username, excludeSocketId = null) {
    const normalizedRoom = String(room).trim().toLowerCase();
    const normalizedUser = String(username).trim().toLowerCase();
    return users.some(user => 
        user.id !== excludeSocketId &&
        String(user.room).trim().toLowerCase() === normalizedRoom &&
        String(user.username).trim().toLowerCase() === normalizedUser
    );
}

module.exports = {
    userJoin,
    getUserById,
    userLeave,
    getRoomUsers,
    isUsernameTaken
}