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
  "searchFilters": {
    "query": "string",
    "maxPrice": number|null,
    "brand": "string|null",
    "isOrganic": boolean,
    "category": "string|null"
  }
}

Examples:
User: "Add 2 bottles of milk"
{"action":"add","items":[{"item":"milk","quantity":2,"unit":"bottles"}],"searchFilters":null}

User: "Remove milk and add bread"
{"action":"multi","items":[{"item":"milk","quantity":1,"unit":null},{"item":"bread","quantity":1,"unit":null}],"searchFilters":null}

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

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('Non-search actions require at least one item');
  }

  for (const item of parsed.items) {
    if (!item.item || typeof item.item !== 'string') {
      throw new Error('Each item must have a string item name');
    }
    if (item.quantity !== null && item.quantity !== undefined && typeof item.quantity !== 'number') {
      throw new Error('Item quantity must be a number or null');
    }
    if (item.unit !== null && item.unit !== undefined && typeof item.unit !== 'string') {
      throw new Error('Item unit must be a string or null');
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

// Mock LLM parser for local development (no API key required)
function mockParseIntent(text) {
  const lower = text.toLowerCase().trim();

  // Search with filters: "find organic tomatoes under $5"
  const searchMatch = lower.match(/^(?:find|search|look for|show me)\s+(.+)$/i);
  if (searchMatch) {
    let query = searchMatch[1];
    const filters = { query: '', maxPrice: null, brand: null, isOrganic: false, category: null };

    // Extract price filter
    const priceMatch = query.match(/(?:under|below|less than|cheaper than)\s*\$?(\d+(?:\.\d+)?)/i);
    if (priceMatch) {
      filters.maxPrice = parseFloat(priceMatch[1]);
      query = query.replace(/(?:under|below|less than|cheaper than)\s*\$?(\d+(?:\.\d+)?)/i, '').trim();
    }

    // Extract organic
    if (/\b(organic|bio)\b/i.test(query)) {
      filters.isOrganic = true;
      query = query.replace(/\b(organic|bio)\b/i, '').trim();
    }

    // Extract brand
    const brandMatch = query.match(/\b(?:brand|by)\s+([a-zA-Z]+)/i);
    if (brandMatch) {
      filters.brand = brandMatch[1];
      query = query.replace(/\b(?:brand|by)\s+([a-zA-Z]+)/i, '').trim();
    }

    // Clean up query
    filters.query = query.replace(/\b(me|for|some|any)\b/gi, '').trim();

    return {
      action: 'search',
      items: [],
      searchFilters: filters
    };
  }

  // Multi-item: "add milk and bread", "buy apples, bananas, and bread", "get milk and 2 bottles of water", "I need milk and bread"
  const multiMatch = lower.match(/^(?:add|buy|get|i need|i want)\s+(.+)$/i);
  if (multiMatch) {
    const itemsText = multiMatch[1];
    // Split by "and" or "," - handle "X, Y, and Z" pattern
    const parts = itemsText.split(/\s*(?:,|and)\s*/i);

    // Filter out empty parts
    const validParts = parts.filter(p => p.trim() && !/^(?:and|or|with|plus)$/i.test(p.trim()));

    if (validParts.length > 1) {
      const items = [];
      for (const part of validParts) {
        // Extract quantity and unit if present (e.g., "2 bottles of water")
        const qtyMatch = part.match(/^(\d+(?:\.\d+)?)\s+(\w+)\s+(.+)$/);
        if (qtyMatch) {
          items.push({
            item: qtyMatch[3].trim(),
            quantity: parseFloat(qtyMatch[1]),
            unit: qtyMatch[2].toLowerCase()
          });
        } else {
          // Check for word quantities like "a couple of apples"
          const wordQtyMatch = part.match(/^(?:a|an)\s+(\w+)\s+(.+)$/i);
          if (wordQtyMatch) {
            const qtyWords = { 'couple': 2, 'few': 3, 'several': 4, 'dozen': 12 };
            items.push({
              item: wordQtyMatch[2].trim(),
              quantity: qtyWords[wordQtyMatch[1].toLowerCase()] || 1,
              unit: null
            });
          } else {
            items.push({ item: part.trim(), quantity: 1, unit: null });
          }
        }
      }

      if (items.length > 1) {
        return {
          action: 'multi',
          items,
          searchFilters: null
        };
      }
    }
  }

  // Single item commands
  // "add 2 bottles of milk"
  const addMatch = lower.match(/^(?:add|buy|get)\s+(.+)$/i);
  if (addMatch) {
    const itemText = addMatch[1];
    // Handle "2 bottles of milk" or "2 bottles milk" or "2 milk"
    const qtyMatch = itemText.match(/^(\d+(?:\.\d+)?)\s+(\w+)(?:\s+of)?\s+(.+)$/);
    if (qtyMatch) {
      return {
        action: 'add',
        items: [{
          item: qtyMatch[3].trim(),
          quantity: parseFloat(qtyMatch[1]),
          unit: qtyMatch[2].toLowerCase()
        }],
        searchFilters: null
      };
    }
    // "add milk"
    return {
      action: 'add',
      items: [{ item: itemText.trim(), quantity: 1, unit: null }],
      searchFilters: null
    };
  }

  // "change milk to 3 liters" / "modify milk to 2 bottles"
  const modifyMatch = lower.match(/^(?:change|modify|update|set)\s+(.+)\s+to\s+(\d+(?:\.\d+)?)\s*(\w*)$/i);
  if (modifyMatch) {
    return {
      action: 'modify',
      items: [{
        item: modifyMatch[1].trim(),
        quantity: parseFloat(modifyMatch[2]),
        unit: modifyMatch[3] ? modifyMatch[3].toLowerCase() : null
      }],
      searchFilters: null
    };
  }

  // "remove milk"
  const removeMatch = lower.match(/^(?:remove|delete|take out|drop)\s+(.+)$/i);
  if (removeMatch) {
    return {
      action: 'remove',
      items: [{ item: removeMatch[1].trim(), quantity: 1, unit: null }],
      searchFilters: null
    };
  }

  // Default fallback
  return {
    action: 'add',
    items: [{ item: text.trim(), quantity: 1, unit: null }],
    searchFilters: null
  };
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

    const { text, locale } = req.body;

    if (!text || typeof text !== 'string') {
      logger.warn({ requestId, event: 'parse_intent_error', error: 'INVALID_REQUEST', latencyMs: Date.now() - startTime });
      return res.status(400).json({ error: 'INVALID_REQUEST', message: 'Missing or invalid text field' });
    }

    logger.info({
      requestId,
      event: 'parse_intent_start',
      textLength: text.length,
      locale: locale || 'en-US',
      mockMode: process.env.MOCK_LLM === 'true'
    });

    try {
      let parsed;

      // Use mock LLM when MOCK_LLM=true (local development)
      if (process.env.MOCK_LLM === 'true') {
        parsed = mockParseIntent(text);
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
        source: 'llm',
        confidence: parsed.confidence ?? 0.85
      };

      logger.info({
        requestId,
        event: 'parse_intent_success',
        latencyMs: Date.now() - startTime,
        action: intent.action,
        itemCount: intent.items?.length || 0,
        provider: process.env.MOCK_LLM === 'true' ? 'mock' : (process.env.LLM_PROVIDER || 'openai'),
        model: process.env.MOCK_LLM === 'true' ? 'local-mock' : (process.env.LLM_MODEL || 'gpt-4o-mini')
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