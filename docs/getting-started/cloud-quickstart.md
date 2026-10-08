# Quickest setup with a cloud model

**Who this is for:** you don't want to download a local AI model, or your computer is short on
memory, and you're fine with a cloud AI service reading the relevant parts of your notes when you
ask a question.

**In about 10 minutes you'll have:** Vault connected to a cloud model with your own API key, a
tested connection, and a cited answer from the built-in guide notes.

## 1. Install

Download Vault from the
[Releases page](https://github.com/tosin2013/local-knowledge-vault/releases) and open it. The
[README](../../README.md#download) has the macOS and Linux first-run notes.

## 2. Get an API key

Create a key with any provider Vault has a preset for: **OpenAI**, **Anthropic (Claude)**,
**Google Gemini**, **OpenRouter**, **Mistral**, **DeepSeek**, **Together AI**, **Groq** or
**xAI (Grok)**. Any other service that speaks the OpenAI API works through
**Custom (OpenAI-compatible)**. OpenRouter is a good first pick because one key reaches many
models, including free ones (model `openrouter/free`).

## 3. Your first session

1. **Open the provider form.** On first launch, with no local model running, Ask shows a card
   titled **Vault runs on local models**. Click **Use a cloud model instead**. You can also click
   the AI chip at the top of the window, then **Add provider**.
2. **Fill it in.** In **Add provider**:
   - choose your service under **Preset**. **Base URL** and **Model** fill in for you.
   - paste your key into **API key**.
   - optionally click **Fetch models** to pick from the provider's live model list.
3. **Test it.** Click **Test connection**. A green box like
   **Connected · 420 ms · openrouter/auto · replied "OK"** means it works. A red box shows the
   exact error, for example a wrong key.
4. **Save.** Click **Save**. The chip at the top now reads something like
   **Cloud · OpenRouter · openrouter/auto**.
5. **Ask.** Type `What is PARA?` in the box at the bottom and press Enter. The built-in
   **Vault guide** notes answer it with numbered citations like **[1]**. Click one to open the note.

## 4. What to expect

- **Cited answers.** Each claim ends in a number, with matching source chips below.
- **A cloud badge on every cloud answer.** In the default **Auto** mode Vault tries local models
  first, so an answer from your cloud provider shows **Cloud fallback · OpenRouter** (or your
  provider's name). If you pick that provider directly under **Use** (switch on **Advanced**
  first), the badge reads **Cloud · …**. Hover over the badge for details.
- **Honest gaps:** "I couldn't find that in your notes" when nothing matches. That one is
  answered without calling the model at all.

## 5. What gets sent, and where your key goes

- **Sent to the provider when you ask:** your question, the matching note passages and recent
  turns of the chat. Nothing is sent until you ask something, apart from **Test connection** and
  **Fetch models**.
- **Not sent:** the rest of your notes. Search runs on your computer.
- **Add from URL** also asks the active model to tag the page, so a cloud provider receives an
  excerpt of it.
- **Your key** is never shown again after you save it. It's stored encrypted with your system
  keychain where one is available. If there's none (for example Linux without a keyring), it's
  saved as a file only your account can read, and **AI providers** tells you so.
- You can also supply a key as an environment variable, such as `OPENROUTER_API_KEY` or
  `OPENAI_API_KEY`. See [docs/providers.md](../providers.md#where-keys-live).

## 6. Tips and limits

- **Model names change often.** If the default model stops working, use **Fetch models** in the
  provider form (click the AI chip, switch on **Advanced**, then the edit button on the provider)
  to pick a current one.
- **Changing your mind later:** install a local model ([Local AI and privacy](local-and-private.md))
  and **Auto** will use it first. **Auto — local only (never cloud)** stops cloud use entirely.
- **Search still works** if the provider is down or you're offline: switch the toggle from **Ask**
  to **Find**.

## Next steps

- [Readers and note-takers](readers.md) or [Students and exam prep](students.md): add your own
  material.
- [docs/providers.md](../providers.md): every preset, default model and setting.
