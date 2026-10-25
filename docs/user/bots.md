# Assistant and bots

The switch at the top of the sidebar moves between **Code**, your projects and
threads, and **Bots**, your ongoing conversations with Assistant and any bots
you add. Each side reopens where you left it, including the thread, review, or
browser you had open in Code.

Bots lists the bots on every environment you're connected to in one list. Each
bot lives on one environment, its host, and opens there; a bot whose host is
offline is marked **Offline** rather than moved. The host's name appears only to
tell two bots with the same name apart. Each bot's conversations are separate: a
bot doesn't start with another bot's history, though any agent can still look up
other threads through T3 Code's tools when asked to. Bots need an up-to-date
T3 Code server on their host.

## Assistant

Assistant is the first entry in Bots: one conversation that continues across
visits. It lives on the environment that already has the oldest Assistant, and
stays there while that environment is offline. With no Assistant yet, opening it
sets one up on a connected environment. If you have more than one Assistant from
before, the others stay listed under **Other Assistants** with their host, and in
**Settings → Bots** and **Settings → Voice**. Nothing is merged or deleted.

Bot chats have no model controls. Choose the model, reasoning, and permissions
every bot uses in **Settings → Bots**, and give one bot its own from its
profile (its **Settings** tab on web and desktop); **Use default** returns it to
the defaults.
Changes apply from the next message, and a reply already running keeps its
settings. Until you choose bot defaults, bots keep the model they already use.
If the chosen model isn't available on that environment, the chat shows
**Setup needed** and doesn't send rather than switching to another model.
An environment whose T3 Code server predates bot settings shows them read-only
and asks you to update it.

While you work in Code on web and desktop, the small Assistant button in the
corner opens a quick panel on the same conversation with your Assistant, whichever
environment you're working in. Type a question there, or choose **Open chat** to
continue in Bots; **Code** in the chat header takes you back. Approvals and questions from Assistant are answered in the full chat.
Press `mod+shift+space` to open the quick panel from Code, or Assistant's chat
from Bots and Settings.

On mobile, open **Bots** from the navigation bar. Bots leads with Assistant,
then your other bots; add one with **New bot**. Older Assistants remain available
through search. Unread and needs-attention badges include the bot’s secondary threads. In Code, the
Assistant button opens a quick
sheet on the same conversation with your Assistant, whichever environment the
thread or pull request you're viewing is on. If the Assistant's environment is
offline or needs an update, the sheet says so instead of using another one. **Open** continues in Bots. Return to the section you left to reopen
the thread, pull request, diff, or browser page you were reading.

A message sent from the quick panel or sheet tells Assistant what you're viewing
on that device. If an in-app browser tab is on screen, the page's text is read
once, when you send. What's on screen accompanies your request without being
added to your message in the chat. Assistant doesn't see the page as an image.

Messages sent while a bot is replying steer its current work. If its provider
requires it, T3 Code interrupts and continues the reply with your new instruction.

On web and desktop, a message you send to a bot whose host is offline waits
above the composer as **Waiting for connection** and goes out, in the order
written, when the host reconnects, whichever screen you're on. It's kept on
this device, so it sends once this browser or app is open and connected again.
Cancel a waiting message with its **×**. A message the host refuses, for
example because of **Setup needed**, stays as **Not delivered** with the reason,
holds the messages after it, and can be retried or cancelled. Messages for a
machine you've since removed are listed in **Settings → Bots**, where you can
copy or discard them; adding the machine back sends them.

When a bot asks a bot on another machine for help and that machine can't be
reached, the request waits on the asking bot's machine. It shows above the
composer in both conversations, marked as coming from a bot, with a link to the
other one. You can cancel it while it's **Waiting for connection**. Once it may
have arrived it shows **Confirming delivery** and can't be cancelled, and
**Access needed** or **Setup needed** means the receiving machine needs
attention first. A request that had to wait shows **Delivered** in the asking
conversation for a while after it goes out; to stop the work it started, open
the other conversation and stop it there. You'll only see requests from
machines this device is connected to.

## Your own bots

Click **+** in the Bots list and give the bot a name. It starts with the bot
defaults, or the model for new threads if none are set. To keep new bots on
another environment, choose it under **Settings → Bots → Advanced → Default
host for new bots** on the environment that hosts your Assistant. Every device
connected to that environment uses the same choice. It only affects bots you
create from then on: Assistant and existing bots stay where they are, and if
the default host is offline, **New bot** says so instead of creating the bot
somewhere else. The bot uses its host's bot defaults.

Each bot opens its main conversation. For parallel work, open **Threads** in the
chat header and choose **New thread**. Threads can be renamed or archived from
their menu. **Show archived** makes archived threads searchable; reading one
doesn't reopen it. Use **Reopen** to continue it.

A bot carries useful context from one conversation to the next, across its
main conversation, its threads, and calls. Tell it what you want remembered, or
ask it to correct or forget something. What it carries is a short summary, but
past conversations stay available: in a thread or a call, ask about something
from its main conversation or another of its threads, even an archived one, and
the bot looks it up.

Bot conversations don't appear in the Code thread list, but thread search and
links still open them.

Type **@** to reference this bot's shared files, bots, conversations, or Code
projects. Internal working files aren't offered. Archived conversations appear
when you search, and a reference alone doesn't start work elsewhere. Tell the
bot what you want: it can read another conversation, ask a specialist to help,
or send work to a Code thread. Substantial work stays in the receiving
conversation, with a short linked result returned to the requesting bot.

## Bot profile

Click a bot's name in its chat header, from its main conversation or any thread,
to open its profile beside the chat; on a narrow window it opens as a sheet.
Click the name to rename the bot, or the picture to choose an emoji, colored
initials, or a photo. Assistant can be renamed and given a picture too.

**Routines** lists what the bot does on a schedule. Ask the bot in chat to set
one up or change it; the switch pauses or resumes it. **Files** collects what
you and the bot shared in its conversations, newest first. Open one to preview
it, and **Show in chat** jumps to the message it was shared in. Files and photos
need an up-to-date server on the bot's environment.

## Voice

**Call** in a bot's chat header starts a voice call with that bot, in the
conversation on screen; Code's Assistant panel or sheet can call Assistant too.
Calls work on web, desktop, and mobile, and need an up-to-date server and a
voice account in **Settings > Voice** on the bot's environment; when calling
isn't possible, Call says why. In a browser, the microphone is only
available over HTTPS or on `localhost`. One call runs at a time. In that bot's
chat the call sits above the composer; anywhere else it stays in reach, where
you can mute, end it, or open its transcript to read along or type instead of
talking.

During a call, the bot knows which page you're on as you move around on the
device you called from. When you ask it to do something, it also reads the text
of an in-app browser page on screen. A call is saved in the conversation as its
transcript. T3 Code doesn't keep the audio; the voice provider's own retention
policy still applies.

Voice is chosen per environment in **Settings > Voice**.

- **Voice accounts**: add an OpenAI or xAI API key, or link a ChatGPT
  subscription. Keys are stored on the environment, not in your browser, and
  calls are billed by that provider. "Key saved" and "Sign-in linked" mean the
  account is set up, not that it has been tried on a call.
- **ChatGPT subscription** uses an enabled
  [existing Codex login](./providers-codex.md#use-an-existing-codex-login)
  signed in with ChatGPT on the environment's machine, whether Codex keeps it
  in a file or the OS credential store. Calls work where OpenAI offers voice
  on that plan. Accounts added with **Connect with ChatGPT** share your plan
  through T3 Code and can't provide voice.
- **Default for bots**: the voice every bot uses unless it has its own.
- **Bots**: give a bot its own voice or switch it back to the default. On web
  and desktop you can also choose **No voice** for one bot.
- An account that needs a key or is unavailable can't be picked. Voices already
  saved on it stay selected and show what's wrong; nothing switches to another
  voice for you.

In a bot's chat, the voice control in the header (the arrow next to **Call** on
web and desktop) opens that bot's voice choices.
On web and desktop you can change the bot's voice or the default there without
leaving the conversation; on mobile it opens the bot's voice settings. A bot's
voice never changes the provider or model it types and works with.

Use the play button beside a voice to hear a short sample before choosing it.
Previewing leaves your selected voice and conversations unchanged.
