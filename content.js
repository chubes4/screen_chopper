let currentHighlight;
let highlightOverlay;
let currentAspectRatio;

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'enableElementSelection') {
    // 1. Store aspect ratio
    currentAspectRatio = request.aspectRatio;

    // 2. Show a quick note telling user to pick the starting section
    showNotification('🔍 Click on the desired starting section.');

    // 3. Create the highlight overlay and attach mouse/click handlers
    createOverlay();
    document.addEventListener('mousemove', highlightElement, true);
    document.addEventListener('click', selectElement, true);
  }

  // Called AFTER the screenshot is taken in background.js
  if (request.action === 'processImage') {
    const { imageData, aspectRatio, title, startOffset, percentage } = request;

    // We show "Processing images..." only after screenshot is done
    showNotification('🛠 Processing images... Please wait.', false);

    const img = new Image();
    img.src = `data:image/png;base64,${imageData}`;
    img.onload = async () => {
      const scaleFactor = 4; // match background.js deviceScaleFactor
      const scaledWidth = img.width;
      const scaledHeight = img.height;

      const chunkWidth = scaledWidth;
      const chunkHeight = Math.floor(
        chunkWidth * (aspectRatio.height / aspectRatio.width)
      );

      const canvas = document.createElement('canvas');
      const maxHeight = scaledHeight - startOffset;
      const captureHeight = Math.min(
        Math.floor(maxHeight * (percentage / 100)),
        maxHeight
      );
      canvas.width = chunkWidth;
      canvas.height = captureHeight;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, -startOffset);

      const adjustedImgBlob = await new Promise((resolve) => canvas.toBlob(resolve));
      const adjustedImg = new Image();
      adjustedImg.src = URL.createObjectURL(adjustedImgBlob);

      adjustedImg.onload = async () => {
        const totalChunks = Math.ceil(captureHeight / chunkHeight);
        const zip = new JSZip();

        for (let i = 0; i < totalChunks; i++) {
          const partCanvas = document.createElement('canvas');
          partCanvas.width = chunkWidth;
          partCanvas.height =
            i === totalChunks - 1 ? captureHeight - chunkHeight * i : chunkHeight;

          const partCtx = partCanvas.getContext('2d');
          partCtx.drawImage(adjustedImg, 0, -chunkHeight * i);

          const blob = await new Promise((resolve) => partCanvas.toBlob(resolve));
          zip.file(
            `${title.replace(/[^a-zA-Z0-9]/g, '_')}_carousel_${i + 1}.png`,
            blob
          );
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipUrl = URL.createObjectURL(zipBlob);

        // Remove "Processing..." notification before the download
        removeNotification();

        // Trigger the download
        chrome.runtime.sendMessage({
          action: 'downloadZip',
          url: zipUrl,
          filename: `${title.replace(/[^a-zA-Z0-9]/g, '_')}_carousel_images.zip`,
        });
      };
    };
  }
});

/** Highlights whichever DIV user is hovering */
function highlightElement(e) {
  const targetDiv = e.target.closest('div');
  if (targetDiv) {
    currentHighlight = targetDiv;
    const rect = targetDiv.getBoundingClientRect();

    Object.assign(highlightOverlay.style, {
      top: `${rect.top + window.scrollY}px`,
      left: `${rect.left + window.scrollX}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      opacity: '0.4',
      display: 'block',
    });

    e.stopPropagation();
  } else {
    // Hide overlay if no div found under mouse
    highlightOverlay.style.display = 'none';
  }
}

/** Handles the user's click to select the DIV and trigger screenshot */
function selectElement(e) {
  e.preventDefault();
  e.stopPropagation();

  const targetDiv = e.target.closest('div');
  const selectedStartOffset = targetDiv.getBoundingClientRect().top + window.scrollY;

  removeOverlay();     // Remove highlight overlay
  cleanupListeners();  // Remove mouse/click handlers

  // Remove any existing notifications (so none are visible in final screenshot)
  removeNotification();

  // Show a short "Capturing screenshots" message
  showNotification('⏳ Capturing screenshots, please don’t navigate away!');

  // Wait a bit, then remove that notification, then capture
  setTimeout(() => {
    removeNotification();

    // Wait a small moment for DOM to update
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'startCaptureFromOffset',
        offset: selectedStartOffset,
        aspectRatio: currentAspectRatio,
      });
    }, 300); // Enough time to ensure the notification disappears visually
  }, 500);
}

/** Creates an absolutely positioned overlay that we can move/highlight. */
function createOverlay() {
  highlightOverlay = document.createElement('div');
  highlightOverlay.style.position = 'absolute';
  highlightOverlay.style.backgroundColor = '#00aaff';
  highlightOverlay.style.border = '2px solid #0088ff';
  highlightOverlay.style.pointerEvents = 'none';
  highlightOverlay.style.zIndex = '2147483647';
  highlightOverlay.style.display = 'none';
  highlightOverlay.style.transition = 'opacity 0.2s ease-in-out';

  document.body.appendChild(highlightOverlay);
}

/** Removes overlay entirely from DOM */
function removeOverlay() {
  if (highlightOverlay && document.body.contains(highlightOverlay)) {
    document.body.removeChild(highlightOverlay);
    highlightOverlay = null;
  }
}

/** Remove event listeners for highlight/click so we don't keep highlighting */
function cleanupListeners() {
  document.removeEventListener('mousemove', highlightElement, true);
  document.removeEventListener('click', selectElement, true);
}

/** Show a notification message at top-center; autoHide = false => stays until manually removed */
function showNotification(msg, autoHide = true) {
  removeNotification(); // remove any old notification

  const notification = document.createElement('div');
  notification.id = 'capture-notification';
  notification.textContent = msg;
  notification.classList.add('capture-notification');

  Object.assign(notification.style, {
    position: 'fixed',
    top: '10px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 12px',
    backgroundColor: '#1a73e8',
    color: '#fff',
    borderRadius: '5px',
    zIndex: '99999',
    fontSize: '14px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  });

  document.body.appendChild(notification);

  if (autoHide) {
    setTimeout(() => {
      removeNotification();
    }, 2000);
  }
}

/** Immediately removes any notification from the DOM. */
function removeNotification() {
  const existing = document.getElementById('capture-notification');
  if (existing) existing.remove();
}
