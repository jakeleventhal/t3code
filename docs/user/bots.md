# Assistant and bots

The switch at the top of the sidebar moves between **Code**, your projects and
threads, and **Bots**, your ongoing conversations with Assistant and any bots
you add. Each side reopens where you left it, including the thread, review, or
browser you had open in Code.

Bots belong to one environment. With more than one environment connected, pick
which one at the top of the Bots list. Each bot's conversations are separate: a
bot doesn't start with another bot's history, though any agent can still look up
other threads through T3 Code's tools when asked to. Bots need an up-to-date
T3 Code server on that environment.

## Assistant

Assistant is the first entry in Bots: one conversation that continues across
visits. It runs like any thread, so you choose its model, mode, and permissions
in its composer. Opening it the first time sets it up on that environment.

While you work in Code on web and desktop, the small Assistant button in the
corner opens a quick panel on the same conversation, using the Assistant of the
environment you're working in. Type a question there, or choose **Open chat** to
continue in Bots; **Code** in the chat header takes you back. Approvals and questions from Assistant are answered in the full chat.
Press `mod+shift+space` to open the quick panel from Code, or Assistant's chat
from Bots and Settings.

On mobile, open **Bots** from the navigation bar. Bots lists each environment's
Assistant first, then its other bots; add one with **New bot**. In Code, the
Assistant button opens a quick
sheet on the same conversation, for the environment of the thread or pull
request you're viewing, or the one your thread list is filtered to. If that
environment is offline or needs an update, the sheet says so instead of using
another one. **Open** continues in Bots. Return to the section you left to reopen
the thread, pull request, diff, or browser page you were reading.

A message sent from the quick panel or sheet tells Assistant what you're viewing
on that device. If an in-app browser tab is on screen, the page's text is read
once, when you send. What's on screen accompanies your request without being
added to your message in the chat. Assistant doesn't see the page as an image.

## Your own bots

Click **+** in the Bots list and give the bot a name. It starts with the
environment's default model. Each bot has a main conversation; use **New topic**
under a selected bot, or **New conversation** on mobile, for a separate thread
with it.

A bot carries useful context from one conversation to the next, across its
main conversation, its topics, and calls. Tell it what you want remembered, or
ask it to correct or forget something. What it carries is a short summary, but
past conversations stay available: in a topic or a call, ask about something
from its main conversation or another of its topics, even an archived one, and
the bot looks it up.

Bot conversations don't appear in the Code thread list, but thread search and
links still open them.

## Bot profile

Click a bot's name in its chat header, from its main conversation or any topic,
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
