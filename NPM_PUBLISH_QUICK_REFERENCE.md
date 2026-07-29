# NPM Publishing Commands

When you're ready to publish MLSH to the npm registry, use these commands:

## Quick Publishing Guide

### 1. Login to npm (first time only)

```bash
npm login
```

This will prompt for:
- Username
- Password  
- Email
- One-time password (if 2FA enabled)

### 2. Publish to npm Registry

```bash
npm publish
```

### 3. Verify Publication (optional)

```bash
npm view mlsh
```

Or check online: https://www.npmjs.com/package/mlsh

---

## Publishing Complete Workflow

If you want to do a full workflow from start to finish:

```bash
# 1. Verify all tests pass
npm test

# 2. Preview package contents (optional)
npm pack --dry-run

# 3. Login to npm
npm login

# 4. Publish
npm publish

# 5. Verify it was published
npm view mlsh

# 6. Create a git tag and push
git tag v1.0.0
git push origin main --tags
```

---

## For Future Releases

To publish a new version with automatic git tagging:

```bash
# This updates version, creates git commit, and git tag
npm version patch    # or 'minor' or 'major'

# Push the changes and tags
git push origin main --tags

# Publish the new version
npm publish
```

---

## Current Package Status

✅ **Ready to Publish**

- Package name: `mlsh`
- Version: `1.0.0`
- Tests: All 15 passing
- Author: Anomaly Co
- License: ISC
- Repository: https://github.com/anomalyco/mlsh

Once published, users can install with:

```bash
npm install -g mlsh
```

---

## Important Notes

1. **npm Account Required**: You need an npm account with verified email
2. **Authentication**: Must be logged in via `npm login`
3. **Package Name Availability**: The name `mlsh` must be available
4. **One-Time Only**: First publish uses `npm publish`
5. **Future Updates**: Use `npm version` + `npm publish` for new releases
6. **2FA Support**: If your npm account has 2FA, you'll need OTP during publish

---

## Full Documentation

See [PUBLISHING.md](./PUBLISHING.md) for detailed instructions, troubleshooting, and best practices.
