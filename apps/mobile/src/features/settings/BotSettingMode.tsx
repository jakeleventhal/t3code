import { Pressable, View } from "react-native";
import { AppText } from "../../components/ui/AppText";

export function BotSettingMode({
  label,
  custom,
  disabled,
  onDefault,
  onCustom,
}: {
  label: string;
  custom: boolean;
  disabled: boolean;
  onDefault: () => void;
  onCustom: () => void;
}) {
  return (
    <View className="flex-row gap-2 px-4 py-2">
      {([false, true] as const).map((value) => (
        <Pressable
          key={String(value)}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value ? "Custom" : "Default"}`}
          accessibilityState={{ selected: custom === value, disabled }}
          disabled={disabled}
          onPress={value ? onCustom : onDefault}
          className={`min-h-11 flex-1 items-center justify-center rounded-full px-3 ${custom === value ? "bg-secondary" : "bg-transparent"} ${disabled ? "opacity-50" : "active:opacity-70"}`}
        >
          <AppText
            textRole="body"
            className={
              custom === value
                ? "font-t3-medium text-secondary-foreground"
                : "text-foreground-muted"
            }
          >
            {value ? "Custom" : "Default"}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}
