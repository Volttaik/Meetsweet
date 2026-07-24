import React, { useState, useCallback } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Button, Chip, Spinner } from 'heroui-native';
import {
  ArrowLeft,
  Camera,
  Check,
  Film,
  Globe,
  Image as ImageIcon,
  Lock,
  Plus,
  X,
} from 'lucide-react-native';
import { T } from '@/constants/theme';
import { uploadMedia } from '@/services/media';
import { createPost } from '@/services/posts';
import { useEffect } from 'react';
import { getCategories, type Category } from '@/services/categories';

// ─── Step type ────────────────────────────────────────────────────────────────

type PublishStep = 'compose' | 'uploading' | 'creating' | 'processing' | 'success';

// ─── Visibility option ───────────────────────────────────────────────────────

const VISIBILITY_OPTIONS = [
  {
    value: 'public' as const,
    label: 'Public Preview',
    description: 'Visible to everyone',
    Icon: Globe,
  },
  {
    value: 'subscribers' as const,
    label: 'Subscribers Only',
    description: 'Locked until subscription',
    Icon: Lock,
  },
  {
    value: 'draft' as const,
    label: 'Draft',
    description: 'Only you can see this',
    Icon: ImageIcon,
  },
];

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CreatePostScreen() {
  const insets = useSafeAreaInsets();

  // Form state
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'subscribers' | 'draft'>('public');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [mediaMime, setMediaMime] = useState<string>('image/jpeg');
  const [mediaName, setMediaName] = useState<string>('media.jpg');

  // Upload state
  const [step, setStep] = useState<PublishStep>('compose');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');

  // Categories
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    getCategories().then(({ categories }) => setCategories(categories)).catch(() => {});
  }, []);

  // ─── Media picker ────────────────────────────────────────────────────────

  const pickMedia = useCallback(async (type: 'image' | 'video') => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Allow access to your media library to upload content.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: type === 'image' ? ['images'] : ['videos'],
      allowsEditing: true,
      aspect: type === 'image' ? [1, 1] : undefined,
      quality: 0.85,
      videoMaxDuration: 300,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setMediaUri(asset.uri);
      setMediaType(type);
      const mime = type === 'image' ? 'image/jpeg' : 'video/mp4';
      const ext = type === 'image' ? 'jpg' : 'mp4';
      setMediaMime(mime);
      setMediaName(`media-${Date.now()}.${ext}`);
    }
  }, []);

  const removeMedia = () => {
    setMediaUri(null);
    setMediaType(null);
  };

  // ─── Tag management ──────────────────────────────────────────────────────

  const addTag = () => {
    const cleaned = tagInput.trim().replace(/^#/, '').toLowerCase();
    if (cleaned && !tags.includes(cleaned) && tags.length < 10) {
      setTags((t) => [...t, cleaned]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags((t) => t.filter((x) => x !== tag));
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  // ─── Publish ─────────────────────────────────────────────────────────────

  const handlePublish = async () => {
    if (!caption.trim() && !mediaUri) {
      setError('Add a caption or upload media before publishing.');
      return;
    }

    setError('');
    setStep('uploading');

    try {
      let uploadedMediaUrl: string | undefined;
      let uploadedThumbnailUrl: string | undefined;
      let uploadedMediaType: 'image' | 'video' | undefined;
      let uploadedSize: number | undefined;

      // Upload media if selected
      if (mediaUri && mediaType) {
        const result = await uploadMedia(mediaUri, mediaMime, mediaName, (p) => {
          setUploadProgress(p);
        });
        uploadedMediaUrl = result.url;
        uploadedThumbnailUrl = result.thumbnailUrl ?? undefined;
        uploadedMediaType = result.type;
        uploadedSize = result.size;
      }

      setStep('creating');

      // Create post
      await createPost({
        caption: caption.trim(),
        visibility,
        mediaUrl: uploadedMediaUrl,
        mediaType: uploadedMediaType,
        thumbnailUrl: uploadedThumbnailUrl,
        fileSize: uploadedSize,
        isPremium: visibility === 'subscribers',
        categories: selectedCategories,
        tags,
      });

      setStep('processing');
      await new Promise((r) => setTimeout(r, 600));

      setStep('success');
      await new Promise((r) => setTimeout(r, 1200));

      // Navigate to profile
      router.replace('/(tabs)/profile');
    } catch (err) {
      setError((err as Error).message ?? 'Publish failed. Please try again.');
      setStep('compose');
    }
  };

  // ─── Publishing overlay ───────────────────────────────────────────────────

  if (step !== 'compose') {
    return (
      <View style={[styles.publishOverlay, { paddingTop: insets.top }]}>
        <View style={styles.publishCard}>
          {step === 'success' ? (
            <>
              <View style={styles.successIcon}>
                <Check size={32} color={T.BG} strokeWidth={2.5} />
              </View>
              <Text style={styles.publishTitle}>Published!</Text>
              <Text style={styles.publishSubtitle}>Your post is now live.</Text>
            </>
          ) : (
            <>
              <Spinner size="lg" color={T.TEXT} />
              <Text style={styles.publishTitle}>
                {step === 'uploading'
                  ? 'Uploading Media'
                  : step === 'creating'
                  ? 'Creating Post'
                  : 'Processing'}
              </Text>
              {step === 'uploading' && uploadProgress > 0 && (
                <>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${Math.round(uploadProgress * 100)}%` as any }]} />
                  </View>
                  <Text style={styles.publishSubtitle}>
                    {Math.round(uploadProgress * 100)}%
                  </Text>
                </>
              )}
              {step !== 'uploading' && (
                <Text style={styles.publishSubtitle}>Please wait…</Text>
              )}
            </>
          )}
        </View>
      </View>
    );
  }

  // ─── Compose view ─────────────────────────────────────────────────────────

  const selectedOption = VISIBILITY_OPTIONS.find((o) => o.value === visibility)!;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={20} color={T.TEXT} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Post</Text>
        <TouchableOpacity
          style={[styles.publishBtn, !caption.trim() && !mediaUri && styles.publishBtnDisabled]}
          onPress={handlePublish}
          activeOpacity={0.8}
        >
          <Text style={styles.publishBtnLabel}>Publish</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ─── Media upload ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Media</Text>

          {!mediaUri ? (
            <View style={styles.mediaPickerRow}>
              <TouchableOpacity
                style={styles.mediaPickerBtn}
                onPress={() => pickMedia('image')}
                activeOpacity={0.8}
              >
                <Camera size={24} color={T.TEXT_2} strokeWidth={1.8} />
                <Text style={styles.mediaPickerLabel}>Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mediaPickerBtn}
                onPress={() => pickMedia('video')}
                activeOpacity={0.8}
              >
                <Film size={24} color={T.TEXT_2} strokeWidth={1.8} />
                <Text style={styles.mediaPickerLabel}>Video</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.mediaPreview}>
              {mediaType === 'image' && (
                <Image source={{ uri: mediaUri }} style={styles.mediaImg} resizeMode="cover" />
              )}
              {mediaType === 'video' && (
                <View style={styles.videoThumb}>
                  <Film size={40} color={T.TEXT_2} strokeWidth={1.4} />
                  <Text style={styles.videoLabel}>Video selected</Text>
                </View>
              )}
              <TouchableOpacity style={styles.removeMedia} onPress={removeMedia}>
                <X size={16} color={T.BG} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ─── Caption ───────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Caption</Text>
          <View style={styles.captionWrap}>
            <TextInput
              placeholder="What's on your mind?"
              placeholderTextColor={T.TEXT_3}
              value={caption}
              onChangeText={setCaption}
              multiline
              numberOfLines={5}
              maxLength={2200}
              style={styles.captionInput}
              textAlignVertical="top"
            />
            <Text style={styles.captionCount}>{caption.length}/2200</Text>
          </View>
        </View>

        {/* ─── Visibility ────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Visibility</Text>
          <View style={styles.visibilityOptions}>
            {VISIBILITY_OPTIONS.map((opt) => {
              const isActive = opt.value === visibility;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.visibilityOption, isActive && styles.visibilityOptionActive]}
                  onPress={() => setVisibility(opt.value)}
                  activeOpacity={0.75}
                >
                  <opt.Icon
                    size={18}
                    color={isActive ? T.BG : T.TEXT_2}
                    strokeWidth={1.8}
                  />
                  <View style={styles.visibilityText}>
                    <Text style={[styles.visibilityLabel, isActive && styles.visibilityLabelActive]}>
                      {opt.label}
                    </Text>
                    <Text style={[styles.visibilityDesc, isActive && styles.visibilityDescActive]}>
                      {opt.description}
                    </Text>
                  </View>
                  {isActive && (
                    <Check size={16} color={T.BG} strokeWidth={2.5} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {visibility === 'subscribers' && (
            <View style={styles.premiumNote}>
              <Lock size={14} color={T.TEXT_2} strokeWidth={1.8} />
              <Text style={styles.premiumNoteText}>
                Subscribers will see a locked preview with a PREMIUM badge.
              </Text>
            </View>
          )}
        </View>

        {/* ─── Categories ────────────────────────────────────────────────────── */}
        {categories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Categories</Text>
            <View style={styles.chipsWrap}>
              {categories.map((cat) => {
                const active = selectedCategories.includes(cat.id);
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.categoryChip, active && styles.categoryChipActive]}
                    onPress={() => toggleCategory(cat.id)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.categoryChipLabel, active && styles.categoryChipLabelActive]}>
                      {cat.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ─── Tags ──────────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tags</Text>
          <View style={styles.tagInputRow}>
            <TextInput
              placeholder="#hashtag"
              placeholderTextColor={T.TEXT_3}
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={addTag}
              returnKeyType="done"
              autoCapitalize="none"
              style={styles.tagInput}
            />
            <TouchableOpacity
              style={styles.tagAddBtn}
              onPress={addTag}
              activeOpacity={0.75}
            >
              <Plus size={16} color={T.BG} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
          {tags.length > 0 && (
            <View style={styles.chipsWrap}>
              {tags.map((tag) => (
                <TouchableOpacity
                  key={tag}
                  style={styles.tagChip}
                  onPress={() => removeTag(tag)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.tagChipLabel}>#{tag}</Text>
                  <X size={12} color={T.TEXT_2} strokeWidth={2} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* ─── Error ─────────────────────────────────────────────────────────── */}
        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* ─── Publish button ────────────────────────────────────────────────── */}
        <Button
          variant="primary"
          size="lg"
          onPress={handlePublish}
          isDisabled={!caption.trim() && !mediaUri}
          style={styles.publishFooterBtn}
        >
          <Button.Label style={styles.publishFooterBtnLabel}>
            Publish{visibility !== 'public' ? ` · ${selectedOption.label}` : ''}
          </Button.Label>
        </Button>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: T.FONT.semibold,
    color: T.TEXT,
    letterSpacing: -0.2,
  },
  publishBtn: {
    paddingHorizontal: 18,
    height: 34,
    borderRadius: T.RADIUS.full,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishBtnDisabled: {
    backgroundColor: T.SURFACE_2,
  },
  publishBtnLabel: {
    fontSize: 13,
    fontFamily: T.FONT.semibold,
    color: T.BG,
  },

  scrollContent: { paddingBottom: 20 },

  section: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: T.FONT.semibold,
    color: T.TEXT_2,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Media
  mediaPickerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  mediaPickerBtn: {
    flex: 1,
    height: 90,
    borderRadius: T.RADIUS.lg,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    borderStyle: 'dashed',
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mediaPickerLabel: {
    fontSize: 13,
    fontFamily: T.FONT.medium,
    color: T.TEXT_2,
  },
  mediaPreview: {
    position: 'relative',
    borderRadius: T.RADIUS.lg,
    overflow: 'hidden',
  },
  mediaImg: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: T.SURFACE,
  },
  videoThumb: {
    width: '100%',
    height: 180,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  videoLabel: {
    fontSize: 13,
    fontFamily: T.FONT.medium,
    color: T.TEXT_2,
  },
  removeMedia: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Caption
  captionWrap: {
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.md,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    padding: 14,
    minHeight: 120,
  },
  captionInput: {
    fontSize: 15,
    fontFamily: T.FONT.regular,
    color: T.TEXT,
    minHeight: 80,
  },
  captionCount: {
    fontSize: 11,
    fontFamily: T.FONT.regular,
    color: T.TEXT_3,
    textAlign: 'right',
    marginTop: 6,
  },

  // Visibility
  visibilityOptions: { gap: 8 },
  visibilityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: T.RADIUS.md,
    borderWidth: 1,
    borderColor: T.BORDER,
    backgroundColor: T.SURFACE,
    gap: 12,
  },
  visibilityOptionActive: {
    backgroundColor: T.TEXT,
    borderColor: T.TEXT,
  },
  visibilityText: { flex: 1 },
  visibilityLabel: {
    fontSize: 14,
    fontFamily: T.FONT.semibold,
    color: T.TEXT,
  },
  visibilityLabelActive: { color: T.BG },
  visibilityDesc: {
    fontSize: 12,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    marginTop: 1,
  },
  visibilityDescActive: { color: 'rgba(0,0,0,0.55)' },
  premiumNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: T.RADIUS.sm,
    backgroundColor: T.SURFACE_2,
    borderWidth: 1,
    borderColor: T.BORDER_2,
  },
  premiumNoteText: {
    flex: 1,
    fontSize: 12,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    lineHeight: 18,
  },

  // Categories
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: T.RADIUS.full,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    backgroundColor: T.SURFACE,
  },
  categoryChipActive: { backgroundColor: T.TEXT, borderColor: T.TEXT },
  categoryChipLabel: {
    fontSize: 13,
    fontFamily: T.FONT.medium,
    color: T.TEXT_2,
  },
  categoryChipLabelActive: { color: T.BG },

  // Tags
  tagInputRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  tagInput: {
    flex: 1,
    height: 44,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.md,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    paddingHorizontal: 14,
    fontSize: 14,
    fontFamily: T.FONT.regular,
    color: T.TEXT,
  },
  tagAddBtn: {
    width: 44,
    height: 44,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: T.RADIUS.full,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    backgroundColor: T.SURFACE,
  },
  tagChipLabel: {
    fontSize: 13,
    fontFamily: T.FONT.medium,
    color: T.TEXT,
  },

  // Error
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 12,
    borderRadius: T.RADIUS.md,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  errorText: {
    fontSize: 13,
    fontFamily: T.FONT.regular,
    color: '#EF4444',
    textAlign: 'center',
  },

  // Publish button
  publishFooterBtn: {
    marginHorizontal: 20,
    marginTop: 24,
  },
  publishFooterBtnLabel: {
    fontFamily: T.FONT.semibold,
    fontSize: 15,
    color: T.BG,
  },

  // Publishing overlay
  publishOverlay: {
    flex: 1,
    backgroundColor: T.BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishCard: {
    alignItems: 'center',
    gap: 16,
    padding: 32,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishTitle: {
    fontSize: 22,
    fontFamily: T.FONT.bold,
    color: T.TEXT,
    letterSpacing: -0.4,
  },
  publishSubtitle: {
    fontSize: 14,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
  },
  progressBar: {
    width: 200,
    height: 3,
    borderRadius: 2,
    backgroundColor: T.SURFACE_2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: T.TEXT,
    borderRadius: 2,
  },
});
