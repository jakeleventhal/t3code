# Messages and context

Give the agent a task in the composer. Add files, quote a previous response, or
include a skill when the task needs more context.

Messages can contain up to 120,000 characters. Longer drafts stay in the composer
so you can shorten them or split them into several messages.

## Attach files

Attach up to eight files per message. Images can be up to 10 MB; other files can
be up to 50 MB, subject to the environment's upload support and limit. The agent
receives them on the environment's machine.

Uploads begin when you add an attachment. All uploads must finish before the
message can send. Retry or remove a failed upload. On web and desktop, reloading
before an upload finishes requires you to attach that file again.

You can drag or paste images into the web or desktop composer. HEIC and HEIF
photos are converted to JPEG there and when selected from the iOS photo library;
the image limit applies after conversion. On mobile, you can also send files to
T3 Code through another app's system share sheet.

See [images and videos](#images-and-videos-in-messages) for previewing and saving media.

## Queue messages offline on mobile

Mobile keeps local copies of draft attachments, so you can preview them and queue
messages while disconnected. Uploads resume when you reconnect. Drafts and queued
messages survive app restarts. Signing out of T3 Connect keeps that work on your
device until you sign back into the same account.

## Custom models

On web and desktop, use Settings → Providers → **Models** to add an unlisted model with a custom
name and options. Only options supported by the provider integration affect turns. Antigravity
uses its account catalog and does not support custom models.

## Model defaults

T3 Code remembers your provider, model, and model options for new threads. A
project's configured model takes precedence; resetting that project setting
returns to the remembered selection.

Leaving reasoning level or service tier unset uses the provider's own configuration.

## Quote an assistant response

On web and desktop, select text within one assistant response and choose
**Cite in composer**. You can add a comment about the quote and write instructions
around it.

Select the quote in a draft or sent message to return to its source. If the source
is unavailable or has changed, the saved quote remains readable.

Mobile displays saved quotes and comments, but does not create citations or
navigate to their sources.

## Recall a sent prompt

Press `ArrowUp` in an empty composer to bring back the last prompt you sent in this thread. Press
`ArrowUp` again to go further back, and `ArrowDown` to come forward. Moving forward past the newest
prompt clears the composer. Recall walks the prompts loaded in the thread. Attachments, terminal
context, and other extras from the original message are not restored, only the text you typed. A
composer that holds an attachment or a picked element does not count as empty.

On web, desktop, and mobile, select a link to an image or video to open it inside T3 Code.
Workspace image and video links open the file viewer. Links to media outside the workspace
open a media preview.
Videos opened from the file explorer or a file-viewer tab also play inside T3 Code. They
stream from the environment as needed, rather than downloading the entire video before playback.
Paths in inline code, such as `/tmp/recording.mp4`, work the same way. Image embeds stay inline;
video embeds show a player with the browser's controls, full screen included. Visible video previews load
an initial frame when supported, but stay paused until you press Play. Video file references use
a filmstrip icon.

On web and desktop, hover over a preview to see its full file path or original URL. Right-click
to copy that reference, save the image or video, or copy an image to the clipboard. The video
player's built-in controls can download a video too. If the player cannot decode a video, its error message
offers a link to open the source in the browser. Workspace media also offers **Copy relative
path** and **Open in file viewer**. These actions are available in expanded previews too.

On mobile, touch and hold an inline image or a video thumbnail to see its source,
copy the path or URL, or choose **Save or share**. Workspace files can open in the file viewer
from the same menu. Saving downloads a copy only when you request it; it does not change how
the video buffers during playback. On iOS, touch and hold a file reference in a message to
copy its full or relative path or open it in the file viewer.

Use Markdown image syntax to embed either kind of media. A link or bare URL to an image or
video also embeds when it sits on a line of its own; a link that shares its line with other text
stays a link.

```markdown
![Screenshot](/tmp/screenshot.png)
![Recording](/tmp/recording.mp4)
[Recording](/tmp/recording.mp4)
https://example.com/screenshot.png
See the [screenshot](/tmp/screenshot.png) for the final layout.
```

Relative paths resolve from the thread's workspace. Absolute paths and `file://` links refer to
the environment's machine, even when you connect remotely or use your phone. Supported media
can live outside the workspace, including in Downloads or `/tmp`.

T3 Code serves the original file without adding it to attachment storage. If that file is moved
or deleted, its preview can no longer load from the environment. A browser or device may still
have a cached copy. Supported video formats and codecs depend on the browser or device.

Bare paths in ordinary prose and paths inside code blocks stay text. Raw HTML `<video>` tags
are not supported; use the Markdown embed syntax above.

## Files outside the workspace

When an agent links to a file it wrote outside the workspace, such as a Markdown report in
`/tmp`, select the link to open it in the file viewer. The viewer shows the file read-only, with
rendered Markdown available as usual; it cannot edit files outside the workspace. The workspace
file tree stays hidden because it does not describe the open file. HTML and PDF files outside the
workspace open the same way as ones inside it. Because such a file is served on its own, an HTML
page outside the workspace cannot load scripts, styles, or images from files beside it.

## HTML and PDF files in the file viewer

On web and desktop, the file viewer shows HTML and PDF files as a rendered page. Use the
source toggle in the viewer's header to switch an HTML file between the page and its markup; the
choice persists like the rendered-Markdown toggle. A link to a line always opens the source. HTML
runs in an isolated frame with no access to your T3 Code session. On desktop, the integrated
browser remains available from the same header for a full browser view.

## Changing projects

On web and desktop, changing the project from a new thread keeps the current environment when that
project exists there. If it does not, T3 Code selects another environment that has the project.

## Notices above the composer

On web and desktop, loading and syncing statuses fill the available banner width beside the
stash tab. Task progress appears above the composer, while the timeline's working timer shows
only elapsed time.

On web and desktop, additional notices peek out above the attached banner. Hover over the peek
to reveal them, or focus **Show other notices** with `Tab` and press `Enter` or `Space`. Press
`Escape` to close the stack and return focus to that control. On a touchscreen, tap the peek to
open the stack. Interacting with the attached banner or composer does not open the stack.

When the composer has text, the arrow keys move the caret as usual. Recall takes over only while
the text is an unedited recalled prompt, with the caret on the first visual line for `ArrowUp` or
the last visual line for `ArrowDown`, counting wrapped lines. Editing a recalled prompt turns it
into a normal draft.

## Prompt stash

On web and desktop, press `Cmd+S` on macOS or `Ctrl+S` on Windows and Linux to save
the current prompt and its attachments for later. Wait for uploads to finish first.
With an empty composer, the same shortcut restores a single stash or opens the
stash menu when there are several.

Stashes containing uploaded files must be restored in their original environment.
Those files are retained for 24 hours. After an upload expires, restore the prompt
and use **Attach again** or remove the missing file before sending.

## Voice input on iPhone

On supported iPhones with iOS 26 or later, use the composer's microphone to record,
then confirm to transcribe. Text is inserted where your selection was when
recording started, ready for you to review and edit before sending.

The first use may download Apple's speech model and needs a network connection.
Later transcription works offline for that language. Recordings can be up to five
minutes long. Canceling, leaving the screen, or an audio interruption discards the
recording and preserves your existing draft.

Transcription runs on your device. T3 Code deletes the temporary audio after
transcription or cancellation; only the message text is sent when you submit.

## Commands and skills

Type `/` for commands or `$` to add a skill from the selected environment and
provider. On mobile, both are also available before starting a thread on
**New task**.

The slash menu also includes skills unless you turn off **Settings → General →
Show skills in slash menu**. Only skills enabled for the provider are listed.

Provider commands must start the message to run. T3 Code commands such as
`/model` and `/plan`, and skill mentions, work on any line.

Send `/compact` in an existing conversation to reduce context usage when the
provider supports it. Web and desktop also offer compaction from the context meter.

## Images and videos in messages

Select an image or video attachment or link to preview it. Playback support depends
on your browser or device; save an unsupported video to open it in another app.

On web and desktop, right-click media to save it or copy its path or URL. On mobile,
touch and hold an image or video thumbnail and choose **Save or share**. On iOS,
return to the thumbnail to open this menu after watching a full-screen video.

File links refer to the environment's machine, including when you connect remotely.
Previews use the original file, even outside the workspace. Moving or deleting it
can break the preview, so save a copy if you need to keep it.

## Files outside the workspace

Follow an agent's file link to read a report or other file outside the workspace.
These files open read-only. An HTML file outside the workspace cannot load scripts,
styles, or images from neighboring files.

## HTML and PDF files in the file viewer

On web and desktop, HTML and PDF files open as rendered pages. Switch an HTML
file to source view to read its markup; a link to a specific line opens source
automatically. HTML previews cannot access your T3 Code session.

On mobile, select a PDF attachment or link to open it. iOS uses the native viewer;
Android opens the system chooser.
