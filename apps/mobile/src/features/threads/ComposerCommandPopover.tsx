import { useProject } from "../../state/entities";
import { BotAvatar } from "../bots/BotAvatar";
import type { ProjectContextRecord } from "@t3tools/contracts";
import {
  BOT_MENTION_GROUP_LABELS,
  type BotMentionItem,
} from "@t3tools/client-runtime/botMentionItems";
import {
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import type {
  PullRequestContextMetadata,
  ScopedThreadRef,
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@t3tools/contracts";
import type { ComposerTriggerKind } from "@t3tools/shared/composerTrigger";
import { Fragment, memo } from "react";
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { PierreEntryIcon } from "../../components/PierreEntryIcon";
import { pullRequestStatus } from "../pull-requests/pullRequestStatus";
export type ComposerCommandItem =
  | BotMentionItem
  | {
      readonly id: string;
      readonly type: "pull-request";
      readonly pullRequest: PullRequestContextMetadata;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "path";
      readonly path: string;
      readonly kind: "file" | "directory";
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "thread";
      readonly thread: ScopedThreadRef;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "slash-command";
      readonly command: string;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "provider-slash-command";
      readonly command: ServerProviderSlashCommand;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "skill";
      readonly skill: ServerProviderSkill;
      readonly label: string;
      readonly description: string;
    };

interface ComposerCommandPopoverProps {
  readonly items: ReadonlyArray<ComposerCommandItem>;
  readonly triggerKind: ComposerTriggerKind | null;
  readonly isLoading: boolean;
  readonly error?: string | null;
  /** A bot chat's @ menu: grouped curated context rather than workspace files. */
  readonly botMentions?: boolean;
  /** A standing explanation above the results, such as why some kinds are missing. */
  readonly notice?: string | null;
  readonly onSelect: (item: ComposerCommandItem) => void;
}

function PopoverSurface(props: { readonly children: React.ReactNode; readonly style?: ViewStyle }) {
  const baseStyle: ViewStyle = {
    borderRadius: 16,
    overflow: "hidden",
    ...props.style,
  };

  return (
    <GlassSurface
      glassEffectStyle="clear"
      tintColorClassName="accent-glass-surface"
      style={baseStyle}
    >
      {props.children}
    </GlassSurface>
  );
}

const SKILL_SOURCE_SYMBOL_BY_KIND: Record<ProviderSkillSourceKind, AppSymbolName> = {
  app: "square.grid.2x2",
  repo: "folder",
  project: "folder",
  personal: "person.crop.circle",
  system: "gearshape",
  other: "cube",
};

function itemIcon(item: ComposerCommandItem): AppSymbolName | null {
  switch (item.type) {
    case "pull-request":
      return pullRequestStatus(item.pullRequest).icon;
    case "slash-command":
    case "provider-slash-command":
      return "terminal";
    case "skill":
      return SKILL_SOURCE_SYMBOL_BY_KIND[resolveProviderSkillSourceKind(item.skill)];
    case "path":
      return null;
    case "thread":
      return "text.bubble";
    case "reference":
      return referenceIcon(item.reference);
  }
}

function referenceIcon(reference: BotMentionItem["reference"]): AppSymbolName {
  switch (reference.kind) {
    case "thread":
      return "text.bubble";
    case "project":
      return reference.botRole === null ? "folder" : "person.crop.circle";
    case "bot-file":
      if (reference.fileKind === "html") return "globe";
      return reference.mimeType?.startsWith("image/") ? "photo" : "doc";
  }
}

function groupLabel(triggerKind: ComposerTriggerKind | null): string | null {
  switch (triggerKind) {
    case "pull-request":
      return "Pull requests";
    case "slash-command":
      return "Commands";
    case "skill":
      return "Skills";
    case "path":
      return "Files";
    default:
      return null;
  }
}

function emptyText(
  triggerKind: ComposerTriggerKind | null,
  isLoading: boolean,
  botMentions: boolean,
): string {
  if (botMentions && triggerKind === "path") {
    return isLoading ? "Loading…" : "No matching files, conversations, projects, or bots.";
  }
  if (isLoading) {
    return triggerKind === "path" ? "Searching files…" : "Loading…";
  }
  switch (triggerKind) {
    case "pull-request":
      return "No matching pull requests.";
    case "path":
      return "No matching files or folders.";
    case "skill":
      return "No skills found.";
    case "slash-command":
      return "No matching commands.";
    default:
      return "No results.";
  }
}

const CommandRow = memo(function CommandRow(props: {
  readonly item: ComposerCommandItem;
  readonly onPress: () => void;
  readonly isLast: boolean;
  readonly isSlashSkill: boolean;
}) {
  const iconName = itemIcon(props.item);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="flex-row items-center gap-2.5 border-border px-3.5 py-2.5 active:opacity-60"
      style={{ borderBottomWidth: props.isLast ? 0 : StyleSheet.hairlineWidth }}
    >
      {props.item.type === "path" ? (
        <PierreEntryIcon path={props.item.path} kind={props.item.kind} size={16} />
      ) : props.item.type === "reference" &&
        props.item.reference.kind === "project" &&
        props.item.reference.botRole !== null ? (
        <MentionBotAvatar reference={props.item.reference} />
      ) : iconName ? (
        <SymbolView
          name={iconName}
          size={14}
          tintColorClassName={
            props.item.type === "pull-request"
              ? pullRequestStatus(props.item.pullRequest).tint
              : "accent-icon-subtle"
          }
          type="monochrome"
        />
      ) : null}
      <Text className="shrink-0 text-base font-t3-medium text-foreground" numberOfLines={1}>
        {props.isSlashSkill && props.item.type === "skill" ? (
          <>
            <Text className="text-foreground-muted">skill:</Text>
            {props.item.skill.name}
          </>
        ) : (
          props.item.label
        )}
      </Text>
      {props.item.description ? (
        <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
          {props.item.description}
        </Text>
      ) : null}
    </Pressable>
  );
});

function GroupHeader(props: { readonly label: string }) {
  return (
    <View className="px-3.5 pt-2.5 pb-1">
      <Text className="text-3xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
        {props.label}
      </Text>
    </View>
  );
}

export const ComposerCommandPopover = memo(function ComposerCommandPopover(
  props: ComposerCommandPopoverProps,
) {
  const grouped = props.botMentions === true && props.triggerKind === "path";
  const label = grouped ? null : groupLabel(props.triggerKind);

  return (
    <PopoverSurface>
      {label ? <GroupHeader label={label} /> : null}
      {props.notice ? (
        <View className="px-3.5 pt-2.5">
          <Text className="text-xs text-foreground-tertiary">{props.notice}</Text>
        </View>
      ) : null}
      {props.items.length > 0 ? (
        <ScrollView
          className="max-h-[180px]"
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          {props.items.map((item, index) => {
            const group = item.type === "reference" ? item.group : null;
            const previous = props.items[index - 1];
            const startsGroup =
              group !== null && (previous?.type !== "reference" || previous.group !== group);
            return (
              <Fragment key={item.id}>
                {startsGroup ? <GroupHeader label={BOT_MENTION_GROUP_LABELS[group]} /> : null}
                <CommandRow
                  item={item}
                  onPress={() => props.onSelect(item)}
                  isLast={index === props.items.length - 1}
                  isSlashSkill={props.triggerKind === "slash-command" && item.type === "skill"}
                />
              </Fragment>
            );
          })}
        </ScrollView>
      ) : (
        <View className="px-3.5 py-2.5">
          <Text className="text-xs text-foreground-tertiary">
            {props.error ??
              emptyText(props.triggerKind, props.isLoading, props.botMentions === true)}
          </Text>
        </View>
      )}
    </PopoverSurface>
  );
});

function MentionBotAvatar({ reference }: { reference: ProjectContextRecord }) {
  const project = useProject({
    environmentId: reference.environmentId,
    projectId: reference.projectId,
  });
  return (
    <BotAvatar
      role={reference.botRole ?? "specialist"}
      title={reference.title}
      size={22}
      project={project}
    />
  );
}
