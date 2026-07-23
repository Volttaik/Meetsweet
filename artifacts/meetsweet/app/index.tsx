import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const FEATURES = [
  {
    icon: 'heart' as const,
    title: 'Discover',
    desc: 'Find compatible matches near you',
  },
  {
    icon: 'chatbubble' as const,
    title: 'Chat',
    desc: 'Message and connect freely',
  },
  {
    icon: 'call' as const,
    title: 'Connect',
    desc: 'Voice & video calls, anytime',
  },
] as const;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(36)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 900,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <LinearGradient
      colors={['#16081E', '#0D0B1A', '#1A0820']}
      locations={[0, 0.5, 1]}
      style={styles.gradient}
    >
      <Animated.View
        style={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 24),
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 28),
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Logo */}
        <View style={styles.logoSection}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../assets/images/logo.png')}
              style={styles.logo}
              resizeMode="contain"
              tintColor="#FFFFFF"
            />
          </View>
          <Text style={styles.appName}>MeetSweet</Text>
          <Text style={styles.tagline}>Discover your perfect match</Text>
        </View>

        {/* Features */}
        <View style={styles.features}>
          {FEATURES.map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <View style={styles.iconCircle}>
                <Ionicons name={f.icon} size={22} color="#FF4473" />
              </View>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* CTA */}
        <View style={styles.cta}>
          <TouchableOpacity
            onPress={() => router.push('/get-started')}
            activeOpacity={0.88}
            style={styles.btnWrap}
          >
            <LinearGradient
              colors={['#FF4473', '#C7155A']}
              style={styles.primaryBtn}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={styles.primaryBtnText}>Get Started</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/get-started')}
            activeOpacity={0.7}
            style={styles.signInLink}
          >
            <Text style={styles.signInText}>
              Already have an account?{' '}
              <Text style={styles.signInHighlight}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },

  // Logo section
  logoSection: { alignItems: 'center' },
  logoWrap: {
    width: 110,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 100, height: 140, tintColor: '#FFFFFF' },
  appName: {
    fontSize: 40,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    marginTop: 8,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
    marginTop: 4,
  },

  // Features
  features: { gap: 22, paddingHorizontal: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FF44731A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { flex: 1 },
  featureTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: '#FFFFFF',
  },
  featureDesc: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
    marginTop: 2,
  },

  // CTA
  cta: { gap: 14 },
  btnWrap: { borderRadius: 16, overflow: 'hidden' },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Poppins_600SemiBold',
    letterSpacing: 0.2,
  },
  signInLink: { alignItems: 'center', paddingVertical: 4 },
  signInText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
  },
  signInHighlight: {
    color: '#FF4473',
    fontFamily: 'Poppins_600SemiBold',
  },
});
