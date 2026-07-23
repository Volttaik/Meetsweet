import React from 'react';
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StepIndicator from '@/components/StepIndicator';
import ScreenTransition from '@/components/ScreenTransition';

export default function CompleteRegistrationScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    username: string;
    email: string;
    phone: string;
    dob: string;
    password: string;
    avatarUri: string;
  }>();

  const handleComplete = () => {
    router.push({
      pathname: '/verification',
      params: { phone: params.phone },
    });
  };

  const fields = [
    { icon: 'at-circle-outline' as const, label: 'Username', value: params.username || '—' },
    { icon: 'mail-outline' as const, label: 'Email', value: params.email || '—' },
    { icon: 'call-outline' as const, label: 'Phone', value: params.phone || '—' },
    { icon: 'calendar-outline' as const, label: 'Date of Birth', value: params.dob || '—' },
    { icon: 'lock-closed-outline' as const, label: 'Password', value: '••••••••' },
  ];

  return (
    <ScreenTransition>
    <LinearGradient colors={['#16081E', '#0D0B1A']} style={styles.gradient}>
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 16) },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <StepIndicator total={5} current={3} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 32) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Avatar preview */}
          <View style={styles.avatarSection}>
            {params.avatarUri ? (
              <Image source={{ uri: params.avatarUri }} style={styles.avatar} />
            ) : (
              <LinearGradient
                colors={['#1A1628', '#251F40']}
                style={styles.avatarPlaceholder}
              >
                <Ionicons name="person" size={48} color="#4A3F72" />
              </LinearGradient>
            )}
            <View style={styles.readyBadge}>
              <Ionicons name="checkmark" size={12} color="#FFFFFF" />
            </View>
          </View>

          <Text style={styles.title}>Looking Good! 🎉</Text>
          <Text style={styles.subtitle}>
            Review your details before completing your account.
          </Text>

          {/* Summary card */}
          <View style={styles.card}>
            {fields.map((field, i) => (
              <View key={field.label}>
                <View style={styles.fieldRow}>
                  <View style={styles.fieldIcon}>
                    <Ionicons name={field.icon} size={18} color="#FF4473" />
                  </View>
                  <View style={styles.fieldInfo}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <Text style={styles.fieldValue} numberOfLines={1}>
                      {field.value}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => router.back()}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="pencil-outline" size={16} color="#4A3F72" />
                  </TouchableOpacity>
                </View>
                {i < fields.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </View>

          {/* Terms notice */}
          <Text style={styles.terms}>
            By completing registration, you agree to our{' '}
            <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
            <Text style={styles.termsLink}>Privacy Policy</Text>.
          </Text>

          {/* CTA */}
          <TouchableOpacity
            onPress={handleComplete}
            activeOpacity={0.88}
            style={styles.primaryWrap}
          >
            <LinearGradient
              colors={['#FF4473', '#C7155A']}
              style={styles.primaryBtn}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons name="checkmark-circle-outline" size={22} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>Complete Account</Text>
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </LinearGradient>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    marginBottom: 4,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#251F40',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 28, paddingTop: 8 },

  avatarSection: {
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
    position: 'relative',
    alignSelf: 'center',
  },
  avatar: { width: 100, height: 100, borderRadius: 50 },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#2E2850',
  },
  readyBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0D0B1A',
  },

  title: {
    fontSize: 28,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
    textAlign: 'center',
    marginBottom: 24,
  },

  card: {
    backgroundColor: '#1A1628',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2E2850',
    padding: 4,
    marginBottom: 20,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FF44731A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldInfo: { flex: 1 },
  fieldLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: '#4A3F72',
    marginBottom: 1,
  },
  fieldValue: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: '#FFFFFF',
  },
  divider: { height: 1, backgroundColor: '#2E2850', marginHorizontal: 16 },

  terms: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: '#4A3F72',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 24,
  },
  termsLink: { color: '#FF4473' },

  primaryWrap: { borderRadius: 16, overflow: 'hidden' },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Poppins_600SemiBold',
  },
});
