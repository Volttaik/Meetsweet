import React, { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button } from 'heroui-native';
import { router } from 'expo-router';
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
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Defs, RadialGradient, Stop } from 'react-native-svg';

function SuccessIcon() {
  return (
    <Svg width={140} height={140} viewBox="0 0 140 140">
      <Defs>
        <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FF4473" stopOpacity="0.3" />
          <Stop offset="100%" stopColor="#FF4473" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {/* Glow */}
      <Circle cx="70" cy="70" r="68" fill="url(#glow)" />
      {/* Ring */}
      <Circle cx="70" cy="70" r="52" fill="#1A1628" stroke="#FF4473" strokeWidth="2" />
      {/* Inner fill */}
      <Circle cx="70" cy="70" r="44" fill="#FF447318" />
      {/* Checkmark */}
      <Path
        d="M48 72 L62 86 L94 56"
        stroke="#FF4473"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

// Particle dot
function Particle({ angle, delay }: { angle: number; delay: number }) {
  const rad = (angle * Math.PI) / 180;
  const tx = Math.cos(rad) * 80;
  const ty = Math.sin(rad) * 80;
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(delay, withSequence(
      withTiming(1, { duration: 200 }),
      withDelay(300, withTiming(0, { duration: 400 })),
    ));
    translateX.value = withDelay(delay, withTiming(tx, { duration: 700, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(ty, { duration: 700, easing: Easing.out(Easing.cubic) }));
    scale.value = withDelay(delay, withSequence(
      withTiming(1.2, { duration: 200 }),
      withTiming(0.6, { duration: 500 }),
    ));
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const colors = ['#FF4473', '#C7155A', '#FF8FB3', '#9385B8'];
  const color = colors[Math.floor(angle / 90) % colors.length];

  return (
    <Animated.View
      style={[
        styles.particle,
        { backgroundColor: color },
        style,
      ]}
    />
  );
}

export default function SuccessScreen() {
  const insets = useSafeAreaInsets();

  const iconScale = useSharedValue(0);
  const iconOpacity = useSharedValue(0);
  const titleOpacity = useSharedValue(0);
  const titleY = useSharedValue(20);
  const subtitleOpacity = useSharedValue(0);
  const btnOpacity = useSharedValue(0);
  const btnY = useSharedValue(20);

  useEffect(() => {
    // Icon entrance
    iconOpacity.value = withTiming(1, { duration: 300 });
    iconScale.value = withSequence(
      withSpring(1.15, { damping: 8, stiffness: 200 }),
      withSpring(1, { damping: 12, stiffness: 300 }),
    );

    // Title
    titleOpacity.value = withDelay(400, withTiming(1, { duration: 400 }));
    titleY.value = withDelay(400, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    // Subtitle
    subtitleOpacity.value = withDelay(600, withTiming(1, { duration: 400 }));

    // Button
    btnOpacity.value = withDelay(800, withTiming(1, { duration: 400 }));
    btnY.value = withDelay(800, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));
  }, []);

  const iconStyle = useAnimatedStyle(() => ({
    opacity: iconOpacity.value,
    transform: [{ scale: iconScale.value }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleY.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
  }));
  const btnStyle = useAnimatedStyle(() => ({
    opacity: btnOpacity.value,
    transform: [{ translateY: btnY.value }],
  }));

  const PARTICLE_ANGLES = [0, 40, 80, 130, 180, 220, 270, 320];

  return (
    <LinearGradient
      colors={['#16081E', '#0D0B1A', '#130A1C']}
      locations={[0, 0.55, 1]}
      style={styles.gradient}
    >
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 80 : 40),
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 60 : 48),
          },
        ]}
      >
        {/* Icon + particles */}
        <View style={styles.iconSection}>
          {/* Particles burst from center */}
          <View style={styles.particleOrigin} pointerEvents="none">
            {PARTICLE_ANGLES.map((angle, i) => (
              <Particle key={angle} angle={angle} delay={200 + i * 40} />
            ))}
          </View>

          <Animated.View style={iconStyle}>
            <SuccessIcon />
          </Animated.View>
        </View>

        {/* Text */}
        <View style={styles.textSection}>
          <Animated.Text style={[styles.title, titleStyle]}>
            You're all set! 🎉
          </Animated.Text>
          <Animated.Text style={[styles.subtitle, subtitleStyle]}>
            Welcome to MeetSweet. Your account is verified and ready. Discover amazing creators and exclusive communities waiting for you.
          </Animated.Text>
        </View>

        {/* CTA */}
        <Animated.View style={[styles.btnWrap, btnStyle]}>
          <Button
            variant="primary"
            size="lg"
            onPress={() => router.replace('/home')}
            style={styles.btn}
          >
            <Button.Label style={styles.btnLabel}>Enter MeetSweet</Button.Label>
          </Button>
        </Animated.View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  iconSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  particleOrigin: {
    position: 'absolute',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  textSection: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 8,
  },
  title: {
    fontSize: 32,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
    textAlign: 'center',
    lineHeight: 24,
  },
  btnWrap: {
    width: '100%',
  },
  btn: {
    backgroundColor: '#FF4473',
    borderRadius: 16,
    height: 56,
  },
  btnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
});
