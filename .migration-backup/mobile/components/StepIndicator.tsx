import React from 'react';
import { StyleSheet, View } from 'react-native';

interface StepIndicatorProps {
  total: number;
  current: number; // 0-indexed
}

export default function StepIndicator({ total, current }: StepIndicatorProps) {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }).map((_, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={i}>
            <View
              style={[
                styles.dot,
                done && styles.dotDone,
                active && styles.dotActive,
              ]}
            />
            {i < total - 1 && (
              <View style={[styles.connector, done && styles.connectorDone]} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2E2850',
  },
  dotDone: { backgroundColor: '#FF4473' },
  dotActive: {
    width: 22,
    borderRadius: 4,
    backgroundColor: '#FF4473',
  },
  connector: { width: 18, height: 2, backgroundColor: '#2E2850', marginHorizontal: 4 },
  connectorDone: { backgroundColor: '#FF4473' },
});
