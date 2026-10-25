import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { useBotsHeaderActions } from "./bots-header";

export function BotsAndroidHeader() {
  const actions = useBotsHeaderActions();
  return (
    <AndroidScreenHeader
      title="Bots"
      actions={[
        { accessibilityLabel: "Search bots", icon: "magnifyingglass", onPress: actions.search },
        ...(actions.newBot
          ? [{ accessibilityLabel: "New bot", icon: "plus" as const, onPress: actions.newBot }]
          : []),
      ]}
    />
  );
}
