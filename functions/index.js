const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { OpenAI } = require('openai');
const { Anthropic } = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `You are a shopping assistant command parser. Parse the user's natural language command into a structured intent.

Supported actions:
- "add": Add item(s) to shopping list
- "remove": Remove item(s) from shopping list
- "modify": Change quantity/unit of existing item(s)
- "search": Search product catalog with filters
- "multi": Multiple different actions in one command (e.g., "add milk and remove bread")

For each item, extract:
- item: the product name (string)
- quantity: number (default 1 if not specified)
- unit: unit of measure if specified (bottle, pack, kg, etc.)

For search, also extract filters:
- query: what to search for
- maxPrice: maximum price (number)
- brand: brand name
- isOrganic: boolean
- category: product category

Return ONLY valid JSON matching this schema:
{
  "action": "add|remove|modify|search|multi",
  "items": [
    { "item": "string", "quantity": number|null, "unit": "string|null" }
  ],
  "operations": [
    { "action": "add|remove|modify", "item": "string", "quantity": number|null, "unit": "string|null" }
  ],
  "searchFilters": {
    "query": "string",
    "maxPrice": number|null,
    "brand": "string|null",
    "isOrganic": boolean,
    "category": "string|null"
  }
}

For action "multi", include "operations" with the correct action for each item, and keep "items" as the flattened item list.

Examples:
User: "Add 2 bottles of milk"
{"action":"add","items":[{"item":"milk","quantity":2,"unit":"bottles"}],"searchFilters":null}

User: "Remove milk and add bread"
{"action":"multi","items":[{"item":"milk","quantity":1,"unit":null},{"item":"bread","quantity":1,"unit":null}],"operations":[{"action":"remove","item":"milk","quantity":1,"unit":null},{"action":"add","item":"bread","quantity":1,"unit":null}],"searchFilters":null}

User: "Find organic tomatoes under $5"
{"action":"search","items":[],"searchFilters":{"query":"tomatoes","maxPrice":5,"brand":null,"isOrganic":true,"category":null}}

User: "Change milk to 3 liters"
{"action":"modify","items":[{"item":"milk","quantity":3,"unit":"liters"}],"searchFilters":null}

User: "I need to buy apples, bananas, and a pack of bread"
{"action":"multi","items":[{"item":"apples","quantity":1,"unit":null},{"item":"bananas","quantity":1,"unit":null},{"item":"bread","quantity":1,"unit":"pack"}],"searchFilters":null}

Now parse this command:
User: "{{TEXT}}"
`;

function getLLMClient() {
  const provider = process.env.LLM_PROVIDER || 'openai';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error('LLM_API_KEY not configured');
  }

  if (provider === 'anthropic') {
    return {
      provider: 'anthropic',
      model,
      client: new Anthropic({ apiKey })
    };
  }

  return {
    provider: 'openai',
    model,
    client: new OpenAI({ apiKey })
  };
}

function validateIntentSchema(parsed) {
  if (!parsed.action || !['add', 'remove', 'modify', 'search', 'multi'].includes(parsed.action)) {
    throw new Error('Invalid or missing action');
  }

  if (parsed.action === 'search') {
    if (!parsed.searchFilters || typeof parsed.searchFilters.query !== 'string') {
      throw new Error('Search requires searchFilters.query');
    }
    return;
  }

  const hasItems = Array.isArray(parsed.items) && parsed.items.length > 0;
  const hasOperations = Array.isArray(parsed.operations) && parsed.operations.length > 0;

  if (parsed.action === 'multi') {
    if (!hasItems && !hasOperations) {
      throw new Error('Multi requires items or operations');
    }
  } else if (!hasItems) {
    throw new Error('Non-search actions require at least one item');
  }

  const validateItemShape = (item, label) => {
    if (!item.item || typeof item.item !== 'string') {
      throw new Error(`Each ${label} must have a string item name`);
    }
    if (item.quantity !== null && item.quantity !== undefined && typeof item.quantity !== 'number') {
      throw new Error(`${label} quantity must be a number or null`);
    }
    if (item.unit !== null && item.unit !== undefined && typeof item.unit !== 'string') {
      throw new Error(`${label} unit must be a string or null`);
    }
  };

  if (hasItems) {
    for (const item of parsed.items) {
      validateItemShape(item, 'item');
    }
  }

  if (hasOperations) {
    for (const operation of parsed.operations) {
      if (!operation.action || !['add', 'remove', 'modify'].includes(operation.action)) {
        throw new Error('Each operation must have action add, remove, or modify');
      }
      validateItemShape(operation, 'operation');
    }
  }
}

async function callOpenAI(client, model, prompt) {
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 300
  });
  return completion.choices[0].message.content;
}

async function callAnthropic(client, model, prompt) {
  const response = await client.messages.create({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
    temperature: 0
  });
  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

exports.parseIntent = onRequest(
  {
    cors: true,
    maxInstances: 10,
    timeoutSeconds: 10,
    invoker: 'public'
  },
  async (req, res) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    if (req.method !== 'POST') {
      logger.warn({ requestId, event: 'parse_intent_error', error: 'METHOD_NOT_ALLOWED' });
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'Use POST' });
    }

    const { text, locale } = req.body ?? {};
    const mockMode = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.MOCK_LLM === 'true';

    if (typeof text !== 'string' || !text.trim() || text.length > 1000) {
      logger.warn({ requestId, event: 'parse_intent_error', error: 'INVALID_REQUEST', latencyMs: Date.now() - startTime });
      return res.status(400).json({ error: 'INVALID_REQUEST', message: 'Missing or invalid text field' });
    }

    logger.info({
      requestId,
      event: 'parse_intent_start',
      textLength: text.length,
      locale: locale || 'en-US',
      mockMode
    });

    try {
      let parsed;

      if (mockMode) {
        const { CommandParser } = await import('./command-parser.mjs');
        const parser = new CommandParser();
        try {
          parsed = parser.parseIntent(text);
        } catch (error) {
          return res.status(400).json({ error: 'CLARIFICATION_REQUIRED', message: error.message });
        }
      } else {
        const { provider, model, client } = getLLMClient();
        const prompt = text;

        let rawResponse;
        if (provider === 'anthropic') {
          rawResponse = await callAnthropic(client, model, prompt);
        } else {
          rawResponse = await callOpenAI(client, model, prompt);
        }

        try {
          parsed = JSON.parse(rawResponse);
        } catch (e) {
          logger.error({ requestId, event: 'parse_intent_failure', error: 'INVALID_JSON', latencyMs: Date.now() - startTime });
          return res.status(500).json({ error: 'INVALID_RESPONSE', message: 'LLM returned invalid JSON' });
        }
      }

      try {
        validateIntentSchema(parsed);
      } catch (e) {
        logger.error({ requestId, event: 'parse_intent_failure', error: 'INVALID_SCHEMA', latencyMs: Date.now() - startTime });
        return res.status(500).json({ error: 'INVALID_RESPONSE', message: e.message });
      }

      const intent = {
        ...parsed,
        originalText: text,
        source: mockMode ? 'rule' : 'llm',
        confidence: parsed.confidence ?? 0.85
      };

      logger.info({
        requestId,
        event: 'parse_intent_success',
        latencyMs: Date.now() - startTime,
        action: intent.action,
        itemCount: intent.items?.length || 0,
        provider: mockMode ? 'mock' : (process.env.LLM_PROVIDER || 'openai'),
        model: mockMode ? 'local-rules' : (process.env.LLM_MODEL || 'gpt-4o-mini')
      });

      return res.json({ intent });
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      logger.error({ requestId, event: 'parse_intent_failure', error: error.message, latencyMs });

      if (error.message.includes('rate limit') || error.message.includes('429')) {
        return res.status(429).json({ error: 'RATE_LIMITED', message: 'LLM rate limit exceeded' });
      }
      if (error.message.includes('API key') || error.message.includes('auth')) {
        return res.status(500).json({ error: 'UNAVAILABLE', message: 'LLM service misconfigured' });
      }

      return res.status(500).json({ error: 'UNAVAILABLE', message: 'LLM service temporarily unavailable' });
    }
  }
);

exports.logErrors = onRequest(
  {
    cors: true,
    maxInstances: 5,
    timeoutSeconds: 5,
    invoker: 'public'
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'Use POST' });
    }

    const errors = Array.isArray(req.body?.errors) ? req.body.errors.slice(0, 50) : [];
    if (errors.length === 0) {
      return res.status(400).json({ error: 'INVALID_REQUEST', message: 'Missing errors array' });
    }

    logger.warn({
      event: 'client_errors_received',
      count: errors.length,
      sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : null,
      userId: typeof req.body?.userId === 'string' ? req.body.userId : null,
      errors: errors.map(error => ({
        message: String(error?.message || error || '').slice(0, 500),
        name: error?.name ? String(error.name).slice(0, 100) : null,
        timestamp: error?.timestamp || null
      }))
    });

    return res.status(204).end();
  }
);