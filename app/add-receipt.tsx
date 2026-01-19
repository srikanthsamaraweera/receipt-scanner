import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';

import BrandingFooter from '@/components/branding-footer';
import { hasPossibleDuplicateReceipt, insertReceipt, insertReceiptItem } from '@/lib/db';
import { normalizeReceiptDateTimeFromScan } from '@/lib/date';
import { parseReceiptItems, runMlKitOcr, type ParsedReceiptItem } from '@/lib/receipt-ocr';
import { parseReceiptItemsFromImageWithOpenAI, parseReceiptItemsWithOpenAI, type AiReceiptData, type AiReceiptItem } from '@/lib/receipt-ai';

type EditableReceiptItem = {
  id: string;
  name: string;
  qty: string;
  price: string;
  lineTotal: string;
};

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/;

const shouldPreferOcrItems = (
  rawText: string,
  parsedItems: ParsedReceiptItem[],
  aiItems: AiReceiptItem[]
) => {
  if (!rawText || parsedItems.length === 0) {
    return false;
  }
  if (CJK_PATTERN.test(rawText)) {
    return true;
  }
  return aiItems.length === 0;
};

export default function AddReceiptScreen() {
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const [merchant, setMerchant] = useState('');
  const [purchaseDateTime, setPurchaseDateTime] = useState('');
  const [purchaseDateWarning, setPurchaseDateWarning] = useState(false);
  const [purchaseDateAcknowledged, setPurchaseDateAcknowledged] = useState(false);
  const [subtotal, setSubtotal] = useState('');
  const [tax, setTax] = useState('');
  const [total, setTotal] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [rawOcrText, setRawOcrText] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [items, setItems] = useState<EditableReceiptItem[]>([]);

  const createEditableItemsFromParsed = (
    parsedItems: ParsedReceiptItem[]
  ): EditableReceiptItem[] =>
    parsedItems.map((item, index) => {
      const inferredQty = item.qty ?? (item.lineTotal !== null ? 1 : null);
      const unitPrice =
        item.unitPrice ??
        (item.lineTotal !== null && inferredQty
          ? Number.parseFloat((item.lineTotal / inferredQty).toFixed(2))
          : item.lineTotal);
      return {
        id: `${Date.now()}-${index}`,
        name: item.description,
        qty: inferredQty !== null ? String(inferredQty) : '',
        price: unitPrice !== null ? unitPrice.toFixed(2) : '',
        lineTotal: item.lineTotal !== null ? item.lineTotal.toFixed(2) : '',
      };
    });

  const createEditableItemsFromAi = (parsedItems: AiReceiptItem[]): EditableReceiptItem[] =>
    parsedItems.map((item, index) => ({
      id: `${Date.now()}-${index}`,
      name: item.name,
      qty: item.qty !== null ? String(item.qty) : item.price !== null ? '1' : '',
      price: item.price !== null ? item.price.toFixed(2) : '',
      lineTotal: item.line_total !== null ? item.line_total.toFixed(2) : '',
    }));

  const applyReceiptFields = (receipt: AiReceiptData) => {
    if (receipt.merchant) {
      setMerchant(receipt.merchant);
    }
    if (receipt.purchase_datetime) {
      const normalized = normalizeReceiptDateTimeFromScan(receipt.purchase_datetime);
      setPurchaseDateTime(normalized ?? receipt.purchase_datetime);
    }
    if (receipt.subtotal !== null) {
      setSubtotal(receipt.subtotal.toFixed(2));
    }
    if (receipt.tax !== null) {
      setTax(receipt.tax.toFixed(2));
    }
    if (receipt.total !== null) {
      setTotal(receipt.total.toFixed(2));
    }
  };

  const hasReceiptFields = (receipt: AiReceiptData) =>
    Boolean(
      receipt.merchant ||
        receipt.purchase_datetime ||
        receipt.subtotal !== null ||
        receipt.tax !== null ||
        receipt.total !== null
    );

  const updateItem = (id: string, updates: Partial<EditableReceiptItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, name: '', qty: '', price: '', lineTotal: '' },
    ]);
  };

  const handleAttachPhoto = async () => {
    setOcrError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera permission required', 'Please allow camera access to scan receipts.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return;
    }

    setPhotoUri(asset.uri);
    setItems([]);
    setRawOcrText(null);
    setMerchant('');
    setPurchaseDateTime('');
    setPurchaseDateWarning(false);
    setPurchaseDateAcknowledged(false);
    setSubtotal('');
    setTax('');
    setTotal('');

    setIsProcessing(true);
    try {
      const openAiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
      let nextItems: EditableReceiptItem[] = [];
      let rawText = '';
      let aiNotice: string | null = null;
      let aiData: AiReceiptData | null = null;
      let parsedOcrItems: ParsedReceiptItem[] = [];

      if (openAiKey && asset.base64) {
        try {
          aiData = await parseReceiptItemsFromImageWithOpenAI(asset.base64, openAiKey);
          if (aiData.items.length > 0) {
            nextItems = createEditableItemsFromAi(aiData.items);
          }
          if (hasReceiptFields(aiData)) {
            applyReceiptFields(aiData);
          } else {
            aiNotice = 'AI parsing returned no items. Falling back to OCR text.';
          }
        } catch (error) {
          aiNotice =
            error instanceof Error
              ? `${error.message} Falling back to OCR text.`
              : 'AI parsing failed. Falling back to OCR text.';
        }
      } else if (openAiKey && !asset.base64) {
        aiNotice = 'Image data missing for AI parsing. Falling back to OCR text.';
      }

      rawText = await runMlKitOcr(asset.uri);
      setRawOcrText(rawText);
      parsedOcrItems = rawText ? parseReceiptItems(rawText) : [];
      const ocrItems = createEditableItemsFromParsed(parsedOcrItems);
      const preferOcr = shouldPreferOcrItems(rawText, parsedOcrItems, aiData?.items ?? []);

      if (preferOcr && ocrItems.length > 0) {
        nextItems = ocrItems;
      }

      if (nextItems.length === 0) {
        nextItems = ocrItems;
      }

      const shouldTryAiText =
        Boolean(openAiKey && rawText) && (!aiData || aiData.items.length === 0);
      if (shouldTryAiText) {
        try {
          const aiTextData = await parseReceiptItemsWithOpenAI(rawText, openAiKey);
          if (
            aiTextData.items.length > 0 &&
            !shouldPreferOcrItems(rawText, parsedOcrItems, aiTextData.items)
          ) {
            nextItems = createEditableItemsFromAi(aiTextData.items);
          }
          if (hasReceiptFields(aiTextData)) {
            applyReceiptFields(aiTextData);
          } else if (!aiNotice) {
            aiNotice = 'AI parsing returned no items. Showing best-effort results.';
          }
        } catch (error) {
          if (!aiNotice) {
            aiNotice =
              error instanceof Error
                ? error.message
                : 'AI parsing failed. Showing best-effort results.';
          }
        }
      }

      if (!rawText && !aiNotice) {
        aiNotice = 'No text detected in the photo.';
      }

      if (aiNotice) {
        setOcrError(aiNotice);
      }
      setItems(nextItems);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read receipt text.';
      setOcrError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const parseOptionalNumber = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  };

  useEffect(() => {
    const trimmed = purchaseDateTime.trim();
    if (!trimmed) {
      setPurchaseDateWarning(false);
      return;
    }

    const normalized = normalizeReceiptDateTimeFromScan(trimmed);
    if (!normalized) {
      setPurchaseDateWarning(false);
      return;
    }

    let isActive = true;
    const timeout = setTimeout(() => {
      hasPossibleDuplicateReceipt(normalized, null)
        .then((hasDuplicate) => {
          if (isActive) {
          setPurchaseDateWarning(hasDuplicate);
        }
      })
        .catch(() => {
          if (isActive) {
            setPurchaseDateWarning(false);
          }
        });
    }, 300);

    return () => {
      isActive = false;
      clearTimeout(timeout);
    };
  }, [purchaseDateTime]);

  useEffect(() => {
    if (!purchaseDateWarning) {
      setPurchaseDateAcknowledged(false);
    }
  }, [purchaseDateWarning]);

  const handleSave = async (forceDuplicate = false) => {
    if (isSaving || isProcessing) {
      return;
    }
    if (purchaseDateWarning && !purchaseDateAcknowledged) {
      Alert.alert(
        'Duplicate warning',
        'Please acknowledge the duplicate warning before saving.'
      );
      return;
    }

    const merchantValue = merchant.trim();
    const purchaseValue = purchaseDateTime.trim();
    if (!merchantValue) {
      Alert.alert('Missing merchant', 'Please enter the merchant name before saving.');
      return;
    }
    if (!purchaseValue) {
      Alert.alert('Missing date', 'Please enter the purchase date and time.');
      return;
    }
    const normalizedPurchaseDate = normalizeReceiptDateTimeFromScan(purchaseValue);
    if (!normalizedPurchaseDate) {
      Alert.alert(
        'Invalid date',
        'Enter a valid date like YYYY-MM-DD or DD/MM/YY with optional time.'
      );
      return;
    }

    const subtotalValue = parseOptionalNumber(subtotal);
    const taxValue = parseOptionalNumber(tax);
    const totalValue = parseOptionalNumber(total);
    const computedTotal =
      totalValue ?? (subtotalValue !== null && taxValue !== null ? subtotalValue + taxValue : null);

    if (!forceDuplicate) {
      const hasDuplicate = await hasPossibleDuplicateReceipt(
        normalizedPurchaseDate,
        computedTotal
      );
      if (hasDuplicate) {
        Alert.alert(
          'Possible duplicate',
          'A receipt with the same purchase date/time and total already exists. Save anyway?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Save anyway',
              onPress: () => handleSave(true),
            },
          ]
        );
        return;
      }
    }

    const filteredItems = items.filter((item) => item.name.trim().length > 0);
    if (filteredItems.length === 0) {
      Alert.alert('No items', 'Add at least one item before saving.');
      return;
    }

    setIsSaving(true);
    try {
      const receiptId = await insertReceipt(
        {
          user_id: null,
          merchant_name: merchantValue,
          purchase_datetime: normalizedPurchaseDate,
          subtotal: subtotalValue,
          tax: taxValue,
          total: totalValue ?? computedTotal,
          image_uri: photoUri,
          raw_ocr_text: rawOcrText,
        },
        { allowDuplicate: forceDuplicate }
      );

      await Promise.all(
        filteredItems.map((item) => {
          const qtyValue = parseOptionalNumber(item.qty);
          const unitPriceValue = parseOptionalNumber(item.price);
          let lineTotalValue = parseOptionalNumber(item.lineTotal);

          if (lineTotalValue === null && qtyValue !== null && unitPriceValue !== null) {
            lineTotalValue = Number.parseFloat((qtyValue * unitPriceValue).toFixed(2));
          }

          const finalUnitPrice =
            unitPriceValue ??
            (lineTotalValue !== null && qtyValue ? lineTotalValue / qtyValue : null);

          return insertReceiptItem({
            receipt_id: receiptId,
            description_raw: item.name.trim(),
            qty: qtyValue,
            unit_price: finalUnitPrice !== null ? Number.parseFloat(finalUnitPrice.toFixed(2)) : null,
            line_total: lineTotalValue,
          });
        })
      );

      Alert.alert('Receipt saved', 'Your receipt has been saved locally.', [
        {
          text: 'OK',
          onPress: () => router.back(),
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save receipt.';
      if (!forceDuplicate && message.includes('dedupe_key')) {
        setIsSaving(false);
        Alert.alert(
          'Possible duplicate',
          'A receipt with the same purchase date/time and total already exists. Save anyway?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Save anyway',
              onPress: () => handleSave(true),
            },
          ]
        );
        return;
      }
      Alert.alert('Save failed', message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
      >
        <Text style={styles.title}>Add Receipt</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Merchant</Text>
        <TextInput
          style={styles.input}
          placeholder="Coffee Shop"
          placeholderTextColor="#6B7280"
          value={merchant}
          onChangeText={setMerchant}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Purchase date and time</Text>
        <TextInput
          style={[styles.input, purchaseDateWarning && styles.inputWarning]}
          placeholder="2025-01-14 13:45"
          placeholderTextColor="#6B7280"
          value={purchaseDateTime}
          onChangeText={setPurchaseDateTime}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Subtotal</Text>
        <TextInput
          style={styles.input}
          placeholder="0.00"
          placeholderTextColor="#6B7280"
          keyboardType="numeric"
          value={subtotal}
          onChangeText={setSubtotal}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Tax</Text>
        <TextInput
          style={styles.input}
          placeholder="0.00"
          placeholderTextColor="#6B7280"
          keyboardType="numeric"
          value={tax}
          onChangeText={setTax}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Total</Text>
        <TextInput
          style={styles.input}
          placeholder="0.00"
          placeholderTextColor="#6B7280"
          keyboardType="numeric"
          value={total}
          onChangeText={setTotal}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Receipt photo</Text>
        <Pressable style={styles.outlineButton} onPress={handleAttachPhoto}>
          <Text style={styles.outlineButtonText}>Attach Photo</Text>
        </Pressable>
        <View style={styles.imagePlaceholder}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.imagePreview} resizeMode="cover" />
          ) : (
            <Text style={styles.imagePlaceholderText}>No image selected</Text>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Items</Text>
        <View style={styles.itemCard}>
          {isProcessing ? (
            <View style={styles.processingRow}>
              <ActivityIndicator size="small" color="#0F766E" />
              <Text style={styles.itemText}>Reading receipt text...</Text>
            </View>
          ) : items.length > 0 ? (
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeaderRow]}>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellName]}>
                  Item
                </Text>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellQty]}>
                  Qty
                </Text>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellPrice]}>
                  Unit Price
                </Text>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellLineTotal]}>
                  Line Total
                </Text>
              </View>
              {items.map((item) => (
                <View key={item.id} style={styles.tableRow}>
                  <TextInput
                    style={[styles.tableCell, styles.tableCellName]}
                    value={item.name}
                    onChangeText={(value) => updateItem(item.id, { name: value })}
                    placeholder="Item name"
                    placeholderTextColor="#9CA3AF"
                  />
                  <TextInput
                    style={[styles.tableCell, styles.tableCellQty]}
                    value={item.qty}
                    onChangeText={(value) => updateItem(item.id, { qty: value })}
                    placeholder="-"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    style={[styles.tableCell, styles.tableCellPrice]}
                    value={item.price}
                    onChangeText={(value) => updateItem(item.id, { price: value })}
                    placeholder="0.00"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    style={[styles.tableCell, styles.tableCellLineTotal]}
                    value={item.lineTotal}
                    onChangeText={(value) => updateItem(item.id, { lineTotal: value })}
                    placeholder="0.00"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="decimal-pad"
                  />
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.itemText}>Itemized entries will appear here.</Text>
          )}
          {ocrError ? <Text style={styles.ocrErrorText}>{ocrError}</Text> : null}
        </View>
        <Pressable style={styles.secondaryButton} onPress={handleAddItem}> 
          <Text style={styles.secondaryButtonText}>Add Item</Text>
        </Pressable>
      </View>

      {purchaseDateWarning ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>Possible duplicate receipt</Text>
          <Text style={styles.warningText}>
            A receipt with this purchase date/time already exists. Confirm before saving.
          </Text>
          <Pressable
            style={styles.warningCheckboxRow}
            onPress={() => setPurchaseDateAcknowledged((prev) => !prev)}
          >
            <View
              style={[
                styles.warningCheckbox,
                purchaseDateAcknowledged && styles.warningCheckboxChecked,
              ]}
            >
              {purchaseDateAcknowledged ? (
                <Text style={styles.warningCheckboxMark}>✓</Text>
              ) : null}
            </View>
            <Text style={styles.warningCheckboxLabel}>I acknowledge this may be a duplicate</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        style={[
          styles.primaryButton,
          (isSaving || (purchaseDateWarning && !purchaseDateAcknowledged)) &&
            styles.primaryButtonDisabled,
        ]}
        onPress={handleSave}
        disabled={isSaving || (purchaseDateWarning && !purchaseDateAcknowledged)}
      >
        <Text style={styles.primaryButtonText}>
          {isSaving ? 'Saving...' : 'Save Receipt'}
        </Text>
      </Pressable>

        <BrandingFooter />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F4F1',
  },
  container: {
    padding: 20,
    paddingBottom: 180,
    backgroundColor: '#F6F4F1',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 16,
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111827',
  },
  inputWarning: {
    borderColor: '#F59E0B',
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: '#0F766E',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  outlineButtonText: {
    color: '#0F766E',
    fontWeight: '600',
  },
  imagePlaceholder: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  imagePreview: {
    width: '100%',
    height: 220,
    borderRadius: 8,
  },
  imagePlaceholderText: {
    color: '#6B7280',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
  },
  itemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
  },
  itemText: {
    color: '#6B7280',
  },
  table: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  tableHeaderRow: {
    backgroundColor: '#F3F4F6',
    borderTopWidth: 0,
  },
  tableCell: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
    color: '#111827',
  },
  tableHeaderCell: {
    fontWeight: '700',
    color: '#374151',
  },
  tableCellName: {
    flex: 2,
  },
  tableCellQty: {
    flex: 1,
    textAlign: 'right',
  },
  tableCellPrice: {
    flex: 1.1,
    textAlign: 'right',
  },
  tableCellLineTotal: {
    flex: 1.2,
    textAlign: 'right',
    borderRightWidth: 0,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ocrErrorText: {
    marginTop: 8,
    color: '#B91C1C',
  },
  secondaryButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#0F766E',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0F766E',
    fontWeight: '600',
  },
  primaryButton: {
    marginTop: 8,
    backgroundColor: '#0F766E',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#F9FAFB',
    fontWeight: '600',
    fontSize: 16,
  },
  warningCard: {
    marginTop: 4,
    marginBottom: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
  },
  warningTitle: {
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
  },
  warningText: {
    color: '#92400E',
    marginBottom: 8,
  },
  warningCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  warningCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#D97706',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  warningCheckboxChecked: {
    backgroundColor: '#F59E0B',
    borderColor: '#F59E0B',
  },
  warningCheckboxMark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  warningCheckboxLabel: {
    color: '#92400E',
    fontWeight: '600',
  },
});
