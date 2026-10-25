/**
 * ChatCord PWA Controller
 * Handles Service Worker registration, install prompts, offline status, and iOS hints.
 */
(() => {
  'use strict';

  let deferredInstallPrompt = null;

  // 1. Register Service Worker with seamless auto-update
  if ('serviceWorker' in navigator) {
    let refreshing = false;

    // When the new service worker activates and claims the page, auto-reload cleanly
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered with scope:', reg.scope);

          // Force an immediate update check on load
          reg.update().catch(() => {});

          // Check for updates whenever the user switches back to the app / unlocks phone
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              reg.update().catch(() => {});
            }
          });

          // Check for worker updates
          reg.addEventListener('updatefound', () => {
            const installingWorker = reg.installing;
            if (!installingWorker) return;

            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  // Existing user receiving an update: activate immediately!
                  showPwaToast('⚡ Updating ChatCord to latest version...', 2500);
                  installingWorker.postMessage({ type: 'SKIP_WAITING' });
                }
              }
            });
          });
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    });
  }

  // 2. Setup In-App Install Prompt Banner & Buttons
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default mini-infobar or auto prompt
    e.preventDefault();
    deferredInstallPrompt = e;

    // Show custom install UI
    showInstallPrompts();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideInstallPrompts();
    showPwaToast('🎉 ChatCord installed successfully!');
    console.log('[PWA] Application installed to device');
  });

  function showInstallPrompts() {
    // 1. Top banner on index.html if present
    const joinInstallBanner = document.getElementById('pwa-install-banner');
    if (joinInstallBanner) {
      joinInstallBanner.classList.remove('hidden');
    }

    // 2. Install buttons
    const installBtns = document.querySelectorAll('.pwa-install-btn');
    installBtns.forEach((btn) => {
      btn.classList.remove('hidden');
      btn.onclick = triggerInstall;
    });
  }

  function hideInstallPrompts() {
    const joinInstallBanner = document.getElementById('pwa-install-banner');
    if (joinInstallBanner) joinInstallBanner.classList.add('hidden');

    const installBtns = document.querySelectorAll('.pwa-install-btn');
    installBtns.forEach((btn) => btn.classList.add('hidden'));
  }

  async function triggerInstall() {
    if (!deferredInstallPrompt) {
      // Check if iOS Safari
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

      if (isIos && !isStandalone) {
        showPwaToast('To install on iPhone/iPad: tap Share <i class="fas fa-share-square"></i> then "Add to Home Screen" <i class="far fa-plus-square"></i>', 6000);
      } else {
        showPwaToast('ChatCord is already installed or your browser handles installation directly.', 4000);
      }
      return;
    }

    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log('[PWA] User response to install prompt:', outcome);
    deferredInstallPrompt = null;
    hideInstallPrompts();
  }

  // 3. Online / Offline Connectivity Notifications
  function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    let offlineBanner = document.getElementById('pwa-offline-banner');

    if (!isOnline) {
      if (!offlineBanner) {
        offlineBanner = document.createElement('div');
        offlineBanner.id = 'pwa-offline-banner';
        offlineBanner.className = 'pwa-offline-banner';
        offlineBanner.innerHTML = `
          <i class="fas fa-wifi-slash"></i>
          <span>You are offline. Reconnecting to chatroom...</span>
        `;
        document.body.prepend(offlineBanner);
      }
      offlineBanner.classList.remove('hidden');
    } else {
      if (offlineBanner) {
        offlineBanner.classList.add('hidden');
      }
    }
  }

  window.addEventListener('online', () => {
    updateOnlineStatus();
    showPwaToast('🟢 Back online! Reconnected to network.');
  });

  window.addEventListener('offline', () => {
    updateOnlineStatus();
    showPwaToast('🔴 Internet disconnected. Working offline.', 4000);
  });

  // Initial check
  if (!navigator.onLine) {
    updateOnlineStatus();
  }

  // 4. Lightweight Toast Utility for PWA alerts
  function showPwaToast(htmlMessage, duration = 3500, onClick = null) {
    let toast = document.getElementById('pwa-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pwa-toast';
      toast.className = 'pwa-toast';
      document.body.appendChild(toast);
    }

    toast.innerHTML = htmlMessage;
    toast.classList.add('show');

    if (onClick) {
      toast.style.cursor = 'pointer';
      toast.onclick = () => {
        onClick();
        toast.classList.remove('show');
      };
    } else {
      toast.style.cursor = 'default';
      toast.onclick = null;
    }

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  // 5. Mobile Virtual Keyboard & Viewport Fix
  // Fixes the issue where iOS Safari and Android pan/scroll the layout viewport upwards
  // when the virtual keyboard opens, pushing the header and top messages out of the screen.
  // By pinning the container's top and height directly to window.visualViewport,
  // the entire header remains 100% visible at the top of the user's screen at all times.
  function setupMobileViewportFix() {
    let ticking = false;

    function syncViewport() {
      const chatContainer = document.querySelector('.chat-container');
      if (!chatContainer) return;

      const isMobile =
        window.innerWidth <= 768 ||
        window.matchMedia('(display-mode: standalone)').matches ||
        'ontouchstart' in window;

      if (!isMobile) {
        chatContainer.style.removeProperty('top');
        chatContainer.style.removeProperty('height');
        chatContainer.style.removeProperty('position');
        document.documentElement.style.removeProperty('--app-top');
        document.documentElement.style.removeProperty('--app-height');
        return;
      }

      if (window.visualViewport) {
        const vv = window.visualViewport;
        const topPx = `${vv.offsetTop}px`;
        const heightPx = `${vv.height}px`;

        document.documentElement.style.setProperty('--app-top', topPx);
        document.documentElement.style.setProperty('--app-height', heightPx);

        chatContainer.style.setProperty('top', topPx, 'important');
        chatContainer.style.setProperty('height', heightPx, 'important');
        chatContainer.style.setProperty('position', 'fixed', 'important');

        // Detect if virtual keyboard is likely open (height is substantially less than full window)
        const isKeyboard = window.innerHeight - vv.height > 100;
        if (isKeyboard) {
          document.body.classList.add('keyboard-open');
        } else {
          document.body.classList.remove('keyboard-open');
        }
      } else {
        const heightPx = `${window.innerHeight}px`;
        document.documentElement.style.setProperty('--app-top', '0px');
        document.documentElement.style.setProperty('--app-height', heightPx);
        chatContainer.style.setProperty('top', '0px', 'important');
        chatContainer.style.setProperty('height', heightPx, 'important');
      }
    }

    function requestSync(scrollChatToBottom = false) {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          syncViewport();
          ticking = false;
          if (scrollChatToBottom) {
            const chatMessages = document.querySelector('.chat-messages');
            if (chatMessages) {
              chatMessages.scrollTop = chatMessages.scrollHeight;
            }
          }
        });
      }
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        requestSync(document.body.classList.contains('keyboard-open'));
      });

      window.visualViewport.addEventListener('scroll', () => {
        requestSync(false);
      });
    } else {
      window.addEventListener('resize', () => requestSync(false));
    }

    // When typing inputs or textareas are focused
    document.addEventListener('focusin', (e) => {
      if (e.target && e.target.matches && e.target.matches('input, textarea')) {
        const isMsg = e.target.id === 'msg';
        requestSync(isMsg);
        setTimeout(() => requestSync(isMsg), 60);
        setTimeout(() => requestSync(isMsg), 180);
        setTimeout(() => requestSync(isMsg), 350);
      }
    });

    document.addEventListener('focusout', (e) => {
      if (e.target && e.target.matches && e.target.matches('input, textarea')) {
        requestSync(false);
        setTimeout(() => {
          window.scrollTo(0, 0);
          requestSync(false);
        }, 100);
      }
    });

    // Prevent body bounce dragging outside of scrollable elements
    document.addEventListener(
      'touchmove',
      (e) => {
        if (!e.target.closest('.chat-messages, .chat-sidebar, .emoji-picker')) {
          if (document.querySelector('.chat-container')) {
            e.preventDefault();
          }
        }
      },
      { passive: false }
    );

    // Initial calculation
    syncViewport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupMobileViewportFix);
  } else {
    setupMobileViewportFix();
  }

  // Expose triggers globally for header buttons
  window.ChatCordPWA = {
    triggerInstall,
    showPwaToast,
    setupMobileViewportFix
  };
})();

