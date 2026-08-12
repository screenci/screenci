# Organisation & SSO

An organisation groups the people who share a ScreenCI account: its projects,
videos, billing, and API keys. Organisation settings let you invite and manage
members, assign roles, and (on the Business plan) enforce single sign-on so your
team authenticates through your own identity provider.

> Organisation settings are a Business feature. Lower tiers can still record and
> render; managing members and enabling SSO / SAML requires the Business plan.

#### You will learn

- [what an organisation is](#what-an-organisation-is)
- [members and roles](#members-and-roles)
- [single sign-on](#single-sign-on-sso--saml)

## What an organisation is

Everything you create in ScreenCI belongs to an organisation: projects, their
videos and versions, the ElevenLabs key used for custom voices, and the
`SCREENCI_SECRET` API keys that authenticate CLI uploads. Billing and plan tier
are set at the organisation level, so every member shares the same limits.

## Members and roles

Invite teammates to your organisation and manage them from the organisation
settings page. Plans include a number of member seats (Business includes 10);
on Business, extra seats beyond the included cap are billed at $10 per seat per
month on your invoice. Each member has a role:

- **Admin**: manage members, roles, billing, and organisation settings.
- **Member**: record, render, and edit within the organisation's projects.

## Single sign-on (SSO / SAML)

On the Business plan you can connect your identity provider so members sign in
through your company's SSO using SAML. This centralises access control:
onboarding and offboarding happen in your identity provider, and access to
ScreenCI follows automatically.
