#!/bin/bash
set -euo pipefail
PACKAGE="$1"
KEEP="${2:-3}"

PACKAGE="$PACKAGE" KEEP="$KEEP" python3 - <<'PY'
import json, os, urllib.error, urllib.request

repo = os.environ['GITHUB_REPOSITORY']
package = os.environ['PACKAGE']
keep = int(os.environ['KEEP'])
base = f'https://api.github.com/repos/{repo}/packages/container/{package}/versions'
headers = {
    'Authorization': f"Bearer {os.environ['GH_TOKEN']}",
    'Accept': 'application/vnd.github+json',
}


def call(url, method='GET'):
    req = urllib.request.Request(url, method=method, headers=headers)
    with urllib.request.urlopen(req) as resp:
        body = resp.read()
    return json.loads(body) if body else None


def tags(version):
    return version.get('metadata', {}).get('container', {}).get('tags') or []


def label(version):
    return f"{version['id']} [{','.join(tags(version)) or '(untagged)'}]"


versions = []
page = 1
while True:
    try:
        batch = call(f'{base}?per_page=100&page={page}')
    except urllib.error.HTTPError as err:
        if err.code == 404 and page == 1:
            print(f'Package {package} not found, nothing to clean up')
            raise SystemExit(0)
        raise
    if not batch:
        break
    versions.extend(batch)
    page += 1

versions.sort(key=lambda v: v['created_at'], reverse=True)
tagged = [v for v in versions if tags(v)]

# 未打标签的版本可能是保留版本的 attestation/平台子清单，故以最旧保留版本的时间为界向前清理
cutoff = tagged[keep - 1]['created_at'] if len(tagged) > keep else None
stale = [v for v in versions if cutoff and v['created_at'] < cutoff]

for v in tagged[:keep]:
    print('Keeping', label(v))
for v in stale:
    print('Deleting', label(v))
    try:
        call(f"{base}/{v['id']}", method='DELETE')
    except urllib.error.HTTPError as err:
        print('  Failed:', err.code, err.read()[:200].decode('utf-8', 'replace'))

print(f'Kept {min(len(tagged), keep)} tagged version(s), deleted {len(stale)}')
PY