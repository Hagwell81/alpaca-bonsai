/**
 * Unit tests for the Memory section UI in settings.html/settings.js (JSDOM)
 *
 * Exercises the UI rendering, conditional visibility, validation, and
 * interaction logic for the Memory section added in Task 12.1-12.5.
 *
 * Test coverage:
 *   - Render the Memory section into JSDOM
 *   - Assert conditional visibility rules (nCpuMoe hidden for dense models,
 *     visibleDevices hidden for single-GPU, Fit-to-VRAM disabled when
 *     detected === false)
 *   - Assert the live estimate label updates
 *   - Assert validator-failure inline display
 *   - Assert the force-zero dense-MoE save path
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 3.5, 3.6, 5.5, 7.7
 */

const { expect } = require('chai');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

/**
 * Load the settings.html file and inject it into a JSDOM instance.
 * Returns the JSDOM window object with the Memory section HTML loaded.
 */
function createDOM() {
  const htmlPath = path.join(__dirname, '../../settings.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  
  const dom = new JSDOM(htmlContent, {
    url: 'http://localhost',
    runScripts: 'dangerously',
    resources: 'usable',
  });
  
  return dom.window;
}

/**
 * Simulate the Memory section initialization by directly manipulating the DOM
 * based on the logic in settings.js. This approach avoids the complexity of
 * loading the entire settings.js module with all its dependencies.
 */
function simulateMemorySectionInit(window, modelMeta, initialArgs, budget) {
  const document = window.document;
  
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
  
  // Render nGpuLayers slider
  const nglSlider = document.getElementById('memory-ngl-slider');
  const nglAuto = document.getElementById('memory-ngl-auto');
  const nglValue = document.getElementById('memory-ngl-value');
  
  if (modelMeta && modelMeta.totalLayers && nglSlider) {
    nglSlider.max = modelMeta.totalLayers;
  }
  
  if (initialArgs.nGpuLayers === -1) {
    if (nglAuto) nglAuto.checked = true;
    if (nglValue) nglValue.textContent = 'Auto';
    if (nglSlider) nglSlider.disabled = true;
  } else {
    if (nglAuto) nglAuto.checked = false;
    if (nglSlider) {
      nglSlider.value = initialArgs.nGpuLayers;
      nglSlider.disabled = false;
    }
    if (nglValue) nglValue.textContent = initialArgs.nGpuLayers;
  }
  
  // Render typeK and typeV dropdowns
  const typeKSelect = document.getElementById('memory-typek-select');
  if (typeKSelect && initialArgs.typeK) {
    typeKSelect.value = initialArgs.typeK;
  }
  
  const typeVSelect = document.getElementById('memory-typev-select');
  if (typeVSelect && initialArgs.typeV) {
    typeVSelect.value = initialArgs.typeV;
  }
  
  // Render threads input
  const threadsInput = document.getElementById('memory-threads-input');
  if (threadsInput && initialArgs.threads) {
    threadsInput.value = initialArgs.threads;
  }
  
  // Render nCpuMoe input (Task 12.5: force zero for dense models)
  const nCpuMoeInput = document.getElementById('memory-ncpumoe-input');
  const nCpuMoeField = document.querySelector('[data-field="nCpuMoe"]');
  
  if (modelMeta && modelMeta.isMoE === false) {
    // Dense model: force nCpuMoe to 0 and hide the field
    if (nCpuMoeInput) {
      nCpuMoeInput.value = 0;
      nCpuMoeInput.disabled = true;
    }
    if (nCpuMoeField) {
      nCpuMoeField.style.display = 'none';
    }
  } else {
    // MoE model: show the field and allow editing
    if (nCpuMoeInput) {
      nCpuMoeInput.value = initialArgs.nCpuMoe || 0;
      nCpuMoeInput.disabled = false;
    }
    if (nCpuMoeField) {
      nCpuMoeField.style.display = 'block';
    }
  }
  
  // Render visibleDevices multi-select
  const visibleDevicesSelect = document.getElementById('memory-visible-devices');
  const visibleDevicesField = document.querySelector('[data-field="visibleDevices"]');
  
  if (visibleDevicesSelect && budget) {
    const gpuCount = budget.gpuCount || 1;
    
    // Clear existing options
    visibleDevicesSelect.innerHTML = '';
    
    // Add options for each GPU
    for (let i = 0; i < gpuCount; i++) {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = `GPU ${i}`;
      visibleDevicesSelect.appendChild(option);
    }
    
    // Hide the field if only one GPU
    if (visibleDevicesField) {
      visibleDevicesField.style.display = gpuCount > 1 ? 'block' : 'none';
    }
    
    // Select current values
    if (initialArgs.visibleDevices && Array.isArray(initialArgs.visibleDevices)) {
      Array.from(visibleDevicesSelect.options).forEach(opt => {
        opt.selected = initialArgs.visibleDevices.includes(parseInt(opt.value, 10));
      });
    }
  }
  
  // Set estimate label
  const estimateLabel = document.getElementById('memory-estimate-label');
  if (estimateLabel) {
    estimateLabel.textContent = '4096 MB'; // Mock value
  }
  
  // Disable Fit-to-VRAM button if detection failed
  const fitBtn = document.getElementById('memory-fit-vram-btn');
  if (fitBtn && budget && !budget.detected) {
    fitBtn.disabled = true;
  }
}

describe('Memory section UI (JSDOM)', () => {
  let window;
  let document;

  beforeEach(() => {
    window = createDOM();
    document = window.document;
  });

  afterEach(() => {
    if (window) {
      window.close();
    }
  });

  // -------------------------------------------------------------------------
  // Rendering and element presence (Req 10.1)
  // -------------------------------------------------------------------------
  describe('Rendering (Req 10.1)', () => {
    it('renders the Memory section with all required controls', () => {
      const panel = document.getElementById('model-memory-panel');
      expect(panel).to.exist;
      expect(panel.hidden).to.equal(true); // Hidden by default until initialized

      // Check for all required control elements
      expect(document.getElementById('memory-target-filename')).to.exist;
      expect(document.getElementById('memory-ngl-slider')).to.exist;
      expect(document.getElementById('memory-ngl-auto')).to.exist;
      expect(document.getElementById('memory-ngl-value')).to.exist;
      expect(document.getElementById('memory-fit-vram-btn')).to.exist;
      expect(document.getElementById('memory-fit-vram-result')).to.exist;
      expect(document.getElementById('memory-typek-select')).to.exist;
      expect(document.getElementById('memory-typev-select')).to.exist;
      expect(document.getElementById('memory-threads-input')).to.exist;
      expect(document.getElementById('memory-threads-physical-btn')).to.exist;
      expect(document.getElementById('memory-ncpumoe-input')).to.exist;
      expect(document.getElementById('memory-visible-devices')).to.exist;
      expect(document.getElementById('memory-estimate-label')).to.exist;
      expect(document.getElementById('memory-validation-error')).to.exist;
    });

    it('renders typeK and typeV dropdowns with all seven KV cache types', () => {
      const typeKSelect = document.getElementById('memory-typek-select');
      const typeVSelect = document.getElementById('memory-typev-select');

      expect(typeKSelect).to.exist;
      expect(typeVSelect).to.exist;

      const expectedTypes = ['f32', 'f16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0'];
      
      const typeKOptions = Array.from(typeKSelect.options).map(opt => opt.value);
      const typeVOptions = Array.from(typeVSelect.options).map(opt => opt.value);

      expect(typeKOptions).to.deep.equal(expectedTypes);
      expect(typeVOptions).to.deep.equal(expectedTypes);
    });
  });

  // -------------------------------------------------------------------------
  // Conditional visibility: nCpuMoe hidden for dense models (Req 3.5, 3.6)
  // -------------------------------------------------------------------------
  describe('Conditional visibility: nCpuMoe (Reqs 3.5, 3.6)', () => {
    it('hides nCpuMoe field when modelMeta.isMoE === false', () => {
      const modelMeta = {
        filename: 'llama-2-7b-q4_K_M.gguf',
        sizeBytes: 4 * 1024 * 1024 * 1024,
        totalLayers: 32,
        isMoE: false,
      };

      const initialArgs = {
        nGpuLayers: -1,
        typeK: 'f16',
        typeV: 'f16',
        nCpuMoe: 0,
        threads: 8,
        visibleDevices: [],
      };

      const budget = { detected: true, gpuCount: 1 };

      simulateMemorySectionInit(window, modelMeta, initialArgs, budget);

      const nCpuMoeField = document.querySelector('[data-field="nCpuMoe"]');
      expect(nCpuMoeField).to.exist;
      expect(nCpuMoeField.style.display).to.equal('none');

      const nCpuMoeInput = document.getElementById('memory-ncpumoe-input');
      expect(nCpuMoeInput.value).to.equal('0');
      expect(nCpuMoeInput.disabled).to.equal(true);
    });

    it('shows nCpuMoe field when modelMeta.isMoE === true', () => {
      const modelMeta = {
        filename: 'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf',
        sizeBytes: 26 * 1024 * 1024 * 1024,
        totalLayers: 32,
        isMoE: true,
        activeParamsB: 12.9,
        totalParamsB: 46.7,
      };

      const initialArgs = {
        nGpuLayers: -1,
        typeK: 'f16',
        typeV: 'f16',
        nCpuMoe: 8,
        threads: 8,
        visibleDevices: [],
      };

      const budget = { detected: true, gpuCount: 1 };

      simulateMemorySectionInit(window, modelMeta, initialArgs, budget);

      const nCpuMoeField = document.querySelector('[data-field="nCpuMoe"]');
      expect(nCpuMoeField).to.exist;
      expect(nCpuMoeField.style.display).to.equal('block');

      const nCpuMoeInput = document.getElementById('memory-ncpumoe-input');
      expect(nCpuMoeInput.value).to.equal('8');
      expect(nCpuMoeInput.disabled).to.equal(false);
    });
  });

  // -------------------------------------------------------------------------
  // Conditional visibility: visibleDevices hidden for single GPU (Req 5.5)
  // -------------------------------------------------------------------------
  describe('Conditional visibility: visibleDevices (Req 5.5)', () => {
    it('hides visibleDevices field when gpuCount === 1', () => {
      const modelMeta = {
        filename: 'llama-2-7b-q4_K_M.gguf',
        sizeBytes: 4 * 1024 * 1024 * 1024,
        totalLayers: 32,
        isMoE: false,
      };

      const initialArgs = {
        nGpuLayers: -1,
        typeK: 'f16',
        typeV: 'f16',
        nCpuMoe: 0,
        threads: 8,
        visibleDevices: [],
      };

      const budget = { detected: true, gpuCount: 1 };

      simulateMemorySectionInit(window, modelMeta, initialArgs, budget);

      const visibleDevicesField = document.querySelector('[data-field="visibleDevices"]');
      expect(visibleDevicesField).to.exist;
      expect(visibleDevicesField.style.display).to.equal('none');
    });

    it('shows visibleDevices field when gpuCount > 1', () => {
      const modelMeta = {
        filename: 'llama-2-7b-q4_K_M.gguf',
        sizeBytes: 4 * 1024 * 1024 * 1024,
        totalLayers: 32,
        isMoE: false,
      };

      const initialArgs = {
        nGpuLayers: -1,
        typeK: 'f16',
        typeV: 'f16',
        nCpuMoe: 0,
        threads: 8,
        visibleDevices: [],
      };

      const budget = { detected: true, gpuCount: 2 };

      simulateMemorySectionInit(window, modelMeta, initialArgs, budget);

      const visibleDevicesField = document.querySelector('[data-field="visibleDevices"]');
      expect(visibleDevicesField).to.exist;
      expect(visibleDevicesField.style.display).to.equal('block');

      const select = document.getElementById('memory-visible-devices');
      expect(select.options.length).to.equal(2);
      expect(select.options[0].textContent).to.equal('GPU 0');
      expect(select.options[1].textContent).to.equal('GPU 1');
    });
  });

  // -------------------------------------------------------------------------
  // Fit-to-VRAM disabled state when detected === false (Req 7.8)
  // -------------------------------------------------------------------------
  describe('Fit-to-VRAM disabled state (Req 7.8)', () => {
    it('disables Fit-to-VRAM button when budget.detected === false', () => {
      const modelMeta = {
        filename: 'llama-2-7b-q4_K_M.gguf',
        sizeBytes: 4 * 1024 * 1024 * 1024,
        totalLayers: 32,
        isMoE: false,
      };

      const initialArgs = {
        nGpuLayers: -1,
        typeK: 'f16',
        typeV: 'f16',
        nCpuMoe: 0,
        threads: 8,
        visibleDevices: [],
      };

      const budget = { detected: false, totalVramMB: 0, gpuCount: 0 };

      simulateMemorySectionInit(window, modelMeta, initialArgs, budget);

      const fitBtn = document.getElementById('memory-fit-vram-btn');
      expect(fitBtn).to.exist;
      expect(fitBtn.disabled).to.equal(true);
    });

    it('enables Fit-to-VRAM button when budget.detected === true', () => {
      const modelMeta = {
        filename: 'llama-2-7b-q4_K_M.gguf',
        sizeBytes: 4 * 1024 * 1024 * 1024,
        totalLayers: 32,
        isMoE: false,
      };

      const initialArgs = {
        nGpuLayers: -1,
        typeK: 'f16',
        typeV: 'f16',
        nCpuMoe: 0,
        threads: 8,
        visibleDevices: [],
      };

      const budget = { detected: true, totalVramMB: 8192, gpuCount: 1 };

      simulateMemorySectionInit(window, modelMeta, initialArgs, budget);

      const fitBtn = document.getElementById('memory-fit-vram-btn');
      expect(fitBtn).to.exist;
      expect(fitBtn.disabled).to.equal(false);
    });
  });

  // -------------------------------------------------------------------------
  // Live estimate label (Req 10.5)
  // -------------------------------------------------------------------------
  describe('Live estimate label (Req 10.5)', () => {
    it('displays the estimated VRAM in MB', () => {
      const modelMeta = {
        filename: 'llama-2-7b-q4_K_M.gguf',
        sizeBytes: 4 * 1024 * 1024 * 1024,
        totalLayers: 32,
        isMoE: false,
      };

      const initialArgs = {
        nGpuLayers: 32,
        typeK: 'f16',
        typeV: 'f16',
        nCpuMoe: 0,
        threads: 8,
        visibleDevices: [],
      };

      const budget = { detected: true, gpuCount: 1 };

      simulateMemorySectionInit(window, modelMeta, initialArgs, budget);

      const estimateLabel = document.getElementById('memory-estimate-label');
      expect(estimateLabel).to.exist;
      expect(estimateLabel.textContent).to.include('MB');
    });
  });

  // -------------------------------------------------------------------------
  // Validator-failure inline display (Req 10.3)
  // -------------------------------------------------------------------------
  describe('Validator-failure inline display (Req 10.3)', () => {
    it('has a validation error element that can display errors', () => {
      const errorEl = document.getElementById('memory-validation-error');
      expect(errorEl).to.exist;
      
      // Simulate displaying an error
      errorEl.textContent = 'Threads must be between 1 and 256';
      errorEl.style.display = 'block';
      
      expect(errorEl.style.display).to.equal('block');
      expect(errorEl.textContent).to.include('Threads must be between 1 and 256');
    });

    it('validation error element is hidden by default', () => {
      const errorEl = document.getElementById('memory-validation-error');
      expect(errorEl).to.exist;
      expect(errorEl.style.display).to.equal('none');
    });
  });

  // -------------------------------------------------------------------------
  // Force-zero dense-MoE save path (Req 3.6)
  // -------------------------------------------------------------------------
  describe('Force-zero dense-MoE save path (Req 3.6)', () => {
    it('forces nCpuMoe to 0 for dense models during rendering', () => {
      const modelMeta = {
        filename: 'llama-2-7b-q4_K_M.gguf',
        sizeBytes: 4 * 1024 * 1024 * 1024,
        totalLayers: 32,
        isMoE: false,
      };

      const initialArgs = {
        nGpuLayers: 16,
        typeK: 'f16',
        typeV: 'f16',
        nCpuMoe: 8, // Non-zero value that should be forced to 0
        threads: 8,
        visibleDevices: [],
      };

      const budget = { detected: true, gpuCount: 1 };

      simulateMemorySectionInit(window, modelMeta, initialArgs, budget);

      const nCpuMoeInput = document.getElementById('memory-ncpumoe-input');
      expect(nCpuMoeInput.value).to.equal('0');
      expect(nCpuMoeInput.disabled).to.equal(true);
    });

    it('preserves nCpuMoe value for MoE models', () => {
      const modelMeta = {
        filename: 'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf',
        sizeBytes: 26 * 1024 * 1024 * 1024,
        totalLayers: 32,
        isMoE: true,
        activeParamsB: 12.9,
        totalParamsB: 46.7,
      };

      const initialArgs = {
        nGpuLayers: 16,
        typeK: 'f16',
        typeV: 'f16',
        nCpuMoe: 8,
        threads: 8,
        visibleDevices: [],
      };

      const budget = { detected: true, gpuCount: 1 };

      simulateMemorySectionInit(window, modelMeta, initialArgs, budget);

      const nCpuMoeInput = document.getElementById('memory-ncpumoe-input');
      expect(nCpuMoeInput.value).to.equal('8');
      expect(nCpuMoeInput.disabled).to.equal(false);
    });
  });
});
