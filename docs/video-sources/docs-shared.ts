import type { Page } from '@playwright/test'

export async function waitForDocHeading(page: Page, name: string) {
  await page.getByRole('heading', { level: 1, name }).first().waitFor()
}

export async function openSourceDetails(page: Page) {
  await page.getByText('Show source').first().click()
}

export async function clickContentLink(page: Page, name: string) {
  await page
    .locator('.sl-markdown-content')
    .getByRole('link', { name, exact: true })
    .first()
    .click()
}
