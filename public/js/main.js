const chatForm = document.getElementById('chat-form');
const chatMessages = document.querySelector('.chat-messages');
const roomName = document.getElementById('room-name');
const userList = document.getElementById('users');
const userCount = document.getElementById('user-count');
const msgInput = document.getElementById('msg');
const replyPreviewContainer = document.getElementById('reply-preview-container');
const replyToUser = document.getElementById('reply-to-user');
const replyToText = document.getElementById('reply-to-text');
const cancelReplyBtn = document.getElementById('cancel-reply-btn');
const toastElement = document.getElementById('toast');
const themeToggle = document.getElementById('theme-toggle');
const soundToggle = document.getElementById('sound-toggle');
const viewModeToggle = document.getElementById('view-mode-toggle');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
const chatSidebar = document.getElementById('chat-sidebar');
const chatContainer = document.querySelector('.chat-container');
const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
const unreadBadge = document.getElementById('unread-count');
const typingIndicator = document.getElementById('typing-indicator');
const typingText = document.getElementById('typing-text');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');

// New feature elements: search, clear, image attachment, modal
const searchToggleBtn = document.getElementById('search-toggle-btn');
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
const searchResultsCount = document.getElementById('search-results-count');
const searchCloseBtn = document.getElementById('search-close-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const attachBtn = document.getElementById('attach-btn');
const imageFileInput = document.getElementById('image-file-input');
const imagePreviewContainer = document.getElementById('image-preview-container');
const imagePreview = document.getElementById('image-preview');
const cancelImageBtn = document.getElementById('cancel-image-btn');
const imageModal = document.getElementById('image-modal');
const modalImg = document.getElementById('modal-img');
const modalCloseBtn = document.getElementById('modal-close-btn');

// Ephemeral in-memory states
let currentReply = null;
let currentMode = 'modern'; // Default: Modern (WhatsApp)
let unreadCount = 0;
let isTyping = false;
let stopTypingTimer = null;
let soundEnabled = true;
let audioCtx = null;
let stagedImage = null;
let tabHasFocus = true;
let bgUnreadCount = 0;
const baseDocTitle = 'ChatCord App';
const activeTypers = new Set();

// Tab focus tracking for unread title alerts
window.addEventListener('focus', () => {
    tabHasFocus = true;
    bgUnreadCount = 0;
    document.title = baseDocTitle;
});
window.addEventListener('blur', () => {
    tabHasFocus = false;
});

// Get username, room, and optional passcode
const queryParams = Qs.parse(window.location.search, { ignoreQueryPrefix: true });
const username = queryParams.username;
const room = queryParams.room;

// Retrieve passcode securely from ephemeral session storage, or fallback to query if shared
let passcode = sessionStorage.getItem('ephemeral_room_passcode') || queryParams.passcode || '';
sessionStorage.removeItem('ephemeral_room_passcode');

// Immediately scrub sensitive passcode from browser URL bar so it is never exposed
if (window.history.replaceState && queryParams.passcode) {
    const cleanParams = new URLSearchParams(window.location.search);
    cleanParams.delete('passcode');
    const cleanQuery = cleanParams.toString() ? `?${cleanParams.toString()}` : '';
    window.history.replaceState(null, document.title, window.location.pathname + cleanQuery);
}

const socket = io();

// Join Chat room with passcode
socket.emit('joinRoom', { username, room, passcode });

// Handle passcode / room access errors
socket.on('joinError', ({ message, room: errRoom }) => {
    alert(message || 'Access denied to this room.');
    const targetRoom = errRoom || room || '';
    window.location.href = `index.html?error=${encodeURIComponent(message)}&room=${encodeURIComponent(targetRoom)}`;
});

// Get room & user list
socket.on('roomUsers', ({ room, users, isProtected }) => {
    outputUsers(users);
    outputRoomName(room);
    const lockBadge = document.getElementById('room-lock-badge');
    if (lockBadge) {
        if (isProtected) {
            lockBadge.classList.remove('hidden');
        } else {
            lockBadge.classList.add('hidden');
        }
    }
});

// Invite / Copy Room Link button
const inviteBtn = document.getElementById('invite-btn');
if (inviteBtn) {
    inviteBtn.addEventListener('click', () => {
        const inviteUrl = `${window.location.origin}/index.html?room=${encodeURIComponent(room || '')}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(inviteUrl).then(() => {
                showToast('Room invite link copied to clipboard!');
            }).catch(() => {
                showToast(`Invite: ${inviteUrl}`);
            });
        } else {
            showToast(`Invite: ${inviteUrl}`);
        }
    });
}

// Clear Chat Screen action
if (clearChatBtn) {
    clearChatBtn.addEventListener('click', () => {
        if (confirm('Clear messages from your screen? (Other participants will not be affected)')) {
            chatMessages.innerHTML = '';
            showToast('Chat screen cleared.');
        }
    });
}

// Incoming message
socket.on('message', message => {
    const isBot = message.username === 'ChatCord Bot';
    const isOwn = !isBot && username && (message.username.toLowerCase() === username.trim().toLowerCase());

    const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 120;

    outputMessage(message);

    if (!isOwn && !isBot) {
        playNotificationSound('incoming');
        if (!tabHasFocus) {
            bgUnreadCount++;
            const snippet = message.text ? message.text.slice(0, 20) : '📷 Image';
            document.title = `(${bgUnreadCount}) ${message.username}: ${snippet} | ChatCord`;
        }
    }

    if (isNearBottom || isOwn) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
        unreadCount = 0;
        if (unreadBadge) unreadBadge.classList.add('hidden');
        if (scrollBottomBtn) scrollBottomBtn.classList.add('hidden');
    } else {
        unreadCount++;
        if (unreadBadge) {
            unreadBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            unreadBadge.classList.remove('hidden');
        }
        if (scrollBottomBtn) scrollBottomBtn.classList.remove('hidden');
    }
});

// Real-time message reaction broadcast
socket.on('messageReaction', ({ messageId, emoji, username: reactor }) => {
    applyReactionToDOM(messageId, emoji, reactor);
});

// Message submit
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const msg = msgInput.value;
    if (!msg.trim() && !stagedImage) return;

    const payload = {
        text: msg.trim(),
        replyTo: currentReply,
        image: stagedImage
    };

    socket.emit('chatMessage', payload);
    playNotificationSound('outgoing');

    if (isTyping) {
        clearTimeout(stopTypingTimer);
        socket.emit('stopTyping');
        isTyping = false;
    }

    msgInput.value = '';
    clearReplyTarget();
    clearStagedImage();
    if (emojiPicker) emojiPicker.classList.add('hidden');
    msgInput.focus();
});

// ===================================
// IN-CHAT MESSAGE SEARCH & FILTER
// ===================================
function openSearch() {
    if (!searchBar) return;
    searchBar.classList.remove('hidden');
    if (searchInput) {
        searchInput.focus();
        searchInput.select();
    }
}

function closeSearch() {
    if (!searchBar) return;
    searchBar.classList.add('hidden');
    if (searchInput) searchInput.value = '';
    if (searchResultsCount) searchResultsCount.textContent = '';
    // Reset all message filters
    document.querySelectorAll('.message').forEach(el => {
        el.classList.remove('search-highlight', 'search-dimmed');
    });
}

if (searchToggleBtn) {
    searchToggleBtn.addEventListener('click', () => {
        if (searchBar.classList.contains('hidden')) {
            openSearch();
        } else {
            closeSearch();
        }
    });
}

if (searchCloseBtn) {
    searchCloseBtn.addEventListener('click', closeSearch);
}

if (searchInput) {
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        const allMessages = document.querySelectorAll('.message');

        if (!query) {
            allMessages.forEach(el => el.classList.remove('search-highlight', 'search-dimmed'));
            if (searchResultsCount) searchResultsCount.textContent = '';
            return;
        }

        let matchCount = 0;
        let firstMatch = null;

        allMessages.forEach(el => {
            const textEl = el.querySelector('.text');
            const metaEl = el.querySelector('.meta');
            const textContent = (textEl ? textEl.textContent : '').toLowerCase();
            const metaContent = (metaEl ? metaEl.textContent : '').toLowerCase();

            if (textContent.includes(query) || metaContent.includes(query)) {
                el.classList.add('search-highlight');
                el.classList.remove('search-dimmed');
                matchCount++;
                if (!firstMatch) firstMatch = el;
            } else {
                el.classList.remove('search-highlight');
                el.classList.add('search-dimmed');
            }
        });

        if (searchResultsCount) {
            searchResultsCount.textContent = matchCount === 1 ? '1 match' : `${matchCount} matches`;
        }

        if (firstMatch) {
            firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
}

// ===================================
// IMAGE ATTACHMENT & CLIPBOARD PASTE
// ===================================
function stageImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            // Compress and scale to max 800px on canvas
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const maxDimension = 800;

            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            stagedImage = canvas.toDataURL('image/jpeg', 0.82);
            if (imagePreview) imagePreview.src = stagedImage;
            if (imagePreviewContainer) imagePreviewContainer.classList.remove('hidden');
            msgInput.focus();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function clearStagedImage() {
    stagedImage = null;
    if (imagePreview) imagePreview.src = '';
    if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
    if (imageFileInput) imageFileInput.value = '';
}

if (attachBtn && imageFileInput) {
    attachBtn.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            stageImageFile(e.target.files[0]);
        }
    });
}

if (cancelImageBtn) {
    cancelImageBtn.addEventListener('click', clearStagedImage);
}

// Clipboard Paste handler for screenshots
window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
            const file = items[i].getAsFile();
            if (file) {
                stageImageFile(file);
                showToast('Image pasted from clipboard!');
                break;
            }
        }
    }
});

// Image Lightbox Modal
function openImageModal(src) {
    if (!imageModal || !modalImg) return;
    modalImg.src = src;
    imageModal.classList.remove('hidden');
}

function closeImageModal() {
    if (!imageModal) return;
    imageModal.classList.add('hidden');
    if (modalImg) modalImg.src = '';
}

if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeImageModal);
if (imageModal) {
    const backdrop = imageModal.querySelector('.image-modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeImageModal);
}

// ===================================
// SYNTHETIC WEB AUDIO NOTIFICATIONS
// ===================================
function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function playNotificationSound(type = 'incoming') {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'incoming') {
            osc.frequency.setValueAtTime(587.33, now);
            osc.frequency.setValueAtTime(880, now + 0.08);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        } else if (type === 'outgoing') {
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.06);
            gain.gain.setValueAtTime(0.06, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
            osc.start(now);
            osc.stop(now + 0.12);
        }
    } catch (e) {}
}

if (soundToggle) {
    soundToggle.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        soundToggle.innerHTML = soundEnabled ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-volume-mute"></i>';
        soundToggle.title = soundEnabled ? 'Toggle Sound (Enabled)' : 'Toggle Sound (Muted)';
        showToast(soundEnabled ? 'Sound enabled' : 'Sound muted');
    });
}

// ===================================
// TYPING INDICATOR
// ===================================
if (msgInput) {
    msgInput.addEventListener('input', () => {
        const text = msgInput.value.trim();

        if (text.length > 0) {
            if (!isTyping) {
                isTyping = true;
                socket.emit('typing');
            }
            clearTimeout(stopTypingTimer);
            stopTypingTimer = setTimeout(() => {
                socket.emit('stopTyping');
                isTyping = false;
            }, 2000);
        } else if (isTyping) {
            clearTimeout(stopTypingTimer);
            socket.emit('stopTyping');
            isTyping = false;
        }
    });
}

socket.on('userTyping', ({ username: typer }) => {
    if (typer && (!username || typer.toLowerCase() !== username.toLowerCase())) {
        activeTypers.add(typer);
        updateTypingIndicator();
    }
});

socket.on('userStopTyping', ({ username: typer }) => {
    if (typer) {
        activeTypers.delete(typer);
        updateTypingIndicator();
    }
});

function updateTypingIndicator() {
    if (!typingIndicator || !typingText) return;

    const typersArr = Array.from(activeTypers);
    if (typersArr.length === 0) {
        typingIndicator.classList.add('hidden');
        typingText.textContent = '';
    } else {
        if (typersArr.length === 1) {
            typingText.textContent = `${typersArr[0]} is typing...`;
        } else if (typersArr.length === 2) {
            typingText.textContent = `${typersArr[0]} and ${typersArr[1]} are typing...`;
        } else {
            typingText.textContent = 'Several people are typing...';
        }
        typingIndicator.classList.remove('hidden');
    }
}

// ===================================
// SCROLL TO BOTTOM BUTTON & UNREAD
// ===================================
if (chatMessages && scrollBottomBtn) {
    chatMessages.addEventListener('scroll', () => {
        const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 80;
        if (isNearBottom) {
            scrollBottomBtn.classList.add('hidden');
            unreadCount = 0;
            if (unreadBadge) unreadBadge.classList.add('hidden');
        } else {
            scrollBottomBtn.classList.remove('hidden');
        }
    });

    scrollBottomBtn.addEventListener('click', () => {
        chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
        scrollBottomBtn.classList.add('hidden');
        unreadCount = 0;
        if (unreadBadge) unreadBadge.classList.add('hidden');
    });
}

// ===================================
// EMOJI PICKER
// ===================================
const EMOJIS = [
    '😀', '😂', '🤣', '😍', '🥰', '😎',
    '👍', '👎', '❤️', '🔥', '🎉', '👏',
    '🙏', '🚀', '💯', '🤝', '💡', '✨',
    '🥳', '🤔', '🙌', '👀', '💪', '🤩'
];

if (emojiPicker && emojiBtn) {
    emojiPicker.innerHTML = EMOJIS.map(emoji => `
        <button type="button" class="emoji-item" data-emoji="${emoji}">${emoji}</button>
    `).join('');

    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPicker.classList.toggle('hidden');
    });

    emojiPicker.addEventListener('click', (e) => {
        const item = e.target.closest('.emoji-item');
        if (item) {
            const emoji = item.dataset.emoji;
            insertAtCursor(msgInput, emoji);
            emojiPicker.classList.add('hidden');
            msgInput.focus();
        }
    });

    document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.classList.add('hidden');
        }
    });
}

function insertAtCursor(input, text) {
    if (!input) return;
    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    const val = input.value;
    input.value = val.substring(0, start) + text + val.substring(end);
    input.selectionStart = input.selectionEnd = start + text.length;
}

// ===================================
// DARK / LIGHT THEME TOGGLE
// ===================================
if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        const isDark = document.body.classList.contains('dark-theme');
        themeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        themeToggle.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    });
}

// ===================================
// CHAT VIEW MODE TOGGLE (Modern/Classic)
// ===================================
if (viewModeToggle && chatContainer) {
    viewModeToggle.addEventListener('click', () => {
        if (currentMode === 'modern') {
            currentMode = 'classic';
            chatContainer.classList.remove('mode-modern');
            chatContainer.classList.add('mode-classic');
            viewModeToggle.innerHTML = '<i class="fas fa-comments"></i> <span>Modern Mode</span>';
            viewModeToggle.title = 'Switch to Modern (WhatsApp) mode';
        } else {
            currentMode = 'modern';
            chatContainer.classList.remove('mode-classic');
            chatContainer.classList.add('mode-modern');
            viewModeToggle.innerHTML = '<i class="fas fa-stream"></i> <span>Classic Mode</span>';
            viewModeToggle.title = 'Switch to Classic (Compact) mode';
        }
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

// ===================================
// MOBILE SIDEBAR DRAWER
// ===================================
if (sidebarToggle && chatSidebar) {
    sidebarToggle.addEventListener('click', () => {
        chatSidebar.classList.toggle('active');
    });
}

if (sidebarCloseBtn && chatSidebar) {
    sidebarCloseBtn.addEventListener('click', () => {
        chatSidebar.classList.remove('active');
    });
}

// ===================================
// REPLY STATE & KEYBOARD SHORTCUTS
// ===================================
function setReplyTarget(id, username, text) {
    currentReply = { id, username, text };
    replyToUser.textContent = username;
    replyToText.textContent = text;
    replyPreviewContainer.classList.remove('hidden');
    msgInput.focus();
}

function clearReplyTarget() {
    currentReply = null;
    replyPreviewContainer.classList.add('hidden');
    replyToUser.textContent = '';
    replyToText.textContent = '';
}

cancelReplyBtn.addEventListener('click', () => {
    clearReplyTarget();
    msgInput.focus();
});

document.addEventListener('keydown', (e) => {
    // Ctrl+F or Cmd+F opens search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
        return;
    }

    if (e.key === 'Escape') {
        if (currentReply) clearReplyTarget();
        if (emojiPicker) emojiPicker.classList.add('hidden');
        if (chatSidebar) chatSidebar.classList.remove('active');
        if (imageModal && !imageModal.classList.contains('hidden')) closeImageModal();
        if (searchBar && !searchBar.classList.contains('hidden')) closeSearch();
    }
});

let toastTimeout = null;
function showToast(message, duration = 2500) {
    if (!toastElement) return;
    toastElement.textContent = message;
    toastElement.classList.remove('hidden');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toastElement.classList.add('hidden');
    }, duration);
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ===================================
// SAFE RICH TEXT & AUTO-LINKIFY
// ===================================
function formatRichText(rawText) {
    if (!rawText) return '';

    // Step 1: Escape HTML to ensure absolute XSS immunity
    let text = escapeHtml(rawText);

    // Step 2: Code blocks `code`
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Step 3: Bold *text*
    text = text.replace(/(^|\s)\*([^*\s][^*]*[^*\s]|[^*])\*(?=\s|$|[.,!?;:])/g, '$1<strong>$2</strong>');

    // Step 4: Italics _text_
    text = text.replace(/(^|\s)_([^_\s][^_]*[^_\s]|[^_])_(?=\s|$|[.,!?;:])/g, '$1<em>$2</em>');

    // Step 5: Strikethrough ~text~
    text = text.replace(/(^|\s)~([^~\s][^~]*[^~\s]|[^~])~(?=\s|$|[.,!?;:])/g, '$1<del>$2</del>');

    // Step 6: Safe Auto-linkify (http://, https://, www.)
    const urlPattern = /((https?:\/\/|www\.)[^\s<]+)/gi;
    text = text.replace(urlPattern, (matchedUrl) => {
        const href = matchedUrl.toLowerCase().startsWith('http') ? matchedUrl : `http://${matchedUrl}`;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="chat-link">${matchedUrl}</a>`;
    });

    return text;
}

// ===================================
// RENDER MESSAGE TO DOM
// ===================================
function outputMessage(message) {
    const div = document.createElement('div');
    div.classList.add('message');
    if (message.id) {
        div.id = `msg-${message.id}`;
        div.dataset.id = message.id;
    }

    const isBot = message.username === 'ChatCord Bot';
    const isOwn = !isBot && username && (message.username.toLowerCase() === username.trim().toLowerCase());

    if (isBot) {
        div.classList.add('message-bot');
    } else if (isOwn) {
        div.classList.add('message-own');
    } else {
        div.classList.add('message-other');
    }

    let replyQuoteHtml = '';
    if (message.replyTo && message.replyTo.id) {
        const replyQuoteAuthor = (username && message.replyTo.username && message.replyTo.username.toLowerCase() === username.trim().toLowerCase())
            ? 'You'
            : escapeHtml(message.replyTo.username);

        replyQuoteHtml = `
            <div class="reply-quote" data-reply-to-id="${escapeHtml(message.replyTo.id)}" title="Click to view original message">
                <span class="reply-quote-author"><i class="fas fa-reply"></i> ${replyQuoteAuthor}</span>
                <span class="reply-quote-text">${escapeHtml(message.replyTo.text)}</span>
            </div>
        `;
    }

    const displayName = isOwn ? 'You' : escapeHtml(message.username);
    const actionsHtml = !isBot && message.id ? `
        <div class="message-actions">
            <button type="button" class="action-btn copy-btn" title="Copy text">
                <i class="far fa-copy"></i>
            </button>
            <button type="button" class="action-btn reply-btn" title="Reply" data-username="${escapeHtml(message.username)}">
                <i class="fas fa-reply"></i> Reply
            </button>
        </div>
    ` : '';

    const reactionBarHtml = !isBot && message.id ? `
        <div class="reaction-bar">
            <button type="button" class="react-quick-btn" data-emoji="👍" title="Thumbs Up">👍</button>
            <button type="button" class="react-quick-btn" data-emoji="❤️" title="Love">❤️</button>
            <button type="button" class="react-quick-btn" data-emoji="😂" title="Laugh">😂</button>
            <button type="button" class="react-quick-btn" data-emoji="🔥" title="Fire">🔥</button>
            <button type="button" class="react-quick-btn" data-emoji="🚀" title="Rocket">🚀</button>
        </div>
    ` : '';

    const checkmarksHtml = isOwn ? `<span class="check-marks" title="Delivered"><i class="fas fa-check-double"></i></span>` : '';

    const imageHtml = message.image ? `
        <div class="message-image-wrapper">
            <img src="${escapeHtml(message.image)}" class="message-image" alt="Attachment" />
        </div>
    ` : '';

    const textHtml = message.text ? `<p class="text">${formatRichText(message.text)}</p>` : '';

    div.innerHTML = `
        ${reactionBarHtml}
        <div class="message-header">
            <p class="meta">${displayName} <span>${escapeHtml(message.time)}${checkmarksHtml}</span></p>
            ${actionsHtml}
        </div>
        ${replyQuoteHtml}
        ${imageHtml}
        ${textHtml}
        <div class="message-reactions"></div>
    `;

    chatMessages.appendChild(div);
}

// ===================================
// EVENT DELEGATION FOR MESSAGE ACTIONS
// ===================================
chatMessages.addEventListener('click', (e) => {
    // Image clicked -> open lightbox modal
    const imgEl = e.target.closest('.message-image');
    if (imgEl) {
        openImageModal(imgEl.src);
        return;
    }

    // Reply button clicked
    const replyBtn = e.target.closest('.reply-btn');
    if (replyBtn) {
        const messageDiv = replyBtn.closest('.message');
        if (!messageDiv) return;
        const id = messageDiv.dataset.id;
        const author = replyBtn.dataset.username;
        const textEl = messageDiv.querySelector('.text');
        const text = textEl ? textEl.textContent.trim() : (messageDiv.querySelector('.message-image') ? '📷 [Image]' : '');
        setReplyTarget(id, author, text);
        return;
    }

    // Copy message button clicked
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
        const messageDiv = copyBtn.closest('.message');
        if (!messageDiv) return;
        const textEl = messageDiv.querySelector('.text');
        const text = textEl ? textEl.textContent.trim() : '';
        if (text && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => showToast('Message copied to clipboard!'));
        } else if (text) {
            showToast('Copied: ' + text.slice(0, 30));
        }
        return;
    }

    // Quick Reaction clicked from hover bar
    const reactQuickBtn = e.target.closest('.react-quick-btn');
    if (reactQuickBtn) {
        const messageDiv = reactQuickBtn.closest('.message');
        if (!messageDiv) return;
        const id = messageDiv.dataset.id;
        const emoji = reactQuickBtn.dataset.emoji;
        if (id && emoji) {
            socket.emit('messageReaction', { messageId: id, emoji });
        }
        return;
    }

    // Reaction pill clicked (re-reacting)
    const reactionPill = e.target.closest('.reaction-pill');
    if (reactionPill) {
        const messageDiv = reactionPill.closest('.message');
        if (!messageDiv) return;
        const id = messageDiv.dataset.id;
        const emoji = reactionPill.dataset.emoji;
        if (id && emoji) {
            socket.emit('messageReaction', { messageId: id, emoji });
        }
        return;
    }

    // Reply Quote clicked -> navigate to original message
    const replyQuote = e.target.closest('.reply-quote');
    if (replyQuote) {
        const targetId = replyQuote.dataset.replyToId;
        if (!targetId) return;

        const targetEl = document.getElementById(`msg-${targetId}`);
        if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetEl.classList.remove('highlight-message');
            void targetEl.offsetWidth;
            targetEl.classList.add('highlight-message');
        } else {
            showToast('Original message unavailable');
        }
    }
});

// Double-click on any message to trigger quick reply
chatMessages.addEventListener('dblclick', (e) => {
    const messageDiv = e.target.closest('.message');
    if (!messageDiv || messageDiv.classList.contains('message-bot')) return;

    const id = messageDiv.dataset.id;
    const replyBtn = messageDiv.querySelector('.reply-btn');
    const author = replyBtn ? replyBtn.dataset.username : (messageDiv.classList.contains('message-own') ? username : '');
    const textEl = messageDiv.querySelector('.text');
    const text = textEl ? textEl.textContent.trim() : (messageDiv.querySelector('.message-image') ? '📷 [Image]' : '');

    if (id && text) {
        setReplyTarget(id, author, text);
    }
});

// Real-time DOM reaction updater
function applyReactionToDOM(messageId, emoji, reactor) {
    const messageDiv = document.getElementById(`msg-${messageId}`);
    if (!messageDiv) return;

    const reactionsContainer = messageDiv.querySelector('.message-reactions');
    if (!reactionsContainer) return;

    let pill = reactionsContainer.querySelector(`.reaction-pill[data-emoji="${emoji}"]`);
    const isCurrentUser = username && reactor && reactor.toLowerCase() === username.toLowerCase();

    if (pill) {
        const countSpan = pill.querySelector('.reaction-count');
        const currentCount = parseInt(countSpan.textContent, 10) || 1;
        countSpan.textContent = currentCount + 1;
        if (isCurrentUser) pill.classList.add('reacted');
    } else {
        pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `reaction-pill ${isCurrentUser ? 'reacted' : ''}`;
        pill.dataset.emoji = emoji;
        pill.innerHTML = `${emoji} <span class="reaction-count">1</span>`;
        reactionsContainer.appendChild(pill);
    }
}

// Users and room helpers
function outputUsers(users) {
    if (userCount) userCount.textContent = users.length;
    userList.innerHTML = users.map(user => `
        <li><span class="user-status-dot"></span> ${escapeHtml(user.username)}</li>
    `).join('');
}

function outputRoomName(room) {
    roomName.textContent = room;
}