const axios = require("axios");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-4-5";

class AnthropicParseError extends Error {
  constructor(message, code = "llm_request_failed") {
    super(message);
    this.name = "AnthropicParseError";
    this.statusCode = 502;
    this.code = code;
  }
}

/**
 * Calls Anthropic's Messages API with a single forced tool call so the model's
 * reply is structured JSON instead of freeform text. Returns the parsed
 * tool input, or throws AnthropicParseError on any failure.
 */
async function callAnthropicTool({ systemPrompt, userMessage, tool }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicParseError(
      "AI request parsing is not configured on this server",
      "llm_not_configured",
    );
  }

  let response;
  try {
    response = await axios.post(
      ANTHROPIC_API_URL,
      {
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
      },
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        timeout: 20000,
      },
    );
  } catch (err) {
    const isTimeout = err.code === "ECONNABORTED";
    throw new AnthropicParseError(
      isTimeout
        ? "The AI request timed out. Please try again."
        : "Couldn't reach the AI service. Please try again in a moment.",
      isTimeout ? "llm_timeout" : "llm_unavailable",
    );
  }

  const toolUse = (response.data?.content || []).find(
    (block) => block.type === "tool_use" && block.name === tool.name,
  );

  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
    throw new AnthropicParseError(
      "The AI couldn't produce a structured result from that request. Try rephrasing with more specific details.",
      "llm_no_structured_output",
    );
  }

  return toolUse.input;
}

module.exports = { callAnthropicTool, AnthropicParseError };
