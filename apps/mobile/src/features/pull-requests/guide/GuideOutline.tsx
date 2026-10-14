import { Button } from "../../../components/ui/Button";
import type { PullRequestReviewGuide } from "@t3tools/contracts";
import { stopFilePaths, reviewGuideStopProgress } from "@t3tools/client-runtime/review-guide-tour";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../../components/ui/AppText";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { PullRequestMarkdown } from "../PullRequestMarkdown";
import { Menu } from "../../../components/ui/Menu";

import { useAppearancePreferences } from "../../settings/appearance/AppearancePreferencesProvider";

export function GuideOutline({
  guide,
  onOpen,
  onRewrite,
  isViewed,
  onToggleViewed,
  onOpenFile,
  onSetChapterViewed,
}: {
  readonly guide: PullRequestReviewGuide;
  readonly onOpen: (position: number) => void;
  readonly onRewrite?: (() => void) | undefined;
  readonly isViewed: (path: string) => boolean;
  readonly onToggleViewed?: ((path: string) => void) | undefined;
  readonly onOpenFile: (path: string) => void;
  readonly onSetChapterViewed?:
    | ((paths: ReadonlyArray<string>, viewed: boolean) => void)
    | undefined;
}) {
  const { appearance, setCodeWordBreak } = useAppearancePreferences();
  const files = new Set(guide.stops.flatMap(stopFilePaths));
  return (
    <View>
      <View className="mb-5 flex-row items-center justify-between">
        <View className="flex-row items-baseline gap-2">
          <Text className="text-base font-t3-semibold">{guide.stops.length} chapters</Text>
          <Text className="text-sm text-foreground-muted">
            through {files.size} {files.size === 1 ? "file" : "files"}
          </Text>
        </View>
        <Menu
          title="Guide options"
          actions={[
            {
              id: "word-wrap",
              title: "Word wrap",
              image: "text.alignleft",
              state: appearance.codeWordBreak ? "on" : "off",
            },
            ...(onRewrite
              ? [{ id: "rewrite", title: "Rewrite guide", image: "arrow.clockwise" }]
              : []),
          ]}
          onPressAction={({ nativeEvent }) =>
            nativeEvent.event === "word-wrap"
              ? setCodeWordBreak(!appearance.codeWordBreak)
              : onRewrite?.()
          }
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Guide options"
            className="h-11 w-11 items-center justify-center rounded-full active:bg-grouped-card"
          >
            <SymbolView name="ellipsis" size={20} tintColorClassName="accent-icon-muted" />
          </Pressable>
        </Menu>
      </View>
      {guide.stops.map((stop, position) => {
        const progress = reviewGuideStopProgress(stop, isViewed);
        const paths = progress.paths;
        const firstPath = paths[0];
        const filename = firstPath?.split("/").at(-1);
        return (
          <View key={`${guide.headSha}:${JSON.stringify(stop)}`} className="mb-6">
          <Pressable
            accessibilityRole="button"
              accessibilityLabel={`Chapter ${position + 1}: ${stop.title}`}
            onPress={() => onOpen(position)}
            className="flex-row gap-4 active:opacity-60"
          >
            <View className="w-8 items-center">
              <View className="h-8 w-8 items-center justify-center rounded-full border border-border bg-grouped-card">
                <Text className="text-sm font-t3-medium tabular-nums">{position + 1}</Text>
              </View>
              {position < guide.stops.length - 1 ? (
                <View className="min-h-5 w-px flex-1 bg-border-subtle" />
              ) : null}
            </View>
            <View className="min-w-0 flex-1 gap-2 pb-7 pt-0.5">
              <Text className="text-base leading-6 font-t3-medium">{stop.title}</Text>
                {stop.summary ? <PullRequestMarkdown markdown={stop.summary} /> : null}
              <View className="flex-row items-center gap-1.5">
                {stop.attention ? (
                    <SymbolView
                      name="eye"
                      size={14}
                      tintColorClassName="accent-warning-foreground"
                    />
                ) : null}
                <Text className="shrink text-xs text-foreground-muted" numberOfLines={1}>
                  {filename ?? "Context"}
                  {paths.length > 1 ? ` +${paths.length - 1}` : ""}
                </Text>
              </View>
            </View>
            <View className="pt-2">
              <SymbolView name="chevron.right" size={12} tintColorClassName="accent-icon-muted" />
            </View>
          </Pressable>
            {paths.length && onSetChapterViewed ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: progress.reviewed }}
                accessibilityLabel={`Mark chapter ${position + 1} reviewed`}
                className="ml-12 mb-2 min-h-11 flex-row items-center gap-2"
                onPress={() => onSetChapterViewed(paths, !progress.reviewed)}
              >
                <SymbolView
                  name={progress.reviewed ? "checkmark.circle.fill" : "circle"}
                  size={17}
                  tintColorClassName="accent-icon-muted"
                />
                <Text className="text-xs text-foreground-muted">
                  {progress.reviewedCount} of {paths.length} files reviewed
                </Text>
              </Pressable>
            ) : null}
            {paths.length ? (
              <View className="ml-12 overflow-hidden rounded-xl border border-border-subtle">
                {paths.map((path) => (
                  <View key={path} className="flex-row items-center gap-2 px-3">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={path}
                      className="min-h-11 min-w-0 flex-1 justify-center"
                      onPress={() => onOpenFile(path)}
                    >
                      <Text numberOfLines={1} className="text-xs">
                        {path}
                      </Text>
                    </Pressable>
                    {onToggleViewed ? (
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isViewed(path) }}
                        accessibilityLabel={`Reviewed ${path}`}
                        className="min-h-11 min-w-11 items-center justify-center"
                        onPress={() => onToggleViewed(path)}
                      >
                        <SymbolView
                          name={isViewed(path) ? "checkmark.circle.fill" : "circle"}
                          size={17}
                          tintColorClassName="accent-icon-muted"
                        />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {guide.stops.length ? (
        <View className="self-end">
          <Button label="Start tour" tone="text" onPress={() => onOpen(0)} icon="arrow.right" />
        </View>
      ) : null}
    </View>
  );
}
