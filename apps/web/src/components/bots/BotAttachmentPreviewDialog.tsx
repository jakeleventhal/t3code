import type { ScopedThreadRef } from "@t3tools/contracts";

import type { ChatFileAttachment } from "../../types";
import { AttachmentFilePreview } from "../files/AttachmentFilePreview";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";

/** Bot chats have no right panel, so a file shared in one opens over the conversation. */
export function BotAttachmentPreviewDialog({
  threadRef,
  attachment,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  attachment: ChatFileAttachment;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup
        className="h-[min(85vh,52rem)] max-w-4xl overflow-hidden"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{attachment.name}</DialogTitle>
        <AttachmentFilePreview
          name={attachment.name}
          mimeType={attachment.mimeType}
          sizeBytes={attachment.sizeBytes}
          asset={{
            environmentId: attachment.originEnvironmentId ?? threadRef.environmentId,
            attachmentId: attachment.id,
          }}
          htmlRender={attachment.htmlRender === true}
          threadRef={threadRef}
          onClose={onClose}
        />
      </DialogPopup>
    </Dialog>
  );
}
