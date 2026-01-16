export type AiReceiptItem = {
  name: string;
  qty: number | null;
  price: number | null;
  line_total: number | null;
};

export type AiReceiptData = {
  items: AiReceiptItem[];
  merchant: string | null;
  purchase_datetime: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
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
          line_total: { type: ['number', 'null'] },
        },
        required: ['name', 'qty', 'price', 'line_total'],
      },
    },
    merchant: { type: ['string', 'null'] },
    purchase_datetime: { type: ['string', 'null'] },
    subtotal: { type: ['number', 'null'] },
    tax: { type: ['number', 'null'] },
    total: { type: ['number', 'null'] },
  },
  required: ['items', 'merchant', 'purchase_datetime', 'subtotal', 'tax', 'total'],
} as const;

function normalizeAiItem(item: AiReceiptItem): AiReceiptItem {
  return {
    name: typeof item.name === 'string' ? item.name.trim() : '',
    qty: typeof item.qty === 'number' && Number.isFinite(item.qty) ? item.qty : null,
    price: typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null,
    line_total:
      typeof item.line_total === 'number' && Number.isFinite(item.line_total)
        ? item.line_total
        : null,
  };
}

function normalizeAiReceiptData(data: AiReceiptData): AiReceiptData {
  return {
    items: Array.isArray(data.items)
      ? data.items.map(normalizeAiItem).filter((item) => item.name.length > 0)
      : [],
    merchant:
      typeof data.merchant === 'string' && data.merchant.trim().length > 0
        ? data.merchant.trim()
        : null,
    purchase_datetime:
      typeof data.purchase_datetime === 'string' &&
      data.purchase_datetime.trim().length > 0
        ? data.purchase_datetime.trim()
        : null,
    subtotal:
      typeof data.subtotal === 'number' && Number.isFinite(data.subtotal)
        ? data.subtotal
        : null,
    tax: typeof data.tax === 'number' && Number.isFinite(data.tax) ? data.tax : null,
    total:
      typeof data.total === 'number' && Number.isFinite(data.total) ? data.total : null,
  };
}

function emptyReceiptData(): AiReceiptData {
  return {
    items: [],
    merchant: null,
    purchase_datetime: null,
    subtotal: null,
    tax: null,
    total: null,
  };
}

function parseReceiptDataFromContent(content: string): AiReceiptData {
  if (!content) {
    return emptyReceiptData();
  }

  try {
    const parsed = JSON.parse(content) as AiReceiptData;
    return normalizeAiReceiptData(parsed);
  } catch {
    return emptyReceiptData();
  }
}

export async function parseReceiptItemsWithOpenAI(
  rawText: string,
  apiKey: string
): Promise<AiReceiptData> {
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
            'You extract receipt line items and totals from Canadian grocery receipts. Return only purchasable items, excluding totals, taxes, loyalty, coupons, and payment lines. Price must be the unit price (per item) and line_total is the final amount charged for the line. Ignore tax codes, item codes, and category headers. Be precise with quantities and unit prices, especially for weighted items.',
        },
        {
          role: 'user',
          content: `The receipt is from a Canadian grocery store (No Frills, Costco, Walmart, Giant Tiger) or a Chinese market (Al Premium, Scarborough), or a small local grocer. Extract items with name, quantity, unit price (per item), and line total (final amount charged) from this receipt text. Lines for a single item may be split across two rows; merge them. Ignore tax codes, item codes, and category headers.

Quantity/unit-price rules (think like a shopper):
- Weighted items: if you see weight like "0.78 kg" or "0.335kg", quantity is that weight. If you see "@ 2.16/kg", unit price is 2.16 (per kg). If a line total is shown (e.g., 0.72), do not use it as unit price.
- Multi-quantity items: if you see "2 @ 1.50" or "2x 1.50", quantity is 2 and unit price is 1.50.
- If a line total is present and quantity > 1 or quantity is a weight but unit price is missing, compute unit price = line total / quantity (round to 2 decimals).
- If no quantity is present, assume quantity = 1 and unit price = the single price shown. Line total should still be the final amount charged for that line.

Also extract merchant name, purchase date/time, subtotal, tax, and total when present. If a field is missing, return null.

${rawText}`,
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
  return parseReceiptDataFromContent(data.choices?.[0]?.message?.content ?? '');
}

export async function parseReceiptItemsFromImageWithOpenAI(
  base64Image: string,
  apiKey: string
): Promise<AiReceiptData> {
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
            'You extract receipt line items and totals from Canadian grocery receipt images. Return only purchasable items, excluding totals, taxes, loyalty, coupons, and payment lines. Price must be the unit price (per item) and line_total is the final amount charged for the line. Ignore tax codes, item codes, and category headers. Be precise with quantities and unit prices, especially for weighted items.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'The receipt is from a Canadian grocery store (No Frills, Costco, Walmart, Giant Tiger) or a Chinese market (Al Premium, Scarborough), or a small local grocer. Extract items with name, quantity, unit price (per item), and line total (final amount charged). Lines for a single item may be split across two rows; merge them. Ignore tax codes, item codes, and category headers.\n\nQuantity/unit-price rules (think like a shopper):\n- Weighted items: if you see weight like "0.78 kg" or "0.335kg", quantity is that weight. If you see "@ 2.16/kg", unit price is 2.16 (per kg). If a line total is shown (e.g., 0.72), do not use it as unit price.\n- Multi-quantity items: if you see "2 @ 1.50" or "2x 1.50", quantity is 2 and unit price is 1.50.\n- If a line total is present and quantity > 1 or quantity is a weight but unit price is missing, compute unit price = line total / quantity (round to 2 decimals).\n- If no quantity is present, assume quantity = 1 and unit price = the single price shown. Line total should still be the final amount charged for that line.\n\nAlso extract merchant name, purchase date/time, subtotal, tax, and total when present. If a field is missing, return null.',
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
  return parseReceiptDataFromContent(data.choices?.[0]?.message?.content ?? '');
}
