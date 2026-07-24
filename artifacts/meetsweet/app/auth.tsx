import React, { useState } from 'react';
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Button,
  Checkbox,
  FieldError,
  Input,
  Label,
  PressableFeedback,
  Spinner,
  TextField,
} from 'heroui-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Eye, EyeOff, Lock, Mail } from 'lucide-react-native';

// ─── Constants ────────────────────────────────────────────────────────────────

const INPUT_BG = '#111111';
const INPUT_BORDER = 'rgba(255,255,255,0.1)';
const INPUT_BORDER_FOCUSED = 'rgba(255,255,255,0.35)';
const INPUT_BORDER_ERROR = '#EF4444';

// ─── Input row with focus state ───────────────────────────────────────────────

function InputRow({
  icon,
  children,
  isError,
  isFocused,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  isError?: boolean;
  isFocused?: boolean;
}) {
  const borderColor = isError
    ? INPUT_BORDER_ERROR
    : isFocused
    ? INPUT_BORDER_FOCUSED
    : INPUT_BORDER;
  return (
    <View style={[styles.inputWrapper, { borderColor }]}>
      {icon}
      {children}
    </View>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider() {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>or continue with</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

// ─── Social button ────────────────────────────────────────────────────────────

function SocialButton({ label, letter }: { label: string; letter: string }) {
  return (
    <TouchableOpacity style={styles.socialBtn} activeOpacity={0.7}>
      <Text style={styles.socialLetter}>{letter}</Text>
      <Text style={styles.socialLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Login form ───────────────────────────────────────────────────────────────

export default function AuthScreen() {
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<Record<string, boolean>>({});

  const setFoc = (k: string, v: boolean) =>
    setFocused((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!email.includes('@') || !email.includes('.'))
      e.email = 'Enter a valid email address';
    if (password.length < 6)
      e.password = 'Password must be at least 6 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    router.replace('/home');
  };

  return (
    <View style={styles.bg}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 72 : 24),
            paddingBottom: insets.bottom + 40,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <ArrowLeft size={22} color="#FFFFFF" strokeWidth={2} />
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.header}>
          <Image
            source={require('../assets/images/logo.png')}
            style={styles.logo}
            resizeMode="contain"
            tintColor="#FFFFFF"
          />
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to your account to continue</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          {/* Email */}
          <TextField isInvalid={!!errors.email}>
            <Label style={styles.fieldLabel}>Email</Label>
            <InputRow
              icon={
                <Mail
                  size={20}
                  color={
                    focused.email
                      ? 'rgba(255,255,255,0.6)'
                      : 'rgba(255,255,255,0.3)'
                  }
                />
              }
              isError={!!errors.email}
              isFocused={focused.email}
            >
              <Input
                placeholder="your@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setErrors((e) => ({ ...e, email: '' }));
                }}
                onFocus={() => setFoc('email', true)}
                onBlur={() => setFoc('email', false)}
                style={styles.input}
                placeholderTextColor="rgba(255,255,255,0.18)"
              />
            </InputRow>
            {!!errors.email && (
              <FieldError style={styles.fieldError}>{errors.email}</FieldError>
            )}
          </TextField>

          {/* Password */}
          <TextField isInvalid={!!errors.password}>
            <Label style={styles.fieldLabel}>Password</Label>
            <InputRow
              icon={
                <Lock
                  size={20}
                  color={
                    focused.password
                      ? 'rgba(255,255,255,0.6)'
                      : 'rgba(255,255,255,0.3)'
                  }
                />
              }
              isError={!!errors.password}
              isFocused={focused.password}
            >
              <Input
                placeholder="••••••••"
                secureTextEntry={!showPw}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  setErrors((e) => ({ ...e, password: '' }));
                }}
                onFocus={() => setFoc('password', true)}
                onBlur={() => setFoc('password', false)}
                style={[styles.input, { flex: 1 }]}
                placeholderTextColor="rgba(255,255,255,0.18)"
              />
              <TouchableOpacity
                onPress={() => setShowPw((v) => !v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                {showPw ? (
                  <EyeOff size={20} color="rgba(255,255,255,0.35)" />
                ) : (
                  <Eye size={20} color="rgba(255,255,255,0.35)" />
                )}
              </TouchableOpacity>
            </InputRow>
            {!!errors.password && (
              <FieldError style={styles.fieldError}>
                {errors.password}
              </FieldError>
            )}
          </TextField>

          {/* Remember me + Forgot */}
          <View style={styles.loginMeta}>
            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => setRememberMe((v) => !v)}
              activeOpacity={0.7}
            >
              <Checkbox isSelected={rememberMe} onSelectedChange={setRememberMe} />
              <Text style={styles.checkLabel}>Remember me</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/forgot-password')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          {/* Login button */}
          <Button
            variant="primary"
            size="lg"
            onPress={handleLogin}
            isDisabled={loading}
            style={styles.submitBtn}
          >
            {loading ? (
              <Spinner size="sm" />
            ) : (
              <Button.Label style={styles.submitBtnLabel}>Log In</Button.Label>
            )}
          </Button>

          <Divider />

          {/* Social */}
          <View style={styles.socialGroup}>
            <SocialButton label="Continue with Google" letter="G" />
            {Platform.OS === 'ios' && (
              <SocialButton label="Continue with Apple" letter="" />
            )}
          </View>
        </View>

        {/* Create account link */}
        <View style={styles.createRow}>
          <Text style={styles.createText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/register')} activeOpacity={0.7}>
            <Text style={styles.createLink}>Create Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollContent: {
    paddingHorizontal: 56,
    gap: 28,
    backgroundColor: '#0A0A0A',
  },

  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },

  header: { alignItems: 'center', gap: 10 },
  logo: { width: 64, height: 64 },
  title: {
    fontSize: 32,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    textAlign: 'center',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
  },

  form: { gap: 20 },

  fieldLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 15,
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: INPUT_BG,
    borderRadius: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    height: 50,
    gap: 12,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Poppins_400Regular',
    height: '100%',
  },
  fieldError: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#EF4444',
    marginTop: 5,
  },

  loginMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: -4,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkLabel: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.5)',
  },
  forgotText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: '#FFFFFF',
  },

  submitBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    height: 60,
    marginTop: 4,
  },
  submitBtnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 17,
    color: '#000000',
  },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  dividerText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.25)',
  },

  socialGroup: { gap: 12 },
  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 16,
    height: 56,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#111111',
  },
  socialLetter: {
    fontSize: 17,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    width: 20,
    textAlign: 'center',
  },
  socialLabel: {
    fontSize: 15,
    fontFamily: 'Poppins_500Medium',
    color: '#FFFFFF',
  },

  createRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 4,
  },
  createText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.4)',
  },
  createLink: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: '#FFFFFF',
  },
});
