import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
async function updateProjectToUseLocalTarball(
  projectDir: string,
  packageRoot: string
): Promise<void> {
  const packageJsonPath = resolve(packageRoot, 'package.json')
  const projectPackageJsonPath = resolve(projectDir, 'package.json')

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    name: string
    version: string
  }

  const projectPackageJson = JSON.parse(
    await readFile(projectPackageJsonPath, 'utf8')
  ) as {
    dependencies?: Record<string, string>
  }

  const tarballName = `${packageJson.name}-${packageJson.version}.tgz`
  projectPackageJson.dependencies ??= {}
  projectPackageJson.dependencies['screenci'] = `file:../${tarballName}`

  await writeFile(
    projectPackageJsonPath,
    JSON.stringify(projectPackageJson, null, 2) + '\n'
  )
}

async function main(): Promise<void> {
  const packageRoot = process.cwd()
  const projectDir = resolve(packageRoot, 'smoke-project')

  await updateProjectToUseLocalTarball(projectDir, packageRoot)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
