---
title: Deployment Automation
description: Automate your video rendering on every deployment.
---

Automation ensures your product videos always match your production environment. ScreenCI allows you to integrate video rendering directly into your development workflow.

## Deployment Strategies

### Managed Cloud Renders

The recommended way to use ScreenCI. We handle the heavy lifting of browser provisioning and video encoding.

1. **Trigger**: Connect your GitHub or GitLab repository.
2. **Render**: On every push or merged PR, ScreenCI spins up a headless browser in our cloud.
3. **Deploy**: The resulting 4K video is optimized and served via our CDN instantly.

### Self-Hosted CI Recording

For enterprise teams with strict security requirements or applications behind a private VPN.

- **Run Locally**: Use the ScreenCI CLI inside your own GitHub Actions, Jenkins, or CircleCI runner.
- **Upload Metadata**: Your CI only sends the UI interaction metadata and raw frames to our API.
- **Privacy**: No external access to your internal staging environments is required.

## Monitoring & Alerts

A broken video is worse than no video. ScreenCI monitors every render and notifies you if a UI change breaks your flow.

### Slack Integration

Connect your team's Slack workspace to receive real-time alerts.

- **Success Notifications**: Confirm when a new video is live on production.
- **Failure Alerts**: Get deep-links to the failing step and logs the moment a selector isn't found.

### Email Summaries

For teams that prefer a daily or weekly digest of their video health.

## Embedding Videos

### Permanent Links

Every ScreenCI video comes with a permanent URL. This is the "magic" of our platform:

- **Embed once**: Copy the code snippet into your documentation once.
- **Update everywhere**: When your CI triggers a new render, the video at that permanent URL is swapped out. You never have to touch your site's code again.
