import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Coffee, Moon, Sun } from "lucide-react";
/**
 * GeneralSettings — app-level settings
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type ThemeMode = "light" | "dark" | "sepia";

const THEME_CONFIG: Record<ThemeMode, { icon: typeof Sun; labelKey: string }> = {
  light: { icon: Sun, labelKey: "settings.light" },
  dark: { icon: Moon, labelKey: "settings.dark" },
  sepia: { icon: Coffee, labelKey: "settings.sepia" },
};

export function GeneralSettings() {
  const { t, i18n } = useTranslation();
  const [theme, setThemeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    const saved = localStorage.getItem("readany-theme") as ThemeMode | null;
    if (saved && THEME_CONFIG[saved]) {
      setThemeState(saved);
    }
  }, []);

  const handleLanguageChange = async (lang: string) => {
    const { changeAndPersistLanguage } = await import("@readany/core/i18n");
    await changeAndPersistLanguage(lang);
  };

  const handleThemeChange = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("readany-theme", newTheme);
  };

  return (
    <div className="space-y-6 p-4 pt-3">
      {/* Theme Section */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.theme")}</h2>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">{t("settings.theme")}</span>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.themeDesc")}</p>
          </div>
          <div className="flex gap-2">
            {(Object.keys(THEME_CONFIG) as ThemeMode[]).map((mode) => {
              const config = THEME_CONFIG[mode];
              const Icon = config.icon;
              const isActive = theme === mode;
              return (
                <button
                  key={mode}
                  onClick={() => handleThemeChange(mode)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t(config.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Language Section */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.language")}</h2>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">{t("settings.language")}</span>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.languageDesc")}</p>
          </div>
          <Select value={i18n.language} onValueChange={handleLanguageChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="zh">{t("settings.simplifiedChinese", "中文")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>
    </div>
  );
}
