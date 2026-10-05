# Claude Mail Sorter

A Thunderbird add-on that uses Claude to sort your email.

- **Folders:** files each email into the best existing folder, or leaves it where it is.
- **Spam:** marks junk and moves it to the Spam folder.
- **Important mail:** flags emails that need your attention.
- **Tags:** applies your existing tags, and can optionally create new topic tags.
- **OTP codes:** files one-time passwords into an `OTP` folder and can delete them after a set number of days.
- **Starter folders:** one click creates Work, Personal, Finance, Shopping, Travel, Newsletters, Social, Notifications and OTP.
- **Inbox sweep:** sorts mail that arrived while Thunderbird was closed, on demand or at startup.
- **Activity log:** shows everything Claude did, with undo.

Works with Proton Mail Bridge: starter folders go inside `Folders`, and Proton's virtual views (All Mail, Starred, Labels) are never used as sort targets.

## Install

Requires Thunderbird 128 or later and an [Anthropic API key](https://console.anthropic.com/).

1. Build the add-on:
   ```sh
   zip -r claude-mail-sorter.xpi manifest.json background.js icons options log
   ```
2. In Thunderbird, open **Add-ons and Themes → ⚙ → Install Add-on From File** and pick `claude-mail-sorter.xpi`.
3. Open the add-on's settings (or click its toolbar button) and paste your API key.

For development, load `manifest.json` via **Debug Add-ons → Load Temporary Add-on**.

## Use

- Right-click emails and choose **Sort with Claude**.
- Turn on **Sort new mail automatically** to sort mail as it arrives.
- Use **Sort Inbox now** to sort up to 200 of the newest unsorted Inbox emails.

## Privacy and cost

- Each sorted email (headers and up to 20,000 characters of body text) is sent to the Anthropic API.
- Your API key is stored unencrypted in Thunderbird's add-on storage.
- Each email is one API call. The default model is Claude Haiku 4.5; you can change it in settings.
- Claude can only choose folders and tags that exist (or tags you allow it to create), so an email cannot instruct it to do anything else.
