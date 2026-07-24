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
  Spinner,
  TextField,
} from 'heroui-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, AtSign, Eye, EyeOff, Lock } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/services/api';

// ─── Constants ────────────────────────────────────────────────────────────────

const INPUT_BG = '#111111';
const INPUT_BORDER = 'rgba(255,255,255,0.1)';
const INPUT_BORDER_FOCUSED = 'rgba(255,255,255,0.35)';
const INPUT_BORDER_ERROR = '#EF4444';
const FORM_MAX_WIDTH = 340;

// ─── Input row ────────────────────────────────────────────────────────────────

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

// ─── Login screen ─────────────────────────────────────────────────────────────

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<Record<string, boolean>>({});
  const [serverError, setServerError] = useState('');

  const setFoc = (k: string, v: boolean) =>
    setFocused((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!identifier.trim()) e.identifier = 'Enter your email, username, or phone';
    if (password.length < 6) e.password = 'Password must be at least 6 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);
    setServerError('');
    try {
      await login({ identifier: identifier.trim().toLowerCase(), password });
      router.replace('/(tabs)');
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
      } else {
        setServerError('Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
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

        {/* Server error */}
        {!!serverError && (
          <View style={styles.serverError}>
            <Text style={styles.serverErrorText}>{serverError}</Text>
          </View>
        )}

        {/* Form */}
        <View style={styles.formOuter}>
          <View style={styles.form}>
            {/* Identifier (email / username / phone) */}
            <TextField isInvalid={!!errors.identifier}>
              <Label style={styles.fieldLabel}>Email, Username or Phone</Label>
              <InputRow
                icon={
                  <AtSign
                    size={18}
                    color={focused.identifier ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)'}
                    strokeWidth={1.8}
                  />
                }
                isError={!!errors.identifier}
                isFocused={focused.identifier}
              >
                <Input
                  placeholder="you@email.com or @username"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={identifier}
                  onChangeText={(v) => {
                    setIdentifier(v);
                    setErrors((e) => ({ ...e, identifier: '' }));
                    setServerError('');
                  }}
                  onFocus={() => setFoc('identifier', true)}
                  onBlur={() => setFoc('identifier', false)}
                  style={styles.input}
                  placeholderTextColor="rgba(255,255,255,0.18)"
                />
              </InputRow>
              {!!errors.identifier && (
                <FieldError style={styles.fieldError}>{errors.identifier}</FieldError>
              )}
            </TextField>

            {/* Password */}
            <TextField isInvalid={!!errors.password}>
              <Label style={styles.fieldLabel}>Password</Label>
              <InputRow
                icon={
                  <Lock
                    size={18}
                    color={focused.password ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)'}
                    strokeWidth={1.8}
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
                    setServerError('');
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
                    <EyeOff size={18} color="rgba(255,255,255,0.35)" strokeWidth={1.8} />
                  ) : (
                    <Eye size={18} color="rgba(255,255,255,0.35)" strokeWidth={1.8} />
                  )}
                </TouchableOpacity>
              </InputRow>
              {!!errors.password && (
                <FieldError style={styles.fieldError}>{errors.password}</FieldError>
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
              style={[styles.submitBtn, loading && styles.submitBtnLoading]}
            >
              {loading ? (
                <Spinner size="sm" color="#FFFFFF" />
              ) : (
                <Button.Label style={styles.submitBtnLabel}>Log In</Button.Label>
              )}
            </Button>
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
  bg: { flex: 1, backgroundColor: '#000000' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    gap: 24,
    flexGrow: 1,
    alignItems: 'center',
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

  header: { alignItems: 'center', gap: 10 },
  logo: { width: 48, height: 48 },
  title: {
    fontSize: 26,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
  },

  serverError: {
    width: '100%',
    maxWidth: FORM_MAX_WIDTH,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 10,
    padding: 12,
  },
  serverErrorText: {
    color: '#EF4444',
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    textAlign: 'center',
  },

  formOuter: {
    width: '100%',
    maxWidth: FORM_MAX_WIDTH,
    alignSelf: 'center',
  },
  form: { gap: 18 },

  fieldLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: INPUT_BG,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    height: 48,
    gap: 10,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    height: '100%',
    backgroundColor: 'transparent',
  },
  fieldError: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#EF4444',
    marginTop: 4,
  },

  loginMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: -2,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkLabel: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.45)',
  },
  forgotText: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: '#FFFFFF',
  },

  submitBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 48,
  },
  submitBtnLoading: {
    backgroundColor: '#111111',
  },
  submitBtnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#000000',
  },

  createRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
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
