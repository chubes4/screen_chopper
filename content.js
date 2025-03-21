let currentHighlight;
let highlightOverlay;
let currentAspectRatio;

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'enableElementSelection') {
    currentAspectRatio = request.aspectRatio;
    showNotification('🔍 Click on the desired starting section.');

    createOverlay();

    document.addEventListener('mousemove', highlightElement, true);
    document.addEventListener('click', selectElement, true);
  }

  if (request.action === 'processImage') {
    const { imageData, aspectRatio, title, startOffset, percentage } = request;
  
    const img = new Image();
    img.src = `data:image/png;base64,${imageData}`;
    img.onload = async () => {
  
      const scaleFactor = 4; // Match this explicitly with the background.js deviceScaleFactor
      const scaledWidth = img.width;
      const scaledHeight = img.height;
  
      const chunkWidth = scaledWidth;
      const chunkHeight = Math.floor(chunkWidth * (aspectRatio.height / aspectRatio.width));
  
      const canvas = document.createElement('canvas');
  
      const maxHeight = scaledHeight - startOffset;
      const captureHeight = Math.min(Math.floor(maxHeight * (percentage / 100)), maxHeight);
      canvas.width = chunkWidth;
      canvas.height = captureHeight;
  
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, -startOffset);
  
      const adjustedImgBlob = await new Promise(resolve => canvas.toBlob(resolve));
      const adjustedImg = new Image();
      adjustedImg.src = URL.createObjectURL(adjustedImgBlob);
      adjustedImg.onload = async () => {
        const totalChunks = Math.ceil(captureHeight / chunkHeight);
        const zip = new JSZip();
  
        for (let i = 0; i < totalChunks; i++) {
          const partCanvas = document.createElement('canvas');
          partCanvas.width = chunkWidth;
          partCanvas.height = (i === totalChunks - 1) ? captureHeight - (chunkHeight * i) : chunkHeight;
  
          const partCtx = partCanvas.getContext('2d');
          partCtx.drawImage(adjustedImg, 0, -chunkHeight * i);
  
          const blob = await new Promise(resolve => partCanvas.toBlob(resolve));
  
          zip.file(`${title.replace(/[^a-zA-Z0-9]/g, '_')}_carousel_${i + 1}.png`, blob);
        }
  
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipUrl = URL.createObjectURL(zipBlob);
  
        chrome.runtime.sendMessage({
          action: 'downloadZip',
          url: zipUrl,
          filename: `${title.replace(/[^a-zA-Z0-9]/g, '_')}_carousel_images.zip`
        });
      };
    };
  }
   
});

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
      display: 'block'
    });

    e.stopPropagation();
  } else {
    // explicitly hide overlay if no div found
    highlightOverlay.style.display = 'none';
  }
}


function selectElement(e) {
  e.preventDefault();
  e.stopPropagation();

  const targetDiv = e.target.closest('div');
  const selectedStartOffset = targetDiv.getBoundingClientRect().top + window.scrollY;

  removeOverlay();
  cleanupListeners();

  showNotification('⏳ Capturing screenshots, please don’t navigate away!');

  setTimeout(() => {
    chrome.runtime.sendMessage({
      action: 'startCaptureFromOffset',
      offset: selectedStartOffset,
      aspectRatio: currentAspectRatio
    });
  }, 500);
}

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

function removeOverlay() {
  if (highlightOverlay && document.body.contains(highlightOverlay)) {
    document.body.removeChild(highlightOverlay);
    highlightOverlay = null;
  }
}

function cleanupListeners() {
  document.removeEventListener('mousemove', highlightElement, true);
  document.removeEventListener('click', selectElement, true);
}

function showNotification(msg) {
  const notification = document.createElement('div');
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
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
  });

  document.body.appendChild(notification);

  setTimeout(() => {
    if (document.body.contains(notification)) {
      document.body.removeChild(notification);
    }
  }, 2000);
}
