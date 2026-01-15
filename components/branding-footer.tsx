import { StyleSheet, Text, View } from 'react-native';

export default function BrandingFooter() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Project by Sri Kanth @ DesignX</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  text: {
    fontSize: 12,
    color: '#6B7280',
  },
});
