export type Receipt = {
  id: number;
  user_id: string | null;
  merchant_name: string;
  purchase_datetime: string;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  image_uri: string | null;
  raw_ocr_text: string | null;
  dedupe_key: string | null;
  created_at: string;
};

export type ReceiptItem = {
  id: number;
  receipt_id: number;
  description_raw: string;
  qty: number | null;
  unit_price: number | null;
  line_total: number | null;
};

export type ReceiptItemWithReceipt = ReceiptItem & {
  purchase_datetime: string;
};
