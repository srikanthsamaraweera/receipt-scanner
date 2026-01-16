import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import BrandingFooter from '@/components/branding-footer';
import { deleteReceipt, getReceiptById, getReceiptItems, replaceReceiptItems, updateReceiptDetails } from '@/lib/db';
import { normalizeReceiptDateTimeFromScan } from '@/lib/date';
import type { Receipt, ReceiptItem } from '@/lib/types';

type EditableReceiptItem = {
  id: string;
  name: string;
  qty: string;
  unitPrice: string;
  lineTotal: string;
};

export default function ReceiptDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const receiptId = useMemo(() => {
    const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!rawId) {
      return null;
    }
    const parsed = Number.parseInt(rawId, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [params.id]);

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftMerchant, setDraftMerchant] = useState('');
  const [draftPurchaseDateTime, setDraftPurchaseDateTime] = useState('');
  const [draftSubtotal, setDraftSubtotal] = useState('');
  const [draftTax, setDraftTax] = useState('');
  const [draftTotal, setDraftTotal] = useState('');
  const [draftItems, setDraftItems] = useState<EditableReceiptItem[]>([]);

  const initializeDrafts = (receiptData: Receipt, itemData: ReceiptItem[]) => {
    setDraftMerchant(receiptData.merchant_name);
    setDraftPurchaseDateTime(receiptData.purchase_datetime);
    setDraftSubtotal(receiptData.subtotal !== null ? receiptData.subtotal.toFixed(2) : '');
    setDraftTax(receiptData.tax !== null ? receiptData.tax.toFixed(2) : '');
    setDraftTotal(receiptData.total !== null ? receiptData.total.toFixed(2) : '');
    setDraftItems(
      itemData.map((item, index) => ({
        id: `${item.id}-${index}`,
        name: item.description_raw,
        qty: item.qty !== null ? String(item.qty) : '',
        unitPrice: item.unit_price !== null ? item.unit_price.toFixed(2) : '',
        lineTotal: item.line_total !== null ? item.line_total.toFixed(2) : '',
      }))
    );
  };

  const parseOptionalNumber = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const updateDraftItem = (id: string, updates: Partial<EditableReceiptItem>) => {
    setDraftItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const handleAddItem = () => {
    setDraftItems((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        name: '',
        qty: '',
        unitPrice: '',
        lineTotal: '',
      },
    ]);
  };

  const handleStartEdit = () => {
    if (receipt) {
      initializeDrafts(receipt, items);
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    if (receipt) {
      initializeDrafts(receipt, items);
    }
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (isSaving || receiptId === null) {
      return;
    }

    const merchantValue = draftMerchant.trim();
    const purchaseValue = draftPurchaseDateTime.trim();
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

    const filteredItems = draftItems.filter((item) => item.name.trim().length > 0);
    if (filteredItems.length === 0) {
      Alert.alert('No items', 'Add at least one item before saving.');
      return;
    }

    setIsSaving(true);
    try {
      await updateReceiptDetails(receiptId, {
        merchant_name: merchantValue,
        purchase_datetime: normalizedPurchaseDate,
        subtotal: parseOptionalNumber(draftSubtotal),
        tax: parseOptionalNumber(draftTax),
        total: parseOptionalNumber(draftTotal),
      });

      const updatedItems = filteredItems.map((item) => {
        const qtyValue = parseOptionalNumber(item.qty);
        const unitPriceValue = parseOptionalNumber(item.unitPrice);
        let lineTotalValue = parseOptionalNumber(item.lineTotal);

        if (lineTotalValue === null && qtyValue !== null && unitPriceValue !== null) {
          lineTotalValue = Number.parseFloat((qtyValue * unitPriceValue).toFixed(2));
        }

        let finalUnitPrice = unitPriceValue;
        if (finalUnitPrice === null && lineTotalValue !== null && qtyValue) {
          finalUnitPrice = lineTotalValue / qtyValue;
        }

        return {
          receipt_id: receiptId,
          description_raw: item.name.trim(),
          qty: qtyValue,
          unit_price:
            finalUnitPrice !== null ? Number.parseFloat(finalUnitPrice.toFixed(2)) : null,
          line_total:
            lineTotalValue !== null ? Number.parseFloat(lineTotalValue.toFixed(2)) : null,
        };
      });

      await replaceReceiptItems(receiptId, updatedItems);

      const [receiptData, itemData] = await Promise.all([
        getReceiptById(receiptId),
        getReceiptItems(receiptId),
      ]);

      if (!receiptData) {
        throw new Error('Receipt not found after saving.');
      }

      setReceipt(receiptData);
      setItems(itemData);
      initializeDrafts(receiptData, itemData);
      setIsEditing(false);
      Alert.alert('Receipt updated', 'Your changes have been saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save receipt.';
      Alert.alert('Save failed', message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (receiptId === null) {
      return;
    }
    Alert.alert('Delete receipt?', 'This will remove the receipt and its items.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteReceipt(receiptId);
            router.back();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Failed to delete receipt.';
            Alert.alert('Delete failed', message);
          }
        },
      },
    ]);
  };

  useEffect(() => {
    let isActive = true;

    if (receiptId === null) {
      setErrorMessage('Invalid receipt id.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    Promise.all([getReceiptById(receiptId), getReceiptItems(receiptId)])
      .then(([receiptData, itemData]) => {
        if (!isActive) {
          return;
        }
        if (!receiptData) {
          setErrorMessage('Receipt not found.');
          return;
        }

        setReceipt(receiptData);
        setItems(itemData);
        initializeDrafts(receiptData, itemData);
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load receipt.';
        setErrorMessage(message);
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [receiptId]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color="#0F766E" />
        <Text style={styles.loadingText}>Loading receipt...</Text>
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{errorMessage}</Text>
      </View>
    );
  }

  if (!receipt) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Receipt not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          {isEditing ? (
            <TextInput
              style={styles.titleInput}
              value={draftMerchant}
              onChangeText={setDraftMerchant}
              placeholder="Merchant"
              placeholderTextColor="#9CA3AF"
            />
          ) : (
            <Text style={styles.title}>{receipt.merchant_name}</Text>
          )}
          {isEditing ? (
            <TextInput
              style={styles.subtitleInput}
              value={draftPurchaseDateTime}
              onChangeText={setDraftPurchaseDateTime}
              placeholder="Purchase date and time"
              placeholderTextColor="#9CA3AF"
            />
          ) : (
            <Text style={styles.subtitle}>{receipt.purchase_datetime}</Text>
          )}
        </View>
        <Pressable
          style={styles.iconButton}
          onPress={isEditing ? handleCancelEdit : handleStartEdit}
          accessibilityRole="button"
        >
          <Ionicons name={isEditing ? 'close' : 'pencil'} size={20} color="#0F766E" />
        </Pressable>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          {isEditing ? (
            <TextInput
              style={styles.summaryInput}
              value={draftSubtotal}
              onChangeText={setDraftSubtotal}
              placeholder="0.00"
              placeholderTextColor="#9CA3AF"
              keyboardType="decimal-pad"
            />
          ) : (
            <Text style={styles.summaryValue}>
              {receipt.subtotal !== null ? `$${receipt.subtotal.toFixed(2)}` : '--'}
            </Text>
          )}
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Tax</Text>
          {isEditing ? (
            <TextInput
              style={styles.summaryInput}
              value={draftTax}
              onChangeText={setDraftTax}
              placeholder="0.00"
              placeholderTextColor="#9CA3AF"
              keyboardType="decimal-pad"
            />
          ) : (
            <Text style={styles.summaryValue}>
              {receipt.tax !== null ? `$${receipt.tax.toFixed(2)}` : '--'}
            </Text>
          )}
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total</Text>
          {isEditing ? (
            <TextInput
              style={[styles.summaryInput, styles.summaryTotalInput]}
              value={draftTotal}
              onChangeText={setDraftTotal}
              placeholder="0.00"
              placeholderTextColor="#9CA3AF"
              keyboardType="decimal-pad"
            />
          ) : (
            <Text style={styles.summaryTotal}>
              {receipt.total !== null ? `$${receipt.total.toFixed(2)}` : '--'}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Items</Text>
        {(isEditing ? draftItems.length === 0 : items.length === 0) ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No items recorded for this receipt.</Text>
          </View>
        ) : (
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
            {isEditing
              ? draftItems.map((item) => (
                  <View key={item.id} style={styles.tableRow}>
                    <TextInput
                      style={[styles.tableCell, styles.tableCellName]}
                      value={item.name}
                      onChangeText={(value) => updateDraftItem(item.id, { name: value })}
                      placeholder="Item name"
                      placeholderTextColor="#9CA3AF"
                    />
                    <TextInput
                      style={[styles.tableCell, styles.tableCellQty]}
                      value={item.qty}
                      onChangeText={(value) => updateDraftItem(item.id, { qty: value })}
                      placeholder="-"
                      placeholderTextColor="#9CA3AF"
                      keyboardType="decimal-pad"
                    />
                    <TextInput
                      style={[styles.tableCell, styles.tableCellPrice]}
                      value={item.unitPrice}
                      onChangeText={(value) => updateDraftItem(item.id, { unitPrice: value })}
                      placeholder="0.00"
                      placeholderTextColor="#9CA3AF"
                      keyboardType="decimal-pad"
                    />
                    <TextInput
                      style={[styles.tableCell, styles.tableCellLineTotal]}
                      value={item.lineTotal}
                      onChangeText={(value) => updateDraftItem(item.id, { lineTotal: value })}
                      placeholder="0.00"
                      placeholderTextColor="#9CA3AF"
                      keyboardType="decimal-pad"
                    />
                  </View>
                ))
              : items.map((item) => (
                  <View key={item.id} style={styles.tableRow}>
                    <Text style={[styles.tableCell, styles.tableCellName]}>
                      {item.description_raw}
                    </Text>
                    <Text style={[styles.tableCell, styles.tableCellQty]}>
                      {item.qty !== null ? item.qty : '--'}
                    </Text>
                    <Text style={[styles.tableCell, styles.tableCellPrice]}>
                      {item.unit_price !== null ? item.unit_price.toFixed(2) : '--'}
                    </Text>
                    <Text style={[styles.tableCell, styles.tableCellLineTotal]}>
                      {item.line_total !== null ? item.line_total.toFixed(2) : '--'}
                    </Text>
                  </View>
                ))}
          </View>
        )}
      </View>

      {isEditing ? (
        <View style={styles.editActions}>
          <Pressable style={styles.secondaryButton} onPress={handleAddItem}>
            <Text style={styles.secondaryButtonText}>Add Item</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, isSaving && styles.primaryButtonDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            <Text style={styles.primaryButtonText}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Text>
          </Pressable>
          <Pressable style={styles.deleteButton} onPress={handleDelete}>
            <Text style={styles.deleteButtonText}>Delete Receipt</Text>
          </Pressable>
        </View>
      ) : null}

      <BrandingFooter />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 32,
    backgroundColor: '#F6F4F1',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F6F4F1',
  },
  loadingText: {
    marginTop: 10,
    color: '#6B7280',
  },
  errorText: {
    color: '#B91C1C',
    fontWeight: '600',
    textAlign: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
  },
  titleInput: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 4,
  },
  subtitle: {
    marginTop: 6,
    color: '#6B7280',
  },
  subtitleInput: {
    marginTop: 6,
    color: '#6B7280',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 4,
  },
  iconButton: {
    height: 36,
    width: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    marginBottom: 18,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  summaryLabel: {
    color: '#6B7280',
  },
  summaryInput: {
    minWidth: 90,
    textAlign: 'right',
    color: '#111827',
    fontWeight: '600',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingVertical: 2,
  },
  summaryTotalInput: {
    color: '#0F766E',
    fontWeight: '700',
  },
  summaryValue: {
    color: '#111827',
    fontWeight: '600',
  },
  summaryTotal: {
    color: '#0F766E',
    fontWeight: '700',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
  },
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
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
  editActions: {
    marginTop: 8,
    marginBottom: 16,
    gap: 10,
  },
  secondaryButton: {
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
    backgroundColor: '#0F766E',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#F9FAFB',
    fontWeight: '600',
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: '#DC2626',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#DC2626',
    fontWeight: '600',
  },
});
