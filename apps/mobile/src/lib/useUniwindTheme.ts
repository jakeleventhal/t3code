import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import type { MobileThemeVariables } from "./mobileTheme";

export function useUniwindTheme(): MobileThemeVariables {
  return useAppearancePreferences().themeVariables;
}

export function useThemeFontFamilies() {
  const { fonts } = useAppearancePreferences();
  return { ...fonts.interface, code: fonts.code.regular };
}
