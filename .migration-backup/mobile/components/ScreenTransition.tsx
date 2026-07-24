import React from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import Animated, { SlideInRight, SlideOutLeft } from 'react-native-reanimated';

interface ScreenTransitionProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

/**
 * Wraps a screen's root view with a slide-from-right entering animation
 * and a slide-to-left exiting animation. Works on both web and native
 * via react-native-reanimated.
 */
export default function ScreenTransition({ children, style }: ScreenTransitionProps) {
  return (
    <Animated.View
      entering={SlideInRight.duration(300)}
      exiting={SlideOutLeft.duration(250)}
      style={[styles.root, style]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
