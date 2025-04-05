(() => {


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
    // Now we expect startOffset to be the user-selected offset
    const { imageData, aspectRatio, title, startOffset, percentage } = request;
  
    showNotification('🛠 Processing images... Please wait.', false);
  
    const img = new Image();
    img.src = `data:image/jpeg;base64,${imageData}`; // full-page screenshot
    img.onload = async () => {
      // Calculate the cropped height from the selected starting point.
      const captureHeight = Math.max(0, img.height - startOffset);
  
      // Create a canvas to crop the full screenshot starting at startOffset.
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = img.width;
      croppedCanvas.height = captureHeight;
      const croppedCtx = croppedCanvas.getContext('2d');
      // Draw the image shifted upward by startOffset.
      croppedCtx.drawImage(img, 0, 0);
  
      // Create an image from the cropped canvas.
      const croppedImg = new Image();
      croppedImg.src = croppedCanvas.toDataURL();
      croppedImg.onload = async () => {
        const scaledWidth = croppedImg.width;   // Width of the cropped image
        const scaledHeight = croppedImg.height;   // Height of the cropped image
  
        const effectiveHeight = scaledHeight;
  
        // Calculate chunk dimensions based on the cropped image and desired aspect ratio.
        const chunkWidth = scaledWidth;
        const chunkHeight = Math.floor(chunkWidth * (aspectRatio.height / aspectRatio.width));
        const totalChunks = Math.ceil(effectiveHeight / chunkHeight);
        const zip = new JSZip();
  
        for (let i = 0; i < totalChunks; i++) {
          const partCanvas = document.createElement('canvas');
          partCanvas.width = chunkWidth;
          partCanvas.height =
            i === totalChunks - 1 ? effectiveHeight - chunkHeight * i : chunkHeight;
          const partCtx = partCanvas.getContext('2d');
          partCtx.drawImage(croppedImg, 0, -chunkHeight * i);
          const blob = await new Promise((resolve) =>
            partCanvas.toBlob(resolve)
          );
          zip.file(
            `${title.replace(/[^a-zA-Z0-9]/g, '_')}_carousel_${i + 1}.jpeg`,
            blob
          );
        }
  
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipUrl = URL.createObjectURL(zipBlob);
  
        removeNotification(); // Remove processing notification
  
        // Trigger the download.
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
  const selectedRect = targetDiv.getBoundingClientRect();
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
        clipRect: selectedRect, // Send the bounding rect
      });
    }, 300); // Enough time to ensure the notification disappears visually
  }, 500);
}

/** Creates an absolutely positioned overlay that we can move/highlight. */
function createOverlay() {
  highlightOverlay = document.createElement('div');
  highlightOverlay.style.position = 'fixed'; /* Changed to fixed */
  highlightOverlay.style.backgroundColor = 'rgba(0, 170, 255, 0.4)'; /* Slightly transparent background */
  highlightOverlay.style.borderTop = '2px solid #0088ff'; /* Bottom border for visual clarity */
  highlightOverlay.style.pointerEvents = 'none';
  highlightOverlay.style.zIndex = '2147483647';
  highlightOverlay.style.display = 'none';
  highlightOverlay.style.width = '100%'; /* Full width highlight */
  highlightOverlay.style.left = '0';      /* Align to the left edge */
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
})();
