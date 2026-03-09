import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

export function NotesScreen() {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("tabs.notes", "笔记")}</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.placeholder}>{t("notes.emptyHint", "阅读时添加的笔记将显示在这里")}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: "700", color: "#fafafa" },
  content: { flex: 1, justifyContent: "center", alignItems: "center" },
  placeholder: { fontSize: 16, color: "#71717a" },
});
