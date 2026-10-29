import { resolveFilesystemReadAccess } from "@t3tools/client-runtime/state/filesystem";
import { environmentSession } from "../../state/session";
import type { EnvironmentId } from "@t3tools/contracts";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, View, type NativeSyntheticEvent } from "react-native";
import {
  ScreenStackHeaderSearchBarView,
  SearchBar,
  type SearchBarCommands,
} from "react-native-screens";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { FilesHeader } from "./FilesHeader";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { FileTreeBrowser } from "./FileTreeBrowser";
import { useFileTreeEntries } from "./useFileTreeEntries";
import { preloadWorkspaceFileContents } from "./preload-workspace-file";
import { IconButton } from "../../components/ui/IconButton";
import { NativeWorkspaceNavigatorPane } from "../layout/workspace-navigator-pane";

export function ThreadFileNavigatorPane(props: {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly headerInset: number;
  readonly projectName: string;
  readonly selectedPath: string | null;
  readonly onSelectFile: (path: string) => void;
  readonly toolbar?: ReactNode;
  readonly active?: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<SearchBarCommands>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchVisible = searchOpen && props.active !== false;
  const focusSearch = useCallback(() => {
    searchRef.current?.setActive(true);
    searchRef.current?.focus();
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the native search controller after its field has mounted in the header
  useEffect(() => {
    if (!searchVisible) return;
    const frame = requestAnimationFrame(focusSearch);
    return () => cancelAnimationFrame(frame);
  }, [searchVisible, focusSearch]);
  const { themeAppearance: highlightTheme } = useAppearancePreferences();
  const theme = useUniwindTheme();
  const foregroundColor = theme["--color-foreground"];
  const fileAccessSession = useEnvironmentQuery(
    environmentSession.sessionStateAtom(props.environmentId),
  );
  const fileEnvironment = useEnvironmentPresentation(props.environmentId);
  const fileAccess = resolveFilesystemReadAccess({
    isCatalogReady: fileEnvironment.isReady,
    connection: fileEnvironment.presentation?.connection ?? null,
    session: fileAccessSession.data,
    sessionError: fileAccessSession.error,
  });
  const { canReadFiles } = fileAccess;
  const entriesQuery = useFileTreeEntries({
    environmentId: props.environmentId,
    cwd: canReadFiles ? props.cwd : null,
    searchQuery,
  });
  const handlePreviewFile = (relativePath: string) => {
    preloadWorkspaceFileContents({
      cwd: props.cwd,
      environmentId: props.environmentId,
      relativePath,
      theme: highlightTheme,
    });
  };

  const fileTree = (
    <FileTreeBrowser
      key={JSON.stringify([props.environmentId, props.cwd])}
      revealSelection={entriesQuery.revealSelection}
      expandedPaths={entriesQuery.expandedPaths}
      setExpandedPaths={entriesQuery.setExpandedPaths}
      entries={entriesQuery.entries}
      loadingDirectories={entriesQuery.loadingDirectories}
      onLoadDirectory={entriesQuery.loadDirectory}
      error={
        canReadFiles
          ? entriesQuery.error
          : fileAccess.isPending
            ? null
            : (fileAccess.error ?? "This connection cannot read host files.")
      }
      isPending={fileAccess.isPending || entriesQuery.isPending}
      isRefreshing={entriesQuery.isRefreshing}
      searchQuery={searchQuery}
      searchResultPaths={entriesQuery.searchResultPaths}
      searchTruncated={entriesQuery.searchTruncated}
      selectedPath={props.selectedPath ?? entriesQuery.selectedPath}
      onPreviewFile={handlePreviewFile}
      onRefresh={entriesQuery.refresh}
      onSelectFile={(path) => {
        entriesQuery.selectPath(path);
        props.onSelectFile(path);
      }}
      toolbar={Platform.OS === "ios" ? undefined : props.toolbar}
      pinnedToolbar={Platform.OS === "ios"}
    />
  );

  if (Platform.OS === "ios") {
    return (
      <NativeWorkspaceNavigatorPane
        screenId="thread-file-navigator-native"
        title="Files"
        header={props.toolbar}
        insetBelowHeader
        trailing={
          <IconButton
            accessibilityLabel="Search files"
            icon="magnifyingglass"
            onPress={() => {
              setSearchOpen(true);
              if (searchVisible) focusSearch();
            }}
          />
        }
        subtitle={props.projectName}
        searchBar={
          searchVisible ? (
            <ScreenStackHeaderSearchBarView>
              <SearchBar
                ref={searchRef}
                allowToolbarIntegration={false}
                autoCapitalize="none"
                hideNavigationBar={false}
                hideWhenScrolling={false}
                obscureBackground={false}
                onCancelButtonPress={() => {
                  setSearchQuery("");
                  setSearchOpen(false);
                }}
                onChangeText={(event: NativeSyntheticEvent<{ readonly text?: string }>) => {
                  setSearchQuery(event.nativeEvent.text ?? "");
                }}
                placement="stacked"
                placeholder="Search files"
                textColor={foregroundColor}
                tintColor={foregroundColor}
              />
            </ScreenStackHeaderSearchBarView>
          ) : undefined
        }
      >
        {fileTree}
      </NativeWorkspaceNavigatorPane>
    );
  }

  return (
    <View
      className={
        Platform.OS === "android" ? "flex-1 bg-header" : "flex-1 border-l border-border bg-sheet"
      }
    >
      <View
        className="ios:border-b ios:border-border android:bg-header"
        style={{ paddingTop: Platform.OS === "android" ? 0 : props.headerInset }}
      >
        {Platform.OS === "android" ? (
          <FilesHeader
            projectName={props.projectName}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onRefresh={entriesQuery.refresh}
          />
        ) : (
          <View className="h-12 flex-row items-center gap-2 px-3">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-t3-bold text-foreground">Files</Text>
              <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                {props.projectName}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh files"
              hitSlop={8}
              className="h-8 w-8 items-center justify-center rounded-full active:bg-subtle"
              onPress={entriesQuery.refresh}
            >
              <SymbolView
                name="arrow.clockwise"
                size={14}
                tintColorClassName="accent-icon-muted"
                type="monochrome"
              />
            </Pressable>
          </View>
        )}
        {Platform.OS !== "android" ? (
          <View className="flex-row items-center gap-2 border-t border-border px-3 py-2">
            <SymbolView
              name="magnifyingglass"
              size={15}
              tintColorClassName="accent-icon-muted"
              type="monochrome"
            />
            <TextInput
              accessibilityLabel="Search files"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              className="min-h-10 flex-1 rounded-xl py-2 text-sm"
              placeholder="Search files"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        ) : null}
      </View>
      <ScreenContent insetHorizontal>{fileTree}</ScreenContent>
    </View>
  );
}
