import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, Spinner } from 'heroui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { ArrowLeft, Mail } from 'lucide-react-native';
import OTPInput, { OTPInputRef } from '@/components/OTPInput';
import { apiFetch } from '@/services/api';

const RESEND_DURATION = 60;

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const displayEmail = email ?? 'your email';

  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [countdown, setCountdown] = useState(RESEND_DURATION);
  const [canResend, setCanResend] = useState(false);
  const otpRef = useRef<OTPInputRef>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Entrance animations
  const contentOpacity = useSharedValue(0);
  const contentY = useSharedValue(24);

  useEffect(() => {
    contentOpacity.value = withDelay(80, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    contentY.value = withDelay(80, withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, []);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentY.value }],
  }));

  const startTimer = () => {
    setCountdown(RESEND_DURATION);
    setCanResend(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const handleVerify = async () => {
    if (!completed) {
      setError('Enter all 6 digits');
      otpRef.current?.shake();
      return;
    }
    setError('');
    setLoading(true);
    try {
      await apiFetch('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email: displayEmail, code: otp }),
      });
      router.replace('/success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Incorrect code. Please try again.';
      setError(msg);
      otpRef.current?.shake();
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = (code: string) => {
    setCompleted(true);
    setOtp(code);
    setError('');
  };

  const handleResend = async () => {
    if (!canResend) return;
    setOtp('');
    setCompleted(false);
    setError('');
    setResendMsg('');
    otpRef.current?.clear();
    startTimer();
    try {
      await apiFetch('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: displayEmail }),
      });
      setResendMsg('New code sent!');
      setTimeout(() => setResendMsg(''), 3000);
    } catch {
      // startTimer already reset state — just continue
    }
  };

  return (
    <View style={styles.bg}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 72 : 24),
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 60 : 48),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ArrowLeft size={22} color="#FFFFFF" strokeWidth={2} />
        </TouchableOpacity>

        <Animated.View style={[styles.inner, contentStyle]}>
          {/* Icon */}
          <View style={styles.iconCircle}>
            <Mail size={32} color="#FFFFFF" strokeWidth={1.8} />
          </View>

          {/* Text */}
          <View style={styles.headerText}>
            <Text style={styles.title}>Verify Your Email</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to{'\n'}
              <Text style={styles.emailHighlight}>{displayEmail}</Text>
            </Text>
          </View>

          {/* OTP */}
          <OTPInput
            ref={otpRef}
            length={6}
            value={otp}
            onChange={(v) => {
              setOtp(v);
              setError('');
              setCompleted(false);
            }}
            onComplete={handleComplete}
            hasError={!!error}
            autoFocus
          />

          {!!error && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          {!!resendMsg && (
            <Text style={styles.successText}>{resendMsg}</Text>
          )}

          {/* Verify button */}
          <Button
            variant="primary"
            size="lg"
            onPress={handleVerify}
            isDisabled={loading || !completed}
            style={[
              styles.verifyBtn,
              loading && styles.verifyBtnLoading,
              (!completed && !loading) && styles.verifyBtnDisabled,
            ]}
          >
            {loading ? (
              <Spinner size="sm" color="#FFFFFF" />
            ) : (
              <Button.Label style={[
                styles.verifyBtnLabel,
                (!completed || loading) && styles.verifyBtnLabelDisabled,
              ]}>
                Verify Email
              </Button.Label>
            )}
          </Button>

          {/* Resend */}
          <View style={styles.resendSection}>
            <Text style={styles.resendPrompt}>Didn't receive the code?</Text>
            <TouchableOpacity onPress={handleResend} disabled={!canResend}>
              <Text style={[styles.resendBtn, !canResend && styles.resendDisabled]}>
                {canResend
                  ? 'Resend Code'
                  : `Resend in 0:${countdown.toString().padStart(2, '0')}`}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000000' },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 28,
    flexGrow: 1,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginBottom: 32,
  },
  inner: {
    alignItems: 'center',
    gap: 28,
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    lineHeight: 24,
  },
  emailHighlight: {
    color: '#FFFFFF',
    fontFamily: 'Poppins_500Medium',
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: '#EF4444',
    textAlign: 'center',
  },
  successText: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: '#22C55E',
    textAlign: 'center',
  },
  verifyBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 46,
    width: '100%',
  },
  verifyBtnLoading: {
    backgroundColor: '#111111',
  },
  verifyBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  verifyBtnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#000000',
  },
  verifyBtnLabelDisabled: {
    color: 'rgba(255,255,255,0.25)',
  },
  resendSection: {
    alignItems: 'center',
    gap: 4,
  },
  resendPrompt: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.3)',
  },
  resendBtn: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: '#FFFFFF',
    paddingVertical: 4,
  },
  resendDisabled: {
    color: 'rgba(255,255,255,0.25)',
  },
});
