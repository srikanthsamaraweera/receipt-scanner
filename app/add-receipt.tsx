import { useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import * as ImagePicker from 'expo-image-picker';

import BrandingFooter from '@/components/branding-footer';
import { parseReceiptItems, runMlKitOcr, type ParsedReceiptItem } from '@/lib/receipt-ocr';
import { parseReceiptItemsFromImageWithOpenAI, parseReceiptItemsWithOpenAI, type AiReceiptItem } from '@/lib/receipt-ai';

type EditableReceiptItem = {
  id: string;
  name: string;
  qty: string;
  price: string;
};

export default function AddReceiptScreen() {
  const headerHeight = useHeaderHeight();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
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
      };
    });

  const createEditableItemsFromAi = (parsedItems: AiReceiptItem[]): EditableReceiptItem[] =>
    parsedItems.map((item, index) => ({
      id: `${Date.now()}-${index}`,
      name: item.name,
      qty: item.qty !== null ? String(item.qty) : item.price !== null ? '1' : '',
      price: item.price !== null ? item.price.toFixed(2) : '',
    }));

  const updateItem = (id: string, updates: Partial<EditableReceiptItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, name: '', qty: '', price: '' },
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

    setIsProcessing(true);
    try {
      const openAiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
      let nextItems: EditableReceiptItem[] = [];
      let rawText = '';
      let aiNotice: string | null = null;

      if (openAiKey && asset.base64) {
        try {
          const aiItems = await parseReceiptItemsFromImageWithOpenAI(asset.base64, openAiKey);
          if (aiItems.length > 0) {
            nextItems = createEditableItemsFromAi(aiItems);
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

      if (nextItems.length === 0) {
        rawText = await runMlKitOcr(asset.uri);
        nextItems = createEditableItemsFromParsed(parseReceiptItems(rawText));
        if (openAiKey && rawText) {
          try {
            const aiItems = await parseReceiptItemsWithOpenAI(rawText, openAiKey);
            if (aiItems.length > 0) {
              nextItems = createEditableItemsFromAi(aiItems);
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

  const handleSave = () => {
    Alert.alert('Save Receipt', 'Saving will be added later.');
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
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Purchase date and time</Text>
        <TextInput
          style={styles.input}
          placeholder="2025-01-14 13:45"
          placeholderTextColor="#6B7280"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Subtotal</Text>
        <TextInput
          style={styles.input}
          placeholder="0.00"
          placeholderTextColor="#6B7280"
          keyboardType="numeric"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Tax</Text>
        <TextInput
          style={styles.input}
          placeholder="0.00"
          placeholderTextColor="#6B7280"
          keyboardType="numeric"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Total</Text>
        <TextInput
          style={styles.input}
          placeholder="0.00"
          placeholderTextColor="#6B7280"
          keyboardType="numeric"
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

        <Pressable style={styles.primaryButton} onPress={handleSave}>
          <Text style={styles.primaryButtonText}>Save Receipt</Text>
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
    flex: 2.2,
  },
  tableCellQty: {
    flex: 1,
    textAlign: 'right',
  },
  tableCellPrice: {
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
  primaryButtonText: {
    color: '#F9FAFB',
    fontWeight: '600',
    fontSize: 16,
  },
});
