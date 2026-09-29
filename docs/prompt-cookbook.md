# Prompt Cookbook

The prompt itself is generated: the button writes the setup code, the link
to the brief, and the task. The only thing you type is the description, one
sentence in the dialog's field. This page collects descriptions that produce
a good first take, per button, and the few rules behind them.

#### You will learn

- [what makes a description work](#what-makes-a-description-work)
- [descriptions for Add project](#add-project)
- [descriptions for Add video](#add-video)
- [descriptions for Add screenshot](#add-screenshot)
- [descriptions for Edit](#edit)
- [the buttons with nothing to type](#nothing-to-type)

## What makes a description work

- **Name the flow and where it ends.** "Creating the first invoice, ending on
  the sent confirmation" tells the agent where to start and where to stop.
- **Name the audience** when it changes the tone: "for new customers on the
  free plan", "for admins".
- **Say what to skip.** "Skip the login and the empty state" keeps setup out
  of the video. Sign-in is never recorded anyway; see
  [Signing In](/docs/guides/signing-in).
- **Use the product's own words.** The agent narrates with the nouns you use:
  "workspace", "deal", "run".
- **One flow per video.** Two flows are two Add video prompts, and each
  re-records independently later.
- **Leave the look to Branding.** Background, size, cursor, and default voice
  come from [Branding](/docs/guides/branding); mention them only to deviate.

Descriptions for **Edit** say what should change, not how: "make the intro
shorter and narrate the export step", never selectors or file names.

## Add project

The first video of a product. Say where the tour starts and ends:

- "Signing up and creating the first project, ending on the empty dashboard
  with the welcome checklist"
- "A 60-second tour of the app for the landing page: dashboard, one report,
  the share dialog"

## Add video

One flow per video, named in the product's own words:

- "The new Insights dashboard, ending on the share button"
- "Setting up a Slack notification for failed payments, for existing
  customers who already use the billing page"
- "Vertical video for social: adding a teammate and assigning a role, no
  narration text on screen, subtitles on"
- "How to invite a teammate and set their role, ending on the pending
  invitation list"
- "Exporting a report to CSV, for admins, skip the filter setup"
- "Recovering a deleted project from the trash within 30 days"
- "Highlight the export button and show the keyboard shortcut for it"

From inside the repository, file references your agent understands work too:

- "The onboarding flow in @src/routes/onboarding, ending on the first
  workspace"
- "The API keys page: creating a key, copying it, revoking it; use the seed
  data from @scripts/seed.ts"

## Add screenshot

A docs figure or README image, with the state and the crop:

- "The billing settings page with a filled-in company profile, cropped to the
  form"
- "The dashboard with three projects, dark mode, for the README"
- "The notification settings panel with email and Slack both enabled"

## Edit

Say what should change, not how:

- "Cut the intro to one sentence and end right after the share dialog opens"
- "Narrate the pricing step in a warmer tone and mention the annual discount"
- "Replace the logo overlay with the new one from Branding"
- "Point out the Save button with a callout on the second step, and number
  the three fields of the form"
- "Add a sentence before the save step explaining that changes apply to all
  members"
- "Skip the login and start on the members page"

After a failed CI run, describe what moved:

- "The invite dialog moved to the members page; update the flow and keep the
  narration"
- "Remove the step that clicks the beta banner, it is gone"

## Nothing to type

- **Add a language**: pick the language. Add a note under Advanced when the
  product itself is not localized: "the UI stays in English, only narration
  and subtitles change".
- **Re-record** and **Record all**: use them after a release changed the UI
  under a video.
- **Add to CI**: the optional note under Advanced is for things the agent
  cannot see:
  - "We use GitLab CI; the app needs `pnpm build` before it starts"
  - "The staging URL needs the VPN; record against localhost from the
    `apps/web` package instead"
  - "Put the workflow next to the existing `e2e.yaml` and reuse its Node cache"

## What's next

- [Make videos by prompt](/docs/make-videos) for how the buttons work.
- [AI context](/docs/guides/ai-context) for how the agent knows the site and
  the repository without being told in every prompt.
