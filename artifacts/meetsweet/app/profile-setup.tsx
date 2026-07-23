import React, { useState } from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StepIndicator from '@/components/StepIndicator';
import ScreenTransition from '@/components/ScreenTransition';

export default function ProfileSetupScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    username: string;
    email: string;
    phone: string;
    dob: string;
    password: string;
  }>();
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const pickImage = async (source: 'camera' | 'gallery') => {
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') return;
      result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') return;
      result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });
    }
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const handleContinue = (skip = false) => {
    router.push({
      pathname: '/complete-registration',
      params: { ...params, avatarUri: skip ? '' : (avatarUri ?? '') },
    });
  };

  return (
    <ScreenTransition>
    <LinearGradient colors={['#16081E', '#0D0B1A']} style={styles.gradient}>
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 16),
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 28),
          },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <StepIndicator total={5} current={2} />
        </View>

        {/* Content */}
        <View style={styles.content}>
          <Text style={styles.title}>Profile Photo</Text>
          <Text style={styles.subtitle}>
            A photo helps others recognise you.
          </Text>

          {/* Avatar picker */}
          <TouchableOpacity
            style={styles.avatarWrapper}
            onPress={() => pickImage('gallery')}
            activeOpacity={0.88}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <LinearGradient
                colors={['#1A1628', '#251F40']}
                style={styles.avatarPlaceholder}
              >
                <Ionicons name="person" size={72} color="#4A3F72" />
              </LinearGradient>
            )}
            <LinearGradient
              colors={['#FF4473', '#C7155A']}
              style={styles.cameraOverlay}
            >
              <Ionicons name="camera" size={18} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>

          {/* Options */}
          <View style={styles.optionsCard}>
            <TouchableOpacity
              style={styles.optionBtn}
              onPress={() => pickImage('camera')}
              activeOpacity={0.8}
            >
              <View style={styles.optionIcon}>
                <Ionicons name="camera-outline" size={20} color="#FF4473" />
              </View>
              <Text style={styles.optionText}>Take Photo</Text>
              <Ionicons name="chevron-forward" size={16} color="#4A3F72" />
            </TouchableOpacity>
            <View style={styles.optionDivider} />
            <TouchableOpacity
              style={styles.optionBtn}
              onPress={() => pickImage('gallery')}
              activeOpacity={0.8}
            >
              <View style={styles.optionIcon}>
                <Ionicons name="images-outline" size={20} color="#FF4473" />
              </View>
              <Text style={styles.optionText}>Choose from Library</Text>
              <Ionicons name="chevron-forward" size={16} color="#4A3F72" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Bottom CTA */}
        <View style={styles.bottom}>
          <TouchableOpacity
            onPress={() => handleContinue(false)}
            activeOpacity={0.88}
            style={styles.primaryWrap}
          >
            <LinearGradient
              colors={['#FF4473', '#C7155A']}
              style={styles.primaryBtn}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleContinue(true)}
            style={styles.skipBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 28 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#251F40',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  title: {
    fontSize: 30,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
    textAlign: 'center',
    marginBottom: 8,
  },
  avatarWrapper: {
    width: 160,
    height: 160,
    borderRadius: 80,
    marginBottom: 24,
    position: 'relative',
  },
  avatar: { width: 160, height: 160, borderRadius: 80 },
  avatarPlaceholder: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#2E2850',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#0D0B1A',
  },
  optionsCard: {
    backgroundColor: '#1A1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2E2850',
    overflow: 'hidden',
    width: '100%',
  },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FF44731A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: '#FFFFFF',
  },
  optionDivider: { height: 1, backgroundColor: '#2E2850', marginHorizontal: 20 },
  bottom: { gap: 12 },
  primaryWrap: { borderRadius: 16, overflow: 'hidden' },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Poppins_600SemiBold',
  },
  skipBtn: { alignItems: 'center', paddingVertical: 4 },
  skipText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
  },
});
