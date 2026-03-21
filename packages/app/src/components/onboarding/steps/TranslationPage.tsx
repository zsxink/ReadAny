import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@readany/core/stores/settings-store";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { OnboardingLayout } from "../OnboardingLayout";

export function TranslationPage({ onNext, onPrev, step, totalSteps }: any) {
  const { t } = useTranslation();
  const { translationConfig, updateTranslationConfig } = useSettingsStore();

  const [provider, setProvider] = useState<"ai" | "deepl">(translationConfig.provider.id);
  const [apiKey, setApiKey] = useState(translationConfig.provider.apiKey || "");
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");

  const testConnection = async () => {
    setStatus("testing");
    try {
      const res = await fetch("https://api-free.deepl.com/v2/usage", {
        headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
      });
      if (res.ok) setStatus("success");
      else throw new Error("Failed");
    } catch (e) {
      setStatus("error");
    }
  };

  const handleNext = () => {
    updateTranslationConfig({
      provider: {
        id: provider,
        name: provider === "ai" ? "AI Translation" : "DeepL",
        apiKey: provider === "deepl" ? apiKey : undefined,
      },
    });
    onNext();
  };

  return (
    <OnboardingLayout
      illustration="/illustrations/discussion.svg"
      step={step}
      totalSteps={totalSteps}
      footer={
        <>
          <Button variant="ghost" onClick={onPrev}>
            {t("common.back", "Back")}
          </Button>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={handleNext} className="text-muted-foreground">
              {t("onboarding.skipForNow", "Skip for now")}
            </Button>
            <Button
              onClick={handleNext}
              disabled={status === "testing"}
              className="rounded-full px-8 shadow-md"
            >
              {t("common.next", "Next")} →
            </Button>
          </div>
        </>
      }
    >
      <div className="animate-in fade-in slide-in-from-right-4 duration-500 flex-1 flex flex-col justify-center">
        <div className="space-y-2 text-center mb-6">
          <h2 className="text-2xl font-bold tracking-tight">
            {t("onboarding.translation.title", "Translation Engine")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "onboarding.translation.desc",
              "Enable seamless bilingual reading with your preferred engine.",
            )}
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.translationProvider", "Provider")}
            </label>
            <Select
              value={provider}
              onValueChange={(v: "ai" | "deepl") => {
                setProvider(v);
                setStatus("idle");
              }}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ai">AI Co-pilot (Free)</SelectItem>
                <SelectItem value="deepl">DeepL Pro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {provider === "deepl" && (
            <div className="space-y-1.5 animate-in fade-in zoom-in-95">
              <label className="text-xs font-medium text-muted-foreground">
                {t("settings.apiKey", "DeepL API Key")}
              </label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          )}
        </div>

        {provider === "deepl" && (
          <div className="mt-4 flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={testConnection}
              disabled={status === "testing" || !apiKey}
            >
              {status === "testing" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {status === "success" && (
                <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-500" />
              )}
              {status === "error" && <AlertCircle className="mr-2 h-3.5 w-3.5 text-destructive" />}
              {t("onboarding.ai.test", "Test Connection")}
            </Button>
            {status === "error" && <p className="text-xs text-destructive">Connection failed</p>}
            {status === "success" && <p className="text-xs text-emerald-600">Connected!</p>}
          </div>
        )}
      </div>
    </OnboardingLayout>
  );
}
