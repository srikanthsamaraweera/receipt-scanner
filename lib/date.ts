type DatePattern = {
  order: 'ymd' | 'dmy';
  regex: RegExp;
};

const DATE_PATTERNS: DatePattern[] = [
  {
    order: 'ymd',
    regex:
      /(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?/i,
  },
  {
    order: 'dmy',
    regex:
      /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?/i,
  },
];

const pad2 = (value: number) => String(value).padStart(2, '0');

type ParseOptions = {
  preferCurrentYear?: boolean;
  currentYear?: number;
};

export const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

export const endOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

export function parseFlexibleDateTime(value: string, options?: ParseOptions): Date | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  const buildDate = (
    year: number,
    month: number,
    day: number,
    hour = 0,
    minute = 0,
    second = 0
  ) => {
    const date = new Date(year, month, day, hour, minute, second);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  if (options?.preferCurrentYear) {
    const currentYear = options.currentYear ?? new Date().getFullYear();
    const match = normalized.match(
      /^(\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?$/i
    );

    if (match) {
      const shortYear = Number.parseInt(match[1], 10);
      if (shortYear === currentYear % 100) {
        const month = Number.parseInt(match[2], 10) - 1;
        const day = Number.parseInt(match[3], 10);
        let hour = match[4] ? Number.parseInt(match[4], 10) : 0;
        const minute = match[5] ? Number.parseInt(match[5], 10) : 0;
        const second = match[6] ? Number.parseInt(match[6], 10) : 0;
        const meridiem = match[7]?.toUpperCase() ?? null;

        if (meridiem) {
          if (meridiem === 'PM' && hour < 12) {
            hour += 12;
          }
          if (meridiem === 'AM' && hour === 12) {
            hour = 0;
          }
        }

        const built = buildDate(2000 + shortYear, month, day, hour, minute, second);
        if (built) {
          return built;
        }
      }
    }
  }

  for (const pattern of DATE_PATTERNS) {
    const match = normalized.match(pattern.regex);
    if (!match) {
      continue;
    }

    let year = 0;
    let month = 0;
    let day = 0;

    if (pattern.order === 'ymd') {
      year = Number.parseInt(match[1], 10);
      month = Number.parseInt(match[2], 10) - 1;
      day = Number.parseInt(match[3], 10);
    } else {
      const first = Number.parseInt(match[1], 10);
      const second = Number.parseInt(match[2], 10);
      let rawYear = Number.parseInt(match[3], 10);
      if (rawYear < 100) {
        rawYear += 2000;
      }
      year = rawYear;
      if (first > 12 && second <= 12) {
        day = first;
        month = second - 1;
      } else if (second > 12 && first <= 12) {
        day = second;
        month = first - 1;
      } else {
        day = first;
        month = second - 1;
      }
    }

    let hour = match[4] ? Number.parseInt(match[4], 10) : 0;
    const minute = match[5] ? Number.parseInt(match[5], 10) : 0;
    const second = match[6] ? Number.parseInt(match[6], 10) : 0;
    const meridiem = match[7]?.toUpperCase() ?? null;

    if (meridiem) {
      if (meridiem === 'PM' && hour < 12) {
        hour += 12;
      }
      if (meridiem === 'AM' && hour === 12) {
        hour = 0;
      }
    }

    const built = buildDate(year, month, day, hour, minute, second);
    if (built) {
      return built;
    }
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateTimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function normalizeReceiptDateTime(value: string): string | null {
  const parsed = parseFlexibleDateTime(value);
  if (!parsed) {
    return null;
  }
  return formatDateTimeLocal(parsed);
}

export function normalizeReceiptDateTimeFromScan(value: string): string | null {
  const parsed = parseFlexibleDateTime(value, { preferCurrentYear: true });
  if (!parsed) {
    return null;
  }
  return formatDateTimeLocal(parsed);
}
