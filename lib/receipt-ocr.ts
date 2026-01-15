import TextRecognition from '@react-native-ml-kit/text-recognition';

export type ParsedReceiptItem = {
  description: string;
  qty: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
};

const IGNORE_LINE_KEYWORDS = [
  'subtotal',
  'tax',
  'total',
  'balance',
  'change',
  'cash',
  'visa',
  'mastercard',
  'amex',
  'amount',
  'tip',
  'gratuity',
  'loyalty',
  'pts',
  'coupon',
  'discount',
  'gst',
  'pst',
  'hst',
];

const PRICE_PATTERN = /-?\d{1,6}[.,]\d{2}/g;
const TAX_CODE_SUFFIXES = ['MRJ', 'HMRJ', 'HST', 'GST', 'PST', 'Q', 'R', 'T'];

function parseMoney(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isNaN(parsed) ? null : parsed;
}

function shouldIgnoreLine(line: string): boolean {
  const lower = line.toLowerCase();
  return IGNORE_LINE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function hasLetters(line: string): boolean {
  return /[A-Za-z]/.test(line);
}

function looksLikeCategoryHeader(line: string): boolean {
  return /^\d{2,}-[A-Z]/i.test(line);
}

function looksLikeCodeOnly(line: string): boolean {
  const compact = line.replace(/\s+/g, '');
  return /^\(?\d+\)?$/.test(compact);
}

function stripLeadingCodes(line: string): string {
  let next = line.trim();
  next = next.replace(/^\(?\d+\)?\s+/, '');
  next = next.replace(/^\d{6,}\s+/, '');
  return next.trim();
}

function stripTaxCodeSuffix(line: string): string {
  return line.replace(
    new RegExp(`\\s+(${TAX_CODE_SUFFIXES.join('|')})$`, 'i'),
    ''
  );
}

type UnitLine = {
  qty: number | null;
  unitPrice: number | null;
};

function parseUnitLine(line: string): UnitLine | null {
  const weightMatch = line.match(
    /(\d+(?:\.\d+)?)\s*(kg|lb)\s*@\s*\$?\s*(\d{1,6}[.,]\d{2})/i
  );
  if (weightMatch) {
    return {
      qty: Number.parseFloat(weightMatch[1]),
      unitPrice: parseMoney(weightMatch[3]),
    };
  }

  const unitMatch = line.match(/(\d+)\s*@\s*\$?\s*(\d{1,6}[.,]\d{2})/i);
  if (unitMatch) {
    return {
      qty: Number.parseInt(unitMatch[1], 10),
      unitPrice: parseMoney(unitMatch[2]),
    };
  }

  return null;
}

function isUnitOnlyLine(line: string, unitLine: UnitLine | null): boolean {
  if (!unitLine) {
    return false;
  }

  let stripped = line.replace(/[0-9.,\s@$]/g, '');
  stripped = stripped.replace(/kg|lb/gi, '');
  stripped = stripped.replace(/\/(kg|lb)/gi, '');
  return stripped.length === 0;
}

function removeUnitFragment(line: string): string {
  return line.replace(
    /\b\d+(?:\.\d+)?\s*(kg|lb)?\s*@\s*\$?\s*\d{1,6}[.,]\d{2}(?:\/\w+)?\b/i,
    ''
  );
}

export async function runMlKitOcr(imageUri: string): Promise<string> {
  const result = await TextRecognition.recognize(imageUri);
  return result?.text?.trim() ?? '';
}

export function parseReceiptItems(rawText: string): ParsedReceiptItem[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0 && !shouldIgnoreLine(line));

  const items: ParsedReceiptItem[] = [];
  let pendingDescription: string | null = null;
  let pendingUnit: UnitLine | null = null;

  for (const line of lines) {
    if (looksLikeCategoryHeader(line) || looksLikeCodeOnly(line)) {
      continue;
    }

    const sanitizedLine = line.replace(/\$/g, '');
    const unitLine = parseUnitLine(sanitizedLine);
    const matches = Array.from(sanitizedLine.matchAll(PRICE_PATTERN));

    if (matches.length === 0) {
      if (unitLine) {
        if (items.length > 0) {
          const lastItem = items[items.length - 1];
          if (lastItem.qty === null && unitLine.qty !== null) {
            lastItem.qty = unitLine.qty;
          }
          if (lastItem.unitPrice === null && unitLine.unitPrice !== null) {
            lastItem.unitPrice = unitLine.unitPrice;
          }
        } else {
          pendingUnit = unitLine;
        }
      } else if (hasLetters(sanitizedLine)) {
        pendingDescription = sanitizedLine;
      }
      continue;
    }

    if (isUnitOnlyLine(sanitizedLine, unitLine)) {
      if (items.length > 0) {
        const lastItem = items[items.length - 1];
        if (lastItem.qty === null && unitLine?.qty !== null) {
          lastItem.qty = unitLine.qty;
        }
        if (lastItem.unitPrice === null && unitLine?.unitPrice !== null) {
          lastItem.unitPrice = unitLine.unitPrice;
        }
      } else if (unitLine) {
        pendingUnit = unitLine;
      }
      continue;
    }

    const lastMatch = matches[matches.length - 1];
    const lineTotal = parseMoney(lastMatch[0]);
    if (lineTotal === null || lastMatch.index === undefined) {
      continue;
    }

    let descriptionPart = sanitizedLine.slice(0, lastMatch.index).trim();
    descriptionPart = stripLeadingCodes(descriptionPart);
    descriptionPart = stripTaxCodeSuffix(descriptionPart);
    if (unitLine) {
      descriptionPart = removeUnitFragment(descriptionPart);
    }
    if (!hasLetters(descriptionPart) && pendingDescription) {
      descriptionPart = pendingDescription;
    }
    descriptionPart = descriptionPart.replace(/\s{2,}/g, ' ').trim();
    if (!hasLetters(descriptionPart)) {
      continue;
    }

    let unitPrice: number | null = null;
    let qty: number | null = null;

    const inlineUnit = parseUnitLine(descriptionPart);
    if (inlineUnit) {
      qty = inlineUnit.qty;
      unitPrice = inlineUnit.unitPrice;
      descriptionPart = removeUnitFragment(descriptionPart).trim();
    }

    let description = descriptionPart.trim();
    const qtyMatch = description.match(/^(\d+)\s+(.*)$/);
    if (qtyMatch) {
      qty = Number.parseInt(qtyMatch[1], 10);
      description = qtyMatch[2].trim();
    }

    if (pendingUnit) {
      if (qty === null && pendingUnit.qty !== null) {
        qty = pendingUnit.qty;
      }
      if (unitPrice === null && pendingUnit.unitPrice !== null) {
        unitPrice = pendingUnit.unitPrice;
      }
      pendingUnit = null;
    }

    if (unitPrice === null && qty && qty > 0) {
      unitPrice = Number.parseFloat((lineTotal / qty).toFixed(2));
    }

    items.push({
      description,
      qty,
      unitPrice,
      lineTotal,
    });
    pendingDescription = null;
  }

  return items;
}
