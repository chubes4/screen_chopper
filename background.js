const DEVICE_SCALE_FACTOR = 2; // explicitly define once at the top
const MOBILE_WIDTH = 450;
let currentPercentage = 100;

async function fullyDisableLazyLoading() {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Remove lazy loading attributes from images and iframes
  document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]').forEach(el => {
    el.removeAttribute('loading');
  });

  // Handle common lazy loading patterns by setting src from data-src/data-lazy/etc.
  document.querySelectorAll('img, iframe').forEach(el => {
    const src = el.getAttribute('src');
    if (!src) {
      const lazySrc = el.getAttribute('data-src') || el.getAttribute('data-lazy') || el.getAttribute('data-srcset');
      if (lazySrc) {
        el.setAttribute('src', lazySrc);
      }
    }
  });

  // Force a scroll through the entire page height to trigger loading
  const totalHeight = document.body.scrollHeight;
  const viewportHeight = window.innerHeight;
  const increment = viewportHeight / 2; // Scroll in half-viewport increments for reliability
  
  for (let position = 0; position <= totalHeight; position += increment) {
    window.scrollTo(0, position);
    await delay(150); // wait briefly to ensure content loads
  }

  window.scrollTo(0, 0); // Return to the top after loading
  
  // Wait until all images have loaded completely
  const allImages = Array.from(document.images);
  await Promise.all(allImages.map(img => new Promise(resolve => {
    if (img.complete && img.naturalHeight !== 0) {
      resolve();
    } else {
      img.onload = img.onerror = resolve;
    }
  })));

  // Additional slight delay to ensure stability
  await delay(500);
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'resizeAndPrepare') {
    currentPercentage = request.percentage || 100;
    (async () => {
      let tab;
      const aspectRatio = request.aspectRatio;
      try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Disable lazy loading before attaching debugger
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: fullyDisableLazyLoading,
        });
        

        await chrome.debugger.attach({ tabId: tab.id }, '1.3');

        // Get original dimensions from the page.
        const origData = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            origWidth: window.innerWidth,
            origScrollHeight: document.body.scrollHeight
          }),
          injectImmediately: true
        });
        const { origWidth, origScrollHeight } = origData[0].result;
        const scaleFactor = MOBILE_WIDTH / origWidth;
        const calculatedHeight = Math.ceil(origScrollHeight / scaleFactor);

        console.log('Original width:', origWidth);
        console.log('Original scrollHeight:', origScrollHeight);
        console.log('Scale factor:', scaleFactor);
        console.log('Calculated height for mobile:', calculatedHeight);

        // Get the natural viewport height from the page.
        const { result: { value: viewportHeight } } = await chrome.debugger.sendCommand(
          { tabId: tab.id },
          'Runtime.evaluate',
          { expression: 'window.innerHeight', returnByValue: true }
        );

        // Set device metrics using the natural viewport height so that scrolling is enabled.
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Emulation.setDeviceMetricsOverride', {
          width: MOBILE_WIDTH,
          height: viewportHeight,
          screenHeight: viewportHeight,
          mobile: true, // Keep mobile: true
          deviceScaleFactor: DEVICE_SCALE_FACTOR, // Set deviceScaleFactor to 1 to disable scaling
        });

        // Inject content scripts for element selection.
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["jszip.min.js", "content.js"]
        });
        await chrome.tabs.sendMessage(tab.id, {
          action: 'enableElementSelection',
          aspectRatio,
          percentage: currentPercentage
        });

        sendResponse({ status: 'ready' });
      } catch (error) {
        if (tab && tab.id && await isDebuggerAttached(tab.id)) {
          await chrome.debugger.detach({ tabId: tab.id });
        }
        sendResponse({ status: 'error', message: error.message });
      }
    })();
    return true;
  }

  if (request.action === 'startCaptureFromOffset') {
    (async () => {
      let tab;
      const startOffset = request.offset; // CSS pixel offset from content.js
      const clipRect = request.clipRect;   // Bounding rect of selected div
      const aspectRatio = request.aspectRatio;
      try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Get full page height (after mobile reflow).
        const { result: { value: totalHeight } } = await chrome.debugger.sendCommand(
          { tabId: tab.id },
          'Runtime.evaluate',
          { expression: 'document.body.scrollHeight', returnByValue: true }
        );

        // Capture the full page screenshot using captureBeyondViewport: true.
        const screenshot = await chrome.debugger.sendCommand(
          { tabId: tab.id },
          'Page.captureScreenshot',
          {
            format: 'jpeg', // Switch to JPEG format
            quality: 100,   // Set quality to 100
            captureBeyondViewport: true, // Capture beyond the viewport
            clip: {
              x: 0,           // Always start from the left edge
              y: startOffset, // Use document-relative startOffset for clip.y
              width: MOBILE_WIDTH, // Set clip width to MOBILE_WIDTH (full page width)
              height: Math.ceil(((totalHeight - startOffset) * (currentPercentage / 100))),
              scale: 1, // Use DEVICE_SCALE_FACTOR for scaling
            }
          }
        );
        
        

        if (await isDebuggerAttached(tab.id)) {
          await chrome.debugger.detach({ tabId: tab.id });
        }

        // Send the full screenshot along with the selected start offset to content.js.
        chrome.tabs.sendMessage(tab.id, {
          action: 'processImage',
          imageData: screenshot.data,
          aspectRatio,
          title: tab.title,
          startOffset: startOffset, // content.js will crop based on this.
          percentage: currentPercentage
        });
      } catch (error) {
        if (tab && tab.id && await isDebuggerAttached(tab.id)) {
          await chrome.debugger.detach({ tabId: tab.id });
        }
        console.error('Capture error:', error);
      }
    })();
  }

  if (request.action === 'downloadZip') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename
    });
  }
});

// Helper: Check if the debugger is attached before detaching.
chrome.debugger.onDetach.addListener((source, reason) => {
  console.log(`Debugger detached. Reason: ${reason}`);
  chrome.tabs.reload(source.tabId);
});
async function isDebuggerAttached(tabId) {
  const attachedTabs = await chrome.debugger.getTargets();
  return attachedTabs.some(target => target.tabId === tabId);
}
// Explicitly detach debugger on navigation or tab update
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url) {
    if (await isDebuggerAttached(tabId)) {
      console.log(`Detaching debugger from tab ${tabId} due to URL change.`);
      await chrome.debugger.detach({ tabId });
    }
  }
});
