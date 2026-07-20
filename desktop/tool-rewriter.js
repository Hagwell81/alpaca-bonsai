/**
 * Tool_Rewriter — Pure rewriter for tool-call markers
 *
 * Detects model-native tool-call markers in responses and rewrites them
 * into OpenAI tool_calls schema. Supports both <tool_call>...</tool_call>
 * and <|function_call|>...<|/function_call|> markers.
 *
 * Requirements: 15.1, 15.3, 15.4, 15.5
 */

const { Transform } = require('stream');

/**
 * Regex patterns for tool-call markers
 * Matches both <tool_call>{...}</tool_call> and <|function_call|>{...}<|/function_call|>
 */
const TOOL_CALL_PATTERN = /<tool_call>([\s\S]*?)<\/tool_call>|<\|function_call\|>([\s\S]*?)<\|\/function_call\|>/g;

/**
 * Extract tool calls from assistant text
 *
 * Parses tool-call markers and converts them to OpenAI tool_calls format.
 * Returns the cleaned text (with markers removed) and the extracted tool calls.
 *
 * @param {string} assistantText - The assistant's response text
 * @returns {{
 *   hasMarkers: boolean,
 *   toolCalls: Array<{id: string, type: string, function: {name: string, arguments: string}}>,
 *   cleanedText: string
 * }}
 */
function extractToolCalls(assistantText) {
  if (typeof assistantText !== 'string') {
    return { hasMarkers: false, toolCalls: [], cleanedText: '' };
  }

  const toolCalls = [];
  let hasMarkers = false;
  let hasValidMarkers = false;
  let cleanedText = assistantText;
  let match;

  // Reset regex state
  TOOL_CALL_PATTERN.lastIndex = 0;

  // Extract all tool calls
  while ((match = TOOL_CALL_PATTERN.exec(assistantText)) !== null) {
    hasMarkers = true;
    // match[1] is for <tool_call>, match[2] is for <|function_call|>
    const jsonStr = match[1] || match[2];

    try {
      const toolCall = JSON.parse(jsonStr);
      // Convert to OpenAI format
      toolCalls.push({
        id: toolCall.id || `call_${Date.now()}`,
        type: 'function',
        function: {
          name: toolCall.name || toolCall.function?.name || 'unknown',
          arguments: typeof toolCall.arguments === 'string'
            ? toolCall.arguments
            : JSON.stringify(toolCall.arguments || {})
        }
      });
      hasValidMarkers = true;
    } catch (err) {
      // Log warning for unparseable JSON but continue
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[Tool_Rewriter] Failed to parse tool-call JSON: ${err.message}`);
      }
    }
  }

  // Remove all markers from text only if we found valid ones
  if (hasValidMarkers) {
    cleanedText = assistantText.replace(TOOL_CALL_PATTERN, '').trim();
  }

  return { hasMarkers, toolCalls, cleanedText };
}

/**
 * Rewrite non-streaming response body
 *
 * Detects tool-call markers in a response body and rewrites them into
 * OpenAI tool_calls format. Passes through byte-identically when no markers
 * are present.
 *
 * Requirements: 15.1, 15.3, 15.4, 15.5
 *
 * @param {Buffer} bodyBuffer - The response body as a Buffer
 * @returns {Buffer} - The rewritten body (or original if no markers)
 */
function rewriteNonStreaming(bodyBuffer) {
  if (!Buffer.isBuffer(bodyBuffer)) {
    return bodyBuffer;
  }

  try {
    const bodyStr = bodyBuffer.toString('utf8');
    const body = JSON.parse(bodyStr);

    // Only process if this looks like a chat completion response
    if (!body.choices || !Array.isArray(body.choices)) {
      return bodyBuffer;
    }

    let hasChanges = false;
    const newChoices = body.choices.map(choice => {
      if (!choice.message || typeof choice.message.content !== 'string') {
        return choice;
      }

      const { hasMarkers, toolCalls, cleanedText } = extractToolCalls(choice.message.content);

      // Only rewrite if we found valid tool calls (not just markers with invalid JSON)
      if (!hasMarkers || toolCalls.length === 0) {
        return choice;
      }

      hasChanges = true;

      // Rewrite the choice with tool_calls
      return {
        ...choice,
        message: {
          ...choice.message,
          content: cleanedText,
          tool_calls: toolCalls
        }
      };
    });

    // If no changes were made, return original buffer (byte-identical)
    if (!hasChanges) {
      return bodyBuffer;
    }

    // Return rewritten body
    const newBody = { ...body, choices: newChoices };
    return Buffer.from(JSON.stringify(newBody), 'utf8');
  } catch (err) {
    // If parsing fails, return original buffer unchanged
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`[Tool_Rewriter] Failed to parse response body: ${err.message}`);
    }
    return bodyBuffer;
  }
}

/**
 * Transform stream for streaming responses
 *
 * Buffers SSE chunks until a complete tool-call marker block is captured,
 * then emits a single synthetic SSE chunk with the rewritten tool_calls delta
 * before resuming passthrough.
 *
 * Requirements: 15.2
 */
class ToolRewriterStream extends Transform {
  constructor(options = {}) {
    super(options);
    this.buffer = '';
    this.logger = options.logger || console;
  }

  _transform(chunk, encoding, callback) {
    try {
      const chunkStr = chunk.toString('utf8');
      this.buffer += chunkStr;

      // Check if we have a complete tool-call block
      const toolCallMatch = this.buffer.match(/<tool_call>[\s\S]*?<\/tool_call>|<\|function_call\|>[\s\S]*?<\|\/function_call\|>/);

      if (toolCallMatch) {
        // Find the position of the tool-call block
        const startIdx = this.buffer.indexOf(toolCallMatch[0]);
        const endIdx = startIdx + toolCallMatch[0].length;

        // Emit everything before the tool-call block
        if (startIdx > 0) {
          this.push(this.buffer.substring(0, startIdx));
        }

        // Extract and parse the tool call
        const { toolCalls } = extractToolCalls(toolCallMatch[0]);

        // Emit synthetic SSE chunk with tool_calls delta
        if (toolCalls.length > 0) {
          const deltaChunk = `data: ${JSON.stringify({
            choices: [{
              delta: {
                tool_calls: toolCalls
              }
            }]
          })}\n\n`;
          this.push(deltaChunk);
        }

        // Continue with the rest of the buffer
        this.buffer = this.buffer.substring(endIdx);

        // Recursively process remaining buffer
        if (this.buffer.length > 0) {
          this._transform(Buffer.from(this.buffer, 'utf8'), 'utf8', callback);
        } else {
          callback();
        }
      } else {
        // No complete tool-call block yet, keep buffering
        callback();
      }
    } catch (err) {
      if (this.logger && this.logger.warn) {
        this.logger.warn(`[Tool_Rewriter] Stream transform error: ${err.message}`);
      }
      // On error, emit what we have and continue
      if (this.buffer.length > 0) {
        this.push(this.buffer);
        this.buffer = '';
      }
      callback();
    }
  }

  _flush(callback) {
    // Emit any remaining buffered data
    if (this.buffer.length > 0) {
      this.push(this.buffer);
      this.buffer = '';
    }
    callback();
  }
}

module.exports = {
  extractToolCalls,
  rewriteNonStreaming,
  ToolRewriterStream,
  // Alias kept for callers that import `ToolRewriter` (e.g. main.js Phase 1
  // init). The class is the same stream transformer.
  ToolRewriter: ToolRewriterStream
};
