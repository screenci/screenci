export default {
  '*.{js,ts,mjs}': ['prettier --write', 'eslint --fix'],
  '*.{ts}': (filenames) => [
    'npm run type-check',
    `npm exec vitest related ${filenames.join(' ')} --run`,
  ],
  '*.{json,md,mdx,yml,yaml,html}': ['prettier --write'],
}
