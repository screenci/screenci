---
title: Editing by Typing
description: Update your videos without re-recording everything.
---

ScreenCI eliminates the need for expensive reshoots. By decoupling the video script from the rendered output, we allow you to make changes to your product videos as easily as you edit a blog post.

## The "Edit by Typing" Workflow

The core of ScreenCI is our **Typed Edit** engine. Every video is backed by a human-readable script.

### 1. Updating Narration

Need to change what the narrator says?

- Open the video in the ScreenCI dashboard.
- Go to the **Narration** tab.
- Change "Click the blue button" to "Click the primary action button."
- AI generates the new audio and re-renders the video to match the new duration instantly.

### 2. Modifying UI Interactions

Did your developers change a button ID or move a menu?

- You don't need to record again.
- Simply update the line in your script: `await page.click('#old-id')` &rarr; `await page.click('#new-id')`.
- Trigger a **Cloud Refresh** to see the updated UI in the video.

## Version Control

Because your videos are based on scripts, you get all the benefits of software versioning:

- **Diffing**: See exactly what changed between two versions of a video.
- **Rollbacks**: Revert to a previous state of the video instantly if a new UI change is buggy.
- **Branching**: Create video variants for different feature branches.

## Why this matters

In traditional video production, a 5-word change in a script can mean a 2-hour reshoot and half a day of editing. With ScreenCI, a 5-word change takes **5 seconds of typing** and is live on your production docs 2 minutes later.
