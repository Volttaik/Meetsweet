import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
} from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OTPInputRef {
  shake: () => void;
  clear: () => void;
  focus: () => void;
}

interface OTPInputProps {
  length: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  hasError?: boolean;
  autoFocus?: boolean;
}

// ─── Single OTP box ───────────────────────────────────────────────────────────

interface BoxProps {
  digit: string;
  focused: boolean;
  hasError: boolean;
  inputRef: (ref: TextInput | null) => void;
  onChangeText: (text: string) => void;
  onKeyPress: (key: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  autoFocus?: boolean;
}

function OtpBox({
  digit,
  focused,
  hasError,
  inputRef,
  onChangeText,
  onKeyPress,
  onFocus,
  onBlur,
  autoFocus,
}: BoxProps) {
  const scale = useSharedValue(1);
  const prevDigit = useRef('');

  useEffect(() => {
    if (digit && digit !== prevDigit.current) {
      scale.value = withSequence(
        withSpring(1.18, { damping: 6, stiffness: 400 }),
        withSpring(1, { damping: 14, stiffness: 500 }),
      );
    }
    prevDigit.current = digit;
  }, [digit]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const borderColor = hasError
    ? '#EF4444'
    : focused
    ? '#FFFFFF'
    : digit
    ? 'rgba(255,255,255,0.35)'
    : 'rgba(255,255,255,0.1)';

  const bgColor = hasError
    ? 'rgba(239,68,68,0.08)'
    : focused
    ? 'rgba(255,255,255,0.06)'
    : '#111111';

  return (
    <Animated.View style={animStyle}>
      <View
        style={[
          styles.box,
          {
            borderColor,
            backgroundColor: bgColor,
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          value={digit}
          onChangeText={onChangeText}
          onKeyPress={({ nativeEvent }) => onKeyPress(nativeEvent.key)}
          onFocus={onFocus}
          onBlur={onBlur}
          keyboardType="number-pad"
          maxLength={1}
          textAlign="center"
          selectionColor="rgba(255,255,255,0.5)"
          caretHidden
          autoFocus={autoFocus}
          style={styles.boxText}
        />
      </View>
    </Animated.View>
  );
}

// ─── Main OTPInput ─────────────────────────────────────────────────────────────

const OTPInput = forwardRef<OTPInputRef, OTPInputProps>(function OTPInput(
  { length, value, onChange, onComplete, hasError = false, autoFocus = false },
  ref,
) {
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const shakeX = useSharedValue(0);
  const [focusedIndex, setFocusedIndex] = React.useState<number>(-1);

  useImperativeHandle(ref, () => ({
    shake: () => {
      shakeX.value = withSequence(
        withTiming(-11, { duration: 50 }),
        withTiming(11, { duration: 50 }),
        withTiming(-8, { duration: 50 }),
        withTiming(8, { duration: 50 }),
        withTiming(-5, { duration: 50 }),
        withTiming(5, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );
    },
    clear: () => {
      onChange('');
      setTimeout(() => inputRefs.current[0]?.focus(), 50);
    },
    focus: () => inputRefs.current[0]?.focus(),
  }));

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const getDigits = (): string[] => {
    const arr: string[] = [];
    for (let i = 0; i < length; i++) arr.push(value[i] ?? '');
    return arr;
  };

  const handleChange = (text: string, index: number) => {
    const digit = text.replace(/[^0-9]/g, '').slice(-1);
    const digits = getDigits();
    digits[index] = digit;
    const next = digits.join('');
    onChange(next);

    if (digit) {
      if (index < length - 1) {
        setTimeout(() => inputRefs.current[index + 1]?.focus(), 10);
      } else {
        // Last box filled
        inputRefs.current[index]?.blur();
        const full = next.replace(/\s/g, '');
        if (full.length === length) {
          onComplete?.(full);
        }
      }
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace') {
      const digits = getDigits();
      if (digits[index]) {
        digits[index] = '';
        onChange(digits.join(''));
      } else if (index > 0) {
        digits[index - 1] = '';
        onChange(digits.join(''));
        setTimeout(() => inputRefs.current[index - 1]?.focus(), 10);
      }
    }
  };

  const digits = getDigits();

  return (
    <Animated.View style={[styles.row, shakeStyle]}>
      {digits.map((digit, i) => (
        <OtpBox
          key={i}
          digit={digit}
          focused={focusedIndex === i}
          hasError={hasError}
          inputRef={(r) => {
            inputRefs.current[i] = r;
          }}
          onChangeText={(text) => handleChange(text, i)}
          onKeyPress={(key) => handleKeyPress(key, i)}
          onFocus={() => setFocusedIndex(i)}
          onBlur={() => setFocusedIndex(-1)}
          autoFocus={autoFocus && i === 0}
        />
      ))}
    </Animated.View>
  );
});

export default OTPInput;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  box: {
    width: 56,
    height: 64,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  boxText: {
    width: '100%',
    height: '100%',
    textAlign: 'center',
    fontSize: 24,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    includeFontPadding: false,
  },
});
