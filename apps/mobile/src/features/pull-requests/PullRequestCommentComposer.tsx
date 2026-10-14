import { useState } from "react";
import { View } from "react-native";
import { AppTextInput as TextInput } from "../../components/AppText";
import { ControlPill } from "../../components/ControlPill";
import { PullRequestAttachments } from "./PullRequestAttachments";
import type { PullRequestParams } from "./usePullRequestDiff";
import { useReviewAttachmentInsertion } from "./useReviewAttachmentInsertion";

/** One compact field and attached upload/send toolbar for every native review composer. */
export function PullRequestCommentComposer({
  params,
  value,
  onChangeText,
  label,
  placeholder,
  editable = true,
  busy = false,
  canSubmit,
  submitLabel,
  showSubmitLabel = false,
  onSubmit,
  onBusyChange,
  autoFocus = false,
  minimumHeight = 80,
}: {
  params: PullRequestParams;
  value: string;
  onChangeText: (value: string) => void;
  label: string;
  placeholder: string;
  editable?: boolean;
  busy?: boolean;
  canSubmit: boolean;
  submitLabel: string;
  showSubmitLabel?: boolean;
  onSubmit: () => void;
  onBusyChange?: (busy: boolean) => void;
  autoFocus?: boolean;
  minimumHeight?: number;
}) {
  const insertion = useReviewAttachmentInsertion(value, onChangeText);
  const [uploading, setUploading] = useState(false);
  const [height, setHeight] = useState(minimumHeight);
  return (
    <View className="overflow-hidden rounded-2xl border border-border-subtle bg-grouped-card">
      <TextInput
        {...insertion.inputProps}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColorClassName="accent-foreground-muted"
        multiline
        maxLength={65536}
        value={value}
        onChangeText={onChangeText}
        editable={editable && !busy && !uploading}
        autoFocus={autoFocus}
        onContentSizeChange={(event) => {
          const next = Math.min(
            200,
            Math.max(minimumHeight, Math.ceil(event.nativeEvent.contentSize.height)),
          );
          setHeight((current) => (current === next ? current : next));
        }}
        className="min-h-0 rounded-none border-0 bg-transparent px-3 py-3 text-base text-foreground"
        style={{ height, textAlignVertical: "top" }}
      />
      <View className="min-h-12 flex-row items-center gap-2 border-t border-border-subtle px-2 py-1">
        <PullRequestAttachments
          params={params}
          disabled={!editable || busy}
          onBusyChange={(busy) => {
            setUploading(busy);
            onBusyChange?.(busy);
          }}
          onAppend={insertion.insert}
        />
        <View className="flex-1" />
        <ControlPill
          icon="arrow.up"
          accessibilityLabel={submitLabel}
          label={showSubmitLabel ? submitLabel : undefined}
          variant="primary"
          disabled={!canSubmit || busy || uploading}
          onPress={onSubmit}
        />
      </View>
    </View>
  );
}
