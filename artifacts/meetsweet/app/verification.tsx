import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
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
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { ArrowLeft, CheckCircle } from 'lucide-react-native';
import OTPInput, { OTPInputRef } from '@/components/OTPInput';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEMO_CODE = '5274';
const RESEND_DURATION = 60;

// ─── Success overlay ──────────────────────────────────────────────────────────

function SuccessOverlay({ visible }: { visible: boolean }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.6);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
      scale.value = withSequence(
        withSpring(1.1, { damping: 8, stiffness: 280 }),
        withSpring(1, { damping: 14, stiffness: 400 }),
      );
    }
  }, [visible]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.successOverlay, style]}>
      <CheckCircle size={48} color="#22C55E" strokeWidth={1.8} />
      <Text style={styles.successText}>Verified!</Text>
    </Animated.View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function VerificationScreen() {
  const insets = useSafeAreaInsets();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(RESEND_DURATION);
  const [canResend, setCanResend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const otpRef = useRef<OTPInputRef>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Entrance animations
  const headerOpacity = useSharedValue(0);
  const headerY = useSharedValue(20);
  const otpOpacity = useSharedValue(0);
  const otpY = useSharedValue(16);
  const btnOpacity = useSharedValue(0);

  useEffect(() => {
    headerOpacity.value = withDelay(60, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    headerY.value = withDelay(60, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));
    otpOpacity.value = withDelay(180, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }));
    otpY.value = withDelay(180, withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) }));
    btnOpacity.value = withDelay(300, withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) }));
  }, []);

  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerY.value }],
  }));
  const otpStyle = useAnimatedStyle(() => ({
    opacity: otpOpacity.value,
    transform: [{ translateY: otpY.value }],
  }));
  const btnStyle = useAnimatedStyle(() => ({
    opacity: btnOpacity.value,
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
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const maskedPhone = phone
    ? phone.replace(/\D/g, '').replace(/(\d{3})(\d+)(\d{3})/, '+1 (***) ***-$3')
    : '+1 (***) ***-**78';

  const handleVerify = async () => {
    if (otp.length < 4) {
      setError('Enter all 4 digits');
      otpRef.current?.shake();
      return;
    }
    if (otp !== DEMO_CODE) {
      setError('Incorrect code — try ' + DEMO_CODE + ' for demo');
      otpRef.current?.shake();
      return;
    }
    setError('');
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    setLoading(false);
    setSuccess(true);
    setTimeout(() => router.replace('/home'), 900);
  };

  const handleOtpComplete = (code: string) => {
    if (code === DEMO_CODE) {
      handleVerify();
    }
  };

  const handleResend = () => {
    if (!canResend) return;
    setOtp('');
    setError('');
    otpRef.current?.clear();
    startTimer();
  };

  const isReady = otp.replace(/\s/g, '').length === 4;

  return (
    <View style={styles.bg}>
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 72 : 20),
            paddingBottom: insets.bottom + 36,
          },
        ]}
      >
        {/* Back button */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <ArrowLeft size={22} color="#FFFFFF" strokeWidth={2} />
        </TouchableOpacity>

        {/* Center content */}
        <View style={styles.body}>
          {/* Header */}
          <Animated.View style={[styles.header, headerStyle]}>
            {/* Lock icon circle */}
            <View style={styles.iconCircle}>
              <Text style={styles.iconEmoji}>🔒</Text>
            </View>

            <Text style={styles.title}>Verify Your Number</Text>
            <Text style={styles.subtitle}>
              We sent a 4-digit code to{'\n'}
              <Text style={styles.phoneHighlight}>{maskedPhone}</Text>
            </Text>

            {/* Demo hint */}
            <View style={styles.demoHint}>
              <Text style={styles.demoHintText}>
                Demo code: <Text style={styles.demoCode}>{DEMO_CODE}</Text>
              </Text>
            </View>
          </Animated.View>

          {/* OTP inputs */}
          <Animated.View style={[styles.otpSection, otpStyle]}>
            <OTPInput
              ref={otpRef}
              length={4}
              value={otp}
              onChange={(v) => {
                setOtp(v);
                setError('');
              }}
              onComplete={handleOtpComplete}
              hasError={!!error}
              autoFocus
            />

            {!!error && (
              <Text style={styles.errorText}>{error}</Text>
            )}
          </Animated.View>

          {/* Resend */}
          <Animated.View style={[styles.resendRow, btnStyle]}>
            {canResend ? (
              <TouchableOpacity onPress={handleResend} activeOpacity={0.65}>
                <Text style={styles.resendActive}>Resend Code</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.resendTimer}>
                Resend in{' '}
                <Text style={styles.resendCount}>
                  0:{countdown.toString().padStart(2, '0')}
                </Text>
              </Text>
            )}
          </Animated.View>
        </View>

        {/* Verify button */}
        <Animated.View style={[styles.btnWrap, btnStyle]}>
          <Button
            variant="primary"
            size="lg"
            onPress={handleVerify}
            isDisabled={loading || !isReady || success}
            style={[
              styles.verifyBtn,
              loading && styles.verifyBtnLoading,
              (!isReady && !loading) && styles.verifyBtnDisabled,
            ]}
          >
            {loading ? (
              <Spinner size="sm" color="#FFFFFF" />
            ) : (
              <Button.Label style={[
                styles.verifyBtnLabel,
                (!isReady || loading || success) && styles.verifyBtnLabelDisabled,
              ]}>
                Verify &amp; Continue
              </Button.Label>
            )}
          </Button>
        </Animated.View>

        {/* Success overlay */}
        <SuccessOverlay visible={success} />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000000' },
  container: {
    flex: 1,
    paddingHorizontal: 28,
  },

  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },

  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
  },

  header: {
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  iconEmoji: {
    fontSize: 34,
  },
  title: {
    fontSize: 30,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    lineHeight: 24,
  },
  phoneHighlight: {
    color: '#FFFFFF',
    fontFamily: 'Poppins_600SemiBold',
  },
  demoHint: {
    backgroundColor: '#111111',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginTop: 4,
  },
  demoHintText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
  },
  demoCode: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'Poppins_600SemiBold',
    letterSpacing: 2,
  },

  otpSection: {
    alignItems: 'center',
    gap: 14,
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: '#EF4444',
    textAlign: 'center',
  },

  resendRow: {
    alignItems: 'center',
  },
  resendTimer: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.35)',
  },
  resendCount: {
    fontFamily: 'Poppins_600SemiBold',
    color: 'rgba(255,255,255,0.55)',
  },
  resendActive: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: '#FFFFFF',
    paddingVertical: 6,
  },

  btnWrap: {
    gap: 0,
  },
  verifyBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 46,
  },
  verifyBtnLoading: {
    backgroundColor: '#111111',
  },
  verifyBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  verifyBtnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#000000',
  },
  verifyBtnLabelDisabled: {
    color: 'rgba(255,255,255,0.3)',
  },

  // Success overlay
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  successText: {
    fontSize: 22,
    fontFamily: 'Poppins_600SemiBold',
    color: '#22C55E',
    letterSpacing: -0.3,
  },
});
