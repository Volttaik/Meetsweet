import React, { useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

interface OTPInputProps {
  length: number;
  value: string;
  onChange: (value: string) => void;
}

export default function OTPInput({ length, value, onChange }: OTPInputProps) {
  const inputs = useRef<(TextInput | null)[]>([]);

  const handleChange = (text: string, index: number) => {
    const digit = text.replace(/[^0-9]/g, '').slice(-1);
    const chars = value.split('');
    chars[index] = digit;
    const joined = chars.join('');
    onChange(joined);
    if (digit && index < length - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !value[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      const chars = value.split('');
      chars[index - 1] = '';
      onChange(chars.join(''));
    }
  };

  return (
    <View style={styles.container}>
      {Array.from({ length }).map((_, i) => (
        <TextInput
          key={i}
          ref={(ref) => {
            inputs.current[i] = ref;
          }}
          style={[styles.box, value[i] ? styles.boxFilled : null]}
          value={value[i] ?? ''}
          onChangeText={(text) => handleChange(text, i)}
          onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
          keyboardType="number-pad"
          maxLength={1}
          textAlign="center"
          selectionColor="#FF4473"
          caretHidden
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  box: {
    width: 48,
    height: 56,
    backgroundColor: '#1A1628',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#2E2850',
    fontSize: 22,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
  },
  boxFilled: {
    borderColor: '#FF4473',
    backgroundColor: '#1F0D1A',
  },
});
