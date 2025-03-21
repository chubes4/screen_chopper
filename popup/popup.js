document.addEventListener('DOMContentLoaded', () => {
  const captureBtn = document.getElementById('capture-btn');
  const aspectSelect = document.getElementById('aspect-ratio');
  const capturePercentage = document.getElementById('capture-percentage');
  const percentageDisplay = document.getElementById('percentage-display');

  function saveSettings() {
    chrome.storage.local.set({
      aspectRatio: aspectSelect.value,
      capturePercentage: capturePercentage.value
    });
  }

  function loadSettings() {
    chrome.storage.local.get(['aspectRatio', 'capturePercentage'], (data) => {
      if (data.aspectRatio) aspectSelect.value = data.aspectRatio;
      if (data.capturePercentage) {
        capturePercentage.value = data.capturePercentage;
        percentageDisplay.textContent = data.capturePercentage + '%';
      }
    });
  }

  capturePercentage.addEventListener('input', () => {
    percentageDisplay.textContent = capturePercentage.value + '%';
    saveSettings();
  });

  aspectSelect.addEventListener('change', saveSettings);

  captureBtn.addEventListener('click', () => {
    const selectedAspect = aspectSelect.value;
    const aspectRatios = {
      '1:1': { width: 1, height: 1 },
      '4:5': { width: 4, height: 5 },
      '1.91:1': { width: 1.91, height: 1 },
      '9:16': { width: 9, height: 16 },
    };

    const aspectRatio = aspectRatios[selectedAspect] || { width: 1, height: 1 };
    const percentage = parseInt(capturePercentage.value, 10);

    chrome.runtime.sendMessage({ action: 'resizeAndPrepare', aspectRatio, percentage }, (response) => {
      if (response.status === 'ready') {
        // Close the popup so first click on page registers
        window.close(); 
      } else {
        alert(`Error: ${response.message}`);
      }
    });
  });

  loadSettings();
});
