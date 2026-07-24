---
name: MeetSweet Icon System
description: All screens use phosphor-react-native (not lucide-react-native). Use weight prop instead of strokeWidth. Lucide-to-Phosphor name mapping documented here.
---

# MeetSweet Icon System

**Package:** `phosphor-react-native` (installed in artifacts/meetsweet)

**Why switched from Lucide:** Lucide React Native icons had a transparency / joint-highlight rendering issue on React Native. Phosphor renders cleanly.

**Key difference from Lucide:**
- Use `weight="regular"` (or "bold", "light", "thin", "fill", "duotone") instead of `strokeWidth={n}`
- Do NOT pass `strokeWidth` to Phosphor icons — it is ignored and creates TS warnings

**Tab bar type** (artifacts/meetsweet/app/(tabs)/_layout.tsx):
```tsx
type VisualTab = {
  Icon: React.ComponentType<{ size: number; color: string; weight?: string }>;
}
// Usage: <tab.Icon size={22} color={color} weight="regular" />
```

## Lucide → Phosphor name mapping

| Lucide | Phosphor |
|---|---|
| AlertTriangle | Warning |
| AtSign | At |
| BadgeCheck | SealCheck |
| BarChart2 | ChartBar |
| BellOff | BellSlash |
| ChevronRight | CaretRight |
| DollarSign | CurrencyDollar |
| EyeOff | EyeSlash |
| Film | FilmStrip |
| HelpCircle | Question |
| Home | House |
| LogOut | SignOut |
| Mail | Envelope |
| MessageCircle | ChatCircle |
| MessageSquare | ChatCentered |
| MoreHorizontal | DotsThree |
| Pencil | PencilSimple |
| Search | MagnifyingGlass |
| Send | PaperPlaneRight |
| Settings | Gear |
| Share2 | ShareNetwork |
| Sparkles | Sparkle |
| TrendingUp | TrendUp |
| UserX | UserMinus |
| WalletCards | Wallet |

Same name in both (no rename needed): ArrowLeft, Bell, Bookmark, Calendar, Camera, Check, CheckCircle, CreditCard, Eye, FileText, Heart, Info, Link, Lock, Phone, Play, Plus, Shield, User, Users, X
