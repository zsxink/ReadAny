import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootNavigator";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ProfileScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();

  const items = [
    { label: t("settings.general", "通用设置"), route: "AppearanceSettings" as const },
    { label: t("settings.ai", "AI 设置"), route: "AISettings" as const },
    { label: t("settings.tts", "TTS 设置"), route: "TTSSettings" as const },
    { label: t("settings.translationTab", "翻译设置"), route: "TranslationSettings" as const },
    { label: t("sync.title", "同步设置"), route: "SyncSettings" as const },
    { label: t("settings.about", "关于"), route: "About" as const },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("profile.title", "我的")}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {items.map((item) => (
          <TouchableOpacity
            key={item.route}
            style={styles.item}
            onPress={() => nav.navigate(item.route)}
          >
            <Text style={styles.itemText}>{item.label}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: "700", color: "#fafafa" },
  list: { padding: 16 },
  item: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: "#18181b",
    borderRadius: 12,
    marginBottom: 8,
  },
  itemText: { fontSize: 16, color: "#fafafa" },
  chevron: { fontSize: 20, color: "#71717a" },
});
