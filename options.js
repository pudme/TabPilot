// options.js - Logic for the options page

const patternsList = document.getElementById('patterns-list');
const newPatternInput = document.getElementById('new-pattern');
const newTitleInput = document.getElementById('new-title');
const newColorSelect = document.getElementById('new-color');
const addButton = document.getElementById('add-button');
const statusMessage = document.getElementById('status');

let currentPatterns = [];

// --- Functions ---

function displayStatus(message, isError = false, isSuccess = false) {
    statusMessage.textContent = message;
    statusMessage.className = ''; // Clear previous classes
    if (isError) {
        statusMessage.classList.add('error');
    } else if (isSuccess) {
        statusMessage.classList.add('success');
    }
    const duration = isError ? 4000 : 2500;
    setTimeout(() => {
        statusMessage.textContent = '';
        statusMessage.className = '';
    }, duration);
}

function renderPatterns() {
    const loadingPara = patternsList.querySelector('p'); // Find loading message
    patternsList.innerHTML = ''; // Clear existing list
    if (currentPatterns.length === 0) {
        patternsList.innerHTML = '<p>No patterns defined yet.</p>';
        return;
    }

    currentPatterns.forEach((pattern, index) => {
        const item = document.createElement('div');
        item.classList.add('pattern-item');

        const details = document.createElement('div');
        details.classList.add('pattern-details');
        
        const patternText = document.createElement('span');
        patternText.innerHTML = `Pattern: <strong>"${pattern.pattern}"</strong>`;
        
        const titleText = document.createElement('span');
        titleText.innerHTML = `Title: <strong>"${pattern.groupTitle}"</strong>`;
        
        const colorContainer = document.createElement('span');
        const colorPreview = document.createElement('span');
        colorPreview.classList.add('color-preview');
        colorPreview.style.backgroundColor = pattern.color;
        colorContainer.textContent = `Color: `;
        colorContainer.appendChild(colorPreview);

        details.appendChild(patternText);
        details.appendChild(titleText);
        details.appendChild(colorContainer);

        const removeButton = document.createElement('button');
        removeButton.textContent = 'Remove';
        removeButton.classList.add('remove-button'); // Add class for styling
        removeButton.addEventListener('click', () => removePattern(index));

        item.appendChild(details);
        item.appendChild(removeButton);
        patternsList.appendChild(item);
    });
}

async function loadPatterns() {
    try {
        const data = await chrome.storage.sync.get('groupingPatterns');
        currentPatterns = data.groupingPatterns || [];
        renderPatterns();
    } catch (error) {
        console.error("Error loading patterns:", error);
        displayStatus('Error loading patterns.', true);
        // Ensure loading message is removed on error too
        const loadingPara = patternsList.querySelector('p');
        if (loadingPara && loadingPara.textContent.includes('Loading')) {
            loadingPara.remove();
        }
    }
}

async function savePatterns() {
    try {
        await chrome.storage.sync.set({ groupingPatterns: currentPatterns });
        displayStatus('Patterns saved successfully!', false, true); // Mark as success
        renderPatterns();
    } catch (error) {
        console.error("Error saving patterns:", error);
        displayStatus('Error saving patterns.', true);
    }
}

function addPattern() {
    const pattern = newPatternInput.value.trim();
    const title = newTitleInput.value.trim();
    const color = newColorSelect.value;

    if (!pattern || !title) {
        displayStatus('Pattern and Title cannot be empty.', true);
        return;
    }
    
    // Prevent overly simple/problematic patterns (example)
    if (pattern === "*") {
        displayStatus('Pattern cannot be just "*".', true);
        return;
    }

    // Check for duplicate patterns (case-insensitive)
    if (currentPatterns.some(p => p.pattern.toLowerCase() === pattern.toLowerCase())) {
      displayStatus('This pattern already exists.', true);
      return;
    }
    // Optional: Check for duplicate titles?
    // if (currentPatterns.some(p => p.groupTitle.toLowerCase() === title.toLowerCase())) {
    //   displayStatus('A group with this title already exists (though using a different pattern).', true);
    //   return;
    // }

    currentPatterns.push({ pattern: pattern, groupTitle: title, color: color });
    savePatterns();

    newPatternInput.value = '';
    newTitleInput.value = '';
    newColorSelect.value = 'grey';
}

function removePattern(index) {
    currentPatterns.splice(index, 1);
    savePatterns(); // Save and re-render
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Load regular options content
    loadPatterns();

    // Add event listeners for non-auth buttons
    addButton.addEventListener('click', addPattern);
    // Note: removeButton listeners are added dynamically in renderPatterns
}); 