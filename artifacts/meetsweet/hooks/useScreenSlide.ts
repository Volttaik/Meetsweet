import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * Smooth slide-from-right + fade entrance animation for screens.
 * Works on both native (hardware accelerated) and web (JS fallback).
 */
export function useScreenSlide(duration = 340) {
  const translateX = useRef(new Animated.Value(28)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: duration * 0.75,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return {
    style: {
      opacity,
      transform: [{ translateX }],
    } as const,
  };
}
