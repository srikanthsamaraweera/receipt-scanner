export type AiReceiptItem = {
  name: string;
  qty: number | null;
  price: number | null;
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          qty: { type: ['number', 'null'] },
          price: { type: ['number', 'null'] },
        },
        required: ['name', 'qty', 'price'],
      },
    },
  },
  required: ['items'],
} as const;

function normalizeAiItem(item: AiReceiptItem): AiReceiptItem {
  return {
    name: typeof item.name === 'string' ? item.name.trim() : '',
    qty: typeof item.qty === 'number' && Number.isFinite(item.qty) ? item.qty : null,
    price: typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null,
  };
}

function parseItemsFromContent(content: string): AiReceiptItem[] {
  if (!content) {
    return [];
  }

  try {
    const parsed = JSON.parse(content) as { items?: AiReceiptItem[] };
    if (!Array.isArray(parsed.items)) {
      return [];
    }
    return parsed.items.map(normalizeAiItem).filter((item) => item.name.length > 0);
  } catch {
    return [];
  }
}

export async function parseReceiptItemsWithOpenAI(
  rawText: string,
  apiKey: string
): Promise<AiReceiptItem[]> {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receipt_items',
          strict: true,
          schema: RECEIPT_SCHEMA,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You extract receipt line items from Canadian grocery receipts. Return only purchasable items, excluding totals, taxes, loyalty, coupons, and payment lines. Price must be the unit price (per item). Ignore tax codes, item codes, and category headers.',
        },
        {
          role: 'user',
          content: `The receipt is from a Canadian grocery store (No Frills, Costco, Walmart, Giant Tiger) or a Chinese market (Al Premium, Scarborough), or a small local grocer. Extract items with name, quantity, and unit price (per item) from this receipt text. If quantity is missing, assume 1. If only a line total is present and quantity > 1, compute unit price. Lines for a single item may be split across two rows; merge them. Ignore tax codes, item codes, and category headers.\n\n${rawText}`,
        },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${message}`.trim());
  }

  const data = (await response.json()) as OpenAiChatResponse;
  return parseItemsFromContent(data.choices?.[0]?.message?.content ?? '');
}

export async function parseReceiptItemsFromImageWithOpenAI(
  base64Image: string,
  apiKey: string
): Promise<AiReceiptItem[]> {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receipt_items',
          strict: true,
          schema: RECEIPT_SCHEMA,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You extract receipt line items from Canadian grocery receipt images. Return only purchasable items, excluding totals, taxes, loyalty, coupons, and payment lines. Price must be the unit price (per item). Ignore tax codes, item codes, and category headers.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'The receipt is from a Canadian grocery store (No Frills, Costco, Walmart, Giant Tiger) or a Chinese market (Al Premium, Scarborough), or a small local grocer. Extract items with name, quantity, and unit price (per item). If quantity is missing, assume 1. If only a line total is present and quantity > 1, compute unit price. Lines for a single item may be split across two rows; merge them. Ignore tax codes, item codes, and category headers.',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${message}`.trim());
  }

  const data = (await response.json()) as OpenAiChatResponse;
  return parseItemsFromContent(data.choices?.[0]?.message?.content ?? '');
}
