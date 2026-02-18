# Publishing MLSH to npm Registry

This document provides step-by-step instructions for publishing MLSH to the npm public registry.

## Prerequisites

1. **npm Account**: You must have an npm account. Create one at https://www.npmjs.com/signup if you don't have one.
2. **npm Credentials**: You should be logged in locally via `npm login` or have an auth token configured.
3. **Verified Email**: Your npm account email must be verified.
4. **Package Name**: The package is registered as `mlsh` on npm.

## Pre-Publishing Checklist

Before publishing, ensure:

- ✅ All tests pass: `npm test`
- ✅ package.json has correct version (currently `1.0.0`)
- ✅ package.json has author field (currently `Anomaly Co`)
- ✅ package.json has valid `bin` field pointing to `bin/mlsh`
- ✅ CHANGELOG.md is updated with release notes
- ✅ README.md is current and accurate
- ✅ No sensitive data in git history or files
- ✅ All dependencies are properly declared
- ✅ bin/mlsh file has `#!/usr/bin/env node` shebang

**Status**: All items verified ✅

## Publishing Steps

### Step 1: Authenticate with npm

```bash
npm login
```

You'll be prompted for:
- Username (your npm account username)
- Password
- Email (associated with your npm account)
- One-time password (if 2FA is enabled)

### Step 2: Verify Package Contents

Preview what will be published (optional):

```bash
npm pack --dry-run
```

This shows all files that will be included in the tarball. The package.json `files` field controls what gets published.

### Step 3: Publish to npm Registry

Publish the package:

```bash
npm publish
```

If successful, you'll see output like:
```
npm notice
npm notice 📦  mlsh@1.0.0
npm notice === Tarball Contents ===
npm notice ...
npm notice === Tarball Details ===
npm notice name:          mlsh
npm notice version:       1.0.0
npm notice filename:      mlsh-1.0.0.tgz
npm notice published:     [timestamp]
npm notice ...
```

### Step 4: Verify Publication

Check that the package is publicly available:

```bash
npm view mlsh
```

Or visit: https://www.npmjs.com/package/mlsh

## Post-Publishing

### Update Documentation

Once published, users can install with:

```bash
npm install -g mlsh
```

Update README.md to reflect this:

```bash
# This should be the primary installation method
npm install -g mlsh

# Rather than GitHub install
npm install -g git+https://github.com/anomalyco/mlsh.git
```

### Create a GitHub Release

1. Go to https://github.com/anomalyco/mlsh/releases
2. Click "Draft a new release"
3. Set tag to `v1.0.0`
4. Set release title to `v1.0.0`
5. Copy CHANGELOG.md content into release notes
6. Check "Set as the latest release"
7. Publish the release

### Announce the Release

- Tweet/post about the release
- Update project website/blog
- Share in relevant communities (MarkLogic forums, etc.)

## Version Management

For future releases, follow Semantic Versioning:

- **Patch** (1.0.x): Bug fixes and minor improvements
- **Minor** (1.x.0): New features, backward compatible
- **Major** (x.0.0): Breaking changes

To publish a new version:

```bash
# Update version in package.json
npm version patch    # or 'minor' or 'major'

# This will create a git tag automatically
# Then publish
npm publish

# Push tags to GitHub
git push origin main --tags
```

## Troubleshooting

### "You must be logged in to publish"

```bash
npm login
# Then try again
npm publish
```

### "Package name taken"

The package name `mlsh` is already in use. Choose a different name or contact npm support if you own the name.

### "npm ERR! 403 Forbidden"

You don't have permission to publish to this package. Possible causes:
- Not logged in as the correct user
- Not the package owner
- Email not verified in npm account

### "You do not have permission to publish 'mlsh'"

The package name is owned by another user. To publish MLSH:
- Use a scoped package name like `@username/mlsh`
- Contact the current owner to request access
- Create a fork with a different name

**For Anomaly Co**: If the `mlsh` package is available, you can publish. If not, consider using `@anomalyco/mlsh`.

## Scoped Packages (Alternative)

If you want to publish under an organization scope:

```bash
# In package.json:
{
  "name": "@anomalyco/mlsh",
  ...
}

# Then publish:
npm publish --access public
```

Users would install with:
```bash
npm install -g @anomalyco/mlsh
```

## npm 2FA (Two-Factor Authentication)

If your account has 2FA enabled, npm will prompt for a one-time password during:
- `npm login`
- `npm publish`
- `npm unpublish`

Keep your authenticator app handy.

## Key Resources

- npm Registry: https://www.npmjs.com/
- MLSH Package: https://www.npmjs.com/package/mlsh (once published)
- npm Publishing Guide: https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages
- Semantic Versioning: https://semver.org/

## Current Status

**Ready to Publish**: ✅

All prerequisites met. When you're ready:

1. Run `npm login`
2. Run `npm publish`
3. Verify at https://www.npmjs.com/package/mlsh
