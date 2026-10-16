# DJ voice: manual test checklist

Run this yourself in desktop Chrome and again in Opera, at http://localhost:5173/dj. The AI's browser has no microphone, so none of this has been tested live.

Notes before you start:

- Voice needs https or localhost. Opening the app by a LAN IP over http (for example http://192.168.x.x:5173) blocks the microphone; the DJ says "Browsers only allow the microphone on a secure page…". Use localhost.
- A page reload clears any API keys you pasted (they live in memory only). The choices (Hears you with, Speaks with, Hey DJ on/off) are remembered.
- To start clean, clear site data for localhost:5173 (DevTools, Application, Storage, Clear site data). That also forgets the downloaded-model flags (`allegra.dj.ears.v2`, `allegra.dj.kokoro.v1`); the browser cache of the models themselves is separate.
- Settings: gear button at the top right of the stage (aria-label "DJ settings"). Mic button: inside the text box at the bottom (aria-label "Speak your request"). Ear button: top right of the stage (aria-label "Hey DJ: listen for my voice").
- Fill in a Result line for each step: pass, fail, or what you saw.

---

## A. First mic tap and the permission prompt (Chrome, then Opera)

1. Clear site data for localhost:5173, reload /dj. Open DJ settings.
   Do: Read the Microphone line under "Hears you with".
   Expect: "Microphone: the browser will ask the first time you tap the mic. Choose Allow."
   Result:

2. Close settings. Tap the mic button ("Speak your request").
   Do: Watch the speech bubble while the browser prompt is open.
   Expect: The browser shows its microphone permission prompt. The bubble says "Your browser is asking to use the microphone. Choose Allow, then speak." (In Opera the 63 MB download question comes first; see section D, then come back here.)
   Result:

3. Click Allow, then say "play Tum Hi Ho".
   Do: Watch the bubble and the text box.
   Expect: The bubble changes to "Listening…", then your words appear in the text box as you speak. The mic button looks active and its label becomes "Stop listening".
   Result:

4. Open DJ settings again.
   Do: Read the Microphone line.
   Expect: "Microphone: allowed."
   Result:

## B. Blocked microphone, Try again, Voice settings

1. Click the icon at the left of the address bar, open Site settings, set Microphone to Block. Go back to /dj (reload if the browser asks).
   Do: Tap the mic.
   Expect: The bubble shows: "Your browser is blocking the microphone for Allegra. Click the icon at the left of the address bar, open Site settings (or Permissions), set Microphone to Allow, then press Try again." Two buttons appear under it: **Try again** and **Voice settings**.
   Result:

2. Tap **Voice settings**.
   Do: Look at the sheet that opens.
   Expect: The DJ settings sheet opens. The Microphone line reads "Microphone: blocked. Click the icon left of the address bar → Site settings → Microphone → Allow." and is highlighted as a warning.
   Result:

3. Tap **Try again** while still blocked.
   Do: Watch the bubble.
   Expect: The same blocked message returns (no crash, no endless spinner).
   Result:

4. In site settings set Microphone back to Allow. Come back to the tab, tap **Try again** (or the mic).
   Do: Say "play Kesariya".
   Expect: It listens ("Listening…"), your words show in the text box, and the request runs. The Microphone line in settings changes to "Microphone: allowed."
   Result:

5. Insecure page (optional). Open the app by your LAN IP over http.
   Do: Tap the mic.
   Expect: "Browsers only allow the microphone on a secure page. Open Allegra at its https:// address (or http://localhost on this computer) to talk to your DJ." with a **Voice settings** button (no Try again).
   Result:

## C. Chrome: Automatic ears

1. Settings, "Hears you with", Speech to text.
   Do: Make sure it says "Automatic · free". Open the dropdown.
   Expect: Options: Automatic · free, This browser's speech · free, On this device (Whisper) · free, OpenAI · your key, Groq · your key. The line under it says "Recognised on this device: nothing you say leaves it." (if Chrome's on-device pack is installed) or "Your browser recognises your voice with its own speech service. Allegra never receives the audio."
   Result: (write which of the two you saw)

2. Tap the mic and say "play Kesariya".
   Do: Wait for the reply.
   Expect: The song starts playing. The DJ answers in the bubble.
   Result:

3. Tap the mic and say "sing Kesariya".
   Do: Wait for the reply.
   Expect: Karaoke starts on Kesariya.
   Result:

4. Look for the **Recognise on this device instead** button in the "Hears you with" section.
   Do: Note whether it appears. It shows only when Chrome says the pack is downloadable and the engine is the browser's own service.
   Expect: Either it is absent (pack already installed, or Chrome has no on-device support) or it appears.
   Result: (appears / absent)

5. If it appears, click it.
   Do: Watch the button text.
   Expect: It reads "Installing the voice pack…" and is disabled. On success the button disappears and the line under the dropdown changes to "Recognised on this device: nothing you say leaves it." On failure: "The voice pack couldn't be installed. Voice still works through the browser."
   Result:

## D. Opera: straight to on-device listening

1. Clear site data, reload /dj in Opera. Open settings.
   Do: Open the Speech to text dropdown.
   Expect: "This browser's speech · free" is not offered. With Automatic, the line reads "Whisper runs on this device: nothing you say leaves it. It downloads once (about 63 MB)".
   Result:

2. Open DevTools, Network tab, tick "Disable cache" off (leave cache on), filter by "huggingface" or "onnx". Close settings, tap the mic.
   Do: Read the bubble.
   Expect: "Here I listen on your device, so nothing you say leaves it. That needs a one-time 63 MB download." with **Download · 63 MB** and **Not now**.
   Result:

3. Tap **Not now**.
   Do: Watch the bubble.
   Expect: The question goes away; nothing downloads.
   Result:

4. Tap the mic again, then **Download · 63 MB**.
   Do: Watch the bubble and the Network tab.
   Expect: The bubble counts "Getting my ears ready · N%", then "Almost ready, warming up my ears…". Then it starts listening by itself, no second tap. Say "play Tum Hi Ho"; it plays.
   Result:

5. In the Network tab, check which model files were fetched.
   Do: Look at the request URLs.
   Expect: They are under `onnx-community/moonshine-base-ONNX`. If you see `Xenova/whisper-tiny.en` instead, it fell back; write that down.
   Result: (moonshine-base-ONNX / fell back to whisper-tiny.en)

6. Reload the page and tap the mic again.
   Do: Watch for the download question.
   Expect: No question this time (the ready flag is remembered); it listens straight away after the permission step.
   Result:

## E. "Hey DJ"

1. Turn on the ear button (top right of the stage).
   Do: Click it once.
   Expect: It looks pressed (on). Its tooltip reads "“Hey DJ” is on. Say “Hey DJ, play …”". In Opera with models not yet downloaded it first shows the 63 MB download question instead.
   Result:

2. Say "Hey DJ, play Tum Hi Ho".
   Do: Don't touch the mic button.
   Expect: The request runs and Tum Hi Ho plays.
   Result:

3. Say "Hey DJ" alone, pause, then say "skip".
   Do: Wait a second between the two.
   Expect: After "Hey DJ" the DJ starts listening for a follow-up (you have 6 seconds). "skip" then runs as a request.
   Result:

4. Switch to another tab for about 20 seconds, then come back.
   Do: Say "Hey DJ, pause".
   Expect: It is paused while the tab is hidden and listens again when you return. The command works.
   Result:

5. Play music out loud from the speakers (a song through Allegra, or another source) with no one talking.
   Do: Let it run for a minute or two.
   Expect: It does not trigger by itself. (In Opera, utterances longer than 4.5 seconds are ignored as music.)
   Result:

6. Turn the ear button off.
   Do: Click it again.
   Expect: It looks off and "Hey DJ" no longer reacts.
   Result:

7. Set Speech to text to OpenAI or Groq and look at the ear button.
   Do: Click it.
   Expect: The DJ explains: "“Hey DJ” listens all the time, so it only runs with voice on this device. Pick “On this device” under Voice." The settings button reads "Turn on “Hey DJ”" and is disabled.
   Result:

## F. Speaks with

1. Settings, Speaks with, Voice dropdown.
   Do: Open it.
   Expect: Options: Silent, Natural voice on this device · free, This browser's voice · free, OpenAI · your key, ElevenLabs · your key.
   Result:

2. Pick "Natural voice on this device · free".
   Do: Read the text below it.
   Expect: "Kokoro is a natural voice that runs on this device. It downloads once (about 92 MB); until then the browser's voice stands in." A **Download · 92 MB** button and **Hear a sample** appear.
   Result:

3. Tap **Hear a sample** before downloading.
   Do: Listen.
   Expect: The browser's own voice reads the sample (Kokoro stand-in).
   Result:

4. Tap **Download · 92 MB**.
   Do: Watch the button.
   Expect: "Downloading · N%", then "Warming up…", then the Download button disappears. The text becomes "Kokoro speaks on this device: natural, free, and nothing leaves it. The music dips while it talks."
   Result:

5. Start a song playing, then tap **Hear a sample**.
   Do: Listen to the music volume while the DJ talks.
   Expect: The sample says "Hey! I'm your DJ. Ask me for a song, a mood, or say sing along." The music dips to about 30% while it talks and returns to its old volume afterwards.
   Result:

6. Try each of the five voices in the second Voice dropdown, tapping **Hear a sample** each time.
   Do: Heart · warm, Bella · bright, Michael · easy, Emma · British, George · British.
   Expect: Each sounds different and natural; no errors.
   Result: Heart / Bella / Michael / Emma / George:

7. Pick "This browser's voice · free", tap **Hear a sample**.
   Do: Listen and watch the music.
   Expect: The operating system voice reads it. Music still dips and returns.
   Result:

8. Pick "Silent", then ask the DJ for something ("play Kesariya").
   Do: Read the settings text, then listen.
   Expect: Text reads "Your DJ answers in words on screen only." The answer shows in the bubble with no sound. There is no Hear a sample button.
   Result:

9. Pick Natural voice again, then reload the page.
   Do: Tap **Hear a sample**.
   Expect: The choice is remembered, no second download question, and it speaks with Kokoro.
   Result:

## G. Optional: your own keys

Only if you have keys. Keys are not saved; a reload clears them.

1. Speech to text: OpenAI.
   Do: Pick "OpenAI · your key", paste a valid key (model placeholder `gpt-transcribe`), tap the mic and speak.
   Expect: Under the dropdown: "Your request is recorded here and sent to OpenAI to be written down." Your words are transcribed and run.
   Result:

2. Speech to text: Groq.
   Do: Pick "Groq · your key", paste a valid key (model placeholder `whisper-large-v3-turbo`), speak.
   Expect: Same as above, with Groq.
   Result:

3. Wrong ears key.
   Do: Paste a bad key, tap the mic, speak.
   Expect: The bubble shows an error like "OpenAI didn't accept that key. Check it in the DJ's settings."
   Result:

4. No key.
   Do: Pick OpenAI ears with the key empty, tap the mic.
   Expect: "Add your OpenAI key under Voice in the DJ's settings, or pick a free option there."
   Result:

5. Voice: OpenAI.
   Do: Pick "OpenAI · your key", paste a valid key, tap **Hear a sample**.
   Expect: The sample is spoken (voice placeholder `coral`, model `gpt-4o-mini-tts`) and the music dips.
   Result:

6. Voice: ElevenLabs.
   Do: Pick "ElevenLabs · your key", paste a key and a Voice ID, tap **Hear a sample**.
   Expect: The sample is spoken.
   Result:

7. Wrong voice key.
   Do: Paste a bad key, tap **Hear a sample**.
   Expect: A message like "OpenAI didn't accept that key. Check it in the DJ's settings." (or ElevenLabs). The music is not left ducked.
   Result:

8. Reload the page.
   Do: Open settings.
   Expect: The provider choices remain; the key fields are empty.
   Result:

## H. Ctrl+J quick prompt on another page

1. Go to another page (Home, for example). Press Ctrl+J.
   Do: Look above the player bar.
   Expect: A small glass pill ("Ask your DJ") opens with the text box focused.
   Result:

2. Tap the mic in the pill (aria-label "Speak to your DJ").
   Do: Say "play Kesariya".
   Expect: The placeholder shows "Listening…" and your words appear in the box. The permission and download steps behave as in sections A and D.
   Result:

3. After the request runs.
   Do: Look just above the pill.
   Expect: The DJ's reply shows above the pill. If the voice is on, it is also spoken, and the music dips.
   Result:

4. Press Esc.
   Do: Press it with the pill open.
   Expect: The pill closes and focus returns to where it was.
   Result:

5. In Opera, with the model not downloaded, tap the pill's mic.
   Do: Read the line above the pill.
   Expect: "Here I listen on your device, so nothing you say leaves it. That needs a one-time 63 MB download." with **Download · 63 MB** and **Not now** links.
   Result:
