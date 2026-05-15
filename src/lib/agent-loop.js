import { parseToolArguments } from "./parse.js";

export const MAX_TOOL_STEPS = 6;

/**
 * Run a generic agent loop. The loop is identical for any backend.
 *
 * @param {object} args
 * @param {(messages: any[], tools: any[]) => Promise<{message: any}>} args.query
 *        Inference function returning {message: {content, tool_calls?}}.
 * @param {(name: string, args: object) => Promise<any>} args.executeTool
 *        Tool dispatcher per execution context.
 * @param {any[]} args.tools     OpenAI-style tool schema.
 * @param {string} args.systemPrompt
 * @param {string} args.userMessage
 * @param {number} [args.maxSteps]
 * @returns {Promise<{text?: string, error?: string, matches?: any[]}>}
 */
export async function runAgentLoop({
  query,
  executeTool,
  tools,
  systemPrompt,
  userMessage,
  maxSteps = MAX_TOOL_STEPS,
}) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  let lastMatches = null;

  for (let step = 0; step < maxSteps; step += 1) {
    const response = await query(messages, tools);
    const message = response?.message;
    if (!message) {
      return { error: "Model response missing." };
    }

    messages.push(message);

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const name = toolCall.function?.name || "";
        const args = parseToolArguments(toolCall.function?.arguments);
        let result;
        if (args && args.__parse_error) {
          result = {
            ok: false,
            error: `Tool call arguments were not valid JSON: ${args.__raw}. Retry with a valid JSON object.`,
          };
        } else {
          try {
            result = await executeTool(name, args);
          } catch (err) {
            result = { ok: false, error: err?.message || "Tool execution failed." };
          }
        }

        if (name === "match_scholarships" && result && result.ok && Array.isArray(result.matches)) {
          lastMatches = result.matches;
        }

        const toolMessage = {
          role: "tool",
          content: JSON.stringify(result),
        };
        if (toolCall.id) toolMessage.tool_call_id = toolCall.id;
        messages.push(toolMessage);
      }
      continue;
    }

    return {
      text: message.content || "",
      ...(lastMatches ? { matches: lastMatches } : {}),
    };
  }

  return {
    text: "I needed more steps than I have to finish this. Please ask a more specific question.",
    ...(lastMatches ? { matches: lastMatches } : {}),
  };
}
