/**
 * Fails fast when a release tag and package.json disagree (#318). electron-builder names
 * every installer from package.json, so tagging v0.4.0 on a 0.3.0 package.json would
 * publish "Vault-0.3.0.dmg" under a v0.4.0 release, and the in-app update check would
 * keep telling users a newer version exists.
 *   node scripts/check-release-version.cjs v0.4.0
 */
const { version } = require('../package.json')
const lock = require('../package-lock.json')
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || ''
const problems = []
// A hyphenated suffix (v0.6.0-rc.1) is a pre-release; the release job publishes it as one.
if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(tag)) problems.push(`tag "${tag}" is not vX.Y.Z or vX.Y.Z-pre`)
if (tag && tag.slice(1) !== version) problems.push(`tag ${tag} does not match package.json version ${version}`)
if (lock.version !== version) problems.push(`package-lock.json version ${lock.version} does not match package.json ${version}`)
if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`)
  console.error('Bump with `npm version X.Y.Z --no-git-tag-version`, merge, then tag that commit.')
  process.exit(1)
}
console.log(`OK: ${tag} matches package.json ${version}`)
