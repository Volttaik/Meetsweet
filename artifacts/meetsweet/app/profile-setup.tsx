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

export default function ProfileSetupScreen() {
  const insets = useSafeAreaInsets();
  const { phone } = useLocalSearchParams<{ phone: string }>();
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

  const handleComplete = () => {
    router.push({ pathname: '/verification', params: { phone } });
  };

  return (
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
          <View style={styles.stepRow}>
            <View style={[styles.stepPill, styles.stepDone]} />
            <View style={[styles.stepConnector, styles.stepConnectorDone]} />
            <View style={[styles.stepPill, styles.stepActive]} />
          </View>
        </View>

        {/* Content */}
        <View style={styles.content}>
          <Text style={styles.title}>Add Your Photo</Text>
          <Text style={styles.subtitle}>
            A profile photo helps others recognize you.
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

          {/* Photo source options */}
          <View style={styles.optionsCard}>
            <TouchableOpacity
              style={styles.optionBtn}
              onPress={() => pickImage('camera')}
              activeOpacity={0.8}
            >
              <Ionicons name="camera-outline" size={22} color="#FF4473" />
              <Text style={styles.optionText}>Take Photo</Text>
            </TouchableOpacity>
            <View style={styles.optionDivider} />
            <TouchableOpacity
              style={styles.optionBtn}
              onPress={() => pickImage('gallery')}
              activeOpacity={0.8}
            >
              <Ionicons name="images-outline" size={22} color="#FF4473" />
              <Text style={styles.optionText}>Choose from Library</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Bottom CTA */}
        <View style={styles.bottom}>
          <TouchableOpacity
            onPress={handleComplete}
            activeOpacity={0.88}
            style={styles.primaryWrap}
          >
            <LinearGradient
              colors={['#FF4473', '#C7155A']}
              style={styles.primaryBtn}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={styles.primaryBtnText}>Complete Account Creation</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleComplete}
            style={styles.skipBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
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
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepPill: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2E2850' },
  stepDone: { backgroundColor: '#FF4473' },
  stepActive: { width: 28, borderRadius: 5, backgroundColor: '#FF4473' },
  stepConnector: { width: 28, height: 2, backgroundColor: '#2E2850' },
  stepConnectorDone: { backgroundColor: '#FF4473' },

  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
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
    marginBottom: 12,
  },
  avatarWrapper: {
    width: 168,
    height: 168,
    borderRadius: 84,
    marginBottom: 28,
    position: 'relative',
  },
  avatar: { width: 168, height: 168, borderRadius: 84 },
  avatarPlaceholder: {
    width: 168,
    height: 168,
    borderRadius: 84,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#2E2850',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#0D0B1A',
  },
  optionsCard: {
    flexDirection: 'row',
    backgroundColor: '#1A1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2E2850',
    overflow: 'hidden',
    width: '100%',
  },
  optionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
  },
  optionText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: '#FFFFFF',
  },
  optionDivider: { width: 1, backgroundColor: '#2E2850' },

  bottom: { gap: 12 },
  primaryWrap: { borderRadius: 16, overflow: 'hidden' },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
  },
  skipBtn: { alignItems: 'center', paddingVertical: 4 },
  skipText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
  },
});
