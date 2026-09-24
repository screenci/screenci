# Prompt Cookbook

The prompt itself is generated: the button writes the setup code, the link
to the brief, and the task. The only thing you type is the description, one
sentence in the dialog's field. This page collects descriptions that produce
a good first take, per role and per button, and the few rules behind them.

#### You will learn

- [what makes a description work](#what-makes-a-description-work)
- [descriptions for product marketing](#product-marketing)
- [descriptions for docs and support](#docs-and-support)
- [descriptions for engineering](#engineering)

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

## Product marketing

**Add project** (the first video of a product):

- "Signing up and creating the first project, ending on the empty dashboard
  with the welcome checklist"
- "A 60-second tour of the app for the landing page: dashboard, one report,
  the share dialog"

**Add video** (a feature launch):

- "The new Insights dashboard, ending on the share button"
- "Setting up a Slack notification for failed payments, for existing
  customers who already use the billing page"
- "Vertical video for social: adding a teammate and assigning a role, no
  narration text on screen, subtitles on"

**Edit**:

- "Cut the intro to one sentence and end right after the share dialog opens"
- "Narrate the pricing step in a warmer tone and mention the annual discount"
- "Replace the logo overlay with the new one from Branding"

**Add a language**: pick the language; there is nothing to type. Add a note
under Advanced when the product itself is not localized: "the UI stays in
English, only narration and subtitles change".

## Docs and support

**Add video** (a help-center article):

- "How to invite a teammate and set their role, ending on the pending
  invitation list"
- "Exporting a report to CSV, for admins, skip the filter setup"
- "Recovering a deleted project from the trash within 30 days"

**Add screenshot** (a docs figure):

- "The billing settings page with a filled-in company profile, cropped to the
  form"
- "The dashboard with three projects, dark mode, for the README"
- "The notification settings panel with email and Slack both enabled"

**Edit**:

- "Add a sentence before the save step explaining that changes apply to all
  members"
- "Skip the login and start on the members page"

**Re-record** and **Record all**: nothing to type. Use them after a release
changed the UI under a video.

## Engineering

**Add to CI**: nothing to type. The optional note
under Advanced is for things the agent cannot see:

- "We use GitLab CI; the app needs `pnpm build` before it starts"
- "The staging URL needs the VPN; record against localhost from the
  `apps/web` package instead"
- "Put the workflow next to the existing `e2e.yaml` and reuse its Node cache"

**Add video** from inside the repository, with file references your agent
understands:

- "The onboarding flow in @src/routes/onboarding, ending on the first
  workspace"
- "The API keys page: creating a key, copying it, revoking it; use the seed
  data from @scripts/seed.ts"

**Edit** after a failed CI run:

- "The invite dialog moved to the members page; update the flow and keep the
  narration"
- "Remove the step that clicks the beta banner, it is gone"

## What's next

- [Make videos by prompt](/docs/make-videos) for how the buttons work.
- [Who does what](/docs/roles) for the roles behind these prompts.
- [AI context](/docs/guides/ai-context) for how the agent knows the site and
  the repository without being told in every prompt.
