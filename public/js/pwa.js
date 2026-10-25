/**
 * ChatCord PWA Controller
 * Handles Service Worker registration, install prompts, offline status, and iOS hints.
 */
(() => {
  'use strict';

  let deferredInstallPrompt = null;

  // 1. Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered with scope:', reg.scope);

          // Check for worker updates
          reg.addEventListener('updatefound', () => {
            const installingWorker = reg.installing;
            if (!installingWorker) return;

            installingWorker.addEventListener('statechange', () => {
              if (
                installingWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                showPwaToast('New update available! Tap to refresh.', 6000, () => {
                  installingWorker.postMessage({ type: 'SKIP_WAITING' });
                  window.location.reload();
                });
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

  // Expose triggers globally for header buttons
  window.ChatCordPWA = {
    triggerInstall,
    showPwaToast
  };
})();
