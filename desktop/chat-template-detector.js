/**
 * Chat Template Detector
 *
 * Detects whether a loaded model supports tool calling by examining its chat template.
 * Implements Requirements 14.1 and 14.2.
 */

const http = require('http');

/**
 * Detects whether a chat template supports tool calling.
 *
 * Pure function that checks if the template contains either 'tool_call' or 'function_call'
 * (case-insensitive substring match).
 *
 * @param {any} chatTemplate - The chat template string to check
 * @returns {boolean} True if the template supports tools, false otherwise
 *
 * Validates: Requirements 14.2
 */
function detectToolSupport(chatTemplate) {
  // Non-string inputs return false (Req 14.2)
  if (typeof chatTemplate !== 'string') {
    return false;
  }

  // Lowercase substring match on 'tool_call' or 'function_call' (Req 14.2)
  const lowerTemplate = chatTemplate.toLowerCase();
  return lowerTemplate.includes('tool_call') || lowerTemplate.includes('function_call');
}

/**
 * Fetches the /props endpoint from a slot and detects tool support.
 *
 * Side-effecting function that makes an HTTP GET request to the slot's /props endpoint
 * and extracts the chat_template to determine tool support.
 *
 * @param {number} port - The port number of the slot (e.g., 13434)
 * @returns {Promise<{supportsTools: boolean, chatTemplate: string|null}>}
 *   An object with supportsTools (boolean) and chatTemplate (string or null if not present)
 *
 * @throws {Error} If the HTTP request fails or the response is invalid
 *
 * Validates: Requirements 14.1, 14.2
 */
async function fetchAndDetect(port) {
  return new Promise((resolve, reject) => {
    const url = `http://127.0.0.1:${port}/props`;

    http.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const props = JSON.parse(data);
          const chatTemplate = props.chat_template || null;
          const supportsTools = detectToolSupport(chatTemplate);

          resolve({
            supportsTools,
            chatTemplate,
          });
        } catch (err) {
          reject(new Error(`Failed to parse /props response: ${err.message}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`Failed to fetch /props from http://127.0.0.1:${port}: ${err.message}`));
    });
  });
}

module.exports = {
  detectToolSupport,
  fetchAndDetect,
};
