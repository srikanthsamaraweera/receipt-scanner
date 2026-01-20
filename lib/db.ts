import * as SQLite from 'expo-sqlite';

import { parseFlexibleDateTime } from './date';
import { Receipt, ReceiptBackup, ReceiptItem, ReceiptItemWithReceipt } from './types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('receipts.db');
  }

  return dbPromise;
}

export async function initDb() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      photo_url TEXT
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      merchant_name TEXT NOT NULL,
      purchase_datetime TEXT NOT NULL,
      subtotal REAL,
      tax REAL,
      total REAL,
      image_uri TEXT,
      raw_ocr_text TEXT,
      dedupe_key TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receipt_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL,
      description_raw TEXT NOT NULL,
      qty REAL,
      unit_price REAL,
      line_total REAL
    );
  `);

  await migrateReceiptsSchema(db);
  await migrateReceiptItemsSchema(db);
}

export type NewReceipt = Omit<Receipt, 'id' | 'created_at'> & {
  created_at?: string;
};

export type NewReceiptItem = Omit<ReceiptItem, 'id'>;

export async function insertReceipt(
  receipt: NewReceipt,
  options?: { allowDuplicate?: boolean }
): Promise<number> {
  const db = await getDb();
  const createdAt = receipt.created_at ?? new Date().toISOString();
  const dedupeKey = options?.allowDuplicate
    ? null
    : createReceiptDedupeKey(receipt.purchase_datetime, receipt.total);

  const result = await db.runAsync(
    `INSERT INTO receipts (
      user_id,
      merchant_name,
      purchase_datetime,
      subtotal,
      tax,
      total,
      image_uri,
      raw_ocr_text,
      dedupe_key,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    receipt.user_id ?? null,
    receipt.merchant_name,
    receipt.purchase_datetime,
    receipt.subtotal ?? null,
    receipt.tax ?? null,
    receipt.total ?? null,
    receipt.image_uri ?? null,
    receipt.raw_ocr_text ?? null,
    dedupeKey,
    createdAt
  );

  return result.lastInsertRowId;
}

export async function insertReceiptItem(item: NewReceiptItem): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO receipt_items (
      receipt_id,
      description_raw,
      qty,
      unit_price,
      line_total
    ) VALUES (?, ?, ?, ?, ?)`,
    item.receipt_id,
    item.description_raw,
    item.qty ?? null,
    item.unit_price ?? null,
    item.line_total ?? null
  );

  return result.lastInsertRowId;
}

async function migrateReceiptItemsSchema(db: SQLite.SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(receipt_items);`
  );
  if (columns.length === 0) {
    return;
  }

  const hasCategory = columns.some((column) => column.name === 'category');
  if (!hasCategory) {
    return;
  }

  await db.execAsync(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS receipt_items_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL,
      description_raw TEXT NOT NULL,
      qty REAL,
      unit_price REAL,
      line_total REAL
    );
    INSERT INTO receipt_items_new (
      id,
      receipt_id,
      description_raw,
      qty,
      unit_price,
      line_total
    )
    SELECT
      id,
      receipt_id,
      description_raw,
      qty,
      unit_price,
      line_total
    FROM receipt_items;
    DROP TABLE receipt_items;
    ALTER TABLE receipt_items_new RENAME TO receipt_items;
    COMMIT;
  `);
}

export async function getReceipts(userId?: string): Promise<Receipt[]> {
  const db = await getDb();

  if (userId) {
    return db.getAllAsync<Receipt>(
      `SELECT * FROM receipts WHERE user_id = ? ORDER BY purchase_datetime DESC, id DESC`,
      userId
    );
  }

  return db.getAllAsync<Receipt>(
    `SELECT * FROM receipts ORDER BY purchase_datetime DESC, id DESC`
  );
}

export async function getReceiptById(receiptId: number): Promise<Receipt | null> {
  const db = await getDb();
  const rows = await db.getAllAsync<Receipt>(
    `SELECT * FROM receipts WHERE id = ? LIMIT 1`,
    receiptId
  );
  return rows[0] ?? null;
}

export async function getReceiptItems(receiptId: number): Promise<ReceiptItem[]> {
  const db = await getDb();

  return db.getAllAsync<ReceiptItem>(
    `SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY id ASC`,
    receiptId
  );
}

export async function getAllReceiptItems(): Promise<ReceiptItem[]> {
  const db = await getDb();

  return db.getAllAsync<ReceiptItem>(
    `SELECT * FROM receipt_items ORDER BY receipt_id ASC, id ASC`
  );
}

export async function getReceiptItemsWithReceipts(): Promise<ReceiptItemWithReceipt[]> {
  const db = await getDb();

  return db.getAllAsync<ReceiptItemWithReceipt>(
    `SELECT
       receipt_items.id,
       receipt_items.receipt_id,
       receipt_items.description_raw,
       receipt_items.qty,
       receipt_items.unit_price,
       receipt_items.line_total,
       receipts.purchase_datetime
     FROM receipt_items
     INNER JOIN receipts ON receipts.id = receipt_items.receipt_id
     ORDER BY receipts.purchase_datetime DESC, receipt_items.id ASC`
  );
}

export async function exportReceiptBackup(): Promise<ReceiptBackup> {
  const [receipts, items] = await Promise.all([getReceipts(), getAllReceiptItems()]);

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    receipts,
    items,
  };
}

export async function importReceiptBackup(backup: ReceiptBackup): Promise<{
  receiptsImported: number;
  itemsImported: number;
  skippedItems: number;
}> {
  if (!backup || backup.version !== 1) {
    throw new Error('Unsupported backup format.');
  }
  if (!Array.isArray(backup.receipts) || !Array.isArray(backup.items)) {
    throw new Error('Invalid backup data.');
  }

  const db = await getDb();
  await db.execAsync('BEGIN;');
  try {
    const receiptIdMap = new Map<number, number>();

    for (const receipt of backup.receipts) {
      const { id: legacyId, created_at, ...rest } = receipt;
      const newId = await insertReceipt(
        {
          ...rest,
          created_at,
        },
        { allowDuplicate: true }
      );
      receiptIdMap.set(legacyId, newId);
    }

    let itemsImported = 0;
    let skippedItems = 0;

    for (const item of backup.items) {
      const mappedReceiptId = receiptIdMap.get(item.receipt_id);
      if (!mappedReceiptId) {
        skippedItems += 1;
        continue;
      }
      await insertReceiptItem({
        receipt_id: mappedReceiptId,
        description_raw: item.description_raw,
        qty: item.qty,
        unit_price: item.unit_price,
        line_total: item.line_total,
      });
      itemsImported += 1;
    }

    await db.execAsync('COMMIT;');

    return {
      receiptsImported: backup.receipts.length,
      itemsImported,
      skippedItems,
    };
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}

function createReceiptDedupeKey(
  purchaseDateTime: string,
  total: number | null
): string | null {
  if (!purchaseDateTime) {
    return null;
  }
  if (total === null) {
    return purchaseDateTime;
  }
  return `${purchaseDateTime}|${total.toFixed(2)}`;
}

async function migrateReceiptsSchema(db: SQLite.SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(receipts);`);
  if (columns.length === 0) {
    return;
  }

  const hasDedupeKey = columns.some((column) => column.name === 'dedupe_key');
  if (!hasDedupeKey) {
    await db.execAsync(`ALTER TABLE receipts ADD COLUMN dedupe_key TEXT;`);
  }

  await db.execAsync(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_dedupe_key
     ON receipts(dedupe_key)
     WHERE dedupe_key IS NOT NULL;`
  );
}

export async function hasReceiptWithPurchaseDate(
  purchaseDateTime: string,
  total: number | null,
  toleranceMs = 60000
): Promise<boolean> {
  const db = await getDb();
  const roundedTotal = total !== null ? Number.parseFloat(total.toFixed(2)) : null;

  const exactRows = await db.getAllAsync<{
    purchase_datetime: string;
    total: number | null;
    subtotal: number | null;
    tax: number | null;
  }>(
    `SELECT purchase_datetime, total, subtotal, tax
     FROM receipts
     WHERE purchase_datetime = ?`,
    purchaseDateTime
  );

  if (exactRows.length > 0) {
    if (roundedTotal === null) {
      return true;
    }
    const hasTotalMatch = exactRows.some((row) => {
      const rowTotal =
        row.total ?? (row.subtotal !== null && row.tax !== null ? row.subtotal + row.tax : null);
      if (rowTotal === null) {
        return true;
      }
      const normalized = Number.parseFloat(rowTotal.toFixed(2));
      return Math.abs(normalized - roundedTotal) <= 0.01;
    });
    if (hasTotalMatch) {
      return true;
    }
  }

  const rows = await db.getAllAsync<{
    purchase_datetime: string;
    total: number | null;
    subtotal: number | null;
    tax: number | null;
  }>(`SELECT purchase_datetime, total, subtotal, tax FROM receipts`);

  const target = parseFlexibleDateTime(purchaseDateTime);
  if (!target) {
    return false;
  }

  const targetTime = target.getTime();
  return rows.some((row) => {
    const parsed = parseFlexibleDateTime(row.purchase_datetime);
    if (!parsed) {
      return false;
    }
    const isTimeMatch = Math.abs(parsed.getTime() - targetTime) <= toleranceMs;
    if (!isTimeMatch) {
      return false;
    }
    const rowTotal =
      row.total ?? (row.subtotal !== null && row.tax !== null ? row.subtotal + row.tax : null);
    if (roundedTotal === null) {
      return true;
    }
    if (rowTotal === null) {
      return true;
    }
    const normalized = Number.parseFloat(rowTotal.toFixed(2));
    return Math.abs(normalized - roundedTotal) <= 0.01;
  });
}

export async function hasPossibleDuplicateReceipt(
  purchaseDateTime: string,
  total: number | null
): Promise<boolean> {
  const db = await getDb();
  if (!purchaseDateTime) {
    return false;
  }

  if (total === null) {
    const rows = await db.getAllAsync<{ count: number }>(
      `SELECT COUNT(1) as count
       FROM receipts
       WHERE purchase_datetime = ?`,
      purchaseDateTime
    );
    return (rows[0]?.count ?? 0) > 0;
  }

  const roundedTotal = Number.parseFloat(total.toFixed(2));
  const rows = await db.getAllAsync<{ count: number }>(
    `SELECT COUNT(1) as count
     FROM receipts
     WHERE purchase_datetime = ?
       AND (
         (total IS NOT NULL AND ABS(total - ?) <= 0.01)
         OR (
           total IS NULL
           AND subtotal IS NOT NULL
           AND tax IS NOT NULL
           AND ABS((subtotal + tax) - ?) <= 0.01
         )
       )`,
    purchaseDateTime,
    roundedTotal,
    roundedTotal
  );
  return (rows[0]?.count ?? 0) > 0;
}

export async function updateReceiptDetails(
  receiptId: number,
  updates: {
    merchant_name: string;
    purchase_datetime: string;
    subtotal: number | null;
    tax: number | null;
    total: number | null;
  }
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE receipts SET
      merchant_name = ?,
      purchase_datetime = ?,
      subtotal = ?,
      tax = ?,
      total = ?
    WHERE id = ?`,
    updates.merchant_name,
    updates.purchase_datetime,
    updates.subtotal,
    updates.tax,
    updates.total,
    receiptId
  );
}

export async function replaceReceiptItems(
  receiptId: number,
  items: NewReceiptItem[]
): Promise<void> {
  const db = await getDb();
  await db.execAsync('BEGIN;');
  try {
    await db.runAsync(`DELETE FROM receipt_items WHERE receipt_id = ?`, receiptId);

    for (const item of items) {
      await db.runAsync(
        `INSERT INTO receipt_items (
          receipt_id,
          description_raw,
          qty,
          unit_price,
          line_total
        ) VALUES (?, ?, ?, ?, ?)`,
        receiptId,
        item.description_raw,
        item.qty ?? null,
        item.unit_price ?? null,
        item.line_total ?? null
      );
    }

    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}

export async function deleteReceipt(receiptId: number): Promise<void> {
  const db = await getDb();
  await db.execAsync('BEGIN;');
  try {
    await db.runAsync(`DELETE FROM receipt_items WHERE receipt_id = ?`, receiptId);
    await db.runAsync(`DELETE FROM receipts WHERE id = ?`, receiptId);
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}
