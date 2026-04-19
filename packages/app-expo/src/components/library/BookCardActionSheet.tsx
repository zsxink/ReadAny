import { DatabaseIcon, HashIcon, Trash2Icon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { type ThemeColors, fontSize, fontWeight, radius, useColors } from "@/styles/theme";
import type { Book } from "@readany/core/types";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface BookCardActionSheetProps {
  visible: boolean;
  book: Book;
  onClose: () => void;
  onManageTags?: (book: Book) => void;
  onVectorize?: (book: Book) => void;
  onDelete: (bookId: string) => void;
}

export function BookCardActionSheet({
  visible,
  book,
  onClose,
  onManageTags,
  onVectorize,
  onDelete,
}: BookCardActionSheetProps) {
  const colors = useColors();
  const s = makeStyles(colors);
  const layout = useResponsiveLayout();
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose} />
      <View
        style={[
          s.sheet,
          layout.isTablet && {
            width: "100%",
            maxWidth: Math.min(layout.centeredContentWidth, 640),
            alignSelf: "center",
          },
        ]}
      >
        <View style={s.handle} />
        <View style={s.header}>
          <Text style={s.title} numberOfLines={1}>{book.meta.title}</Text>
          {book.meta.author ? <Text style={s.author}>{book.meta.author}</Text> : null}
        </View>
        <View style={s.divider} />

        {onManageTags && (
          <TouchableOpacity
            style={s.item}
            onPress={() => { onClose(); onManageTags(book); }}
          >
            <HashIcon size={20} color={colors.mutedForeground} />
            <Text style={s.label}>{t("home.manageTags", "管理标签")}</Text>
          </TouchableOpacity>
        )}

        {onVectorize && (
          <TouchableOpacity
            style={s.item}
            onPress={() => { onClose(); onVectorize(book); }}
          >
            <DatabaseIcon size={20} color={colors.mutedForeground} />
            <Text style={s.label}>
              {book.isVectorized ? t("home.vec_reindex", "重新索引") : t("home.vec_vectorize", "向量化")}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={s.itemDestructive}
          onPress={() => { onClose(); onDelete(book.id); }}
        >
          <Trash2Icon size={20} color={colors.destructive} />
          <Text style={s.labelDestructive}>{t("common.remove", "删除")}</Text>
        </TouchableOpacity>

        <View style={s.divider} />
        <TouchableOpacity style={s.cancel} onPress={onClose}>
          <Text style={s.cancelText}>{t("common.cancel", "取消")}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: 34,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.muted,
      alignSelf: "center",
      marginTop: 12,
      marginBottom: 8,
    },
    header: { paddingHorizontal: 20, paddingBottom: 12 },
    title: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
    author: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },
    divider: { height: 0.5, backgroundColor: colors.border },
    item: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
    label: { fontSize: fontSize.base, color: colors.foreground },
    itemDestructive: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
    labelDestructive: { fontSize: fontSize.base, color: colors.destructive },
    cancel: { alignItems: "center", paddingVertical: 14 },
    cancelText: { fontSize: fontSize.base, fontWeight: fontWeight.medium, color: colors.foreground },
  });
