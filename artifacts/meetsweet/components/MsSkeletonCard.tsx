import React, { useEffect } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { T } from '@/constants/theme';

interface MsSkeletonCardProps {
  style?: ViewStyle;
  height?: number;
  radius?: number;
}

/** Animated shimmer rectangle — wraps content or stands alone */
export function MsSkeletonCard({
  style,
  height = 120,
  radius = T.RADIUS.md,
}: MsSkeletonCardProps) {
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.75, { duration: 900, easing: Easing.inOut(Easing.sine) }),
        withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.sine) }),
      ),
      -1,
      false,
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[{ backgroundColor: T.SURFACE, height, borderRadius: radius }, animStyle, style]}
    />
  );
}

/** Skeleton row — for building complex multi-line skeletons */
export function MsSkeletonRow({
  width = '100%' as string | number,
  height = 12,
  radius = T.RADIUS.xs,
  style,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.65, { duration: 1000, easing: Easing.inOut(Easing.sine) }),
        withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.sine) }),
      ),
      -1,
      false,
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        { backgroundColor: T.SURFACE_2, height, borderRadius: radius, width: width as number },
        animStyle,
        style,
      ]}
    />
  );
}

/** Full post card skeleton — header + image area + footer */
export function MsPostSkeleton() {
  return (
    <View style={postStyles.card}>
      {/* Header */}
      <View style={postStyles.header}>
        <MsSkeletonCard height={38} radius={19} style={{ width: 38 }} />
        <View style={postStyles.headerText}>
          <MsSkeletonRow width="55%" height={12} />
          <MsSkeletonRow width="38%" height={10} />
        </View>
      </View>
      {/* Content */}
      <MsSkeletonCard height={190} radius={T.RADIUS.md} style={{ marginTop: 12 }} />
      {/* Footer */}
      <View style={postStyles.footer}>
        <MsSkeletonRow width={60} height={10} />
        <MsSkeletonRow width={60} height={10} />
        <MsSkeletonRow width={40} height={10} />
      </View>
    </View>
  );
}

const postStyles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginBottom: 16,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
    paddingBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1, gap: 6 },
  footer: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 14,
  },
});
