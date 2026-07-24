import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Check, CreditCard, Plus, Sparkles, WalletCards } from 'lucide-react-native';
import { Button, Spinner } from 'heroui-native';
import { T } from '@/constants/theme';
import { getWallet, type Transaction } from '@/services/wallet';

const PACKAGES = [
  { credits: 500, price: '$4.99', label: 'Starter' },
  { credits: 1200, price: '$9.99', label: 'Popular' },
  { credits: 3000, price: '$19.99', label: 'Best value' },
];

function formatTime(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState(1);
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWallet()
      .then(({ balance, transactions }) => {
        setBalance(balance);
        setTransactions(transactions);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const pack = PACKAGES[selected];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <ArrowLeft size={20} color={T.TEXT} />
        </Pressable>
        <Text style={styles.headerTitle}>Creator wallet</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* Balance card */}
        <View style={styles.balanceCard}>
          <View style={styles.walletIcon}>
            <WalletCards size={20} color={T.BG} />
          </View>
          <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
          {loading ? (
            <Spinner size="sm" color={T.BG} />
          ) : (
            <Text style={styles.balance}>
              {(balance ?? 0).toLocaleString()}{' '}
              <Text style={styles.balanceUnit}>credits</Text>
            </Text>
          )}
          <Text style={styles.balanceHint}>
            Use credits to support creators and unlock premium drops.
          </Text>
        </View>

        {/* Transaction history */}
        {transactions.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 28, marginBottom: 12 }]}>
              Transaction history
            </Text>
            <View style={styles.transactions}>
              {transactions.map((tx) => (
                <View key={tx.id} style={styles.txRow}>
                  <View style={styles.txLeft}>
                    <Text style={styles.txDesc}>{tx.description}</Text>
                    <Text style={styles.txDate}>{formatTime(tx.createdAt)}</Text>
                  </View>
                  <Text style={[
                    styles.txAmount,
                    tx.type === 'credit' ? styles.txCredit : styles.txDebit,
                  ]}>
                    {tx.type === 'credit' ? '+' : '-'}{tx.amount}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Get credits section */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Get more credits</Text>
          <Text style={styles.secure}>
            <CreditCard size={12} color={T.TEXT_3} /> Secure checkout
          </Text>
        </View>

        <View style={styles.packages}>
          {PACKAGES.map((item, index) => {
            const active = index === selected;
            return (
              <Pressable
                key={item.credits}
                style={[styles.package, active && styles.packageActive]}
                onPress={() => setSelected(index)}
              >
                {item.label === 'Popular' && (
                  <View style={styles.popular}>
                    <Text style={styles.popularText}>MOST POPULAR</Text>
                  </View>
                )}
                <View style={styles.packageTop}>
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active && <Check size={11} color={T.BG} strokeWidth={3} />}
                  </View>
                  <Text style={styles.packageLabel}>{item.label}</Text>
                </View>
                <Text style={styles.packageCredits}>{item.credits.toLocaleString()}</Text>
                <Text style={styles.packageUnit}>credits</Text>
                <Text style={styles.packagePrice}>{item.price}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.note}>
          <Sparkles size={16} color={T.TEXT_2} />
          <Text style={styles.noteText}>
            Credits never expire and go directly toward creator subscriptions and premium content.
          </Text>
        </View>

        <Button variant="primary" size="lg" onPress={() => undefined} style={styles.buyButton}>
          <Button.Label>Continue with {pack.price}</Button.Label>
        </Button>

        <View style={styles.paymentRow}>
          <Plus size={14} color={T.TEXT_2} />
          <Text style={styles.paymentText}>Add a payment method</Text>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.BG },
  header: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: T.TEXT,
    fontFamily: T.FONT.semibold,
    fontSize: 15,
  },
  placeholder: { width: 36 },
  content: { padding: 20, paddingBottom: 40 },

  balanceCard: {
    backgroundColor: T.TEXT,
    borderRadius: T.RADIUS.xl,
    padding: 20,
    minHeight: 175,
  },
  walletIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: T.BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceLabel: {
    color: 'rgba(0,0,0,0.5)',
    fontFamily: T.FONT.semibold,
    fontSize: 9,
    letterSpacing: 1.1,
    marginTop: 18,
  },
  balance: {
    color: T.BG,
    fontFamily: T.FONT.bold,
    fontSize: 32,
    letterSpacing: -1,
    marginTop: 2,
  },
  balanceUnit: { fontFamily: T.FONT.medium, fontSize: 13 },
  balanceHint: {
    color: 'rgba(0,0,0,0.5)',
    fontFamily: T.FONT.regular,
    fontSize: 11,
    marginTop: 9,
  },

  transactions: {
    borderRadius: T.RADIUS.md,
    borderWidth: 1,
    borderColor: T.BORDER,
    overflow: 'hidden',
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  txLeft: { flex: 1 },
  txDesc: { fontSize: 13, fontFamily: T.FONT.medium, color: T.TEXT },
  txDate: { fontSize: 11, fontFamily: T.FONT.regular, color: T.TEXT_2, marginTop: 2 },
  txAmount: { fontSize: 14, fontFamily: T.FONT.semibold },
  txCredit: { color: T.SUCCESS },
  txDebit: { color: T.TEXT_2 },

  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 28,
    marginBottom: 12,
  },
  sectionTitle: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 15 },
  secure: { color: T.TEXT_3, fontFamily: T.FONT.regular, fontSize: 10 },

  packages: { gap: 9 },
  package: {
    minHeight: 112,
    padding: 16,
    borderRadius: T.RADIUS.lg,
    borderWidth: 1,
    borderColor: T.BORDER,
    backgroundColor: T.SURFACE,
    position: 'relative',
  },
  packageActive: { borderColor: T.TEXT, backgroundColor: T.SURFACE_2 },
  popular: {
    position: 'absolute',
    right: 14,
    top: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: T.TEXT,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
  },
  popularText: {
    color: T.BG,
    fontFamily: T.FONT.bold,
    fontSize: 7,
    letterSpacing: 0.7,
  },
  packageTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { backgroundColor: T.TEXT, borderColor: T.TEXT },
  packageLabel: { color: T.TEXT_2, fontFamily: T.FONT.medium, fontSize: 11 },
  packageCredits: {
    color: T.TEXT,
    fontFamily: T.FONT.bold,
    fontSize: 23,
    marginTop: 12,
  },
  packageUnit: {
    position: 'absolute',
    left: 87,
    top: 54,
    color: T.TEXT_2,
    fontFamily: T.FONT.regular,
    fontSize: 10,
  },
  packagePrice: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    color: T.TEXT,
    fontFamily: T.FONT.semibold,
    fontSize: 13,
  },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 18,
    padding: 14,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE,
  },
  noteText: {
    flex: 1,
    color: T.TEXT_2,
    fontFamily: T.FONT.regular,
    fontSize: 11,
    lineHeight: 17,
  },

  buyButton: { width: '100%', marginTop: 18 },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 18,
  },
  paymentText: { color: T.TEXT_2, fontFamily: T.FONT.medium, fontSize: 11 },
});
