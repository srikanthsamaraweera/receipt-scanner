import * as SQLite from 'expo-sqlite';

import { Receipt, ReceiptItem } from './types';

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
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receipt_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL,
      description_raw TEXT NOT NULL,
      qty REAL,
      unit_price REAL,
      line_total REAL,
      category TEXT
    );
  `);
}

export type NewReceipt = Omit<Receipt, 'id' | 'created_at'> & {
  created_at?: string;
};

export type NewReceiptItem = Omit<ReceiptItem, 'id'>;

export async function insertReceipt(receipt: NewReceipt): Promise<number> {
  const db = await getDb();
  const createdAt = receipt.created_at ?? new Date().toISOString();

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
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    receipt.user_id ?? null,
    receipt.merchant_name,
    receipt.purchase_datetime,
    receipt.subtotal ?? null,
    receipt.tax ?? null,
    receipt.total ?? null,
    receipt.image_uri ?? null,
    receipt.raw_ocr_text ?? null,
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
      line_total,
      category
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    item.receipt_id,
    item.description_raw,
    item.qty ?? null,
    item.unit_price ?? null,
    item.line_total ?? null,
    item.category ?? null
  );

  return result.lastInsertRowId;
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

export async function getReceiptItems(receiptId: number): Promise<ReceiptItem[]> {
  const db = await getDb();

  return db.getAllAsync<ReceiptItem>(
    `SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY id ASC`,
    receiptId
  );
}
