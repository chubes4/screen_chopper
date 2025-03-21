const DEVICE_SCALE_FACTOR = 4; // explicitly define once at the top
const MOBILE_WIDTH = 450;
let currentPercentage = 100;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'resizeAndPrepare') {
    currentPercentage = request.percentage || 100;

    (async () => {
      let tab;
      const aspectRatio = request.aspectRatio;

      try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.debugger.attach({ tabId: tab.id }, '1.3');

        const { result: { value: totalHeight } } = await chrome.debugger.sendCommand(
          { tabId: tab.id }, 'Runtime.evaluate',
          { expression: 'document.body.scrollHeight', returnByValue: true }
        );

        const adjustedHeight = Math.floor(totalHeight * (currentPercentage / 100));

        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Emulation.setDeviceMetricsOverride', {
          width: MOBILE_WIDTH,
          height: adjustedHeight,
          deviceScaleFactor: DEVICE_SCALE_FACTOR, // explicitly use the same value
          mobile: true,
        });

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async (percentage) => {
            const delay = ms => new Promise(res => setTimeout(res, ms));
            const totalHeight = document.body.scrollHeight * (percentage / 100);
            const viewportHeight = window.innerHeight;
        
            for (let i = 0; i < totalHeight; i += viewportHeight / 2) {
              window.scrollTo(0, i);
              await delay(150); // Explicitly optimized delay per scroll step
            }
            window.scrollTo(0, 0);
            await delay(500); // Explicitly optimized delay after scrolling
          },
          args: [currentPercentage]
        });
        

        await new Promise(r => setTimeout(r, 1500));
        await chrome.debugger.detach({ tabId: tab.id });

        await chrome.tabs.sendMessage(tab.id, {
          action: 'enableElementSelection',
          aspectRatio,
          percentage: currentPercentage
        });

        sendResponse({ status: 'ready' });
      } catch (error) {
        if (tab && tab.id) {
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
      const startOffset = request.offset;
      const aspectRatio = request.aspectRatio;

      try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        await chrome.debugger.attach({ tabId: tab.id }, '1.3');

        const { result: { value: totalHeight } } = await chrome.debugger.sendCommand(
          { tabId: tab.id }, 'Runtime.evaluate',
          { expression: 'document.body.scrollHeight', returnByValue: true }
        );

        const adjustedHeight = Math.floor(totalHeight * (currentPercentage / 100));

        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Emulation.setDeviceMetricsOverride', {
          width: MOBILE_WIDTH,
          height: adjustedHeight,
          deviceScaleFactor: DEVICE_SCALE_FACTOR, // explicitly use the same value
          mobile: true,
        });

        await new Promise(r => setTimeout(r, 1000));

        const screenshot = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true
        });

        await chrome.debugger.detach({ tabId: tab.id });

        chrome.tabs.sendMessage(tab.id, {
          action: 'processImage',
          imageData: screenshot.data,
          aspectRatio,
          title: tab.title,
          startOffset: Math.floor(startOffset * DEVICE_SCALE_FACTOR), // explicitly matched to scale factor
          percentage: currentPercentage
        });

      } catch (error) {
        if (tab && tab.id) {
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
