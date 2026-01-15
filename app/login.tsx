import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

export default function LoginScreen() {
  const handleGooglePress = () => {
    Alert.alert('Google Sign-In', 'Coming soon.');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.subtitle}>Use Google to sync receipts across devices later.</Text>

      <Pressable style={styles.googleButton} onPress={handleGooglePress}>
        <Text style={styles.googleButtonText}>Continue with Google</Text>
      </Pressable>

      <Text style={styles.footerText}>Local mode works without signing in.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F4F1',
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1F2937',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#4B5563',
  },
  googleButton: {
    marginTop: 24,
    backgroundColor: '#1D4ED8',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  googleButtonText: {
    color: '#F9FAFB',
    fontWeight: '600',
    fontSize: 16,
  },
  footerText: {
    marginTop: 16,
    color: '#6B7280',
  },
});
