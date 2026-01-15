import { Link } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import BrandingFooter from '@/components/branding-footer';

type ReceiptPreview = {
  id: number;
  merchant_name: string;
  purchase_datetime: string;
  total: number;
};

const sampleReceipts: ReceiptPreview[] = [];

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Receipts</Text>
        <Text style={styles.subtitle}>Saved locally on your device.</Text>
      </View>

      <View style={styles.actions}>
        <Link href="/add-receipt" asChild>
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Add Receipt</Text>
          </Pressable>
        </Link>
        <Link href="/login" asChild>
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Sign In</Text>
          </Pressable>
        </Link>
      </View>

      <FlatList
        data={sampleReceipts}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle}>{item.merchant_name}</Text>
              <Text style={styles.cardTotal}>${item.total.toFixed(2)}</Text>
            </View>
            <Text style={styles.cardSub}>{item.purchase_datetime}</Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No receipts yet</Text>
            <Text style={styles.emptyText}>Tap Add Receipt to create your first entry.</Text>
          </View>
        }
        ListFooterComponent={<BrandingFooter />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F4F1',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1F2937',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: '#4B5563',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#0F766E',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginRight: 12,
  },
  primaryButtonText: {
    color: '#F9FAFB',
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#0F766E',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  secondaryButtonText: {
    color: '#0F766E',
    fontWeight: '600',
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  cardTotal: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F766E',
  },
  cardSub: {
    marginTop: 6,
    color: '#6B7280',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
  },
  emptyText: {
    marginTop: 6,
    color: '#6B7280',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
