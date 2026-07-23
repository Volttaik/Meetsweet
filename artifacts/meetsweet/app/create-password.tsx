import React, { useState } from 'react';
import {
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
import MsInput from '@/components/MsInput';
import StepIndicator from '@/components/StepIndicator';
import ScreenTransition from '@/components/ScreenTransition';

type Strength = 'weak' | 'fair' | 'good' | 'strong';

function getStrength(pw: string): { level: Strength; score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { level: 'weak', score, label: 'Weak' };
  if (score === 2) return { level: 'fair', score, label: 'Fair' };
  if (score === 3) return { level: 'good', score, label: 'Good' };
  return { level: 'strong', score, label: 'Strong' };
}

const STRENGTH_COLORS: Record<Strength, string> = {
  weak: '#EF4444',
  fair: '#F97316',
  good: '#EAB308',
  strong: '#22C55E',
};

export default function CreatePasswordScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    username: string;
    email: string;
    phone: string;
    dob: string;
  }>();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const strength = getStrength(password);
  const strengthColor = password.length > 0 ? STRENGTH_COLORS[strength.level] : '#2E2850';

  const validate = () => {
    const errs: Record<string, string> = {};
    if (password.length < 8) errs.password = 'At least 8 characters required';
    else if (strength.level === 'weak') errs.password = 'Password is too weak';
    if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleContinue = () => {
    if (validate()) {
      router.push({
        pathname: '/profile-setup',
        params: { ...params, password },
      });
    }
  };

  const requirements = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'One number', met: /[0-9]/.test(password) },
    { label: 'One special character', met: /[^A-Za-z0-9]/.test(password) },
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
          <StepIndicator total={5} current={1} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 32) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Icon */}
          <View style={styles.iconWrap}>
            <LinearGradient
              colors={['#FF447320', '#C7155A10']}
              style={styles.iconCircle}
            >
              <Ionicons name="lock-closed" size={36} color="#FF4473" />
            </LinearGradient>
          </View>

          <Text style={styles.title}>Secure Password</Text>
          <Text style={styles.subtitle}>
            Choose a strong password to protect your account.
          </Text>

          <View style={styles.form}>
            <MsInput
              label="Password"
              placeholder="Min. 8 characters"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setErrors((e) => ({ ...e, password: '' }));
              }}
              secureTextEntry
              error={errors.password}
            />

            {/* Strength bar */}
            {password.length > 0 && (
              <View style={styles.strengthWrap}>
                <View style={styles.strengthBars}>
                  {[1, 2, 3, 4].map((i) => (
                    <View
                      key={i}
                      style={[
                        styles.strengthBar,
                        {
                          backgroundColor:
                            strength.score >= i ? strengthColor : '#2E2850',
                        },
                      ]}
                    />
                  ))}
                </View>
                <Text style={[styles.strengthLabel, { color: strengthColor }]}>
                  {strength.label}
                </Text>
              </View>
            )}

            <MsInput
              label="Confirm Password"
              placeholder="Repeat your password"
              value={confirmPassword}
              onChangeText={(t) => {
                setConfirmPassword(t);
                setErrors((e) => ({ ...e, confirmPassword: '' }));
              }}
              secureTextEntry
              error={errors.confirmPassword}
            />
          </View>

          {/* Requirements checklist */}
          <View style={styles.requirements}>
            {requirements.map((req) => (
              <View key={req.label} style={styles.reqRow}>
                <Ionicons
                  name={req.met ? 'checkmark-circle' : 'ellipse-outline'}
                  size={16}
                  color={req.met ? '#22C55E' : '#4A3F72'}
                />
                <Text style={[styles.reqText, req.met && styles.reqTextMet]}>
                  {req.label}
                </Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            onPress={handleContinue}
            activeOpacity={0.88}
            style={styles.primaryWrap}
          >
            <LinearGradient
              colors={['#FF4473', '#C7155A']}
              style={styles.primaryBtn}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
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
  scrollContent: { paddingHorizontal: 28, paddingTop: 16 },
  iconWrap: { marginBottom: 16 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
    marginBottom: 28,
  },
  form: { gap: 16, marginBottom: 20 },
  strengthWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: -4,
  },
  strengthBars: { flex: 1, flexDirection: 'row', gap: 6 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    width: 44,
    textAlign: 'right',
  },
  requirements: {
    backgroundColor: '#1A1628',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2E2850',
    padding: 16,
    gap: 10,
    marginBottom: 28,
  },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reqText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: '#4A3F72',
  },
  reqTextMet: { color: '#9385B8' },
  primaryWrap: { borderRadius: 16, overflow: 'hidden' },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Poppins_600SemiBold',
  },
});
