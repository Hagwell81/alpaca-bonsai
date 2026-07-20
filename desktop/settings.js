/**
 * Settings Module - Handles HuggingFace token storage/retrieval from Secret_Vault
 * 
 * This module provides functions to:
 * - Load HF token from Secret_Vault on page load
 * - Save HF token to Secret_Vault when user updates it
 * - Display token status and expiration warnings
 * - Handle errors gracefully with user feedback
 */

const HF_TOKEN_KEY = 'hf_token';
const HF_TOKEN_METADATA_KEY = 'hf_token_metadata';

/**
 * Initialize the HF token settings on page load
 * Loads the token from Secret_Vault and displays its status
 */
async function initializeHFTokenSettings() {
  try {
    console.log('[Settings] Initializing HF token settings...');
    
    // Check if Secret_Vault API is available
    if (!window.secretVaultAPI) {
      console.warn('[Settings] Secret_Vault API not available, using localStorage fallback');
      loadHFTokenFromLocalStorage();
      return;
    }

    // Check if Secret_Vault is initialized
    const isInitialized = await window.secretVaultAPI.isInitialized();
    if (!isInitialized) {
      console.warn('[Settings] Secret_Vault not initialized, using localStorage fallback');
      loadHFTokenFromLocalStorage();
      return;
    }

    // Load token from Secret_Vault
    await loadHFTokenFromVault();
    
    // Set up event listeners for token changes
    setupHFTokenEventListeners();
    
    console.log('[Settings] HF token settings initialized successfully');
  } catch (error) {
    console.error('[Settings] Error initializing HF token settings:', error);
    showToast('Failed to initialize token settings', 'error');
    // Fall back to localStorage
    loadHFTokenFromLocalStorage();
  }
}

/**
 * Load HF token from Secret_Vault
 */
async function loadHFTokenFromVault() {
  try {
    console.log('[Settings] Loading HF token from Secret_Vault...');
    
    const token = await window.secretVaultAPI.getSecret(HF_TOKEN_KEY);
    
    if (token) {
      console.log('[Settings] HF token loaded from Secret_Vault');
      document.getElementById('hfToken').value = token;
      
      // Load and display metadata (expiration, etc.)
      await displayHFTokenMetadata();
    } else {
      console.log('[Settings] No HF token found in Secret_Vault');
      document.getElementById('hfToken').value = '';
    }
  } catch (error) {
    console.error('[Settings] Error loading HF token from Secret_Vault:', error);
    
    // Check if it's a decryption error (cross-machine copy)
    if (error.message && error.message.includes('Decryption')) {
      showToast('Cannot decrypt token - this may be a cross-machine copy. Please re-enter your token.', 'error');
      document.getElementById('hfToken').value = '';
    } else {
      showToast('Failed to load token from secure storage', 'error');
    }
  }
}

/**
 * Load HF token from localStorage (fallback)
 */
function loadHFTokenFromLocalStorage() {
  try {
    console.log('[Settings] Loading HF token from localStorage (fallback)...');
    const token = localStorage.getItem(HF_TOKEN_KEY);
    if (token) {
      document.getElementById('hfToken').value = token;
      console.log('[Settings] HF token loaded from localStorage');
    }
  } catch (error) {
    console.error('[Settings] Error loading HF token from localStorage:', error);
  }
}

/**
 * Save HF token to Secret_Vault
 */
async function saveHFTokenToVault(token) {
  try {
    console.log('[Settings] Saving HF token to Secret_Vault...');
    
    if (!window.secretVaultAPI) {
      console.warn('[Settings] Secret_Vault API not available, saving to localStorage');
      localStorage.setItem(HF_TOKEN_KEY, token);
      showToast('Token saved to local storage (not encrypted)', 'info');
      return;
    }

    // Check if Secret_Vault is initialized
    const isInitialized = await window.secretVaultAPI.isInitialized();
    if (!isInitialized) {
      console.warn('[Settings] Secret_Vault not initialized, saving to localStorage');
      localStorage.setItem(HF_TOKEN_KEY, token);
      showToast('Token saved to local storage (not encrypted)', 'info');
      return;
    }

    // Save token with optional expiration metadata
    const options = {
      metadata: {
        source: 'settings-ui',
        savedAt: new Date().toISOString(),
      }
    };

    await window.secretVaultAPI.setSecret(HF_TOKEN_KEY, token, options);
    console.log('[Settings] HF token saved to Secret_Vault successfully');
    showToast('Token saved securely', 'success');
    
    // Update metadata display
    await displayHFTokenMetadata();
  } catch (error) {
    console.error('[Settings] Error saving HF token to Secret_Vault:', error);
    showToast('Failed to save token securely', 'error');
  }
}

/**
 * Delete HF token from Secret_Vault
 */
async function deleteHFToken() {
  try {
    console.log('[Settings] Deleting HF token...');
    
    if (!window.secretVaultAPI) {
      localStorage.removeItem(HF_TOKEN_KEY);
      document.getElementById('hfToken').value = '';
      showToast('Token deleted', 'success');
      return;
    }

    await window.secretVaultAPI.deleteSecret(HF_TOKEN_KEY);
    document.getElementById('hfToken').value = '';
    console.log('[Settings] HF token deleted successfully');
    showToast('Token deleted', 'success');
    
    // Clear metadata display
    clearHFTokenMetadataDisplay();
  } catch (error) {
    console.error('[Settings] Error deleting HF token:', error);
    showToast('Failed to delete token', 'error');
  }
}

/**
 * Display HF token metadata (expiration, scope, etc.)
 */
async function displayHFTokenMetadata() {
  try {
    if (!window.secretVaultAPI) {
      return;
    }

    const metadata = await window.secretVaultAPI.getSecretMetadata(HF_TOKEN_KEY);
    
    if (!metadata) {
      clearHFTokenMetadataDisplay();
      return;
    }

    console.log('[Settings] HF token metadata:', metadata);
    
    // Display expiration warning if applicable
    displayHFTokenExpirationWarning(metadata);
    
    // Create or update metadata display element
    let metadataEl = document.getElementById('hfTokenMetadata');
    if (!metadataEl) {
      metadataEl = document.createElement('div');
      metadataEl.id = 'hfTokenMetadata';
      metadataEl.style.cssText = 'font-size: 12px; color: #666; margin-top: 8px; padding: 8px; background: #f0f0f0; border-radius: 4px;';
      document.getElementById('hfToken').parentNode.appendChild(metadataEl);
    }

    let metadataText = '';
    
    if (metadata.savedAt) {
      const savedDate = new Date(metadata.savedAt).toLocaleString();
      metadataText += `Saved: ${savedDate}<br>`;
    }

    if (metadata.expiresAt) {
      const expiryDate = new Date(metadata.expiresAt);
      const now = new Date();
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      
      if (daysUntilExpiry <= 0) {
        metadataText += `<span style="color: #e74c3c;">⚠️ Token expired</span><br>`;
      } else if (daysUntilExpiry <= 7) {
        metadataText += `<span style="color: #f39c12;">⚠️ Expires in ${daysUntilExpiry} days</span><br>`;
      } else {
        metadataText += `Expires: ${expiryDate.toLocaleDateString()}<br>`;
      }
    }

    if (metadata.scope) {
      metadataText += `Scope: ${metadata.scope}<br>`;
    }

    if (metadataText) {
      metadataEl.innerHTML = metadataText;
      metadataEl.style.display = 'block';
    } else {
      metadataEl.style.display = 'none';
    }
  } catch (error) {
    console.error('[Settings] Error displaying HF token metadata:', error);
  }
}

/**
 * Display token expiration warning (Task 1.4.6)
 * Shows visual warning when token is expiring soon (7 days or less)
 */
function displayHFTokenExpirationWarning(metadata) {
  const warningEl = document.getElementById('hfTokenExpirationWarning');
  const warningTextEl = document.getElementById('hfTokenExpirationText');
  
  if (!warningEl || !warningTextEl) {
    console.warn('[Settings] Token expiration warning elements not found');
    return;
  }

  if (!metadata || !metadata.expiresAt) {
    warningEl.style.display = 'none';
    return;
  }

  const expiryDate = new Date(metadata.expiresAt);
  const now = new Date();
  const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry <= 0) {
    // Token expired - show red warning
    warningEl.style.display = 'block';
    warningEl.style.background = '#e74c3c';
    warningEl.style.color = 'white';
    warningTextEl.innerHTML = '🔴 Token has expired. Please refresh or update your token.';
  } else if (daysUntilExpiry <= 7) {
    // Token expiring soon - show orange warning
    warningEl.style.display = 'block';
    warningEl.style.background = '#f39c12';
    warningEl.style.color = 'white';
    warningTextEl.innerHTML = `🟠 Token expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? 's' : ''}. Expiration date: ${expiryDate.toLocaleDateString()}`;
  } else {
    // Token valid for more than 7 days - hide warning
    warningEl.style.display = 'none';
  }
}

/**
 * Clear HF token metadata display
 */
function clearHFTokenMetadataDisplay() {
  const metadataEl = document.getElementById('hfTokenMetadata');
  if (metadataEl) {
    metadataEl.style.display = 'none';
  }
}

/**
 * Set up event listeners for HF token input
 */
function setupHFTokenEventListeners() {
  const hfTokenInput = document.getElementById('hfToken');
  
  if (!hfTokenInput) {
    console.warn('[Settings] HF token input element not found');
    return;
  }

  // Save token when user leaves the input field
  hfTokenInput.addEventListener('blur', async (e) => {
    const token = e.target.value.trim();
    
    if (token && token.length > 0) {
      // Only save if token has changed
      const currentToken = await getCurrentHFToken();
      if (token !== currentToken) {
        await saveHFTokenToVault(token);
      }
    }
  });

  // Add a save button next to the token input
  addHFTokenSaveButton();
}

/**
 * Get current HF token from Secret_Vault or localStorage
 */
async function getCurrentHFToken() {
  try {
    if (window.secretVaultAPI && await window.secretVaultAPI.isInitialized()) {
      return await window.secretVaultAPI.getSecret(HF_TOKEN_KEY);
    }
  } catch (error) {
    console.error('[Settings] Error getting current HF token:', error);
  }
  
  return localStorage.getItem(HF_TOKEN_KEY);
}

/**
 * Add a save button next to the HF token input
 */
function addHFTokenSaveButton() {
  const hfTokenContainer = document.querySelector('.hf-token');
  
  if (!hfTokenContainer) {
    console.warn('[Settings] HF token container not found');
    return;
  }

  // Check if button already exists
  if (hfTokenContainer.querySelector('.hf-token-save-btn')) {
    return;
  }

  // Create button container
  const buttonContainer = document.getElementById('hfTokenActions');
  if (!buttonContainer) {
    console.warn('[Settings] HF token actions container not found');
    return;
  }

  // Create save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-primary btn-small hf-token-save-btn';
  saveBtn.textContent = 'Save Token';
  saveBtn.addEventListener('click', async () => {
    const token = document.getElementById('hfToken').value.trim();
    if (!token) {
      showToast('Please enter a token', 'error');
      return;
    }
    await saveHFTokenToVault(token);
  });

  // Create clear button
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-danger btn-small hf-token-clear-btn';
  clearBtn.textContent = 'Clear Token';
  clearBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete the stored token?')) {
      await deleteHFToken();
    }
  });

  // Create refresh button (Task 1.4.7)
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn-secondary btn-small hf-token-refresh-btn';
  refreshBtn.textContent = 'Refresh Token';
  refreshBtn.id = 'hfTokenRefreshBtn';
  refreshBtn.addEventListener('click', async () => {
    await refreshHFToken();
  });

  buttonContainer.appendChild(saveBtn);
  buttonContainer.appendChild(clearBtn);
  buttonContainer.appendChild(refreshBtn);
}

/**
 * Refresh HF token (Task 1.4.7)
 * Attempts to refresh the token using HuggingFace API
 */
async function refreshHFToken() {
  try {
    const token = document.getElementById('hfToken').value.trim();
    
    if (!token) {
      showToast('Please enter a token first', 'error');
      return;
    }

    console.log('[Settings] Refreshing HF token...');
    
    const refreshBtn = document.getElementById('hfTokenRefreshBtn');
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<span class="spinner"></span> Refreshing...';
    }

    showToast('Refreshing token...', 'info');

    // Call the Secret_Vault refresh token method
    if (!window.secretVaultAPI) {
      showToast('Secret_Vault API not available', 'error');
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh Token';
      }
      return;
    }

    // Define a refresh function that calls HuggingFace API
    const refreshFn = async (key, currentToken) => {
      // For HuggingFace tokens, we need to validate the current token
      // and potentially get a new one. Since HF doesn't have a standard
      // refresh endpoint, we'll validate the current token instead.
      const response = await fetch('https://huggingface.co/api/user', {
        headers: {
          'Authorization': `Bearer ${currentToken}`,
        }
      });

      if (response.ok) {
        // Token is still valid, return it with extended expiration
        const userData = await response.json();
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 30); // Extend by 30 days
        
        return {
          token: currentToken,
          expiresAt: newExpiresAt.toISOString(),
          metadata: {
            refreshedAt: new Date().toISOString(),
            username: userData.name
          }
        };
      } else if (response.status === 401) {
        throw new Error('Token is invalid or expired');
      } else {
        throw new Error(`Token refresh failed: ${response.statusText}`);
      }
    };

    // Call refreshToken on Secret_Vault
    await window.secretVaultAPI.refreshToken(HF_TOKEN_KEY, refreshFn);
    
    console.log('[Settings] HF token refreshed successfully');
    showToast('Token refreshed successfully', 'success');
    
    // Update metadata display
    await displayHFTokenMetadata();
  } catch (error) {
    console.error('[Settings] Error refreshing HF token:', error);
    showToast(`Token refresh failed: ${error.message}`, 'error');
  } finally {
    const refreshBtn = document.getElementById('hfTokenRefreshBtn');
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh Token';
    }
  }
}

/**
 * Verify that the HF token is valid by testing it with HuggingFace API
 */
async function verifyHFToken() {
  try {
    const token = document.getElementById('hfToken').value.trim();
    
    if (!token) {
      showToast('Please enter a token first', 'error');
      return;
    }

    console.log('[Settings] Verifying HF token...');
    showToast('Verifying token...', 'info');

    // Test the token by fetching user info from HuggingFace API
    const response = await fetch('https://huggingface.co/api/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    });

    if (response.ok) {
      const userData = await response.json();
      console.log('[Settings] HF token verified successfully for user:', userData.name);
      showToast(`Token verified for user: ${userData.name}`, 'success');
    } else if (response.status === 401) {
      console.warn('[Settings] HF token verification failed: Unauthorized');
      showToast('Token is invalid or expired', 'error');
    } else {
      console.warn('[Settings] HF token verification failed:', response.status);
      showToast(`Token verification failed: ${response.statusText}`, 'error');
    }
  } catch (error) {
    console.error('[Settings] Error verifying HF token:', error);
    showToast('Failed to verify token (network error)', 'error');
  }
}

/**
 * Add a verify button to test the HF token
 */
function addHFTokenVerifyButton() {
  const buttonContainer = document.querySelector('.hf-token > div');
  
  if (!buttonContainer) {
    console.warn('[Settings] HF token button container not found');
    return;
  }

  // Check if verify button already exists
  if (buttonContainer.querySelector('.hf-token-verify-btn')) {
    return;
  }

  const verifyBtn = document.createElement('button');
  verifyBtn.className = 'btn-secondary btn-small hf-token-verify-btn';
  verifyBtn.textContent = 'Verify Token';
  verifyBtn.addEventListener('click', verifyHFToken);
  
  buttonContainer.appendChild(verifyBtn);
}

/**
 * Export functions for use in settings.html
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initializeHFTokenSettings,
    loadHFTokenFromVault,
    saveHFTokenToVault,
    deleteHFToken,
    displayHFTokenMetadata,
    verifyHFToken,
    getCurrentHFToken,
  };
}

// ============================================================================
// Memory Section (Tasks 12.2-12.5)
// ============================================================================

/**
 * Current model metadata for the Memory section
 * @type {Object|null}
 */
let currentModelMeta = null;

/**
 * Current draft state for the Memory section
 * @type {Object|null}
 */
let memoryDraft = null;

/**
 * Initialize the Memory section (Task 12.2)
 * Binds controls, sets up event listeners, and loads initial state
 * 
 * @param {Object} modelMeta - Model metadata (filename, sizeBytes, totalLayers, etc.)
 * @param {Object} initialArgs - Initial Advanced_Args values
 */
function initializeMemorySection(modelMeta, initialArgs) {
  console.log('[Settings] Initializing Memory section...', { modelMeta, initialArgs });
  
  currentModelMeta = modelMeta;
  memoryDraft = { ...initialArgs };
  
  // Show the Memory section
  const panel = document.getElementById('model-memory-panel');
  if (panel) {
    panel.hidden = false;
  }
  
  // Display the model filename
  const filenameEl = document.getElementById('memory-target-filename');
  if (filenameEl && modelMeta && modelMeta.filename) {
    filenameEl.textContent = modelMeta.filename;
  }
  
  // Bind controls
  bindMemoryControls();
  
  // Render initial values
  renderMemoryControls(memoryDraft);
  
  // Update estimate
  updateMemoryEstimate();
  
  console.log('[Settings] Memory section initialized');
}

/**
 * Bind event listeners to Memory section controls (Task 12.2)
 */
function bindMemoryControls() {
  // 1. nGpuLayers slider + Auto checkbox
  const nglSlider = document.getElementById('memory-ngl-slider');
  const nglAuto = document.getElementById('memory-ngl-auto');
  const nglValue = document.getElementById('memory-ngl-value');
  
  if (nglSlider && nglAuto && nglValue) {
    nglSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      memoryDraft.nGpuLayers = value;
      nglValue.textContent = value;
      nglAuto.checked = false;
      updateMemoryEstimate();
      validateMemoryDraft();
    });
    
    nglAuto.addEventListener('change', (e) => {
      if (e.target.checked) {
        memoryDraft.nGpuLayers = -1;
        nglValue.textContent = 'Auto';
        nglSlider.disabled = true;
      } else {
        const value = parseInt(nglSlider.value, 10);
        memoryDraft.nGpuLayers = value;
        nglValue.textContent = value;
        nglSlider.disabled = false;
      }
      updateMemoryEstimate();
      validateMemoryDraft();
    });
  }
  
  // 2. "Fit to VRAM" button (Task 12.3)
  const fitBtn = document.getElementById('memory-fit-vram-btn');
  if (fitBtn) {
    fitBtn.addEventListener('click', handleFitToVram);
  }
  
  // 3. typeK dropdown
  const typeKSelect = document.getElementById('memory-typek-select');
  if (typeKSelect) {
    typeKSelect.addEventListener('change', (e) => {
      memoryDraft.typeK = e.target.value;
      updateMemoryEstimate();
      validateMemoryDraft();
    });
  }
  
  // 4. typeV dropdown
  const typeVSelect = document.getElementById('memory-typev-select');
  if (typeVSelect) {
    typeVSelect.addEventListener('change', (e) => {
      memoryDraft.typeV = e.target.value;
      updateMemoryEstimate();
      validateMemoryDraft();
    });
  }
  
  // 5. threads input + "Use physical core count" button
  const threadsInput = document.getElementById('memory-threads-input');
  const threadsPhysicalBtn = document.getElementById('memory-threads-physical-btn');
  
  if (threadsInput) {
    threadsInput.addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value) && value >= 1 && value <= 256) {
        memoryDraft.threads = value;
        validateMemoryDraft();
      }
    });
  }
  
  if (threadsPhysicalBtn) {
    threadsPhysicalBtn.addEventListener('click', async () => {
      try {
        const budget = await window.llamaAPI.detectVramBudget();
        if (budget && budget.physicalCores) {
          const clamped = Math.max(1, Math.min(256, budget.physicalCores));
          memoryDraft.threads = clamped;
          if (threadsInput) {
            threadsInput.value = clamped;
          }
          showToast(`Threads set to ${clamped} (physical core count)`, 'success');
          validateMemoryDraft();
        } else {
          showToast('Could not detect physical core count', 'error');
        }
      } catch (error) {
        console.error('[Settings] Error detecting physical cores:', error);
        showToast('Failed to detect physical core count', 'error');
      }
    });
  }
  
  // 6. nCpuMoe input
  const nCpuMoeInput = document.getElementById('memory-ncpumoe-input');
  if (nCpuMoeInput) {
    nCpuMoeInput.addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value) && value >= 0) {
        memoryDraft.nCpuMoe = value;
        validateMemoryDraft();
      }
    });
  }
  
  // 7. visibleDevices multi-select
  const visibleDevicesSelect = document.getElementById('memory-visible-devices');
  if (visibleDevicesSelect) {
    visibleDevicesSelect.addEventListener('change', (e) => {
      const selected = Array.from(e.target.selectedOptions).map(opt => parseInt(opt.value, 10));
      memoryDraft.visibleDevices = selected;
      validateMemoryDraft();
    });
  }
}

/**
 * Render Memory section controls with current draft values (Task 12.2)
 * 
 * @param {Object} args - Advanced_Args object
 */
function renderMemoryControls(args) {
  if (!args) return;
  
  // 1. nGpuLayers slider + Auto checkbox
  const nglSlider = document.getElementById('memory-ngl-slider');
  const nglAuto = document.getElementById('memory-ngl-auto');
  const nglValue = document.getElementById('memory-ngl-value');
  
  if (currentModelMeta && currentModelMeta.totalLayers) {
    if (nglSlider) {
      nglSlider.max = currentModelMeta.totalLayers;
    }
  }
  
  if (args.nGpuLayers === -1) {
    if (nglAuto) nglAuto.checked = true;
    if (nglValue) nglValue.textContent = 'Auto';
    if (nglSlider) nglSlider.disabled = true;
  } else {
    if (nglAuto) nglAuto.checked = false;
    if (nglSlider) {
      nglSlider.value = args.nGpuLayers;
      nglSlider.disabled = false;
    }
    if (nglValue) nglValue.textContent = args.nGpuLayers;
  }
  
  // 3. typeK dropdown
  const typeKSelect = document.getElementById('memory-typek-select');
  if (typeKSelect && args.typeK) {
    typeKSelect.value = args.typeK;
  }
  
  // 4. typeV dropdown
  const typeVSelect = document.getElementById('memory-typev-select');
  if (typeVSelect && args.typeV) {
    typeVSelect.value = args.typeV;
  }
  
  // 5. threads input
  const threadsInput = document.getElementById('memory-threads-input');
  if (threadsInput && args.threads) {
    threadsInput.value = args.threads;
  }
  
  // 6. nCpuMoe input (Task 12.5: force zero for dense models)
  const nCpuMoeInput = document.getElementById('memory-ncpumoe-input');
  const nCpuMoeField = document.querySelector('[data-field="nCpuMoe"]');
  
  if (currentModelMeta && currentModelMeta.isMoE === false) {
    // Dense model: force nCpuMoe to 0 and hide the field
    if (nCpuMoeInput) {
      nCpuMoeInput.value = 0;
      nCpuMoeInput.disabled = true;
    }
    if (nCpuMoeField) {
      nCpuMoeField.style.display = 'none';
    }
    memoryDraft.nCpuMoe = 0;
  } else {
    // MoE model: show the field and allow editing
    if (nCpuMoeInput) {
      nCpuMoeInput.value = args.nCpuMoe || 0;
      nCpuMoeInput.disabled = false;
    }
    if (nCpuMoeField) {
      nCpuMoeField.style.display = 'block';
    }
  }
  
  // 7. visibleDevices multi-select
  const visibleDevicesSelect = document.getElementById('memory-visible-devices');
  if (visibleDevicesSelect) {
    // Populate options based on detected GPU count
    populateVisibleDevicesOptions();
    
    // Select current values
    if (args.visibleDevices && Array.isArray(args.visibleDevices)) {
      Array.from(visibleDevicesSelect.options).forEach(opt => {
        opt.selected = args.visibleDevices.includes(parseInt(opt.value, 10));
      });
    }
  }
}

/**
 * Populate visibleDevices multi-select options based on detected GPU count
 */
async function populateVisibleDevicesOptions() {
  const select = document.getElementById('memory-visible-devices');
  if (!select) return;
  
  try {
    const budget = await window.llamaAPI.detectVramBudget();
    const gpuCount = (budget && budget.gpuCount) || 1;
    
    // Clear existing options
    select.innerHTML = '';
    
    // Add options for each GPU
    for (let i = 0; i < gpuCount; i++) {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = `GPU ${i}`;
      select.appendChild(option);
    }
    
    // Hide the field if only one GPU
    const visibleDevicesField = document.querySelector('[data-field="visibleDevices"]');
    if (visibleDevicesField) {
      visibleDevicesField.style.display = gpuCount > 1 ? 'block' : 'none';
    }
  } catch (error) {
    console.error('[Settings] Error populating visible devices:', error);
  }
}

/**
 * Handle "Fit to VRAM" button click (Task 12.3)
 */
async function handleFitToVram() {
  try {
    console.log('[Settings] Fit to VRAM clicked');
    
    const btn = document.getElementById('memory-fit-vram-btn');
    const resultSpan = document.getElementById('memory-fit-vram-result');
    
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Computing...';
    }
    
    if (resultSpan) {
      resultSpan.textContent = '';
    }
    
    // Get current VRAM budget
    const budget = await window.llamaAPI.detectVramBudget();
    
    if (!budget || !budget.detected) {
      showToast('VRAM detection unavailable - using permissive fallback', 'info');
      if (currentModelMeta && currentModelMeta.totalLayers) {
        memoryDraft.nGpuLayers = currentModelMeta.totalLayers;
        renderMemoryControls(memoryDraft);
        updateMemoryEstimate();
        if (resultSpan) {
          resultSpan.textContent = `Set to ${currentModelMeta.totalLayers} (all layers)`;
        }
      }
      return;
    }
    
    // Call autoTuneNgl via IPC
    const result = await window.llamaAPI.autoTuneNgl({
      modelMeta: currentModelMeta,
      baseArgs: memoryDraft,
      budget,
      totalLayers: currentModelMeta.totalLayers || 0,
      activeAllocationsMB: [], // TODO: get from active slots
    });
    
    console.log('[Settings] autoTuneNgl result:', result);
    
    // Update draft and UI
    memoryDraft.nGpuLayers = result;
    renderMemoryControls(memoryDraft);
    updateMemoryEstimate();
    validateMemoryDraft();
    
    if (resultSpan) {
      resultSpan.textContent = `Set to ${result} layers`;
      resultSpan.style.color = '#27ae60';
    }
    
    showToast(`GPU layers set to ${result}`, 'success');
  } catch (error) {
    console.error('[Settings] Error in Fit to VRAM:', error);
    showToast(`Fit to VRAM failed: ${error.message}`, 'error');
    
    const resultSpan = document.getElementById('memory-fit-vram-result');
    if (resultSpan) {
      resultSpan.textContent = 'Error';
      resultSpan.style.color = '#e74c3c';
    }
  } finally {
    const btn = document.getElementById('memory-fit-vram-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Fit to VRAM';
    }
  }
}

/**
 * Update the live VRAM estimate label (Task 12.2)
 */
async function updateMemoryEstimate() {
  try {
    const estimateLabel = document.getElementById('memory-estimate-label');
    if (!estimateLabel) return;
    
    if (!currentModelMeta || !memoryDraft) {
      estimateLabel.textContent = '-';
      return;
    }
    
    // Call estimateRequiredMB via IPC
    const estimate = await window.llamaAPI.estimateRequiredMB({
      modelMeta: currentModelMeta,
      args: memoryDraft,
    });
    
    if (estimate && typeof estimate.totalMB === 'number') {
      estimateLabel.textContent = `${Math.round(estimate.totalMB)} MB`;
    } else {
      estimateLabel.textContent = '-';
    }
  } catch (error) {
    console.error('[Settings] Error updating memory estimate:', error);
    const estimateLabel = document.getElementById('memory-estimate-label');
    if (estimateLabel) {
      estimateLabel.textContent = 'Error';
    }
  }
}

/**
 * Validate the memory draft and display errors (Task 12.5)
 */
function validateMemoryDraft() {
  const errorEl = document.getElementById('memory-validation-error');
  if (!errorEl) return;
  
  const errors = [];
  
  // Validate nGpuLayers
  if (memoryDraft.nGpuLayers !== -1) {
    if (currentModelMeta && currentModelMeta.totalLayers) {
      if (memoryDraft.nGpuLayers < 0 || memoryDraft.nGpuLayers > currentModelMeta.totalLayers) {
        errors.push(`GPU layers must be between 0 and ${currentModelMeta.totalLayers}`);
      }
    }
  }
  
  // Validate threads
  if (memoryDraft.threads < 1 || memoryDraft.threads > 256) {
    errors.push('Threads must be between 1 and 256');
  }
  
  // Validate nCpuMoe
  if (memoryDraft.nCpuMoe < 0) {
    errors.push('MoE CPU layers must be non-negative');
  }
  
  // Dense model: nCpuMoe must be 0 (Task 12.5)
  if (currentModelMeta && currentModelMeta.isMoE === false && memoryDraft.nCpuMoe !== 0) {
    errors.push('MoE CPU layers must be 0 for dense models');
    memoryDraft.nCpuMoe = 0;
  }
  
  // Display errors
  if (errors.length > 0) {
    errorEl.textContent = errors.join('; ');
    errorEl.style.display = 'block';
  } else {
    errorEl.style.display = 'none';
  }
}

/**
 * Pre-fill Memory section with recommended preset (Task 12.4)
 * Called when a new model is selected
 * 
 * @param {Object} modelMeta - Model metadata
 */
async function prefillMemoryWithPreset(modelMeta) {
  try {
    console.log('[Settings] Pre-filling Memory section with recommended preset...', modelMeta);
    
    // Get current VRAM budget
    const budget = await window.llamaAPI.detectVramBudget();
    
    // Call recommendPreset via IPC
    const preset = await window.llamaAPI.recommendPreset({
      modelMeta,
      budget,
    });
    
    console.log('[Settings] Recommended preset:', preset);
    
    // Initialize Memory section with the preset
    initializeMemorySection(modelMeta, preset);
    
    showToast('Memory settings pre-filled with recommended values', 'success');
  } catch (error) {
    console.error('[Settings] Error pre-filling with preset:', error);
    showToast('Failed to pre-fill memory settings', 'error');
    
    // Fall back to default values
    const { DEFAULT_ADVANCED_ARGS } = require('./advanced-args');
    initializeMemorySection(modelMeta, DEFAULT_ADVANCED_ARGS);
  }
}

/**
 * Save the current memory draft (Task 12.5)
 * Validates the draft before saving
 * 
 * @returns {Promise<boolean>} True if saved successfully
 */
async function saveMemoryDraft() {
  try {
    // Validate before saving
    validateMemoryDraft();
    
    const errorEl = document.getElementById('memory-validation-error');
    if (errorEl && errorEl.style.display !== 'none') {
      showToast('Please fix validation errors before saving', 'error');
      return false;
    }
    
    // Save via IPC
    await window.llamaAPI.saveModelMemorySettings({
      filename: currentModelMeta.filename,
      settings: memoryDraft,
    });
    
    console.log('[Settings] Memory settings saved:', memoryDraft);
    showToast('Memory settings saved', 'success');
    return true;
  } catch (error) {
    console.error('[Settings] Error saving memory settings:', error);
    showToast(`Failed to save memory settings: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Export Memory section functions for use in settings.html
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ...module.exports,
    initializeMemorySection,
    bindMemoryControls,
    renderMemoryControls,
    handleFitToVram,
    updateMemoryEstimate,
    validateMemoryDraft,
    prefillMemoryWithPreset,
    saveMemoryDraft,
  };
}
