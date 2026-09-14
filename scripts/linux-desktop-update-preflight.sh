#!/usr/bin/env bash
# Read-only environment evidence. This entry never installs a package or changes authorization policy.
set -euo pipefail
if [[ "$(uname -s)" != Linux ]]; then
  printf '%s\n' 'Native Linux is required for update preflight.' >&2
  exit 78
fi
[[ "$#" == 1 ]]
/usr/bin/python3 -I -S - "$1" <<'PY'
import ctypes, datetime, json, os, pathlib, platform, shutil, stat, subprocess, sys

def query(argv):
    if shutil.which(argv[0]) is None:
        return {'available': False, 'exitCode': None, 'output': ''}
    try:
        result = subprocess.run(argv, text=True, capture_output=True, timeout=5,
                                env={**os.environ, 'LC_ALL': 'C'})
        return {'available': True, 'exitCode': result.returncode,
                'output': result.stdout[:32768], 'error': result.stderr[:2048]}
    except subprocess.TimeoutExpired:
        return {'available': True, 'exitCode': None, 'timeout': True}

release = {}
for line in pathlib.Path('/etc/os-release').read_text().splitlines():
    if '=' in line:
        key, value = line.split('=', 1)
        if key in ['ID', 'VERSION_ID', 'PRETTY_NAME']:
            release[key] = value.strip('"')
fuse = pathlib.Path('/dev/fuse')
restriction = pathlib.Path('/proc/sys/kernel/apparmor_restrict_unprivileged_userns')
result = {
    'schemaVersion': 1, 'recordedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'platform': platform.system(), 'architecture': platform.machine(), 'kernel': platform.release(),
    'osRelease': release, 'uid': os.getuid(),
    'displayAvailable': bool(os.environ.get('DISPLAY')),
    'sessionType': os.environ.get('XDG_SESSION_TYPE', 'unknown'),
    'sessionBusConfigured': bool(os.environ.get('DBUS_SESSION_BUS_ADDRESS')),
    'systemBusSocket': pathlib.Path('/run/dbus/system_bus_socket').exists(),
    'fuseCharacterDevice': fuse.exists() and stat.S_ISCHR(fuse.stat().st_mode),
    'userNamespaceRestriction': restriction.read_text().strip() if restriction.exists() else 'unavailable',
    'renameat2': {'python': sys.executable, 'isolatedMode': bool(sys.flags.isolated),
                  'libcSymbolAvailable': hasattr(ctypes.CDLL(None), 'renameat2'),
                  'requiredFlag': 'RENAME_NOREPLACE=1',
                  'filesystemAcceptance': 'not-tested; backend probes private files on the selected installation filesystem'},
    'packageKit': query(['gdbus', 'introspect', '--system', '--dest', 'org.freedesktop.PackageKit',
                         '--object-path', '/org/freedesktop/PackageKit']),
    'packageVersions': query(['dpkg-query', '-W', '-f=${Package}\t${Version}\t${Status}\n',
                              'packagekit', 'policykit-1', 'polkitd', 'libfuse2', 'libfuse2t64']),
    'systemdRun': query(['systemd-run', '--version']),
    'userManager': query(['systemctl', '--user', 'show', '--property=Version', '--value']),
    'authorizationInteraction': 'not-tested; process or service presence does not prove a working polkit agent',
    'transactionIntrospection': 'not-tested; no PackageKit transaction was created',
    'packageInstallation': 'not-performed', 'appImageReplacement': 'not-performed',
}
target = pathlib.Path(sys.argv[1])
target.parent.mkdir(parents=True, exist_ok=True)
with target.open('x') as output:
    json.dump(result, output, indent=2)
    output.write('\n')
print(json.dumps({'evidence': str(target), 'osRelease': release, 'nativeAuthorizationAcceptance': False}))
PY
