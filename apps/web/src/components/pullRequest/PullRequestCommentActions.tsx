import { MoreHorizontalIcon } from "lucide-react";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";

export function PullRequestCommentActions({
  body,
  url,
  onEdit,
  resolution,
  onCopyLink,
  disabled,
}: {
  body: string;
  url: string | null;
  onCopyLink?: (() => Promise<string | null>) | undefined;
  disabled?: boolean | undefined;
  onEdit?: (() => void) | undefined;
  resolution?:
    | {
        resolved: boolean;
        pending: boolean;
        onToggle: () => void;
      }
    | undefined;
}) {
  const { copyToClipboard } = useCopyToClipboard({
    target: "comment",
    onError: () => toastManager.add({ type: "error", title: "Could not copy the comment" }),
  });
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="icon-xs" variant="ghost-muted" />}
        aria-label="Comment actions"
        disabled={disabled}
      >
        <MoreHorizontalIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {onEdit ? <MenuItem onClick={onEdit}>Edit comment</MenuItem> : null}
        <MenuItem disabled={body.length === 0} onClick={() => copyToClipboard(body, undefined)}>
          Copy comment
        </MenuItem>
        {url || onCopyLink ? (
          <MenuItem
            onClick={() =>
              void (async () => {
                const link = onCopyLink ? await onCopyLink() : url;
                if (link) await copyToClipboard(link, undefined);
              })()
            }
          >
            Copy link
          </MenuItem>
        ) : null}
        {resolution?.resolved ? (
          <>
            <MenuSeparator />
            <MenuItem disabled={resolution.pending} onClick={resolution.onToggle}>
              Unresolve conversation
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
